# Migrate SSE to WebSockets with Durable Object Hibernation

## Motivation

The current SSE implementation keeps Durable Objects alive in memory while clients are connected, even when workflows are idle (sleeping, waiting for events, paused). This is wasteful because:

1. **Memory cost** — the DO holds a `Set<WritableStreamDefaultWriter>` in RAM for each connected client
2. **No hibernation** — the DO cannot sleep while SSE connections exist (TransformStream writers pin the DO in memory)
3. **Dashboard inefficiency** — the dashboard uses SSE events only as React Query cache invalidation triggers, re-fetching the full workflow status via REST on every event

Cloudflare's Hibernatable WebSocket API solves all three: the platform manages WebSocket connections outside the DO, allowing the DO to hibernate between events while clients stay connected.

## Architecture Change

### Before (SSE)

```
Client → fetch(GET /subscribe) → oRPC async generator → DO.connectSSE()
  → TransformStream pair created
  → WritableStreamDefaultWriter stored in Set<Writer>
  → ReadableStream returned to client
  → DO stays alive as long as any writer exists
```

### After (WebSocket + Hibernation)

```
Client → new WebSocket(/ws) → Hono route upgrades → DO.fetch() handles upgrade
  → WebSocketPair created
  → this.ctx.acceptWebSocket(server, [instanceId]) — platform owns the connection
  → Persisted emit() messages flushed to new client
  → DO hibernates — zero memory cost
  → On alarm/event: DO wakes, calls this.ctx.getWebSockets(), sends messages, sleeps again
```

## What Changes

### 1. WorkflowRunner DO (`workflow-runner.ts`)

**WebSocket upgrade in `fetch()`:**

The DO's `fetch()` handler gains a WebSocket upgrade path. When a request has the `Upgrade: websocket` header, it creates a `WebSocketPair`, accepts the server side with hibernation, flushes persisted messages, and returns the 101 response.

**Hibernation event handlers:**

New methods on the DO class:

- `webSocketMessage(ws, message)` — future bidirectional support (initially a no-op or used for ping/pong)
- `webSocketClose(ws, code, reason, wasClean)` — platform calls this on disconnect; no manual cleanup needed since `getWebSockets()` automatically excludes closed sockets
- `webSocketError(ws, error)` — close the socket cleanly

**Remove `connectSSE()` RPC method** — replaced by the WebSocket upgrade path in `fetch()`.

### 2. SSEContext → LiveContext (`sse.ts`)

Rename `SSEContext` to `LiveContext` (or `RealtimeContext`) to reflect transport-agnosticism.

**Key changes:**

| Before (SSE) | After (WebSocket) |
|---|---|
| `Set<WritableStreamDefaultWriter>` | `this.ctx.getWebSockets()` |
| `writer.write(encode(msg))` | `ws.send(superjson.stringify(msg))` |
| `flushPersistedMessages(writer)` | `flushPersistedMessages(ws: WebSocket)` |
| Manual dead-writer cleanup on write failure | Platform manages connection lifecycle |

**What stays the same:**

- `broadcast(name, data)` — ephemeral, skipped on replay
- `emit(name, data)` — persisted + sent, write-only on replay
- `close()` — sends close frame, platform handles cleanup
- `isReplay` flag and flip logic
- Zod schema validation on all messages
- `sse_messages` SQLite table (rename to `live_messages` optional)

**Wire format changes:**

```
// Before (SSE text/event-stream):
event: progress
data: {"json":{"percent":50},"meta":{}}

// After (WebSocket JSON frames):
{"event":"progress","data":{"json":{"percent":50},"meta":{}}}
```

Each WebSocket message is a single JSON object with `event` and `data` fields, serialized via superjson.

### 3. Dashboard API (`dashboard.ts`)

**Remove the oRPC `subscribe` endpoint.** The dashboard client connects directly to the DO via WebSocket — no oRPC proxy layer needed. The client constructs the WebSocket URL from the base URL and workflow ID.

If an oRPC endpoint is still desired (for URL discovery or auth token exchange), it can return the WebSocket URL rather than streaming data.

### 4. Client Package (`@der-ablauf/client`)

