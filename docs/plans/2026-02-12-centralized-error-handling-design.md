# Centralized Error Handling Design

## Goal

Replace scattered error handling with a centralized, structured error system. Every error carries a machine-readable code, its origin source, and optional details. Errors propagate cleanly from Durable Objects through the Hono API layer.

## Base Error Class

`WorkflowError` extends Hono's `HTTPException`. All error classes live in `src/engine/errors.ts`.

```typescript
type ErrorCode =
  | "WORKFLOW_NOT_FOUND"
  | "WORKFLOW_ALREADY_EXISTS"
  | "WORKFLOW_TYPE_UNKNOWN"
  | "VALIDATION_ERROR"
  | "STEP_FAILED"
  | "STEP_RETRY_EXHAUSTED"
  | "EVENT_TIMEOUT"
  | "EVENT_INVALID"
  | "WORKFLOW_NOT_RUNNING"
  | "INTERNAL_ERROR";

type ErrorSource = "api" | "engine" | "step" | "validation";

class WorkflowError extends HTTPException {
  code: ErrorCode;
  source: ErrorSource;
  details?: Record<string, unknown>;

  toJSON(): object           // For DO boundary serialization
  static fromSerialized(e: unknown): WorkflowError  // Reconstruct on API side
}
```

## Error Classes

Flat hierarchy — each pre-fills the base class:

| Class | Code | Status | Source | Trigger |
|-------|------|--------|--------|---------|
| `WorkflowNotFoundError` | WORKFLOW_NOT_FOUND | 404 | api | Workflow ID doesn't resolve |
| `WorkflowAlreadyExistsError` | WORKFLOW_ALREADY_EXISTS | 409 | engine | Duplicate initialize call |
| `WorkflowTypeUnknownError` | WORKFLOW_TYPE_UNKNOWN | 400 | api | Registry lookup fails |
| `PayloadValidationError` | VALIDATION_ERROR | 400 | validation | Zod inputSchema.parse() fails |
| `EventValidationError` | EVENT_INVALID | 400 | validation | Zod event schema parse fails |
| `StepFailedError` | STEP_FAILED | 500 | step | Unexpected step execution error |
| `StepRetryExhaustedError` | STEP_RETRY_EXHAUSTED | 500 | step | Retries exhausted |
| `EventTimeoutError` | EVENT_TIMEOUT | 408 | engine | Waiting step times out |
| `WorkflowNotRunningError` | WORKFLOW_NOT_RUNNING | 409 | engine | Operation on wrong-state workflow |

## Structured JSON Response

```json
{
  "error": {
    "code": "WORKFLOW_NOT_FOUND",
    "message": "Workflow abc-123 not found",
    "status": 404,
    "source": "api"
  }
}
```

With optional details for validation errors:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid workflow input",
    "status": 400,
    "source": "validation",
    "details": {
      "issues": [
        { "path": ["email"], "message": "Required" }
      ]
    }
  }
}
```

## Centralized Error Handler

In `index.ts`, replaces current `app.onError`:

```typescript
app.onError((err, c) => {
  if (err instanceof WorkflowError) {
    return c.json({
      error: {
        code: err.code,
        message: err.message,
        status: err.status,
        source: err.source,
        ...(err.details && { details: err.details }),
      },
    }, err.status);
  }

  // Unknown errors — don't leak internals
  return c.json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      status: 500,
      source: "api",
    },
  }, 500);
});
```

## DO-to-Caller Propagation

Errors thrown inside Durable Objects lose their class info over RPC (arrive as plain `Error`). A Hono middleware re-hydrates them:

```typescript
app.use("/workflows/*", async (c, next) => {
  try {
    await next();
  } catch (e) {
    throw WorkflowError.fromSerialized(e);
  }
});
```

`WorkflowError.toJSON()` serializes code, message, status, source, details into the error message string inside the DO. `fromSerialized()` parses it back and reconstructs the correct subclass.

## Integration Points

**`index.ts` (API layer):**
- `WorkflowTypeUnknownError` — registry lookup fails on `POST /workflows`
- Error handler middleware on `/workflows/*`
- Centralized `app.onError`

**`workflow-runner.ts` (engine layer):**
- `WorkflowAlreadyExistsError` — idempotency guard in `initialize()`
- `WorkflowNotRunningError` — state guards in `pause()`, `resume()`, `terminate()`, `deliverEvent()`
- `PayloadValidationError` — `inputSchema.parse()` failure in `replay()`
- `EventValidationError` — event schema parse failure in `deliverEvent()`
- `EventTimeoutError` — waiting step timeout in `alarm()`

**`step.ts` (step layer):**
- `StepRetryExhaustedError` — replaces raw rethrow when retries exhausted
- `StepFailedError` — wraps unexpected errors during step execution

## What Stays the Same

- Interrupt classes (SleepInterrupt, WaitInterrupt, PauseInterrupt) — control flow, not errors
- Step retry logic with exponential backoff — unchanged
- Alarm-based scheduling — unchanged
- Best-effort index updates — silently ignored failures stay as-is
