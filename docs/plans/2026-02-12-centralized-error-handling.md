# Centralized Error Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace scattered error handling with centralized, structured error classes that carry machine-readable codes, origin source, and optional details — with clean propagation from Durable Objects through the Hono API layer.

**Architecture:** A `WorkflowError` base class extends Hono's `HTTPException` with `code`, `source`, and `details` fields. Nine flat subclasses pre-fill these for specific error scenarios. A Hono middleware re-hydrates serialized errors crossing the DO boundary. A centralized `app.onError` formats all errors into structured JSON responses.

**Tech Stack:** TypeScript, Hono (HTTPException), Zod (validation error wrapping), Vitest

---

### Task 1: Create the error classes module

**Files:**
- Create: `src/engine/errors.ts`

**Step 1: Write the failing test**

Create `src/__tests__/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  WorkflowError,
  WorkflowNotFoundError,
  WorkflowAlreadyExistsError,
  WorkflowTypeUnknownError,
  PayloadValidationError,
  EventValidationError,
  StepFailedError,
  StepRetryExhaustedError,
  EventTimeoutError,
  WorkflowNotRunningError,
} from "../engine/errors";

describe("WorkflowError", () => {
  it("has correct properties", () => {
    const err = new WorkflowNotFoundError("wf-123");
    expect(err).toBeInstanceOf(WorkflowError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("WORKFLOW_NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.source).toBe("api");
    expect(err.message).toBe('Workflow "wf-123" not found');
  });

  it("WorkflowAlreadyExistsError has correct properties", () => {
    const err = new WorkflowAlreadyExistsError("wf-123");
    expect(err.code).toBe("WORKFLOW_ALREADY_EXISTS");
    expect(err.status).toBe(409);
    expect(err.source).toBe("engine");
  });

  it("WorkflowTypeUnknownError has correct properties", () => {
    const err = new WorkflowTypeUnknownError("bad-type");
    expect(err.code).toBe("WORKFLOW_TYPE_UNKNOWN");
    expect(err.status).toBe(400);
    expect(err.source).toBe("api");
  });

  it("PayloadValidationError includes Zod issues in details", () => {
    const issues = [{ path: ["name"], message: "Required" }];
    const err = new PayloadValidationError("Invalid input", issues);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.status).toBe(400);
    expect(err.source).toBe("validation");
    expect(err.details).toEqual({ issues });
  });

  it("EventValidationError includes event name and issues", () => {
    const issues = [{ path: ["approved"], message: "Expected boolean" }];
    const err = new EventValidationError("approval", issues);
    expect(err.code).toBe("EVENT_INVALID");
    expect(err.status).toBe(400);
    expect(err.source).toBe("validation");
    expect(err.details).toEqual({ event: "approval", issues });
  });

  it("StepFailedError has step name in details", () => {
    const err = new StepFailedError("my-step", "something broke");
    expect(err.code).toBe("STEP_FAILED");
    expect(err.status).toBe(500);
    expect(err.source).toBe("step");
    expect(err.details).toEqual({ step: "my-step" });
  });

  it("StepRetryExhaustedError has attempts in details", () => {
    const err = new StepRetryExhaustedError("my-step", 3, "still broken");
    expect(err.code).toBe("STEP_RETRY_EXHAUSTED");
    expect(err.status).toBe(500);
    expect(err.source).toBe("step");
    expect(err.details).toEqual({ step: "my-step", attempts: 3 });
  });

  it("EventTimeoutError has correct properties", () => {
    const err = new EventTimeoutError("approval");
    expect(err.code).toBe("EVENT_TIMEOUT");
    expect(err.status).toBe(408);
    expect(err.source).toBe("engine");
  });

  it("WorkflowNotRunningError includes current status", () => {
    const err = new WorkflowNotRunningError("wf-123", "paused");
    expect(err.code).toBe("WORKFLOW_NOT_RUNNING");
    expect(err.status).toBe(409);
    expect(err.source).toBe("engine");
    expect(err.details).toEqual({ workflowId: "wf-123", currentStatus: "paused" });
  });
});

describe("WorkflowError serialization", () => {
  it("round-trips through toJSON/fromSerialized", () => {
    const original = new WorkflowNotFoundError("wf-456");
    const serialized = new Error(JSON.stringify(original.toJSON()));
    const restored = WorkflowError.fromSerialized(serialized);

    expect(restored).toBeInstanceOf(WorkflowError);
    expect(restored.code).toBe("WORKFLOW_NOT_FOUND");
    expect(restored.status).toBe(404);
    expect(restored.source).toBe("api");
    expect(restored.message).toBe('Workflow "wf-456" not found');
  });

  it("round-trips PayloadValidationError with details", () => {
    const issues = [{ path: ["email"], message: "Required" }];
    const original = new PayloadValidationError("Invalid input", issues);
    const serialized = new Error(JSON.stringify(original.toJSON()));
    const restored = WorkflowError.fromSerialized(serialized);

    expect(restored.code).toBe("VALIDATION_ERROR");
    expect(restored.details).toEqual({ issues });
  });

  it("returns generic WorkflowError for non-workflow errors", () => {
    const plain = new Error("random failure");
    const restored = WorkflowError.fromSerialized(plain);

    expect(restored).toBeInstanceOf(WorkflowError);
    expect(restored.code).toBe("INTERNAL_ERROR");
    expect(restored.status).toBe(500);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test -- src/__tests__/errors.test.ts`