**Replace `fetch()` + SSE parser with `WebSocket`:**

```ts
subscribe<W>(workflowId: string): AsyncIterable<InferSSEUpdates<W>> {
  const ws = new WebSocket(`${this.wsUrl}/workflows/${workflowId}/ws`);
  // Return async iterable that yields parsed messages
  // Auto-reconnect with exponential backoff on close/error
  // Close on receiving { event: "close" } frame
}
```

**Delete `sse-stream.ts`** — the manual SSE parser is no longer needed.

**Reconnection:** Implement exponential backoff with jitter. On reconnect, the server replays persisted `emit()` messages, so the client receives any missed milestones automatically.

### 5. Dashboard UI (`detail-panel.tsx`)

Minimal change — swap the oRPC subscribe call to the client's WebSocket-based `subscribe()`. The existing React Query invalidation pattern can remain, or be improved to use the actual message data directly.

### 6. Hono Route (`apps/worker/src/index.ts` or equivalent)

Add a WebSocket upgrade route that forwards to the DO:

```ts
app.get('/workflows/:id/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 426);
  }
  const stub = getStub(c.env.WORKFLOW_RUNNER, c.req.param('id'));
  return stub.fetch(c.req.raw);
});
```

This passes the upgrade request directly to the DO, which handles the `WebSocketPair` creation.

### 7. wrangler.toml / DO Configuration

No changes needed — hibernation is the default behavior when you implement `webSocketMessage()` on a DO class. No opt-in flag required.

## What Doesn't Change

- **Replay semantics** — the `isReplay` flag, `StepContext.onFirstExecution` callback, and replay-skip behavior are transport-independent
- **Persistence** — `emit()` still writes to the `sse_messages` SQLite table; late joiners still get replayed messages
- **Zod validation** — all messages validated against workflow's `sseUpdates` schema
- **Type safety** — `InferSSEUpdates<W>` type helper works the same way
- **Step execution** — steps, interrupts, alarms, events are completely unaffected
- **Error hierarchy** — no new error classes needed (existing `ObservabilityDisabledError` covers the "no sseUpdates defined" case)

## Public API Surface Changes

### `@der-ablauf/workflows` exports

- Remove: `createSSEStream()` helper (SSE-specific)
- Add: nothing new needed — the WebSocket upgrade is handled internally by the DO
- Rename: `SSEContext` → `LiveContext` (internal, not exported)
- Keep: `SSE<Updates>` interface type (rename to `Live<Updates>` optional but recommended for clarity)

### `@der-ablauf/client` exports

- `subscribe()` return type changes from callback-based to async iterable (or keep both)
- Remove SSE-specific internals
- Add WebSocket reconnection logic

## Testing Strategy

- Rewrite `apps/worker/src/__tests__/sse.test.ts` → `ws.test.ts`
- Use `WebSocket` client in tests (supported by `@cloudflare/vitest-pool-workers` in workerd)
- Test cases:
  - Connect, receive broadcast messages
  - Connect, receive persisted emit messages
  - Late joiner receives replayed emit history
  - DO hibernates after sending messages (verify via alarm-based wake)
  - Reconnection receives persisted messages
  - Close frame terminates connection
  - Multiple concurrent clients receive same broadcasts
  - Workflow without `sseUpdates` rejects/ignores WebSocket upgrade gracefully

## Migration Checklist

1. Add WebSocket upgrade path to `WorkflowRunner.fetch()` with hibernation handlers
2. Refactor `SSEContext` → `LiveContext` to use `getWebSockets()` instead of `Set<Writer>`
3. Update `flushPersistedMessages()` to write to `WebSocket` instead of `WritableStreamDefaultWriter`
4. Add Hono WebSocket upgrade route in the worker
5. Update `@der-ablauf/client` to use `WebSocket` with reconnection
6. Update dashboard `detail-panel.tsx` to use new client subscribe
7. Remove oRPC `subscribe` endpoint from `dashboard.ts`
8. Delete `sse-stream.ts`
9. Rewrite SSE tests as WebSocket tests
10. Update documentation (`apps/docs/content/docs/workflows/sse.mdx` → rename/rewrite)
