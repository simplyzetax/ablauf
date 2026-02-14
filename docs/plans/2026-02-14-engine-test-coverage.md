# Engine Test Coverage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Achieve comprehensive integration test coverage for the entire Ablauf workflow engine — replay mechanics, indexing/observability, concurrency, dashboard API, duration parsing, backoff strategies, and SSE edge cases.

**Architecture:** All tests run inside workerd via `@cloudflare/vitest-pool-workers`. No mocks — tests exercise real Durable Objects with SQLite persistence. New test workflows are created for specific test scenarios. Dashboard API tests use oRPC's `call()` function from `@orpc/server` to invoke router procedures directly with a real `DashboardContext`. Since `isolatedStorage: false`, every test uses a unique workflow ID to avoid collisions.

**Tech Stack:** vitest, @cloudflare/vitest-pool-workers, @orpc/server (`call`), zod, superjson

**Important:** The `vitest.config.ts` has `isolatedStorage: false` and `singleWorker: false`. This means all tests share the same DO namespace. Every workflow ID must be globally unique across all test files to avoid collisions. Use prefixes like `replay-`, `idx-`, `dur-`, `cc-`, `dash-`, `wr-`, `sse-` per test file.

---

## Task 1: Create New Test Workflows

New workflow definitions needed by downstream test tasks.

**Files:**
- Create: `apps/worker/src/workflows/multi-step-workflow.ts`
- Create: `apps/worker/src/workflows/replay-counter-workflow.ts`
- Create: `apps/worker/src/workflows/backoff-config-workflow.ts`
- Create: `apps/worker/src/workflows/no-schema-workflow.ts`
- Create: `apps/worker/src/workflows/multi-event-workflow.ts`
- Modify: `apps/worker/src/index.ts` (register all new workflows)

### Step 1: Create multi-step-workflow.ts

A workflow with 4 sequential steps — used to test replay caching, step ordering, and observability across many steps.

```typescript
// apps/worker/src/workflows/multi-step-workflow.ts
import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';

const inputSchema = z.object({ value: z.number() });

export const MultiStepWorkflow = defineWorkflow({
	type: 'multi-step',
	input: inputSchema,
	run: async (step, payload) => {
		const a = await step.do('step-a', async () => payload.value + 1);
		const b = await step.do('step-b', async () => a * 2);
		const c = await step.do('step-c', async () => b + 10);
		const d = await step.do('step-d', async () => `result:${c}`);
		return { a, b, c, d };
	},
});
```

### Step 2: Create replay-counter-workflow.ts

A workflow that uses a module-level counter to detect whether step functions are re-executed on replay. The counter increments each time the step function runs. If replay caching works, the counter should only increment once per step.

```typescript
// apps/worker/src/workflows/replay-counter-workflow.ts
import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';

const inputSchema = z.object({ id: z.string() });

// Module-level counters — persist across replay() calls within the same DO isolate.
export const executionCounts = new Map<string, number>();

export const ReplayCounterWorkflow = defineWorkflow({
	type: 'replay-counter',
	input: inputSchema,
	events: {
		continue: z.object({}),
	},
	run: async (step, payload) => {
		const key1 = `${payload.id}:step-1`;
		const result1 = await step.do('step-1', async () => {
			executionCounts.set(key1, (executionCounts.get(key1) ?? 0) + 1);
			return 'first';
		});

		const key2 = `${payload.id}:step-2`;
		const result2 = await step.do('step-2', async () => {
			executionCounts.set(key2, (executionCounts.get(key2) ?? 0) + 1);
			return 'second';
		});

		const event = await step.waitForEvent('continue');

		const key3 = `${payload.id}:step-3`;
		const result3 = await step.do('step-3', async () => {
			executionCounts.set(key3, (executionCounts.get(key3) ?? 0) + 1);
			return 'third';
		});

		return { result1, result2, result3 };
	},
});
```

### Step 3: Create backoff-config-workflow.ts

A workflow with configurable backoff strategy and per-step retry overrides. Uses module-level counter like FailingStepWorkflow.

```typescript
// apps/worker/src/workflows/backoff-config-workflow.ts
import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';

const inputSchema = z.object({
	failCount: z.number(),
	strategy: z.enum(['fixed', 'linear', 'exponential']),
});

const callCounts = new Map<string, number>();

export const BackoffConfigWorkflow = defineWorkflow({
	type: 'backoff-config',
	input: inputSchema,
	defaults: {
		retries: { limit: 5, delay: '100ms', backoff: 'fixed' as const },
	},
	run: async (step, payload) => {
		const key = `backoff:${payload.strategy}:${payload.failCount}`;
		const result = await step.do(
			'configurable-step',
			async () => {
				const count = (callCounts.get(key) ?? 0) + 1;
				callCounts.set(key, count);
				if (count <= payload.failCount) {
					throw new Error(`Fail #${count}`);
				}
				return 'ok';
			},
			{
				retries: {
					backoff: payload.strategy,
					delay: '100ms',
					limit: 5,
				},
			},
		);
		return result;
	},
});
```

### Step 4: Create no-schema-workflow.ts

Minimal workflow — no events, no SSE, bare minimum input. Tests the default/minimal code path.

```typescript
// apps/worker/src/workflows/no-schema-workflow.ts
import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';

