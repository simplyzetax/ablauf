# Workflow Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a durable workflow engine on a single Cloudflare Durable Object class with replay-based checkpointing, typed events, and sharded observability.

**Architecture:** One `WorkflowRunner` DO class handles all workflows. Workflow types are plain classes in a registry. The DO stores step results in SQLite via Drizzle ORM. Replay re-executes `run()` from the top, skipping completed steps. Index shard DOs (same class, `__index:` prefix) track workflow instances for listing.

**Tech Stack:** Cloudflare Workers, Durable Objects, Hono, Drizzle ORM (durable-sqlite), TypeScript

**Design Doc:** `docs/plans/2026-02-11-workflow-engine-design.md`

---

### Task 1: Project Setup

**Files:**

- Modify: `package.json`
- Modify: `wrangler.jsonc`
- Create: `drizzle.config.ts`
- Delete: `src/dos/workflow-runner.ts`
- Delete: `src/dos/test-workflow.ts`

**Step 1: Install dependencies**

Run: `bun add drizzle-orm && bun add -d drizzle-kit`

**Step 2: Add drizzle scripts to package.json**

Add to `scripts`:

```json
"db:generate": "drizzle-kit generate",
"db:push": "drizzle-kit push"
```

**Step 3: Create drizzle.config.ts**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	out: './drizzle',
	schema: './src/db/schema.ts',
	dialect: 'sqlite',
	driver: 'durable-sqlite',
});
```

**Step 4: Update wrangler.jsonc**

Replace the entire content with:

```jsonc
{
	"$schema": "node_modules/wrangler/config-schema.json",
	"name": "durable-workflows",
	"main": "src/index.ts",
	"compatibility_date": "2026-02-10",
	"compatibility_flags": ["nodejs_compat"],
	"observability": {
		"enabled": true,
	},
	"durable_objects": {
		"bindings": [
			{
				"class_name": "WorkflowRunner",
				"name": "WORKFLOW_RUNNER",
			},
		],
	},
	"migrations": [
		{
			"new_sqlite_classes": ["WorkflowRunner"],
			"tag": "v1",
		},
	],
	"rules": [
		{
			"type": "Text",
			"globs": ["**/*.sql"],
			"fallthrough": true,
		},
	],
}
```

Note: If you previously deployed with the old config (TestWorkflow binding), add a second migration: `{ "deleted_classes": ["TestWorkflow"], "tag": "v2" }`. If never deployed, the above is fine.

**Step 5: Delete old files**

Run: `rm -rf src/dos`

**Step 6: Create directory structure**

Run: `mkdir -p src/db src/engine src/workflows`

**Step 7: Regenerate types**

Run: `npx wrangler types`

**Step 8: Type check**

Run: `npx tsc --noEmit`
Expected: May have errors from missing src/index.ts imports — that's fine, we'll fix in later tasks.

**Step 9: Commit**

```bash
git add -A
git commit -m "chore: setup drizzle, single DO binding, new directory structure"
```

---

### Task 2: Type System

**Files:**

- Create: `src/engine/types.ts`
- Create: `src/engine/interrupts.ts`
- Create: `src/engine/duration.ts`

**Step 1: Create src/engine/types.ts**

```typescript
export type WorkflowStatus = 'created' | 'running' | 'completed' | 'errored' | 'paused' | 'sleeping' | 'waiting' | 'terminated';

export type BackoffStrategy = 'fixed' | 'linear' | 'exponential';

export interface RetryConfig {
	limit: number;
	delay: string;
	backoff: BackoffStrategy;
}

export interface StepDoOptions {
	retries?: Partial<RetryConfig>;
}

export interface StepWaitOptions {
	timeout: string;
}

export interface WorkflowDefaults {
	retries: RetryConfig;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	limit: 3,
	delay: '1s',
	backoff: 'exponential',
};