Expected: FAIL — module `../engine/errors` doesn't exist.

**Step 3: Implement `src/engine/errors.ts`**

```typescript
import { HTTPException } from "hono/http-exception";
import type { StatusCode } from "hono/utils/http-status";

export type ErrorCode =
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

export type ErrorSource = "api" | "engine" | "step" | "validation";

export class WorkflowError extends HTTPException {
  public readonly code: ErrorCode;
  public readonly source: ErrorSource;
  public readonly details?: Record<string, unknown>;

  constructor(opts: {
    code: ErrorCode;
    message: string;
    status: StatusCode;
    source: ErrorSource;
    details?: Record<string, unknown>;
  }) {
    super(opts.status, { message: opts.message });
    this.code = opts.code;
    this.source = opts.source;
    this.details = opts.details;
  }

  toJSON() {
    return {
      __workflowError: true,
      code: this.code,
      message: this.message,
      status: this.status,
      source: this.source,
      ...(this.details && { details: this.details }),
    };
  }

  static fromSerialized(e: unknown): WorkflowError {
    if (e instanceof WorkflowError) return e;

    const message = e instanceof Error ? e.message : String(e);

    try {
      const parsed = JSON.parse(message);
      if (parsed?.__workflowError) {
        return new WorkflowError({
          code: parsed.code,
          message: parsed.message,
          status: parsed.status,
          source: parsed.source,
          details: parsed.details,
        });
      }
    } catch {
      // Not a serialized WorkflowError
    }

    return new WorkflowError({
      code: "INTERNAL_ERROR",
      message,
      status: 500,
      source: "api",
    });
  }
}

export class WorkflowNotFoundError extends WorkflowError {
  constructor(workflowId: string) {
    super({
      code: "WORKFLOW_NOT_FOUND",
      message: `Workflow "${workflowId}" not found`,
      status: 404,
      source: "api",
    });
  }
}

export class WorkflowAlreadyExistsError extends WorkflowError {
  constructor(workflowId: string) {
    super({
      code: "WORKFLOW_ALREADY_EXISTS",
      message: `Workflow "${workflowId}" already exists`,
      status: 409,
      source: "engine",
    });
  }
}

export class WorkflowTypeUnknownError extends WorkflowError {
  constructor(workflowType: string) {
    super({
      code: "WORKFLOW_TYPE_UNKNOWN",
      message: `Unknown workflow type: "${workflowType}"`,
      status: 400,
      source: "api",
    });
  }
}

export class PayloadValidationError extends WorkflowError {
  constructor(message: string, issues: unknown[]) {
    super({
      code: "VALIDATION_ERROR",
      message,
      status: 400,
      source: "validation",
      details: { issues },
    });
  }
}

export class EventValidationError extends WorkflowError {
  constructor(eventName: string, issues: unknown[]) {
    super({
      code: "EVENT_INVALID",
      message: `Invalid payload for event "${eventName}"`,
      status: 400,
      source: "validation",
      details: { event: eventName, issues },
    });
  }
}

export class StepFailedError extends WorkflowError {
  constructor(stepName: string, cause: string) {
    super({
      code: "STEP_FAILED",
      message: `Step "${stepName}" failed: ${cause}`,
      status: 500,
      source: "step",
      details: { step: stepName },
    });
  }
}

export class StepRetryExhaustedError extends WorkflowError {
  constructor(stepName: string, attempts: number, cause: string) {
    super({
      code: "STEP_RETRY_EXHAUSTED",
      message: `Step "${stepName}" failed after ${attempts} attempts: ${cause}`,
      status: 500,
      source: "step",
      details: { step: stepName, attempts },
    });
  }
}

export class EventTimeoutError extends WorkflowError {
  constructor(eventName: string) {
    super({
      code: "EVENT_TIMEOUT",
      message: `Event "${eventName}" timed out`,
      status: 408,
      source: "engine",
    });
  }
}

export class WorkflowNotRunningError extends WorkflowError {
  constructor(workflowId: string, currentStatus: string) {
    super({
      code: "WORKFLOW_NOT_RUNNING",
      message: `Workflow "${workflowId}" is not running (status: ${currentStatus})`,
      status: 409,
      source: "engine",
      details: { workflowId, currentStatus },
    });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun run test -- src/__tests__/errors.test.ts`