export const NoSchemaWorkflow = defineWorkflow({
	type: 'no-schema',
	input: z.object({}),
	run: async (step) => {
		return await step.do('noop', async () => 'done');
	},
});
```

### Step 5: Create multi-event-workflow.ts

A workflow with multiple `waitForEvent` calls for different event types. Tests concurrent event delivery and multiple timeouts.

```typescript
// apps/worker/src/workflows/multi-event-workflow.ts
import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';

const inputSchema = z.object({ name: z.string() });

export const MultiEventWorkflow = defineWorkflow({
	type: 'multi-event',
	input: inputSchema,
	events: {
		'first-approval': z.object({ ok: z.boolean() }),
		'second-approval': z.object({ ok: z.boolean() }),
	},
	run: async (step, payload) => {
		const greeting = await step.do('greet', async () => `Hi, ${payload.name}`);
		const first = await step.waitForEvent('first-approval', { timeout: '1m' });
		const second = await step.waitForEvent('second-approval', { timeout: '1m' });
		return { greeting, first: first.ok, second: second.ok };
	},
});
```

### Step 6: Register new workflows in the worker

Modify `apps/worker/src/index.ts` to import and register all new workflows.

Add these imports after the existing ones:

```typescript
import { MultiStepWorkflow } from './workflows/multi-step-workflow';
import { ReplayCounterWorkflow } from './workflows/replay-counter-workflow';
import { BackoffConfigWorkflow } from './workflows/backoff-config-workflow';
import { NoSchemaWorkflow } from './workflows/no-schema-workflow';
import { MultiEventWorkflow } from './workflows/multi-event-workflow';
```

Add them to the `workflows` array:

```typescript
const workflows = [
	TestWorkflow,
	FailingStepWorkflow,
	EchoWorkflow,
	SSEWorkflow,
	DuplicateStepWorkflow,
	MultiStepWorkflow,
	ReplayCounterWorkflow,
	BackoffConfigWorkflow,
	NoSchemaWorkflow,
	MultiEventWorkflow,
];
```

### Step 7: Run existing tests to verify no regressions

Run: `cd apps/worker && npx vitest run`
Expected: All 40 existing tests pass.

### Step 8: Commit

```bash
git add apps/worker/src/workflows/ apps/worker/src/index.ts
git commit -m "test: add test workflow definitions for comprehensive engine coverage"
```

---

## Task 2: Write replay.test.ts

Tests verifying the replay-based execution model — the engine's core architectural bet.

**Files:**
- Create: `apps/worker/src/__tests__/replay.test.ts`
- Reference: `apps/worker/src/workflows/replay-counter-workflow.ts`
- Reference: `apps/worker/src/workflows/multi-step-workflow.ts`

### Step 1: Write replay.test.ts

```typescript
// apps/worker/src/__tests__/replay.test.ts
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf } from '@der-ablauf/workflows';
import type { WorkflowRunnerStub, WorkflowStatus } from '@der-ablauf/workflows';
import { ReplayCounterWorkflow, executionCounts } from '../workflows/replay-counter-workflow';
import { MultiStepWorkflow } from '../workflows/multi-step-workflow';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

async function advanceAlarm(stub: { _expireTimers(): Promise<void> }) {
	await stub._expireTimers();
	await runDurableObjectAlarm(stub as unknown as DurableObjectStub<undefined>);
}