export interface Step<Events extends Record<string, unknown> = Record<string, never>> {
	do<T>(name: string, fn: () => Promise<T> | T, options?: StepDoOptions): Promise<T>;
	sleep(name: string, duration: string): Promise<void>;
	waitForEvent<K extends Extract<keyof Events, string>>(name: K, options?: StepWaitOptions): Promise<Events[K]>;
}

export interface WorkflowClass<Payload = unknown, Result = unknown, Events extends Record<string, unknown> = Record<string, never>> {
	type: string;
	events?: Events;
	defaults?: Partial<WorkflowDefaults>;
	new (): WorkflowInstance<Payload, Result, Events>;
}

export interface WorkflowInstance<Payload = unknown, Result = unknown, Events extends Record<string, unknown> = Record<string, never>> {
	run(step: Step<Events>, payload: Payload): Promise<Result>;
}

export interface WorkflowStatusResponse {
	id: string;
	type: string;
	status: WorkflowStatus;
	payload: unknown;
	result: unknown;
	error: string | null;
	steps: StepInfo[];
	createdAt: number;
	updatedAt: number;
}

export interface StepInfo {
	name: string;
	type: string;
	status: string;
	attempts: number;
	result: unknown;
	error: string | null;
	completedAt: number | null;
}
```

**Step 2: Create src/engine/interrupts.ts**

```typescript
export class SleepInterrupt {
	readonly _tag = 'SleepInterrupt';
	constructor(
		public readonly stepName: string,
		public readonly wakeAt: number,
	) {}
}

export class WaitInterrupt {
	readonly _tag = 'WaitInterrupt';
	constructor(
		public readonly stepName: string,
		public readonly timeoutAt: number | null,
	) {}
}

export class PauseInterrupt {
	readonly _tag = 'PauseInterrupt';
}

export function isInterrupt(e: unknown): e is SleepInterrupt | WaitInterrupt | PauseInterrupt {
	return e instanceof SleepInterrupt || e instanceof WaitInterrupt || e instanceof PauseInterrupt;
}
```

**Step 3: Create src/engine/duration.ts**

```typescript
const UNITS: Record<string, number> = {
	ms: 1,
	s: 1000,
	m: 60 * 1000,
	h: 60 * 60 * 1000,
	d: 24 * 60 * 60 * 1000,
};

export function parseDuration(duration: string): number {
	const match = duration.match(/^(\d+)\s*(ms|s|m|h|d)$/);
	if (!match) {
		throw new Error(`Invalid duration: "${duration}". Use format like "30s", "5m", "24h", "7d".`);
	}
	return parseInt(match[1], 10) * UNITS[match[2]];
}
```

**Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: Errors from index.ts (still importing old files). That's expected.

**Step 5: Commit**

```bash
git add src/engine/types.ts src/engine/interrupts.ts src/engine/duration.ts
git commit -m "feat: add type system, interrupts, and duration parser"
```

---

### Task 3: Drizzle Schema + Migrations

**Files:**

- Create: `src/db/schema.ts`

**Step 1: Create src/db/schema.ts**

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Per-workflow-instance tables (stored in each workflow DO)
export const workflowTable = sqliteTable('workflow', {
	id: integer('id').primaryKey().default(1),
	type: text('type').notNull(),
	status: text('status').notNull().default('created'),
	payload: text('payload'),
	result: text('result'),
	error: text('error'),
	paused: integer('paused').notNull().default(0),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull(),
});

export const stepsTable = sqliteTable('steps', {
	name: text('name').primaryKey(),
	type: text('type').notNull(), // 'do' | 'sleep' | 'wait_for_event'
	status: text('status').notNull(), // 'completed' | 'failed' | 'sleeping' | 'waiting'
	result: text('result'),
	error: text('error'),
	attempts: integer('attempts').notNull().default(0),
	wakeAt: integer('wake_at'),
	completedAt: integer('completed_at'),
});

// Index shard table (stored in __index:{type} DOs)
export const instancesTable = sqliteTable('instances', {
	id: text('id').primaryKey(),
	status: text('status').notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull(),
});
```

**Step 2: Generate migrations**

