# Non-Retriable Error Design

## Problem

When a step throws inside `step.do()`, the engine always enters the retry loop. There's no way for user code to say "this error is permanent — don't retry." This wastes retries on errors that will never succeed: invalid input discovered mid-step, business rule violations, authorization failures, etc.

## Solution

Add a `NonRetriableError` class that users throw inside their step functions. The engine detects it via `instanceof` and immediately fails the step without retrying.

## Design

### The class

```typescript
// In errors.ts
export class NonRetriableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetriableError';
  }
}
```

Extends `Error`, not `WorkflowError`. It's a user-facing API — users shouldn't need error codes, HTTP statuses, or sources. The engine catches it internally and handles the rest.

### Engine handling in `step.do()`

In `StepContext.do()`, add an `instanceof NonRetriableError` check at the top of the catch block, before the existing retry logic. When detected:

1. Mark the step as `failed` immediately (no retry scheduled)
2. Record the attempt in retry history (dashboard visibility)
3. Throw `StepFailedError` — propagates to `replay()`, which sets workflow to `errored`

```typescript
catch (e) {
  // Non-retriable errors skip retries entirely
  if (e instanceof NonRetriableError) {
    const duration = Date.now() - startedAt;
    const existingHistory = existing?.retryHistory ? JSON.parse(existing.retryHistory) : [];
    const updatedHistory = [...existingHistory, {
      attempt: newAttempts, error: e.message, errorStack: e.stack ?? null,
      timestamp: startedAt, duration,
    }];

    await this.db.update(stepsTable).set({
      status: 'failed', error: e.message, attempts: newAttempts,
      wakeAt: null, startedAt, duration,
      errorStack: e.stack ?? null,
      retryHistory: JSON.stringify(updatedHistory),
    }).where(eq(stepsTable.name, name));

    throw new StepFailedError(name, e.message);
  }

  // ... existing retry logic unchanged ...
}
```

No changes to `workflow-runner.ts` — the existing `!isInterrupt(e)` branch handles `StepFailedError` propagation.

### Workflow status

The workflow ends up `errored` (not `terminated`). Rationale:
- `errored` = workflow didn't produce a result (needs attention)
- `terminated` = external action stopped the workflow (`workflow.terminate()`)
- The error message preserves the intentionality

### Usage

```typescript
import { defineWorkflow, NonRetriableError } from '@der-ablauf/workflows';

const order = defineWorkflow({
  type: 'process-order',
  run: async (step, payload) => {
    await step.do('validate-user', async () => {
      const user = await getUser(payload.userId);
      if (user.banned) {
        throw new NonRetriableError('User is banned');
      }
      return user;
    });
  },
});
```

## Changes

| File | Change |
|------|--------|
| `packages/workflows/src/errors.ts` | Add `NonRetriableError` class |
| `packages/workflows/src/engine/step.ts` | Add `instanceof NonRetriableError` check in catch block |
| `packages/workflows/src/index.ts` | Export `NonRetriableError` |
| `apps/worker/src/workflows/non-retriable-workflow.ts` | Test workflow that throws `NonRetriableError` |
| `apps/worker/src/__tests__/` | Test: step fails immediately, no retries, workflow errored |
| `apps/docs/content/docs/workflows/retries.mdx` | Document `NonRetriableError` |
| `apps/docs/content/docs/workflows/steps/do.mdx` | Add non-retriable example |