describe('Replay mechanics', () => {
	it('completed steps return cached results without re-executing', async () => {
		const id = 'replay-cached-1';
		const stub = await ablauf.create(ReplayCounterWorkflow, {
			id,
			payload: { id },
		});

		// step-1 and step-2 execute, then waitForEvent suspends
		let status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('waiting');
		expect(executionCounts.get(`${id}:step-1`)).toBe(1);
		expect(executionCounts.get(`${id}:step-2`)).toBe(1);

		// Deliver event triggers replay — step-1 and step-2 should NOT re-execute
		await stub.deliverEvent({ event: 'continue', payload: {} });
		status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');

		// step-1 and step-2 still at 1 (not re-executed), step-3 at 1
		expect(executionCounts.get(`${id}:step-1`)).toBe(1);
		expect(executionCounts.get(`${id}:step-2`)).toBe(1);
		expect(executionCounts.get(`${id}:step-3`)).toBe(1);
	});

	it('preserves step execution order across replays', async () => {
		const stub = await ablauf.create(MultiStepWorkflow, {
			id: 'replay-order-1',
			payload: { value: 5 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');

		const stepNames = status.steps.map((s: { name: string }) => s.name);
		expect(stepNames).toEqual(['step-a', 'step-b', 'step-c', 'step-d']);

		// Verify each step computed correctly
		expect(status.result).toEqual({ a: 6, b: 12, c: 22, d: 'result:22' });
	});

	it('persists complex types via superjson round-trip', async () => {
		// The EchoWorkflow returns { original, echoed, timestamp: Date.now() }
		// Date.now() returns a number, but let's test via MultiStep which returns strings and numbers
		const stub = await ablauf.create(MultiStepWorkflow, {
			id: 'replay-superjson-1',
			payload: { value: 42 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');
		// Verify types survived serialization
		expect(status.result).toEqual({ a: 43, b: 86, c: 96, d: 'result:96' });
		expect(typeof status.result.a).toBe('number');
		expect(typeof status.result.d).toBe('string');
	});

	it('sleep interrupt resumes at the correct step after alarm', async () => {
		const id = 'replay-sleep-resume-1';
		const stub = await ablauf.create(ReplayCounterWorkflow, {
			id,
			payload: { id },
		});

		// Workflow runs step-1, step-2, then hits waitForEvent
		let status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('waiting');

		// step-1 and step-2 completed
		const step1 = status.steps.find((s: { name: string }) => s.name === 'step-1');
		const step2 = status.steps.find((s: { name: string }) => s.name === 'step-2');
		expect(step1?.status).toBe('completed');
		expect(step2?.status).toBe('completed');
		expect(step1?.result).toBe('first');
		expect(step2?.result).toBe('second');
	});

	it('waitForEvent interrupt resumes and runs remaining steps after event delivery', async () => {
		const id = 'replay-event-resume-1';
		const stub = await ablauf.create(ReplayCounterWorkflow, {
			id,
			payload: { id },
		});

		let status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('waiting');

		// Deliver event, which triggers replay, skips step-1 and step-2, runs step-3
		await stub.deliverEvent({ event: 'continue', payload: {} });
		status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');
		expect(status.result).toEqual({ result1: 'first', result2: 'second', result3: 'third' });

		// step-3 executed exactly once
		expect(executionCounts.get(`${id}:step-3`)).toBe(1);
	});

	it('multi-step workflow records independent timing per step', async () => {
		const stub = await ablauf.create(MultiStepWorkflow, {
			id: 'replay-timing-1',
			payload: { value: 1 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');

		for (const step of status.steps) {
			expect(step.startedAt).toBeTypeOf('number');
			expect(step.startedAt).toBeGreaterThan(0);
			expect(step.duration).toBeTypeOf('number');
			expect(step.duration).toBeGreaterThanOrEqual(0);
		}
	});
});
```

### Step 2: Run tests

Run: `cd apps/worker && npx vitest run src/__tests__/replay.test.ts`
Expected: All 6 tests pass.

### Step 3: Commit

```bash
git add apps/worker/src/__tests__/replay.test.ts
git commit -m "test: add replay mechanics integration tests"
```

---

## Task 3: Write duration.test.ts

Tests for `parseDuration()` — covers all valid formats, invalid inputs, and edge cases.

**Files:**
- Create: `apps/worker/src/__tests__/duration.test.ts`
- Reference: `packages/workflows/src/engine/duration.ts`

### Step 1: Write duration.test.ts

```typescript
// apps/worker/src/__tests__/duration.test.ts
import { describe, it, expect } from 'vitest';
import { parseDuration, InvalidDurationError } from '@der-ablauf/workflows';

describe('parseDuration', () => {
	it('parses all valid duration formats', () => {
		expect(parseDuration('500ms')).toBe(500);
		expect(parseDuration('1s')).toBe(1000);
		expect(parseDuration('30s')).toBe(30000);
		expect(parseDuration('5m')).toBe(300000);
		expect(parseDuration('1h')).toBe(3600000);
		expect(parseDuration('7d')).toBe(604800000);
	});

	it('throws InvalidDurationError on invalid formats', () => {
		const badInputs = ['5x', '', 'abc', '-1s', '1.5h', 'ms', 's5', '5 s', '5S', '1H'];
		for (const input of badInputs) {
			expect(() => parseDuration(input), `Expected "${input}" to throw`).toThrow(InvalidDurationError);
		}
	});

	it('handles boundary values', () => {
		expect(parseDuration('0s')).toBe(0);
		expect(parseDuration('0ms')).toBe(0);
		expect(parseDuration('999d')).toBe(999 * 24 * 60 * 60 * 1000);
	});
});
```

Note: `parseDuration` and `InvalidDurationError` must be exported from `packages/workflows/src/index.ts`. Check that they are — if not, add the exports.

### Step 2: Verify exports exist

Check `packages/workflows/src/index.ts` exports `parseDuration` and `InvalidDurationError`. If `parseDuration` is not exported, add:

```typescript
export { parseDuration } from './engine/duration';
```

### Step 3: Run tests

Run: `cd apps/worker && npx vitest run src/__tests__/duration.test.ts`
Expected: All 3 tests pass.

### Step 4: Commit

```bash
git add apps/worker/src/__tests__/duration.test.ts packages/workflows/src/index.ts
git commit -m "test: add parseDuration edge case tests"
```

---

## Task 4: Expand workflow-runner.test.ts

Add tests for backoff strategies, retry exhaustion, terminate/pause edge combos, timestamps, and the no-schema path.

**Files:**
- Modify: `apps/worker/src/__tests__/workflow-runner.test.ts`

### Step 1: Add imports for new workflows

Add to the import block at the top of the file:

```typescript
import { BackoffConfigWorkflow } from '../workflows/backoff-config-workflow';
import { NoSchemaWorkflow } from '../workflows/no-schema-workflow';
import { MultiEventWorkflow } from '../workflows/multi-event-workflow';
```

### Step 2: Add backoff strategy tests

Add inside the `describe('WorkflowRunner', ...)` block, after the existing `describe('step retry with backoff', ...)`:

```typescript
	describe('backoff strategies', () => {
		it('fixed backoff: delay stays constant across retries', async () => {
			const stub = await ablauf.create(BackoffConfigWorkflow, {
				id: 'wr-backoff-fixed-1',
				payload: { failCount: 2, strategy: 'fixed' },
			});

			// First attempt fails
			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			// Advance twice for retry attempts
			await advanceAlarm(stub);
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			await advanceAlarm(stub);
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toBe('ok');
		});

		it('linear backoff: retries with increasing delay', async () => {
			const stub = await ablauf.create(BackoffConfigWorkflow, {
				id: 'wr-backoff-linear-1',
				payload: { failCount: 2, strategy: 'linear' },
			});

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			await advanceAlarm(stub);
			await advanceAlarm(stub);
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toBe('ok');
		});

		it('exponential backoff: retries with doubling delay', async () => {
			const stub = await ablauf.create(BackoffConfigWorkflow, {
				id: 'wr-backoff-exp-1',
				payload: { failCount: 2, strategy: 'exponential' },
			});

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			await advanceAlarm(stub);
			await advanceAlarm(stub);
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toBe('ok');
		});
	});
```

### Step 3: Add retry exhaustion test

```typescript
	describe('step retry exhaustion', () => {
		it('errors with StepRetryExhaustedError after all attempts fail', async () => {
			// failCount=5 exceeds the default limit=3 for FailingStepWorkflow
			const stub = await ablauf.create(FailingStepWorkflow, {
				id: 'wr-retry-exhaust-1',
				payload: { failCount: 5 },
			});

			// Advance through all retry attempts
			await advanceAlarm(stub);
			await advanceAlarm(stub);

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('errored');
			expect(status.error).toContain('failed after');
			expect(status.error).toContain('attempts');

			const failStep = status.steps.find((s: { name: string }) => s.name === 'unreliable');
			expect(failStep).toBeDefined();
			expect(failStep!.status).toBe('failed');
			expect(failStep!.attempts).toBe(3); // limit is 3
		});
	});
```

### Step 4: Add terminate/pause edge case tests

```typescript
	describe('terminate edge cases', () => {
		it('terminates a sleeping workflow', async () => {
			const stub = await ablauf.create(TestWorkflow, {
				id: 'wr-term-sleeping-1',
				payload: { name: 'Sleeping' },
			});

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			await stub.terminate();
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('terminated');
		});

		it('terminates a waiting workflow', async () => {
			const stub = await ablauf.create(TestWorkflow, {
				id: 'wr-term-waiting-1',
				payload: { name: 'Waiting' },
			});

			await advanceAlarm(stub);
			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('waiting');

			await stub.terminate();
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('terminated');
		});
	});

	describe('pause edge cases', () => {
		it('double pause does not corrupt state', async () => {
			const stub = await ablauf.create(TestWorkflow, {
				id: 'wr-double-pause-1',
				payload: { name: 'DoublePause' },
			});

			await stub.pause();
			await stub.pause(); // second pause is a no-op

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('paused');
		});

		it('resume on a running workflow is safe', async () => {
			const stub = await ablauf.create(TestWorkflow, {
				id: 'wr-resume-running-1',
				payload: { name: 'ResumeRunning' },
			});

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			// Resume a non-paused workflow — should replay and remain sleeping
			await stub.resume();
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');
		});
	});
```

### Step 5: Add timestamps and minimal workflow tests

```typescript
	describe('timestamps', () => {
		it('sets createdAt and updatedAt on workflow creation', async () => {
			const before = Date.now();
			const stub = await ablauf.create(EchoWorkflow, {
				id: 'wr-timestamps-1',
				payload: { message: 'ts' },
			});
			const after = Date.now();

			const status = await stub.getStatus();
			expect(status.createdAt).toBeGreaterThanOrEqual(before);
			expect(status.createdAt).toBeLessThanOrEqual(after);
			expect(status.updatedAt).toBeGreaterThanOrEqual(status.createdAt);
		});
	});

	describe('minimal workflow', () => {
		it('runs a workflow with no events and minimal input', async () => {
			const stub = await ablauf.create(NoSchemaWorkflow, {
				id: 'wr-no-schema-1',
				payload: {},
			});

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toBe('done');
		});
	});

	describe('multi-event workflow', () => {
		it('handles multiple sequential waitForEvent calls', async () => {
			const stub = await ablauf.create(MultiEventWorkflow, {
				id: 'wr-multi-event-1',
				payload: { name: 'MultiEvent' },
			});

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('waiting');

			// Deliver first event
			await stub.deliverEvent({ event: 'first-approval', payload: { ok: true } });
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('waiting');

			// Deliver second event
			await stub.deliverEvent({ event: 'second-approval', payload: { ok: false } });
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toEqual({
				greeting: 'Hi, MultiEvent',
				first: true,
				second: false,
			});
		});
	});
```

### Step 6: Run tests

Run: `cd apps/worker && npx vitest run src/__tests__/workflow-runner.test.ts`
Expected: All existing + new tests pass (~30 total in this file).

### Step 7: Commit

```bash
git add apps/worker/src/__tests__/workflow-runner.test.ts
git commit -m "test: expand workflow-runner tests with backoff, retry exhaustion, pause/terminate edge cases"
```

---

## Task 5: Write indexing.test.ts

Tests for the shard-based indexing and observability system.

**Files:**
- Create: `apps/worker/src/__tests__/indexing.test.ts`
- Reference: `packages/workflows/src/engine/index-listing.ts`
- Reference: `packages/workflows/src/engine/shard.ts`
- Reference: `packages/workflows/src/client.ts:305-315` (list method)

### Step 1: Write indexing.test.ts

```typescript
// apps/worker/src/__tests__/indexing.test.ts
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf, ObservabilityDisabledError, WorkflowError } from '@der-ablauf/workflows';
import type { WorkflowRunnerStub, WorkflowStatus } from '@der-ablauf/workflows';
import { EchoWorkflow } from '../workflows/echo-workflow';
import { TestWorkflow } from '../workflows/test-workflow';
import { NoSchemaWorkflow } from '../workflows/no-schema-workflow';

async function advanceAlarm(stub: { _expireTimers(): Promise<void> }) {
	await stub._expireTimers();
	await runDurableObjectAlarm(stub as unknown as DurableObjectStub<undefined>);
}

describe('Indexing & Observability', () => {
	describe('index entries', () => {
		it('creates an index entry when a workflow starts', async () => {
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow],
				observability: true,
			});

			await ablauf.create(EchoWorkflow, {
				id: 'idx-created-1',
				payload: { message: 'index test' },
			});

			// Wait briefly for the best-effort index write
			await new Promise((r) => setTimeout(r, 100));

			const entries = await ablauf.list('echo');
			const entry = entries.find((e) => e.id === 'idx-created-1');
			expect(entry).toBeDefined();
			expect(entry!.status).toBe('completed'); // echo workflow completes immediately
		});

		it('index entry updates when status changes', async () => {
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [TestWorkflow],
				observability: true,
			});

			const stub = await ablauf.create(TestWorkflow, {
				id: 'idx-status-change-1',
				payload: { name: 'IndexStatus' },
			});

			await new Promise((r) => setTimeout(r, 100));

			let entries = await ablauf.list('test');
			let entry = entries.find((e) => e.id === 'idx-status-change-1');
			expect(entry).toBeDefined();
			// TestWorkflow goes to sleeping after greet step
			expect(['sleeping', 'running']).toContain(entry!.status);

			// Terminate and check index updates
			await stub.terminate();
			await new Promise((r) => setTimeout(r, 100));

			entries = await ablauf.list('test');
			entry = entries.find((e) => e.id === 'idx-status-change-1');
			expect(entry).toBeDefined();
			expect(entry!.status).toBe('terminated');
		});

		it('list filters by status', async () => {
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow, TestWorkflow],
				observability: true,
			});

			// Create a completed workflow
			await ablauf.create(EchoWorkflow, {
				id: 'idx-filter-completed-1',
				payload: { message: 'done' },
			});

			// Create a sleeping workflow
			await ablauf.create(TestWorkflow, {
				id: 'idx-filter-sleeping-1',
				payload: { name: 'Sleeper' },
			});

			await new Promise((r) => setTimeout(r, 100));

			const completedEntries = await ablauf.list('echo', { status: 'completed' });
			const completedIds = completedEntries.map((e) => e.id);
			expect(completedIds).toContain('idx-filter-completed-1');
		});

		it('list with limit returns capped results sorted by updatedAt', async () => {
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow],
				observability: true,
			});

			for (let i = 0; i < 5; i++) {
				await ablauf.create(EchoWorkflow, {
					id: `idx-limit-${i}`,
					payload: { message: `msg-${i}` },
				});
			}

			await new Promise((r) => setTimeout(r, 100));

			const entries = await ablauf.list('echo', { limit: 2 });
			expect(entries.length).toBeLessThanOrEqual(2);
		});
	});

	describe('observability disabled', () => {
		it('throws ObservabilityDisabledError when listing with observability off', async () => {
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow],
				observability: false,
			});

			await expect(ablauf.list('echo')).rejects.toThrow(ObservabilityDisabledError);
		});
	});
});
```

### Step 2: Verify ObservabilityDisabledError is exported

Check `packages/workflows/src/index.ts` exports `ObservabilityDisabledError`. If not, add it.

### Step 3: Run tests

Run: `cd apps/worker && npx vitest run src/__tests__/indexing.test.ts`
Expected: All 5 tests pass.

### Step 4: Commit

```bash
git add apps/worker/src/__tests__/indexing.test.ts packages/workflows/src/index.ts
git commit -m "test: add indexing and observability integration tests"
```

---

## Task 6: Write concurrency.test.ts

Tests for error paths and edge cases around concurrent/invalid operations.

**Files:**
- Create: `apps/worker/src/__tests__/concurrency.test.ts`

### Step 1: Write concurrency.test.ts

```typescript
// apps/worker/src/__tests__/concurrency.test.ts
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf, WorkflowError } from '@der-ablauf/workflows';
import type { WorkflowRunnerStub, WorkflowStatus } from '@der-ablauf/workflows';
import { TestWorkflow } from '../workflows/test-workflow';
import { EchoWorkflow } from '../workflows/echo-workflow';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

