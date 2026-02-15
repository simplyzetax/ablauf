# NonRetriableError Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `NonRetriableError` class that users throw inside `step.do()` to immediately fail a step without retries, causing the workflow to error.

**Architecture:** `NonRetriableError extends Error` (user-facing, lightweight). The engine detects it in `step.do()`'s catch block via `instanceof`, marks the step as `failed` immediately, and throws `StepFailedError` which propagates to `replay()` and sets the workflow to `errored`.

**Tech Stack:** TypeScript, Vitest with `@cloudflare/vitest-pool-workers`, Drizzle ORM (SQLite)

---

### Task 1: Add NonRetriableError class and export it

**Files:**
- Modify: `packages/workflows/src/errors.ts` (add class at bottom of file)
- Modify: `packages/workflows/src/index.ts` (add export)

**Step 1: Add the NonRetriableError class to errors.ts**

Add this class at the bottom of `packages/workflows/src/errors.ts`, after the `extractZodIssues` function:

```typescript
/**
 * Thrown by user code inside `step.do()` to indicate the error is permanent
 * and the step should NOT be retried. The step is immediately marked as failed
 * and the workflow transitions to `errored`.
 *
 * Unlike {@link WorkflowError} subclasses, this is a user-facing error class
 * that extends plain `Error` — no error codes, HTTP statuses, or sources needed.
 *
 * @example
 * ```ts
 * await step.do('validate', async () => {
 *   if (user.banned) throw new NonRetriableError('User is banned');
 * });
 * ```
 */
export class NonRetriableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NonRetriableError';
	}
}
```

**Step 2: Export NonRetriableError from index.ts**

In `packages/workflows/src/index.ts`, add `NonRetriableError` to the Errors export block. Add it after `InvalidDurationError` in the existing export list:

```typescript
// In the Errors export block, add NonRetriableError to the list:
export {
	// ... existing exports ...
	InvalidDurationError,
	NonRetriableError,    // <-- add this
	asWorkflowError,
	// ... rest of exports ...
} from './errors';
```