Expected: All PASS.

**Step 5: Commit**

```bash
git add src/engine/errors.ts src/__tests__/errors.test.ts
git commit -m "feat: add centralized error classes with DO serialization"
```

---

### Task 2: Integrate errors into `workflow-runner.ts`

**Files:**
- Modify: `src/engine/workflow-runner.ts`

**Step 1: Add imports**

At the top of `src/engine/workflow-runner.ts`, add:

```typescript
import {
  WorkflowNotFoundError,
  WorkflowAlreadyExistsError,
  WorkflowTypeUnknownError,
  PayloadValidationError,
  EventValidationError,
  EventTimeoutError,
  WorkflowNotRunningError,
  WorkflowError,
} from "./errors";
```

**Step 2: Replace error in `getStatus()` (line 59)**

Replace:
```typescript
throw new Error("Workflow not initialized");
```
With:
```typescript
throw new WorkflowNotFoundError(this.workflowId ?? "unknown");
```

**Step 3: Replace errors in `deliverEvent()`**

Replace `throw new Error("Workflow not initialized")` (line 87) with:
```typescript
throw new WorkflowNotFoundError(this.workflowId ?? "unknown");
```

Replace `throw new Error(\`Unknown workflow type: "${wf.type}"\`)` (line 92) with:
```typescript
throw new WorkflowTypeUnknownError(wf.type);
```

Replace `throw new Error(\`Unknown event "${props.event}" for workflow type "${wf.type}"\`)` (line 97) with:
```typescript
throw new EventValidationError(props.event, [{ message: `Unknown event "${props.event}" for workflow type "${wf.type}"` }]);
```

Wrap `schema.parse(props.payload)` (line 99) in a try-catch:
```typescript
let payload: unknown;
try {
  payload = schema.parse(props.payload);
} catch (e) {
  const issues = e instanceof Error && "issues" in e ? (e as { issues: unknown[] }).issues : [{ message: String(e) }];
  throw new EventValidationError(props.event, issues);
}
```

Replace `throw new Error(\`No waiting step found for event "${props.event}"\`)` (line 107) with:
```typescript
throw new WorkflowNotRunningError(wf.workflowId, step ? step.status : "no matching step");
```

**Step 4: Wrap Zod parse in `replay()` (line 234)**

Replace:
```typescript
const payload = WorkflowClass.inputSchema.parse(wf.payload ? JSON.parse(wf.payload) : undefined);
```
With:
```typescript
let payload: unknown;
try {
  payload = WorkflowClass.inputSchema.parse(wf.payload ? JSON.parse(wf.payload) : undefined);
} catch (e) {
  const issues = e instanceof Error && "issues" in e ? (e as { issues: unknown[] }).issues : [{ message: String(e) }];
  throw new PayloadValidationError("Invalid workflow input", issues);
}
```

**Step 5: Replace error message extraction in `replay()` catch block (line 254)**

Replace:
```typescript
const errorMsg = e instanceof Error ? e.message : String(e);
```
With:
```typescript
const errorMsg = e instanceof WorkflowError
  ? JSON.stringify(e.toJSON())
  : e instanceof Error ? e.message : String(e);
```

This ensures `WorkflowError` instances get their structured data serialized into the DB error field.

**Step 6: Run all tests**

Run: `bun run test`
Expected: All existing tests still pass. The errors thrown are now specific classes, but the test assertions use `.toContain()` and `.toThrow()` which should still match.

**Step 7: Commit**