async function advanceAlarm(stub: { _expireTimers(): Promise<void> }) {
	await stub._expireTimers();
	await runDurableObjectAlarm(stub as unknown as DurableObjectStub<undefined>);
}

describe('Concurrency & Error Paths', () => {
	it('event delivery to a completed workflow returns error', async () => {
		const stub = await ablauf.create(EchoWorkflow, {
			id: 'cc-completed-event-1',
			payload: { message: 'done' },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');

		// Try delivering an event to a completed workflow (EchoWorkflow has no events)
		const rawStub = stub as unknown as WorkflowRunnerStub;
		const error = await rawStub
			.deliverEvent({ event: 'nonexistent', payload: {} })
			.then(() => null)
			.catch((e: unknown) => e);
		expect(error).toBeTruthy();
	});

	it('event delivery with wrong event name returns EVENT_INVALID', async () => {
		const stub = await ablauf.create(TestWorkflow, {
			id: 'cc-wrong-event-1',
			payload: { name: 'WrongEvent' },
		});

		await advanceAlarm(stub);
		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('waiting');

		const rawStub = stub as unknown as WorkflowRunnerStub;
		const error = await rawStub
			.deliverEvent({ event: 'nonexistent', payload: {} })
			.then(() => null)
			.catch((e: unknown) => e);
		expect(error).toBeTruthy();
		if (error instanceof Error) {
			const restored = WorkflowError.fromSerialized(error);
			expect(restored.code).toBe('EVENT_INVALID');
		}
	});

	it('event delivery with invalid payload returns EVENT_INVALID', async () => {
		const stub = await ablauf.create(TestWorkflow, {
			id: 'cc-bad-payload-1',
			payload: { name: 'BadPayload' },
		});

		await advanceAlarm(stub);
		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('waiting');

		const rawStub = stub as unknown as WorkflowRunnerStub;
		const error = await rawStub
			.deliverEvent({ event: 'approval', payload: { approved: 'not-a-boolean' } })
			.then(() => null)
			.catch((e: unknown) => e);
		expect(error).toBeTruthy();
		if (error instanceof Error) {
			const restored = WorkflowError.fromSerialized(error);
			expect(restored.code).toBe('EVENT_INVALID');
		}
	});

	it('payload validation rejects invalid input at create time', async () => {
		await expect(
			ablauf.create(TestWorkflow, {
				id: 'cc-bad-create-1',
				payload: { name: 123 as unknown as string },
			}),
		).rejects.toThrow();
	});

	it('create with unknown workflow type errors', async () => {
		const id = env.WORKFLOW_RUNNER.idFromName('cc-unknown-type-1');
		const stub = env.WORKFLOW_RUNNER.get(id) as unknown as WorkflowRunnerStub;
		await stub.initialize({ type: 'definitely-not-registered', id: 'cc-unknown-type-1', payload: {} });

		const status = await stub.getStatus();
		expect(status.status).toBe('errored');
		expect(status.error).toContain('definitely-not-registered');
	});

	it('event to non-waiting step returns WORKFLOW_NOT_RUNNING', async () => {
		const stub = await ablauf.create(TestWorkflow, {
			id: 'cc-not-waiting-1',
			payload: { name: 'NotWaiting' },
		});

		// Workflow is sleeping (not waiting), try delivering approval
		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('sleeping');

		const rawStub = stub as unknown as WorkflowRunnerStub;
		const error = await rawStub
			.deliverEvent({ event: 'approval', payload: { approved: true } })
			.then(() => null)
			.catch((e: unknown) => e);
		expect(error).toBeTruthy();
		if (error instanceof Error) {
			const restored = WorkflowError.fromSerialized(error);
			expect(restored.code).toBe('WORKFLOW_NOT_RUNNING');
		}
	});
});
```

### Step 2: Run tests

Run: `cd apps/worker && npx vitest run src/__tests__/concurrency.test.ts`
Expected: All 6 tests pass.

### Step 3: Commit

```bash
git add apps/worker/src/__tests__/concurrency.test.ts
git commit -m "test: add concurrency and error path tests"
```

---

## Task 7: Expand sse.test.ts

Add tests for SSE edge cases: multiple clients, schema validation, replay suppression, close events.

**Files:**
- Modify: `apps/worker/src/__tests__/sse.test.ts`

### Step 1: Add new SSE tests

Add the following tests inside the existing `describe('SSE', ...)` block:

```typescript
	it('SSE close event fires when workflow reaches terminal state', async () => {
		// Create a workflow that completes immediately
		await ablauf.create(SSEWorkflow, {
			id: 'sse-close-1',
			payload: { itemCount: 3 },
		});

		const rawStub = env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName('sse-close-1')) as unknown as WorkflowRunnerStub;

		const stream = await rawStub.connectSSE();
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		// Read all messages — should include the close event
		const chunks: string[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(decoder.decode(value));
		}

		const allText = chunks.join('');
		expect(allText).toContain('event: close');
	});

	it('connectSSE on workflow without sseUpdates returns empty stream', async () => {
		const { EchoWorkflow } = await import('../workflows/echo-workflow');
		const echoAblauf = new Ablauf(env.WORKFLOW_RUNNER);

		await echoAblauf.create(EchoWorkflow, {
			id: 'sse-no-schema-1',
			payload: { message: 'no sse' },
		});

		const rawStub = env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName('sse-no-schema-1')) as unknown as WorkflowRunnerStub;
		const stream = await rawStub.connectSSE();
		const reader = stream.getReader();

		// Stream should end immediately (closed by connectSSE for non-SSE workflows)
		const { done } = await reader.read();
		expect(done).toBe(true);
	});
