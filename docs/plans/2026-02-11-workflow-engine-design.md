# Durable Workflow Engine — Design

Single Durable Object class that runs all workflow types with replay-based step checkpointing, typed events, and sharded observability.

## Architecture

One DO class (`WorkflowRunner`), one binding, one migration. Workflow types are plain classes registered in a typed map. Adding a workflow is a pure code change — no config updates.

```jsonc
// wrangler.jsonc — never grows
{
	"durable_objects": {
		"bindings": [{ "class_name": "WorkflowRunner", "name": "WORKFLOW_RUNNER" }],
	},
	"migrations": [{ "new_sqlite_classes": ["WorkflowRunner"], "tag": "v1" }],
}
```

### Registry

```typescript
const registry = {
	test: TestWorkflow,
	payment: PaymentWorkflow,
} as const;
```

### Creating a workflow

```typescript
const instance = await TestWorkflow.create(env, {
	id: 'unique-instance-id',
	payload: { name: 'World' },
});
```

`create` resolves `env.WORKFLOW_RUNNER.idFromName(id)`, calls `initialize()` on the stub, which stores the type + payload and begins the replay loop. Same ID = same instance.

The DO is thin — it holds the replay engine, step context, and alarm handler. All business logic lives in the workflow classes.

## Step API

The `step` object is passed to every workflow's `run()` method. Three primitives:

### `step.do(name, fn, options?)`

Execute a retryable unit of work. Returns cached result on replay.

```typescript
const user = await step.do(
	'fetch-user',
	async () => {
		return await api.getUser(payload.userId);
	},
	{ retries: { limit: 5, delay: '2s', backoff: 'exponential' } },
);
```

### `step.sleep(name, duration)`

Pause the workflow. Sets a DO alarm and hibernates.

```typescript
await step.sleep('wait-for-cooling-period', '24 hours');
```

### `step.waitForEvent(name, options?)`

Block until an external event arrives or timeout expires. Returns the event payload.

```typescript
const approval = await step.waitForEvent<{ approved: boolean }>('wait-for-approval', {
	timeout: '7 days',
});
```

### Workflow-level defaults

```typescript
class PaymentWorkflow implements Workflow<PaymentPayload, PaymentResult> {
	static defaults = {
		retries: { limit: 3, delay: '1s', backoff: 'exponential' },
	};

	async run(step: Step<typeof PaymentWorkflow.events>, payload: PaymentPayload) {
		// steps inherit defaults unless they override
	}
}
```

Step names must be unique within a workflow and deterministic — no `step.do(`step-${Date.now()}`, ...)`.

## Type-Safe Events

Events are type-safe at three points: where they're defined, where they're awaited, and where they're sent.

### Event map on the workflow class

```typescript
class PaymentWorkflow implements Workflow<PaymentPayload, PaymentResult> {
	static events = {
		approval: {} as { approved: boolean; reviewer: string },
		'refund-requested': {} as { reason: string; amount: number },
	};

	async run(step: Step<typeof PaymentWorkflow.events>, payload: PaymentPayload) {
		const approval = await step.waitForEvent('approval', { timeout: '7d' });
		//    ^ typed as { approved: boolean; reviewer: string }

		await step.waitForEvent('typo'); // compile error
	}
}
```

### Sending events from outside

Static helpers on the workflow subclass — type flows from the class, no registry lookup needed:

```typescript
await PaymentWorkflow.sendEvent(env, {
	id: 'payment-123',
	event: 'approval',
	payload: { approved: true, reviewer: 'alice' },
});
```

`PaymentWorkflow.sendEvent` knows the event map from `static events`. Under the hood it resolves to `env.WORKFLOW_RUNNER.get(id)` and calls the DO's RPC method.

### All control methods on the subclass

```typescript
const instance = await PaymentWorkflow.create(env, { id: "pay-123", payload: {...} });
const status   = await PaymentWorkflow.status(env, "pay-123");
await PaymentWorkflow.sendEvent(env, { id: "pay-123", event: "approval", payload: {...} });
await PaymentWorkflow.pause(env, "pay-123");
await PaymentWorkflow.resume(env, "pay-123");
await PaymentWorkflow.terminate(env, "pay-123");
```

These come from a base class — workflow authors just declare `events`, `defaults`, and `run()`.

For workflows with no events, omit `static events`. `step.waitForEvent` becomes a compile error.

## Replay Engine

When a workflow starts or resumes (after sleep, eviction, or event), the `run()` method is called from the top. The `step` object decides whether to execute or return a cached result.

### Replay logic for `step.do()`

1. Check storage for a row with this step name
2. If `status = completed` — return cached result (skip execution)
3. If no row or `status = failed` with remaining retries — execute the function
4. On success — write result to storage, return it
5. On failure — increment attempts, apply retry delay. If retries exhausted, mark workflow as `errored`

### For `step.sleep()`

1. Check storage — if completed, skip
2. If no row — write a `sleeping` row with wake time, set DO alarm, throw `SleepInterrupt`
3. When alarm fires — mark step `completed`, restart `run()` from top (replay skips all prior steps)