Run: `npx drizzle-kit generate`
Expected: Creates `drizzle/` directory with migration SQL files and a `migrations` meta file.

**Step 3: Verify migration files exist**

Run: `ls drizzle/`
Expected: Should see `.sql` migration file(s) and `meta/` directory.

**Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add drizzle schema and generate migrations"
```

---

### Task 4: WorkflowRunner DO Skeleton

**Files:**

- Create: `src/engine/workflow-runner.ts`
- Create: `src/workflows/registry.ts`
- Modify: `src/index.ts`

**Step 1: Create src/workflows/registry.ts**

```typescript
import type { WorkflowClass } from '../engine/types';

// Add workflow classes here as they're created
// e.g. import { TestWorkflow } from "./test-workflow";
export const registry: Record<string, WorkflowClass> = {
	// test: TestWorkflow,
};
```

**Step 2: Create src/engine/workflow-runner.ts**

```typescript
import { DurableObject } from 'cloudflare:workers';
import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import migrations from '../../drizzle/migrations';
import { workflowTable, stepsTable, instancesTable } from '../db/schema';
import { registry } from '../workflows/registry';
import { isInterrupt, SleepInterrupt, WaitInterrupt, PauseInterrupt } from './interrupts';
import { eq } from 'drizzle-orm';
import type { WorkflowStatus, WorkflowStatusResponse, StepInfo } from './types';