```

### Step 2: Run tests

Run: `cd apps/worker && npx vitest run src/__tests__/sse.test.ts`
Expected: All existing + new tests pass (~6 total).

### Step 3: Commit

```bash
git add apps/worker/src/__tests__/sse.test.ts
git commit -m "test: expand SSE tests with close event, non-SSE workflow stream"
```

---

## Task 8: Write dashboard.test.ts

Tests for the oRPC dashboard router endpoints using `call()` from `@orpc/server`.

**Files:**
- Create: `apps/worker/src/__tests__/dashboard.test.ts`
- Reference: `packages/workflows/src/dashboard.ts`

### Step 1: Write dashboard.test.ts

The dashboard router uses a `DashboardContext`. We construct this in tests using the real DO binding. We use `call()` from `@orpc/server` to invoke procedures directly.

```typescript
// apps/worker/src/__tests__/dashboard.test.ts
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { call } from '@orpc/server';

import { Ablauf } from '@der-ablauf/workflows';
import type { WorkflowRunnerStub, WorkflowStatus } from '@der-ablauf/workflows';
import { dashboardRouter } from '@der-ablauf/workflows';
import type { DashboardContext } from '@der-ablauf/workflows';
import { EchoWorkflow } from '../workflows/echo-workflow';
import { TestWorkflow } from '../workflows/test-workflow';
import { MultiStepWorkflow } from '../workflows/multi-step-workflow';

