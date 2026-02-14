# Ablauf Unified API Design

## Problem

Configuration is fragmented across three separate functions that each need overlapping inputs:

```typescript
// Current: three separate configs, duplicated knowledge
const ablauf = new Ablauf(env.WORKFLOW_RUNNER, shardConfigs);
const workflows = [TestWorkflow, EchoWorkflow];

export const WorkflowRunner = createWorkflowRunner({
	workflows: [TestWorkflow, [EchoWorkflow, { shards: 4 }]],
});

const dashboardHandler = createDashboardHandler({
	binding: env.WORKFLOW_RUNNER,
	workflows,
	shardConfigs,
});
```

Workflows, binding, and shard configs are repeated. The dashboard handler had a bug because it didn't know about shards — a direct result of fragmented configuration.

## Proposed API

`Ablauf` becomes the single configuration point:

```typescript
const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
	workflows: [TestWorkflow, EchoWorkflow],
	// Optional: shard configs per workflow type
	shards: { echo: { shards: 4, previousShards: 2 } },
});
```

Everything else derives from it:

```typescript
// Durable Object class export
export const WorkflowRunner = ablauf.createWorkflowRunner();

// Dashboard REST handler (replaces createDashboardHandler)
app.all('/__ablauf/*', (c) => ablauf.handleDashboard(c.req.raw, '/__ablauf'));

// Optional: authentication
app.all('/__ablauf/*', (c) =>
	ablauf.handleDashboard(c.req.raw, '/__ablauf', {
		authenticate: (req) => checkAuth(req),
	}),
);

// Creating/managing workflows (unchanged API)
const wf = await ablauf.create(EchoWorkflow, { id: 'echo-1', payload: { message: 'hi' } });
const status = await ablauf.status('echo-1');

// SSE stream
app.get('/workflows/:id/sse', (c) => ablauf.sseStream(c.req.param('id')));

// Listing
const list = await ablauf.list('echo');
```

## Worker File (Before → After)

### Before

```typescript
import { Ablauf, createSSEStream, createDashboardHandler, createWorkflowRunner } from '@der-ablauf/workflows';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);
const workflows = [TestWorkflow, FailingStepWorkflow, EchoWorkflow, SSEWorkflow];

const dashboardHandler = createDashboardHandler({
	binding: env.WORKFLOW_RUNNER,
	workflows,
});

app.get('/workflows/:id/sse', (c) => createSSEStream(c.env.WORKFLOW_RUNNER, c.req.param('id')));
app.all('/__ablauf/*', (c) => dashboardHandler(c.req.raw, '/__ablauf'));

export const WorkflowRunner = createWorkflowRunner({ workflows });
```

### After

```typescript
import { Ablauf } from '@der-ablauf/workflows';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
	workflows: [TestWorkflow, FailingStepWorkflow, EchoWorkflow, SSEWorkflow],
});

app.get('/workflows/:id/sse', (c) => ablauf.sseStream(c.req.param('id')));
app.all('/__ablauf/*', (c) => ablauf.handleDashboard(c.req.raw, '/__ablauf'));

export const WorkflowRunner = ablauf.createWorkflowRunner();
```

## Changes Required

### 1. Refactor `Ablauf` constructor (`packages/workflows/src/client.ts`)

**Current signature:**

```typescript
constructor(binding: DurableObjectNamespace, shardConfigs?: Record<string, WorkflowShardConfig>)
```

**New signature:**

```typescript
constructor(binding: DurableObjectNamespace, config?: {
  workflows?: WorkflowRegistration[];
  shards?: Record<string, WorkflowShardConfig>;
})
```

- Store `workflows` array and build `registry` + `shardConfigs` internally
- Backwards-compatible: `config` is optional, `workflows` within it is optional
- Existing `create(WorkflowClass, ...)` API still works

### 2. Move `createWorkflowRunner` onto `Ablauf` instance

**New method:**

```typescript
ablauf.createWorkflowRunner(overrides?: { binding?: string }): typeof DurableObject
```

- Uses `this.workflows` and `this.shardConfigs` from the constructor
- Same internal logic as the current standalone function
- Optional `binding` override for non-default binding names

### 3. Move `createDashboardHandler` onto `Ablauf` instance

**New method:**

```typescript
ablauf.handleDashboard(request: Request, basePath: string, options?: {
  authenticate?: (request: Request) => boolean | Promise<boolean>;
}): Promise<Response>
```

- Uses `this.binding`, `this.workflows`, `this.shardConfigs`
- `authenticate` is the only option since everything else comes from the instance

### 4. Move `createSSEStream` onto `Ablauf` instance

**New method:**

```typescript
ablauf.sseStream(workflowId: string): Response
```

- Uses `this.binding` internally

### 5. Update exports (`packages/workflows/src/index.ts`)

- Keep standalone `createWorkflowRunner` and `createDashboardHandler` as deprecated re-exports for backwards compatibility (or remove if this is a breaking release)
- Primary export is just `Ablauf`

### 6. Update worker (`apps/worker/src/index.ts`)

- Consolidate to single `Ablauf` instance
- Remove standalone function imports

## Files to Change

| File                                               | Change                                |
| -------------------------------------------------- | ------------------------------------- |
| `packages/workflows/src/client.ts`                 | Refactor constructor, add methods     |
| `packages/workflows/src/engine/workflow-runner.ts` | Extract class factory logic for reuse |
| `packages/workflows/src/dashboard.ts`              | Extract handler logic for reuse       |
| `packages/workflows/src/sse-stream.ts`             | Extract for reuse                     |
| `packages/workflows/src/index.ts`                  | Update exports                        |
| `apps/worker/src/index.ts`                         | Use new unified API                   |

## Migration

This can be a breaking change (major version bump on `@der-ablauf/workflows`) or backwards-compatible by keeping the old standalone functions that delegate to the new implementation. Given this is pre-1.0, a clean break is fine.