export class WorkflowRunner extends DurableObject<Env> {
	db: DrizzleSqliteDODatabase;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.db = drizzle(ctx.storage, { logger: false });
		ctx.blockConcurrencyWhile(async () => {
			migrate(this.db, migrations);
		});
	}

	// ─── Workflow RPC Methods ───

	async initialize(props: { type: string; id: string; payload: unknown }): Promise<void> {
		const now = Date.now();
		await this.db.insert(workflowTable).values({
			type: props.type,
			status: 'running',
			payload: JSON.stringify(props.payload),
			createdAt: now,
			updatedAt: now,
		});
		await this.updateIndex(props.type, props.id, 'running', now);
		await this.replay();
	}

	async getStatus(): Promise<WorkflowStatusResponse> {
		const [wf] = await this.db.select().from(workflowTable);
		const stepRows = await this.db.select().from(stepsTable);
		const steps: StepInfo[] = stepRows.map((s) => ({
			name: s.name,
			type: s.type,
			status: s.status,
			attempts: s.attempts,
			result: s.result ? JSON.parse(s.result) : null,
			error: s.error,
			completedAt: s.completedAt,
		}));
		return {
			id: this.ctx.id.toString(),
			type: wf.type,
			status: wf.status as WorkflowStatus,
			payload: wf.payload ? JSON.parse(wf.payload) : null,
			result: wf.result ? JSON.parse(wf.result) : null,
			error: wf.error,
			steps,
			createdAt: wf.createdAt,
			updatedAt: wf.updatedAt,
		};
	}

	async deliverEvent(props: { event: string; payload: unknown }): Promise<void> {
		const [step] = await this.db.select().from(stepsTable).where(eq(stepsTable.name, props.event));

		if (!step || step.status !== 'waiting') {
			throw new Error(`No waiting step found for event "${props.event}"`);
		}

		await this.db
			.update(stepsTable)
			.set({
				status: 'completed',
				result: JSON.stringify(props.payload),
				completedAt: Date.now(),
			})
			.where(eq(stepsTable.name, props.event));

		// Cancel timeout alarm if set — we'll set a new one if needed during replay
		await this.ctx.storage.deleteAlarm();
		await this.setStatus('running');
		await this.replay();
	}

	async pause(): Promise<void> {
		await this.db.update(workflowTable).set({ paused: 1, updatedAt: Date.now() });
		await this.setStatus('paused');
	}

	async resume(): Promise<void> {
		await this.db.update(workflowTable).set({ paused: 0, updatedAt: Date.now() });
		await this.setStatus('running');
		await this.replay();
	}

	async terminate(): Promise<void> {
		await this.ctx.storage.deleteAlarm();
		await this.setStatus('terminated');
	}

	// ─── Index Shard RPC Methods ───

	async indexWrite(props: { id: string; status: string; createdAt: number; updatedAt: number }): Promise<void> {
		await this.db
			.insert(instancesTable)
			.values(props)
			.onConflictDoUpdate({
				target: instancesTable.id,
				set: { status: props.status, updatedAt: props.updatedAt },
			});
	}

	async indexList(filters?: { status?: string; limit?: number }): Promise<Array<typeof instancesTable.$inferSelect>> {
		let query = this.db.select().from(instancesTable);
		if (filters?.status) {
			query = query.where(eq(instancesTable.status, filters.status)) as typeof query;
		}
		if (filters?.limit) {
			query = query.limit(filters.limit) as typeof query;
		}
		return query;
	}

	// ─── DO Alarm Handler ───

	async alarm(): Promise<void> {
		// Find the step that's sleeping or waiting
		const sleepingSteps = await this.db.select().from(stepsTable).where(eq(stepsTable.status, 'sleeping'));
		const waitingSteps = await this.db.select().from(stepsTable).where(eq(stepsTable.status, 'waiting'));

		const now = Date.now();

		for (const step of [...sleepingSteps, ...waitingSteps]) {
			if (step.wakeAt && step.wakeAt <= now) {
				if (step.status === 'sleeping') {
					await this.db.update(stepsTable).set({ status: 'completed', completedAt: now }).where(eq(stepsTable.name, step.name));
				} else if (step.status === 'waiting') {
					// Timeout — mark as failed
					await this.db
						.update(stepsTable)
						.set({
							status: 'failed',
							error: `Event "${step.name}" timed out`,
							completedAt: now,
						})
						.where(eq(stepsTable.name, step.name));
				}
			}
		}

		await this.setStatus('running');
		await this.replay();
	}

	// ─── Internal ───

	private async replay(): Promise<void> {
		const [wf] = await this.db.select().from(workflowTable);
		if (!wf) return;

		const WorkflowClass = registry[wf.type];
		if (!WorkflowClass) {
			await this.setStatus('errored');
			await this.db.update(workflowTable).set({ error: `Unknown workflow type: "${wf.type}"` });
			return;
		}

		// Import StepContext here to avoid circular deps
		const { StepContext } = await import('./step');

		const instance = new WorkflowClass();
		const stepCtx = new StepContext(this.db, WorkflowClass.defaults);

		// Check pause flag
		if (wf.paused) {
			await this.setStatus('paused');
			return;
		}

		const payload = wf.payload ? JSON.parse(wf.payload) : null;

		try {
			const result = await instance.run(stepCtx, payload);
			await this.db.update(workflowTable).set({
				status: 'completed',
				result: JSON.stringify(result),
				updatedAt: Date.now(),
			});
			await this.updateIndex(wf.type, this.ctx.id.toString(), 'completed', Date.now());
		} catch (e) {
			if (e instanceof SleepInterrupt) {
				await this.ctx.storage.setAlarm(e.wakeAt);
				await this.setStatus('sleeping');
			} else if (e instanceof WaitInterrupt) {
				if (e.timeoutAt) {
					await this.ctx.storage.setAlarm(e.timeoutAt);
				}
				await this.setStatus('waiting');
			} else if (e instanceof PauseInterrupt) {
				await this.setStatus('paused');
			} else if (!isInterrupt(e)) {
				const errorMsg = e instanceof Error ? e.message : String(e);
				await this.db.update(workflowTable).set({
					status: 'errored',
					error: errorMsg,
					updatedAt: Date.now(),
				});
				await this.updateIndex(wf.type, this.ctx.id.toString(), 'errored', Date.now());
			}
		}
	}

	private async setStatus(status: WorkflowStatus): Promise<void> {
		const now = Date.now();
		await this.db.update(workflowTable).set({ status, updatedAt: now });

		// Also update index
		const [wf] = await this.db.select().from(workflowTable);
		if (wf) {
			await this.updateIndex(wf.type, this.ctx.id.toString(), status, now);
		}
	}

	private async updateIndex(type: string, id: string, status: string, now: number): Promise<void> {
		try {
			const indexId = this.env.WORKFLOW_RUNNER.idFromName(`__index:${type}`);
			const indexStub = this.env.WORKFLOW_RUNNER.get(indexId);
			await indexStub.indexWrite({ id, status, createdAt: now, updatedAt: now });
		} catch {
			// Index update is best-effort — don't fail the workflow
		}
	}
}
```

**Step 3: Update src/index.ts (minimal, just exports)**

```typescript
import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => {
	return c.json({ status: 'ok' });
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { WorkflowRunner } from './engine/workflow-runner';
```

**Step 4: Regenerate types**

Run: `npx wrangler types`

**Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: May have errors from missing `StepContext` (created in next task). Note them but proceed.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add WorkflowRunner DO skeleton with replay, alarms, and index shards"
```

---

### Task 5: Step Context with step.do() and Replay

**Files:**

- Create: `src/engine/step.ts`

**Step 1: Create src/engine/step.ts**

```typescript
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { eq } from 'drizzle-orm';
import { stepsTable } from '../db/schema';
import { SleepInterrupt, WaitInterrupt, PauseInterrupt } from './interrupts';
import { parseDuration } from './duration';
import type { Step, StepDoOptions, StepWaitOptions, RetryConfig, WorkflowDefaults } from './types';
import { DEFAULT_RETRY_CONFIG } from './types';

export class StepContext<Events extends Record<string, unknown> = Record<string, never>> implements Step<Events> {
	private defaults: WorkflowDefaults;

	constructor(
		private db: DrizzleSqliteDODatabase,
		defaults?: Partial<WorkflowDefaults>,
	) {
		this.defaults = {
			retries: { ...DEFAULT_RETRY_CONFIG, ...defaults?.retries },
		};
	}

	async do<T>(name: string, fn: () => Promise<T> | T, options?: StepDoOptions): Promise<T> {
		// Check for cached result
		const [existing] = await this.db.select().from(stepsTable).where(eq(stepsTable.name, name));

		if (existing?.status === 'completed') {
			return existing.result ? JSON.parse(existing.result) : undefined;
		}

		const retryConfig: RetryConfig = {
			...this.defaults.retries,
			...options?.retries,
		};

		const attempts = existing?.attempts ?? 0;

		try {
			const result = await fn();
			const serialized = JSON.stringify(result);

			if (existing) {
				await this.db
					.update(stepsTable)
					.set({
						status: 'completed',
						result: serialized,
						attempts: attempts + 1,
						completedAt: Date.now(),
					})
					.where(eq(stepsTable.name, name));
			} else {
				await this.db.insert(stepsTable).values({
					name,
					type: 'do',
					status: 'completed',
					result: serialized,
					attempts: 1,
					completedAt: Date.now(),
				});
			}

			return result;
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			const newAttempts = attempts + 1;

			if (newAttempts >= retryConfig.limit) {
				// Exhausted retries
				if (existing) {
					await this.db
						.update(stepsTable)
						.set({ status: 'failed', error: errorMsg, attempts: newAttempts })
						.where(eq(stepsTable.name, name));
				} else {
					await this.db.insert(stepsTable).values({
						name,
						type: 'do',
						status: 'failed',
						error: errorMsg,
						attempts: newAttempts,
					});
				}
				throw e;
			}

			// Store failed attempt and retry inline
			if (existing) {
				await this.db.update(stepsTable).set({ status: 'failed', error: errorMsg, attempts: newAttempts }).where(eq(stepsTable.name, name));
			} else {
				await this.db.insert(stepsTable).values({
					name,
					type: 'do',
					status: 'failed',
					error: errorMsg,
					attempts: newAttempts,
				});
			}

			// Calculate backoff delay
			const baseDelay = parseDuration(retryConfig.delay);
			const delay = this.calculateBackoff(baseDelay, newAttempts, retryConfig.backoff);
			await new Promise((resolve) => setTimeout(resolve, delay));

			// Retry recursively
			return this.do(name, fn, options);
		}
	}

	async sleep(name: string, duration: string): Promise<void> {
		const [existing] = await this.db.select().from(stepsTable).where(eq(stepsTable.name, name));

		if (existing?.status === 'completed') {
			return; // Already slept, skip
		}

		if (existing?.status === 'sleeping') {
			// We're replaying but the alarm hasn't fired yet — re-throw
			throw new SleepInterrupt(name, existing.wakeAt!);
		}

		const wakeAt = Date.now() + parseDuration(duration);

		await this.db.insert(stepsTable).values({
			name,
			type: 'sleep',
			status: 'sleeping',
			wakeAt,
			attempts: 0,
		});

		throw new SleepInterrupt(name, wakeAt);
	}

	async waitForEvent<K extends Extract<keyof Events, string>>(name: K, options?: StepWaitOptions): Promise<Events[K]> {
		const [existing] = await this.db
			.select()
			.from(stepsTable)
			.where(eq(stepsTable.name, name as string));

		if (existing?.status === 'completed') {
			return existing.result ? JSON.parse(existing.result) : undefined;
		}

		if (existing?.status === 'failed') {
			throw new Error(existing.error ?? `Event "${name as string}" failed`);
		}

		if (existing?.status === 'waiting') {
			// Already registered, re-throw interrupt
			throw new WaitInterrupt(name as string, existing.wakeAt);
		}

		const timeoutAt = options?.timeout ? Date.now() + parseDuration(options.timeout) : null;

		await this.db.insert(stepsTable).values({
			name: name as string,
			type: 'wait_for_event',
			status: 'waiting',
			wakeAt: timeoutAt,
			attempts: 0,
		});

		throw new WaitInterrupt(name as string, timeoutAt);
	}

	private calculateBackoff(baseDelay: number, attempt: number, strategy: string): number {
		switch (strategy) {
			case 'exponential':
				return baseDelay * Math.pow(2, attempt - 1);
			case 'linear':
				return baseDelay * attempt;
			case 'fixed':
			default:
				return baseDelay;
		}
	}
}
```

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: Should pass or have minimal errors. Fix any import issues.

**Step 3: Commit**

```bash
git add src/engine/step.ts
git commit -m "feat: add StepContext with step.do(), step.sleep(), step.waitForEvent()"
```

---

### Task 6: Base Workflow Class

**Files:**

- Create: `src/engine/base-workflow.ts`

**Step 1: Create src/engine/base-workflow.ts**

This provides static helpers (`create`, `sendEvent`, `status`, `pause`, `resume`, `terminate`) that workflow subclasses inherit.

```typescript
import type { Step, WorkflowDefaults, WorkflowStatusResponse } from './types';

export abstract class BaseWorkflow<Payload = unknown, Result = unknown, Events extends Record<string, unknown> = Record<string, never>> {
	static type: string;
	static events: Record<string, unknown> = {};
	static defaults: Partial<WorkflowDefaults> = {};

	abstract run(step: Step<Events>, payload: Payload): Promise<Result>;

	private static getStub(env: Env, id: string) {
		return env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName(id));
	}

	static async create<P>(this: { type: string; getStub: (env: Env, id: string) => any }, env: Env, props: { id: string; payload: P }) {
		const stub = (this as typeof BaseWorkflow).getStub(env, props.id);
		await stub.initialize({ type: this.type, id: props.id, payload: props.payload });
		return stub;
	}

	static async sendEvent(env: Env, props: { id: string; event: string; payload: unknown }) {
		const stub = this.getStub(env, props.id);
		await stub.deliverEvent({ event: props.event, payload: props.payload });
	}

	static async status(env: Env, id: string): Promise<WorkflowStatusResponse> {
		const stub = this.getStub(env, id);
		return stub.getStatus();
	}

	static async pause(env: Env, id: string) {
		const stub = this.getStub(env, id);
		await stub.pause();
	}

	static async resume(env: Env, id: string) {
		const stub = this.getStub(env, id);
		await stub.resume();
	}

	static async terminate(env: Env, id: string) {
		const stub = this.getStub(env, id);
		await stub.terminate();
	}
}
```

**Step 2: Type check**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/engine/base-workflow.ts
git commit -m "feat: add BaseWorkflow with static create/sendEvent/status/pause/resume/terminate"
```

---

### Task 7: Test Workflow + Registry

**Files:**

- Create: `src/workflows/test-workflow.ts`
- Modify: `src/workflows/registry.ts`

**Step 1: Create src/workflows/test-workflow.ts**

```typescript
import { BaseWorkflow } from '../engine/base-workflow';
import type { Step } from '../engine/types';

interface TestPayload {
	name: string;
}

interface TestResult {
	message: string;
	greeting: string;
}

interface TestEvents {
	approval: { approved: boolean };
}

export class TestWorkflow extends BaseWorkflow<TestPayload, TestResult, TestEvents> {
	static type = 'test' as const;
	static events = {
		approval: {} as { approved: boolean },
	};
	static defaults = {
		retries: { limit: 2, delay: '500ms', backoff: 'exponential' as const },
	};

	async run(step: Step<TestEvents>, payload: TestPayload): Promise<TestResult> {
		const greeting = await step.do('greet', async () => {
			return `Hello, ${payload.name}!`;
		});

		await step.sleep('pause', '5s');

		const approval = await step.waitForEvent('approval', {
			timeout: '1m',
		});

		const message = approval.approved ? `${payload.name} was approved` : `${payload.name} was rejected`;

		return { message, greeting };
	}
}
```

**Step 2: Update src/workflows/registry.ts**

```typescript
import type { WorkflowClass } from '../engine/types';
import { TestWorkflow } from './test-workflow';

export const registry: Record<string, WorkflowClass> = {
	test: TestWorkflow as unknown as WorkflowClass,
};
```

**Step 3: Type check**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/workflows/
git commit -m "feat: add TestWorkflow with sleep + event + registry"
```

---

### Task 8: HTTP API Routes

**Files:**

- Modify: `src/index.ts`

**Step 1: Update src/index.ts with full API**

```typescript
import { Hono } from 'hono';
import { registry } from './workflows/registry';

const app = new Hono<{ Bindings: Env }>();

// Health check
app.get('/', (c) => {
	return c.json({ status: 'ok', workflows: Object.keys(registry) });
});

// Create a workflow instance
app.post('/workflows', async (c) => {
	const body = await c.req.json<{ type: string; id: string; payload: unknown }>();
	const { type, id, payload } = body;

	if (!registry[type]) {
		return c.json({ error: `Unknown workflow type: "${type}"` }, 400);
	}

	const stub = c.env.WORKFLOW_RUNNER.get(c.env.WORKFLOW_RUNNER.idFromName(id));
	await stub.initialize({ type, id, payload });

	return c.json({ id, type, status: 'running' }, 201);
});

// Get workflow status
app.get('/workflows/:id', async (c) => {
	const id = c.req.param('id');
	const stub = c.env.WORKFLOW_RUNNER.get(c.env.WORKFLOW_RUNNER.idFromName(id));
	const status = await stub.getStatus();
	return c.json(status);
});

// Pause workflow
app.post('/workflows/:id/pause', async (c) => {
	const id = c.req.param('id');
	const stub = c.env.WORKFLOW_RUNNER.get(c.env.WORKFLOW_RUNNER.idFromName(id));
	await stub.pause();
	return c.json({ id, status: 'paused' });
});

// Resume workflow
app.post('/workflows/:id/resume', async (c) => {
	const id = c.req.param('id');
	const stub = c.env.WORKFLOW_RUNNER.get(c.env.WORKFLOW_RUNNER.idFromName(id));
	await stub.resume();
	return c.json({ id, status: 'running' });
});

// Terminate workflow
app.post('/workflows/:id/terminate', async (c) => {
	const id = c.req.param('id');
	const stub = c.env.WORKFLOW_RUNNER.get(c.env.WORKFLOW_RUNNER.idFromName(id));
	await stub.terminate();
	return c.json({ id, status: 'terminated' });
});

// Send event to workflow
app.post('/workflows/:id/events/:event', async (c) => {
	const id = c.req.param('id');
	const event = c.req.param('event');
	const body = await c.req.json();
	const stub = c.env.WORKFLOW_RUNNER.get(c.env.WORKFLOW_RUNNER.idFromName(id));
	await stub.deliverEvent({ event, payload: body });
	return c.json({ id, event, status: 'delivered' });
});

// List workflows by type (queries index shard)
app.get('/workflows', async (c) => {
	const type = c.req.query('type');
	const status = c.req.query('status');
	const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 50;

	if (type) {
		// Query single index shard
		const indexId = c.env.WORKFLOW_RUNNER.idFromName(`__index:${type}`);
		const indexStub = c.env.WORKFLOW_RUNNER.get(indexId);
		const results = await indexStub.indexList({ status: status ?? undefined, limit });
		return c.json({ type, instances: results });
	}

	// Fan out to all registry types
	const results = await Promise.all(
		Object.keys(registry).map(async (wfType) => {
			const indexId = c.env.WORKFLOW_RUNNER.idFromName(`__index:${wfType}`);
			const indexStub = c.env.WORKFLOW_RUNNER.get(indexId);
			const instances = await indexStub.indexList({ status: status ?? undefined, limit });
			return { type: wfType, instances };
		}),
	);

	return c.json({ workflows: results });
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { WorkflowRunner } from './engine/workflow-runner';
```

**Step 2: Type check**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add HTTP API routes for workflow CRUD, events, and listing"
```

---

### Task 9: Integration Test with wrangler dev

**Step 1: Start dev server**

Run: `npx wrangler dev` (in a background terminal)

**Step 2: Create a workflow**

Run:

```bash
curl -s -X POST http://localhost:8787/workflows \
  -H 'Content-Type: application/json' \
  -d '{"type":"test","id":"test-1","payload":{"name":"World"}}'
```

Expected: `{"id":"test-1","type":"test","status":"running"}` with 201 status.

**Step 3: Check status (should be sleeping after step.do completes)**

Run:

```bash
curl -s http://localhost:8787/workflows/test-1 | jq .
```

Expected: Status should be `"sleeping"` with the "greet" step completed and "pause" step sleeping.

**Step 4: Wait for sleep to complete (5s), then check status**

Run:

```bash
sleep 6 && curl -s http://localhost:8787/workflows/test-1 | jq .
```

Expected: Status should be `"waiting"` — the sleep completed and now it's waiting for the "approval" event.

**Step 5: Send event**

Run:

```bash
curl -s -X POST http://localhost:8787/workflows/test-1/events/approval \
  -H 'Content-Type: application/json' \
  -d '{"approved":true}'
```

Expected: `{"id":"test-1","event":"approval","status":"delivered"}`

**Step 6: Check final status**

Run:

```bash
curl -s http://localhost:8787/workflows/test-1 | jq .
```

Expected: Status `"completed"`, result `{"message":"World was approved","greeting":"Hello, World!"}`.

**Step 7: Test listing**

Run:

```bash
curl -s http://localhost:8787/workflows?type=test | jq .
```

Expected: Should list test-1 in the instances.

**Step 8: Fix any issues found during testing, then commit**

```bash
git add -A
git commit -m "fix: resolve issues found during integration testing"
```

---

### Task 10: Cleanup + Final Verification

**Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 2: Verify file structure matches design**

```
src/
  index.ts
  db/
    schema.ts
  engine/
    base-workflow.ts
    duration.ts
    interrupts.ts
    step.ts
    types.ts
    workflow-runner.ts
  workflows/
    registry.ts
    test-workflow.ts
drizzle/
  migrations/
drizzle.config.ts
wrangler.jsonc
```

**Step 3: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: final cleanup and verification"
```