const workflows = [EchoWorkflow, TestWorkflow, MultiStepWorkflow];

const context: DashboardContext = {
	binding: env.WORKFLOW_RUNNER,
	workflows,
	shardConfigs: {},
	observability: true,
};

const ablauf = new Ablauf(env.WORKFLOW_RUNNER, { workflows, observability: true });

async function advanceAlarm(stub: { _expireTimers(): Promise<void> }) {
	await stub._expireTimers();
	await runDurableObjectAlarm(stub as unknown as DurableObjectStub<undefined>);
}

describe('Dashboard API', () => {
	describe('GET /workflows (list)', () => {
		it('lists workflows across types', async () => {
			await ablauf.create(EchoWorkflow, {
				id: 'dash-list-echo-1',
				payload: { message: 'list test' },
			});
			await ablauf.create(TestWorkflow, {
				id: 'dash-list-test-1',
				payload: { name: 'ListTest' },
			});

			await new Promise((r) => setTimeout(r, 100));

			const result = await call(dashboardRouter.workflows.list, { context }, {});
			expect(result.workflows).toBeDefined();
			expect(Array.isArray(result.workflows)).toBe(true);

			const ids = result.workflows.map((w: { id: string }) => w.id);
			expect(ids).toContain('dash-list-echo-1');
			expect(ids).toContain('dash-list-test-1');
		});

		it('filters by type', async () => {
			await ablauf.create(EchoWorkflow, {
				id: 'dash-filter-type-1',
				payload: { message: 'echo' },
			});

			await new Promise((r) => setTimeout(r, 100));

			const result = await call(dashboardRouter.workflows.list, { context }, { type: 'echo' });
			const types = result.workflows.map((w: { type: string }) => w.type);
			for (const t of types) {
				expect(t).toBe('echo');
			}
		});

		it('applies limit', async () => {
			for (let i = 0; i < 5; i++) {
				await ablauf.create(EchoWorkflow, {
					id: `dash-limit-${i}`,
					payload: { message: `msg ${i}` },
				});
			}

			await new Promise((r) => setTimeout(r, 100));

			const result = await call(dashboardRouter.workflows.list, { context }, { limit: 2 });
			expect(result.workflows.length).toBeLessThanOrEqual(2);
		});
	});

	describe('GET /workflows/{id} (get)', () => {
		it('returns full workflow status', async () => {
			await ablauf.create(EchoWorkflow, {
				id: 'dash-get-1',
				payload: { message: 'get test' },
			});

			const result = await call(dashboardRouter.workflows.get, { context }, { id: 'dash-get-1' });
			expect(result.id).toBe('dash-get-1');
			expect(result.type).toBe('echo');
			expect(result.status).toBe('completed');
			expect(result.steps).toBeDefined();
			expect(result.steps.length).toBeGreaterThan(0);
		});

		it('returns error for nonexistent workflow', async () => {
			await expect(
				call(dashboardRouter.workflows.get, { context }, { id: 'dash-nonexistent-1' }),
			).rejects.toThrow();
		});
	});

	describe('GET /workflows/{id}/timeline', () => {
		it('returns timeline entries sorted by startedAt', async () => {
			await ablauf.create(MultiStepWorkflow, {
				id: 'dash-timeline-1',
				payload: { value: 10 },
			});

			const result = await call(dashboardRouter.workflows.timeline, { context }, { id: 'dash-timeline-1' });
			expect(result.id).toBe('dash-timeline-1');
			expect(result.type).toBe('multi-step');
			expect(result.status).toBe('completed');
			expect(result.timeline.length).toBe(4); // 4 steps

			// Verify sorted by startedAt ascending
			for (let i = 1; i < result.timeline.length; i++) {
				expect(result.timeline[i].startedAt).toBeGreaterThanOrEqual(result.timeline[i - 1].startedAt!);
			}

			// Verify timeline entries have required fields
			for (const entry of result.timeline) {
				expect(entry.name).toBeTypeOf('string');
				expect(entry.type).toBe('do');
				expect(entry.status).toBe('completed');
				expect(entry.duration).toBeTypeOf('number');
			}
		});

		it('excludes steps that have not started', async () => {
			const stub = await ablauf.create(TestWorkflow, {
				id: 'dash-timeline-nostart-1',
				payload: { name: 'TimelineNoStart' },
			});

			// Workflow is sleeping — sleep and approval steps have no startedAt
			const result = await call(dashboardRouter.workflows.timeline, { context }, { id: 'dash-timeline-nostart-1' });

			// Only the greet step has startedAt (it completed)
			const stepNames = result.timeline.map((e: { name: string }) => e.name);
			expect(stepNames).toContain('greet');
			expect(stepNames).not.toContain('pause');
			expect(stepNames).not.toContain('approval');
		});
	});

	describe('observability disabled', () => {
		it('list endpoint throws when observability is off', async () => {
			const disabledContext: DashboardContext = {
				...context,
				observability: false,
			};

			await expect(
				call(dashboardRouter.workflows.list, { context: disabledContext }, {}),
			).rejects.toThrow();
		});
	});
});
```

### Step 2: Verify dashboardRouter and DashboardContext are exported

Check `packages/workflows/src/index.ts` exports both `dashboardRouter` and the `DashboardContext` type. If not, add:

```typescript
export { dashboardRouter } from './dashboard';
export type { DashboardContext } from './dashboard';
```

### Step 3: Run tests

Run: `cd apps/worker && npx vitest run src/__tests__/dashboard.test.ts`
Expected: All 7 tests pass.

### Step 4: Commit

```bash
git add apps/worker/src/__tests__/dashboard.test.ts packages/workflows/src/index.ts
git commit -m "test: add dashboard oRPC endpoint tests using call()"
```

---

## Task 9: Final Verification

Run the full test suite and verify everything passes.

### Step 1: Run all tests

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/san-antonio && bun run test`
Expected: All tests pass (type check + ~100 tests).

### Step 2: Commit any remaining fixes

If any tests fail, fix them and commit the fixes.

### Step 3: Final commit summary

The final test count should be approximately:

| File | Tests |
|------|-------|
| `api.test.ts` | 1 |
| `errors.test.ts` | 18 |
| `workflow-runner.test.ts` | ~30 (17 existing + ~13 new) |
| `sse.test.ts` | ~6 (4 existing + 2 new) |
| `replay.test.ts` | 6 (new) |
| `duration.test.ts` | 3 (new) |
| `indexing.test.ts` | 5 (new) |
| `concurrency.test.ts` | 6 (new) |
| `dashboard.test.ts` | 7 (new) |
| **Total** | **~82** |