### For `step.waitForEvent()`

1. Check storage — if completed, return cached event payload
2. If no row — write a `waiting` row with timeout, set alarm for timeout, throw `WaitInterrupt`
3. When `sendEvent()` is called — write event payload to step row, mark completed, restart `run()`
4. If timeout alarm fires first — mark step as failed with timeout error

### Alarm management

DOs support a single alarm. Pending wake-ups (sleeps and event timeouts) are stored as a sorted list. The alarm is set to the earliest one. When it fires, process the due item and set the next alarm.

Events resolve instantly when they arrive via `sendEvent()` (RPC call to the DO), not on a poll cycle. The alarm is just a fallback for timeouts.

`SleepInterrupt` and `WaitInterrupt` are caught by the runner — they're control flow, not errors.

## Retry System

Global default + per-step override. A sensible default (e.g., 3 retries, exponential backoff) means most steps just work. Override on specific steps that need different behavior.

```typescript
class PaymentWorkflow implements Workflow<PaymentPayload, PaymentResult> {
  static defaults = {
    retries: { limit: 3, delay: "1s", backoff: "exponential" },
  };

  async run(step: Step, payload: PaymentPayload) {
    // Uses default retry policy
    const user = await step.do("fetch-user", async () => { ... });

    // Override for this step
    const charge = await step.do("charge-card", async () => { ... }, {
      retries: { limit: 5, delay: "2s", backoff: "exponential" },
    });
  }
}
```

## Workflow Lifecycle

### Status transitions

```
created -> running -> completed
                   -> errored (retries exhausted)
                   -> paused (manual)
                   -> sleeping (alarm pending)
                   -> waiting (event pending)
                   -> terminated (manual)
```

### Control methods (RPC on the DO)

- `status()` — current status, type, step history, timestamps
- `pause()` — sets flag in storage; replay loop checks before each step, throws `PauseInterrupt`
- `resume()` — clears pause flag, restarts replay loop
- `terminate()` — marks `terminated`, cancels pending alarm
- `sendEvent(name, payload)` — writes event data to matching step, restarts replay

## Observability

All workflows share one DO class, so CF dashboard won't distinguish them. We build our own using sharded index DOs of the same class.

### Index shards

Some WorkflowRunner DO instances are workflows, others are indexes. Index instances are sharded by workflow type.

When a workflow creates or transitions status, it writes to its type's index shard:

```typescript
const indexId = env.WORKFLOW_RUNNER.idFromName("__index:payment");
const indexStub = env.WORKFLOW_RUNNER.get(indexId);
await indexStub.indexWrite({ id: "payment-123", status: "running", ... });
```

### Querying

List by type hits one shard:

```
GET /workflows?type=payment -> queries __index:payment DO
```

List across all types fans out to all registry keys in parallel:

```typescript
const results = await Promise.all(Object.keys(registry).map((type) => getIndexShard(env, type).list(filters)));
```

### Role detection

The `__index:` prefix in the DO ID distinguishes index shards from workflow instances.

### API

```
GET    /workflows?type=payment&status=running&limit=50
GET    /workflows/:id
POST   /workflows/:id/pause
POST   /workflows/:id/resume
POST   /workflows/:id/terminate
POST   /workflows/:id/events/:name
```

List endpoint queries index shards (summaries). Detail endpoint hits the DO directly (full step history).

## Storage with Drizzle

All DO storage goes through Drizzle ORM using the `durable-sqlite` driver.

### Initialization

```typescript
import { drizzle, DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import migrations from '../drizzle/migrations';

export class WorkflowRunner extends DurableObject<Env> {
	db: DrizzleSqliteDODatabase;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.db = drizzle(ctx.storage, { logger: false });
		ctx.blockConcurrencyWhile(() => migrate(this.db, migrations));
	}
}
```

### Schema

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Used by workflow instances
export const steps = sqliteTable('steps', {
	name: text('name').primaryKey(),
	result: text('result'),
	status: text('status').notNull(),
	attempts: integer('attempts').default(0),
	completedAt: integer('completed_at'),
});

// Used by index shard instances
export const instances = sqliteTable('instances', {
	id: text('id').primaryKey(),
	status: text('status').notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull(),
});
```

### Drizzle Kit config

```typescript
// drizzle.config.ts
export default defineConfig({
	out: './drizzle',
	schema: './src/db/schema.ts',
	dialect: 'sqlite',
	driver: 'durable-sqlite',
});
```

## File Structure

```
src/
  index.ts                  # Hono HTTP handler + API routes
  db/
    schema.ts               # Drizzle schema (steps + instances tables)
  engine/
    workflow-runner.ts       # The single DO class
    replay.ts               # Replay engine + step context
    step.ts                 # Step API (do, sleep, waitForEvent)
    types.ts                # Workflow, Step, event map types
  workflows/
    registry.ts             # Typed workflow registry map
    test-workflow.ts         # Example workflow
    payment-workflow.ts      # Example workflow
drizzle/
  migrations/               # Generated by drizzle-kit
drizzle.config.ts
wrangler.jsonc
```
