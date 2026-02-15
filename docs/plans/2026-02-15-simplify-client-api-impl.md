# Simplify Client API — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace redundant Ablauf methods with a `WorkflowHandle` class, making the handle the single surface for all instance operations.

**Architecture:** Create `WorkflowHandle` wrapping raw DO stub + workflow class. Ablauf.create() and new Ablauf.get() return handles. Remove 6 redundant methods from Ablauf. Update tests and docs.

**Tech Stack:** TypeScript, Zod, Cloudflare Workers, Vitest

---

### Task 1: Create WorkflowHandle class

**Files:**
- Create: `packages/workflows/src/handle.ts`

**Step 1: Create the WorkflowHandle class**

Move `sendEvent` validation logic from `client.ts` and `waitForUpdate` WebSocket logic into a new `WorkflowHandle` class. The handle wraps three things: the typed RPC stub, the raw DO stub (for WebSocket), and the workflow class (for schema validation).

Expose `_rpc` getter for test access to the raw `WorkflowRunnerStub` (needed by `advanceAlarm` and raw `deliverEvent` tests).

**Step 2: Commit**

```bash
git add packages/workflows/src/handle.ts
git commit -m "feat: add WorkflowHandle class for instance operations"
```

---

### Task 2: Update Ablauf class

**Files:**
- Modify: `packages/workflows/src/client.ts`

**Step 1: Refactor the Ablauf class**

- Import `WorkflowHandle`
- Add `createHandle()` private method
- Add `get()` public method returning `WorkflowHandle`
- Change `create()` return type from `TypedWorkflowRunnerStub` to `WorkflowHandle`
- Remove: `status()`, `pause()`, `resume()`, `terminate()`, `sendEvent()`, `waitForUpdate()`
- Remove now-unused imports (`EventValidationError`, `extractZodIssues`, `UpdateTimeoutError`, `WorkflowNotRunningError`, `parseDuration`, `SuperJSON`, `TypedWorkflowRunnerStub`, `WorkflowEventProps`)

**Step 2: Commit**

```bash
git add packages/workflows/src/client.ts
git commit -m "refactor: slim Ablauf class, delegate to WorkflowHandle"
```

---

### Task 3: Update types and exports

**Files:**
- Modify: `packages/workflows/src/engine/types.ts`
- Modify: `packages/workflows/src/index.ts`

**Step 1: Remove TypedWorkflowRunnerStub from types.ts**

Delete the `TypedWorkflowRunnerStub` type alias.

**Step 2: Update index.ts exports**

- Remove `TypedWorkflowRunnerStub` from type exports
- Add `WorkflowHandle` to exports
- Keep `WorkflowRunnerStub` (still needed for advanced/test use)

**Step 3: Commit**

```bash
git add packages/workflows/src/engine/types.ts packages/workflows/src/index.ts
git commit -m "refactor: export WorkflowHandle, remove TypedWorkflowRunnerStub"
```

---

### Task 4: Update tests

**Files:**
- Modify: `apps/worker/src/__tests__/workflow-runner.test.ts`
- Modify: `apps/worker/src/__tests__/ws.test.ts`
- Modify: `apps/worker/src/__tests__/replay.test.ts`
- Modify: `apps/worker/src/__tests__/concurrency.test.ts`
- Modify: `apps/worker/src/__tests__/indexing.test.ts` (minor — `stub.terminate()` works on handle)

**Step 1: Update workflow-runner.test.ts**

- `stub.deliverEvent(...)` → `stub.sendEvent(...)` where the stub is a handle
- `advanceAlarm(stub)` → `advanceAlarm(stub._rpc)` (handle doesn't have `_expireTimers`)
- Type safety test: `const rawStub = stub as unknown as WorkflowRunnerStub` → `const rawStub = stub._rpc`
- `TypedWorkflowRunnerStub` import removed (if present)

**Step 2: Update replay.test.ts**

- `stub.deliverEvent(...)` → `stub.sendEvent(...)`

**Step 3: Update concurrency.test.ts**

- `advanceAlarm(stub)` → `advanceAlarm(stub._rpc)`
- `const rawStub = stub as unknown as WorkflowRunnerStub` → `const rawStub = stub._rpc`

**Step 4: Update ws.test.ts**

- `ablauf.waitForUpdate(SSEWorkflow, { id, update })` → use handle from create

**Step 5: Run tests**

```bash
bun run test
```

Expected: All tests pass.

**Step 6: Commit**

```bash
git add apps/worker/src/__tests__/
git commit -m "test: update tests to use WorkflowHandle API"
```

---

### Task 5: Update documentation

**Files:**
- Modify: `apps/docs/content/docs/server/index.mdx`
- Modify: `apps/docs/content/docs/server/api-reference.mdx`
- Modify: `apps/docs/content/docs/workflows/lifecycle.mdx`
- Modify: `apps/docs/content/docs/workflows/getting-started.mdx`
- Modify: `apps/docs/content/docs/workflows/events.mdx`
- Modify: `apps/docs/content/docs/dashboard/index.mdx`

**Step 1: Update server/index.mdx**

- "Sending Events" section: `ablauf.sendEvent(...)` → `ablauf.get(...).sendEvent(...)`
- "Querying Status" section: `ablauf.status(...)` → `ablauf.get(...).getStatus()`
- "Lifecycle Control" section: `ablauf.pause/resume/terminate(...)` → handle methods
- "Waiting for SSE Updates" section: `ablauf.waitForUpdate(...)` → handle method

**Step 2: Update server/api-reference.mdx**

- Remove `sendEvent()`, `status()`, `pause()`, `resume()`, `terminate()`, `waitForUpdate()` method docs
- Add `get()` method docs
- Update `create()` return type from `TypedWorkflowRunnerStub` to `WorkflowHandle`
- Add `WorkflowHandle` section documenting all handle methods
- Update error discrimination example

**Step 3: Update workflows/lifecycle.mdx**

- "Getting Status" section: `ablauf.status(...)` → `ablauf.get(...).getStatus()`
- "Pausing and Resuming" section: `ablauf.pause/resume(...)` → handle methods
- "Terminating" section: `ablauf.terminate(...)` → handle method

**Step 4: Update workflows/getting-started.mdx**

- Status route: `ablauf.status(id, GreetingWorkflow)` → `ablauf.get(GreetingWorkflow, { id }).getStatus()`

**Step 5: Update workflows/events.mdx**

- All `ablauf.sendEvent(...)` calls → `ablauf.get(...).sendEvent(...)`

**Step 6: Update dashboard/index.mdx**

- `ablauf.status(id)` reference → `ablauf.get(Workflow, { id }).getStatus()`

**Step 7: Commit**

```bash
git add apps/docs/
git commit -m "docs: update API examples for WorkflowHandle pattern"
```
