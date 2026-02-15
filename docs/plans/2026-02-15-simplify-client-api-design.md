# Simplify Server-Side Client API

**Date**: 2026-02-15
**Status**: Design

## Problem

The `Ablauf` class has redundant methods that duplicate functionality already available on the stub returned by `ablauf.create()`. This creates two ways to do the same thing and bloats the API surface.

Duplicated methods (zero added value — just call `stub.method()`):
- `ablauf.status(id)` → `stub.getStatus()`
- `ablauf.pause(id)` → `stub.pause()`
- `ablauf.resume(id)` → `stub.resume()`
- `ablauf.terminate(id)` → `stub.terminate()`

Additionally, `ablauf.sendEvent()` and `ablauf.waitForUpdate()` are instance-level operations that belong on the instance handle, not on the top-level client.

## Design

### WorkflowHandle

Introduce a `WorkflowHandle` class that wraps a raw DO stub and workflow class reference. All instance-level operations go through the handle.

```ts
class WorkflowHandle<Payload, Result, Events, Type, SSEUpdates> {
  constructor(
    private rpcStub: WorkflowRunnerStub,     // typed DO RPC
    private rawStub: DurableObjectStub,       // raw DO stub (for WebSocket)
    private workflow: WorkflowClass<...>,     // schema access for validation
    private id: string,                       // instance ID (for error messages)
  ) {}

  getStatus(): Promise<WorkflowStatusResponseFor<Payload, Result, Type>>
  sendEvent(props: WorkflowEventProps<Events>): Promise<void>   // validates, then delivers
  pause(): Promise<void>
  resume(): Promise<void>
  terminate(): Promise<void>
  waitForUpdate<K>(props: { update: K, timeout?: string }): Promise<SSEUpdates[K]>
}
```

### Slim Ablauf class

The `Ablauf` class keeps only orchestration and infrastructure methods:

```ts
class Ablauf {
  create(workflow, { id, payload }): Promise<WorkflowHandle>   // start workflow, return handle
  get(workflow, { id }): WorkflowHandle                         // get handle for existing workflow (no async)
  list(type, filters?): Promise<WorkflowIndexEntry[]>           // query index shards

  createWorkflowRunner(overrides?): DurableObject class         // produce DO class
  createHandlers(): { rpcHandler, openApiHandler }              // dashboard oRPC handlers
  getDashboardContext(): DashboardContext                       // dashboard context
  get router(): typeof dashboardRouter                          // dashboard router
}
```

### Removed from Ablauf

- `status(id)` / `status(id, workflow)`
- `pause(id)`
- `resume(id)`
- `terminate(id)`
- `sendEvent(workflow, props)`
- `waitForUpdate(workflow, props)`

### Removed from public exports

- `TypedWorkflowRunnerStub` type (replaced by `WorkflowHandle`)

### New public export

- `WorkflowHandle` class

### Internal helper

Both `create()` and `get()` use a shared private method:

```ts
private createHandle(workflow, id): WorkflowHandle {
  const doId = this.binding.idFromName(id);
  const rawStub = this.binding.get(doId);
  const rpcStub = rawStub as unknown as WorkflowRunnerStub;
  return new WorkflowHandle(rpcStub, rawStub, workflow, id);
}
```

## Consumer usage

```ts
// Create and interact
const order = await ablauf.create(OrderWorkflow, {
  id: 'order-123',
  payload: { items: [...] },
});
const status = await order.getStatus();

// Get handle for existing workflow
const order = ablauf.get(OrderWorkflow, { id: 'order-123' });
await order.sendEvent({ event: 'payment', payload: { amount: 99 } });
await order.pause();
await order.resume();
await order.terminate();

// Wait for SSE update
const progress = await order.waitForUpdate({ update: 'progress', timeout: '30s' });

// List workflows (stays on Ablauf — not instance-specific)
const entries = await ablauf.list('process-order', { status: 'running' });
```

## Migration impact

### Files that change

| File | Change |
|---|---|
| `packages/workflows/src/client.ts` | Remove 6 methods, add `get()`, add private `createHandle()`, `create()` returns `WorkflowHandle` |
| `packages/workflows/src/handle.ts` | **New file** — `WorkflowHandle` class |
| `packages/workflows/src/index.ts` | Export `WorkflowHandle`, remove `TypedWorkflowRunnerStub` export |
| `packages/workflows/src/engine/types.ts` | `TypedWorkflowRunnerStub` type removed |
| `apps/worker/src/index.ts` | No change needed — already calls `.getStatus()` on the return value |
| `apps/worker/src/__tests__/*.test.ts` | Minimal — same method names, variable naming optional |
| `apps/worker/src/utils/benchmark-runner.ts` | No change needed — already uses `.getStatus()` |
| `apps/docs/content/docs/**/*.mdx` | Update examples to use `ablauf.get()` + handle pattern |

### Files that don't change

- `dashboard.ts` — uses its own internal `getStub()` for raw DO RPC
- `WorkflowRunnerStub` interface — stays as internal type
- All DO internals (`workflow-runner.ts`, `step.ts`, `interrupts.ts`, etc.)

## Breaking changes

1. `ablauf.status(id)` → `ablauf.get(Workflow, { id }).getStatus()`
2. `ablauf.pause(id)` → `ablauf.get(Workflow, { id }).pause()`
3. `ablauf.resume(id)` / `ablauf.terminate(id)` → same pattern
4. `ablauf.sendEvent(Workflow, { id, event, payload })` → `ablauf.get(Workflow, { id }).sendEvent({ event, payload })`
5. `ablauf.waitForUpdate(Workflow, { id, ... })` → `ablauf.get(Workflow, { id }).waitForUpdate({ ... })`
6. `TypedWorkflowRunnerStub` type import → `WorkflowHandle`