```bash
git add src/engine/workflow-runner.ts
git commit -m "feat: use centralized error classes in workflow-runner"
```

---

### Task 3: Integrate errors into `step.ts`

**Files:**
- Modify: `src/engine/step.ts`

**Step 1: Add imports**

At the top of `src/engine/step.ts`, add:

```typescript
import { StepRetryExhaustedError } from "./errors";
```

**Step 2: Replace raw rethrow on retry exhaustion (line 85)**

In the `do()` method, replace the line `throw e;` (after retries exhausted, line 85) with:

```typescript
const cause = e instanceof Error ? e.message : String(e);
throw new StepRetryExhaustedError(name, newAttempts, cause);
```

**Step 3: Run all tests**

Run: `bun run test`
Expected: All tests pass. The `StepRetryExhaustedError` is still an `Error` and the failing-step-workflow test checks for `status: "completed"` (the step eventually succeeds), so behavior is unchanged.

**Step 4: Commit**

```bash
git add src/engine/step.ts
git commit -m "feat: use StepRetryExhaustedError in step retry logic"
```

---

### Task 4: Integrate errors into `index.ts` and `base-workflow.ts`

**Files:**
- Modify: `src/index.ts`
- Modify: `src/engine/base-workflow.ts`

**Step 1: Update `index.ts` — add imports, middleware, and error handler**

Replace the entire `src/index.ts` with:

```typescript
import { Hono } from "hono";
import { registry } from "./workflows/registry";
import type { WorkflowRunnerStub } from "./engine/types";
import { WorkflowError, WorkflowTypeUnknownError, PayloadValidationError } from "./engine/errors";

const app = new Hono<{ Bindings: Env }>();

function getWorkflowRunnerStub(env: Env, id: string): WorkflowRunnerStub {
  return env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName(id)) as unknown as WorkflowRunnerStub;
}

// Centralized error handler
app.onError((err, c) => {
  if (err instanceof WorkflowError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          status: err.status,
          source: err.source,
          ...(err.details && { details: err.details }),
        },
      },
      err.status,
    );
  }

  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR" as const,
        message: "An unexpected error occurred",
        status: 500,
        source: "api" as const,
      },
    },
    500,
  );
});

// Middleware: re-hydrate WorkflowErrors from DO RPC calls
app.use("/workflows/*", async (c, next) => {
  try {
    await next();
  } catch (e) {
    throw WorkflowError.fromSerialized(e);
  }
});

app.get("/", (c) => {
  return c.json({ status: "ok", workflows: Object.keys(registry) });
});

// Create a workflow instance
app.post("/workflows", async (c) => {
  const body = await c.req.json<{ type: string; id: string; payload: unknown }>();
  const { type, id, payload } = body;

  if (!registry[type]) {
    throw new WorkflowTypeUnknownError(type);
  }

  const WorkflowClass = registry[type];
  let parsed: unknown;
  try {
    parsed = WorkflowClass.inputSchema?.parse(payload) ?? payload;
  } catch (e) {
    const issues = e instanceof Error && "issues" in e ? (e as { issues: unknown[] }).issues : [{ message: String(e) }];
    throw new PayloadValidationError("Invalid workflow input", issues);
  }

  const stub = getWorkflowRunnerStub(c.env, id);
  await stub.initialize({ type, id, payload: parsed });

  return c.json({ id, type, status: "running" }, 201);
});

// Get workflow status
app.get("/workflows/:id", async (c) => {
  const id = c.req.param("id");
  const stub = getWorkflowRunnerStub(c.env, id);
  const status = await stub.getStatus();
  return c.json(status);
});

// Pause workflow
app.post("/workflows/:id/pause", async (c) => {
  const id = c.req.param("id");
  const stub = getWorkflowRunnerStub(c.env, id);
  await stub.pause();
  return c.json({ id, status: "paused" });
});

// Resume workflow
app.post("/workflows/:id/resume", async (c) => {
  const id = c.req.param("id");
  const stub = getWorkflowRunnerStub(c.env, id);
  await stub.resume();
  return c.json({ id, status: "running" });
});

// Terminate workflow
app.post("/workflows/:id/terminate", async (c) => {
  const id = c.req.param("id");
  const stub = getWorkflowRunnerStub(c.env, id);
  await stub.terminate();
  return c.json({ id, status: "terminated" });
});

// Send event to workflow
app.post("/workflows/:id/events/:event", async (c) => {
  const id = c.req.param("id");
  const event = c.req.param("event");
  const body = await c.req.json();
  const stub = getWorkflowRunnerStub(c.env, id);
  await stub.deliverEvent({ event, payload: body });
  return c.json({ id, event, status: "delivered" });
});

// List workflows by type (queries index shard)
app.get("/workflows", async (c) => {
  const type = c.req.query("type");
  const status = c.req.query("status");
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 50;

  if (type) {
    const indexId = c.env.WORKFLOW_RUNNER.idFromName(`__index:${type}`);
    const indexStub = c.env.WORKFLOW_RUNNER.get(indexId) as unknown as WorkflowRunnerStub;
    const results = await indexStub.indexList({ status: status ?? undefined, limit });
    return c.json({ type, instances: results });
  }

  const results = await Promise.all(
    Object.keys(registry).map(async (wfType) => {
      const indexId = c.env.WORKFLOW_RUNNER.idFromName(`__index:${wfType}`);
      const indexStub = c.env.WORKFLOW_RUNNER.get(indexId) as unknown as WorkflowRunnerStub;
      const instances = await indexStub.indexList({ status: status ?? undefined, limit });
      return { type: wfType, instances };
    }),
  );

  return c.json({ workflows: results });
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { WorkflowRunner } from "./engine/workflow-runner";
```