**Step 3: Verify types compile**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/seoul && bun run check-types`
Expected: No type errors.

**Step 4: Commit**

```bash
git add packages/workflows/src/errors.ts packages/workflows/src/index.ts
git commit -m "Add NonRetriableError class for skipping step retries"
```

---

### Task 2: Handle NonRetriableError in step.do()

**Files:**
- Modify: `packages/workflows/src/engine/step.ts` (add instanceof check in catch block)

**Step 1: Add NonRetriableError handling to step.do()**

In `packages/workflows/src/engine/step.ts`, add `NonRetriableError` to the import from `'../errors'`:

```typescript
import { StepRetryExhaustedError, DuplicateStepError, WorkflowError, NonRetriableError, StepFailedError } from '../errors';
```

Then in the `do()` method's catch block (line ~161), add this check at the very top of the catch block, BEFORE the existing `const errorMsg = ...` line:

```typescript
		} catch (e) {
			// Non-retriable errors bypass retry logic entirely
			if (e instanceof NonRetriableError) {
				const duration = Date.now() - startedAt;
				const existingHistory: Array<{ attempt: number; error: string; errorStack: string | null; timestamp: number; duration: number }> =
					existing?.retryHistory ? JSON.parse(existing.retryHistory) : [];
				const updatedHistory = [...existingHistory, { attempt: newAttempts, error: e.message, errorStack: e.stack ?? null, timestamp: startedAt, duration }];

				await this.db
					.update(stepsTable)
					.set({
						status: 'failed',
						error: e.message,
						attempts: newAttempts,
						wakeAt: null,
						startedAt,
						duration,
						errorStack: e.stack ?? null,
						retryHistory: JSON.stringify(updatedHistory),
					})
					.where(eq(stepsTable.name, name));

				throw new StepFailedError(name, e.message);
			}

			// existing retry logic continues unchanged below...
			const errorMsg = e instanceof Error ? e.message : String(e);
```

**Step 2: Verify types compile**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/seoul && bun run check-types`
Expected: No type errors.

**Step 3: Commit**

```bash
git add packages/workflows/src/engine/step.ts
git commit -m "Handle NonRetriableError in step.do() to skip retries"
```

---

### Task 3: Add test workflow and integration tests

**Files:**
- Create: `apps/worker/src/workflows/non-retriable-workflow.ts`
- Modify: `apps/worker/src/index.ts` (register workflow)
- Create test cases in: `apps/worker/src/__tests__/workflow-runner.test.ts`

**Step 1: Create the test workflow**

Create `apps/worker/src/workflows/non-retriable-workflow.ts`:

```typescript
import { z } from 'zod';
import { defineWorkflow, NonRetriableError } from '@der-ablauf/workflows';

const inputSchema = z.object({ shouldFail: z.boolean() });

/**
 * Test workflow: throws NonRetriableError when shouldFail is true.
 * Used to verify that non-retriable errors skip retries and immediately
 * fail the step and workflow.
 */
export const NonRetriableWorkflow = defineWorkflow({
	type: 'non-retriable',
	input: inputSchema,
	defaults: {
		retries: { limit: 5, delay: '500ms', backoff: 'exponential' as const },
	},
	run: async (step, payload) => {
		const result = await step.do('maybe-fail', async () => {
			if (payload.shouldFail) {
				throw new NonRetriableError('Intentional permanent failure');
			}
			return 'success';
		});

		return result;
	},
});
```

**Step 2: Register the workflow in apps/worker/src/index.ts**

Add the import after the OOMRecoveryWorkflow import:

```typescript
import { NonRetriableWorkflow } from './workflows/non-retriable-workflow';
```

Add `NonRetriableWorkflow` to the `workflows` array (after `OOMRecoveryWorkflow`):

```typescript
const workflows = [
	// ... existing entries ...
	OOMRecoveryWorkflow,
	NonRetriableWorkflow,    // <-- add this
];
```

**Step 3: Add integration tests**

Add a new `describe` block to `apps/worker/src/__tests__/workflow-runner.test.ts`. Add the import at the top with the other workflow imports:

```typescript
import { NonRetriableWorkflow } from '../workflows/non-retriable-workflow';
```

Add this test block (place it after the existing `describe` blocks, before the file's closing):

```typescript
	describe('non-retriable errors', () => {
		it('fails immediately without retrying when NonRetriableError is thrown', async () => {
			const stub = await ablauf.create(NonRetriableWorkflow, {
				id: 'non-retriable-1',
				payload: { shouldFail: true },
			});

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('errored');

			// Verify step was only attempted once despite retries.limit=5
			const failedStep = status.steps.find((s) => s.name === 'maybe-fail');
			expect(failedStep).toBeDefined();
			expect(failedStep!.status).toBe('failed');
			expect(failedStep!.attempts).toBe(1);
			expect(failedStep!.error).toContain('Intentional permanent failure');
		});

		it('succeeds normally when NonRetriableError is not thrown', async () => {
			const stub = await ablauf.create(NonRetriableWorkflow, {
				id: 'non-retriable-2',
				payload: { shouldFail: false },
			});

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toBe('success');
		});

		it('preserves error message and stack in step retry history', async () => {
			const stub = await ablauf.create(NonRetriableWorkflow, {
				id: 'non-retriable-3',
				payload: { shouldFail: true },
			});

			const status = await stub.getStatus();
			const failedStep = status.steps.find((s) => s.name === 'maybe-fail');
			expect(failedStep!.retryHistory).toHaveLength(1);
			expect(failedStep!.retryHistory![0].error).toBe('Intentional permanent failure');
			expect(failedStep!.retryHistory![0].attempt).toBe(1);
		});
	});
```

**Step 4: Run tests**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/seoul && bun run test`
Expected: All tests pass, including the 3 new non-retriable tests.

**Step 5: Commit**

```bash
git add apps/worker/src/workflows/non-retriable-workflow.ts apps/worker/src/index.ts apps/worker/src/__tests__/workflow-runner.test.ts
git commit -m "Add NonRetriableError integration tests"
```

---

### Task 4: Add NonRetriableError unit test to errors.test.ts

**Files:**
- Modify: `apps/worker/src/__tests__/errors.test.ts`

**Step 1: Add unit test for NonRetriableError**

Add `NonRetriableError` to the import at the top of the file:

```typescript
import {
	// ... existing imports ...
	WorkflowNotRunningError,
	NonRetriableError,
} from '@der-ablauf/workflows';
```

Add this test inside the `describe('WorkflowError', ...)` block, after the `WorkflowNotRunningError` test:

```typescript
	it('NonRetriableError is a plain Error, not a WorkflowError', () => {
		const err = new NonRetriableError('User is banned');
		expect(err).toBeInstanceOf(Error);
		expect(err).not.toBeInstanceOf(WorkflowError);
		expect(err.name).toBe('NonRetriableError');
		expect(err.message).toBe('User is banned');
	});
```

**Step 2: Run tests**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/seoul && bun run test`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add apps/worker/src/__tests__/errors.test.ts
git commit -m "Add NonRetriableError unit test"
```

---

### Task 5: Update documentation

**Files:**
- Modify: `apps/docs/content/docs/workflows/retries.mdx`
- Modify: `apps/docs/content/docs/workflows/steps/do.mdx`

**Step 1: Add NonRetriableError section to retries.mdx**

In `apps/docs/content/docs/workflows/retries.mdx`, add a new section after the "When Retries Are Exhausted" section (after line 112, before "## Crash & OOM Recovery"):

```mdx
## Skipping Retries with NonRetriableError

Sometimes retrying is pointless — the error is permanent and will never succeed. For these cases, throw `NonRetriableError` inside your step function to immediately fail the step without retrying:

```ts
import { defineWorkflow, NonRetriableError } from '@der-ablauf/workflows';

const order = defineWorkflow({
	type: 'process-order',
	input: z.object({ userId: z.string() }),
	run: async (step, payload) => {
		const user = await step.do('validate-user', async () => {
			const user = await getUser(payload.userId);
			if (user.banned) {
				throw new NonRetriableError('User is banned');
			}
			return user;
		});
		// ...
	},
});
```

When `NonRetriableError` is thrown:

1. The step is immediately marked as `failed` — no retries are attempted, regardless of the retry configuration
2. The error is recorded in the step's retry history (visible in the dashboard)
3. The workflow transitions to `errored`

<Callout type="info">
	`NonRetriableError` extends plain `Error`, not `WorkflowError`. It's designed to be simple for user code — no error codes or HTTP statuses needed.
</Callout>

### When to Use NonRetriableError

Use it for errors where retrying would be wasteful:

- **Business rule violations** — user is banned, account is suspended
- **Authorization failures** — invalid API key, insufficient permissions
- **Invalid data** — malformed input discovered mid-step
- **Resource gone** — the thing you need no longer exists
```

**Step 2: Add NonRetriableError mention to steps/do.mdx**

In `apps/docs/content/docs/workflows/steps/do.mdx`, add a new section after "### Retry Exhaustion" (after line 197, before "## How It Works"):

```mdx
### Skipping Retries

If an error is permanent and retrying would be wasteful, throw `NonRetriableError` to immediately fail the step:

```ts
import { NonRetriableError } from '@der-ablauf/workflows';

await step.do('charge-card', async () => {
	const result = await chargeCard(cardId, amount);
	if (result.declined) {
		throw new NonRetriableError('Card declined');
	}
	return result;
});
```

This bypasses all retry logic — the step fails on the first attempt and the workflow transitions to `errored`. See [Skipping Retries with NonRetriableError](/docs/workflows/retries#skipping-retries-with-nonretriableerror) for details.
```

**Step 3: Verify types compile**

Run: `cd /Users/finnernzerhoff/conductor/workspaces/ablauf/seoul && bun run check-types`
Expected: No type errors.

**Step 4: Commit**

```bash
git add apps/docs/content/docs/workflows/retries.mdx apps/docs/content/docs/workflows/steps/do.mdx
git commit -m "Document NonRetriableError in retries and step.do() docs"
```