**Step 2: Update `base-workflow.ts` — wrap Zod errors in `sendEvent()`**

In `src/engine/base-workflow.ts`, replace the `sendEvent` method's error handling:

Add import at top:
```typescript
import { EventValidationError } from "./errors";
```

Replace lines 57-59:
```typescript
if (!schema) {
  throw new Error(`Unknown event "${props.event}" for workflow type "${this.type}"`);
}
const payload = schema.parse(props.payload);
```
With:
```typescript
if (!schema) {
  throw new EventValidationError(props.event, [{ message: `Unknown event "${props.event}" for workflow type "${this.type}"` }]);
}
let payload: unknown;
try {
  payload = schema.parse(props.payload);
} catch (e) {
  const issues = e instanceof Error && "issues" in e ? (e as { issues: unknown[] }).issues : [{ message: String(e) }];
  throw new EventValidationError(props.event, issues);
}
```

**Step 3: Run all tests**

Run: `bun run test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/index.ts src/engine/base-workflow.ts
git commit -m "feat: add error middleware, centralized handler, and Zod wrapping"
```

---

### Task 5: Update existing tests for structured errors

**Files:**
- Modify: `src/__tests__/workflow-runner.test.ts`

**Step 1: Update the runtime validation test to check for specific error types**

In the `"rejects invalid payloads and events at runtime"` test, update to check that errors propagated through the DO are `WorkflowError` instances or carry structured data. Since the tests talk directly to the DO (no Hono middleware), the errors arrive as plain `Error` with serialized JSON messages.

Add import:
```typescript
import { WorkflowError } from "../engine/errors";
```

Update the `badPayloadError` check:
```typescript
expect(badPayloadError).toBeTruthy();
if (badPayloadError instanceof Error) {
  const restored = WorkflowError.fromSerialized(badPayloadError);
  expect(restored.code).toBe("EVENT_INVALID");
}
```

Update the `badEventError` check:
```typescript
expect(badEventError).toBeTruthy();
if (badEventError instanceof Error) {
  const restored = WorkflowError.fromSerialized(badEventError);
  expect(restored.code).toBe("EVENT_INVALID");
}
```

**Step 2: Run all tests**

Run: `bun run test`
Expected: All PASS.

**Step 3: Commit**

```bash
git add src/__tests__/workflow-runner.test.ts
git commit -m "feat: update tests to assert structured error codes"
```

---

### Task 6: Export errors from package entry point

**Files:**
- Modify: `src/index.ts`

**Step 1: Add re-export**

At the bottom of `src/index.ts`, add:

```typescript
export {
  WorkflowError,
  WorkflowNotFoundError,
  WorkflowAlreadyExistsError,
  WorkflowTypeUnknownError,
  PayloadValidationError,
  EventValidationError,
  StepFailedError,
  StepRetryExhaustedError,
  EventTimeoutError,
  WorkflowNotRunningError,
} from "./engine/errors";
export type { ErrorCode, ErrorSource } from "./engine/errors";
```

**Step 2: Run all tests**

Run: `bun run test`
Expected: All PASS.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export error classes from package entry point"
```
