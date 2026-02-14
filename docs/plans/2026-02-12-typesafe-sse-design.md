# Type-Safe SSE for Ablauf Workflows

## Overview

Real-time, type-safe Server-Sent Events (SSE) from Durable Object workflows to browser clients. Workflows push updates via an `sse` parameter in `run()`, and clients consume them through a typed `@der-ablauf/client` package.

## Workflow Definition

Workflows opt into SSE by adding an optional static `sseUpdates` Zod schema:

```ts
const sseUpdates = z.discriminatedUnion('type', [
	z.object({ type: z.literal('progress'), percent: z.number() }),
	z.object({ type: z.literal('status'), message: z.string() }),
]);

export class OrderWorkflow extends BaseWorkflow<OrderPayload, OrderResult, OrderEvents> {
	static type = 'order';
	static inputSchema = inputSchema;
	static events = eventSchemas;
	static sseUpdates = sseUpdates;

	async run(step: Step<OrderEvents>, payload: OrderPayload, sse: SSE<z.infer<typeof sseUpdates>>): Promise<OrderResult> {
		sse.broadcast({ type: 'progress', percent: 0 });
		const items = await step.do('fetch-items', () => getItems(payload.orderId));
		sse.broadcast({ type: 'progress', percent: 50 });
		const result = await step.do('charge', () => charge(items));
		sse.emit({ type: 'status', message: 'Order complete' });
		return result;
	}
}
```

Workflows without `sseUpdates` receive `SSE<never>` (calling broadcast/emit is a type error).

## SSE Object: Two Broadcast Modes

The `sse` parameter is a separate third argument to `run()`, keeping it distinct from `step`.

### `sse.broadcast(data)` - Fire-and-Forget

- Validates data against `sseUpdates` schema at runtime
- Pushes to all currently connected SSE clients
- On replay: **no-op**. The engine detects replay vs. first-run and silently skips.

### `sse.emit(data)` - Persisted

- Validates data against `sseUpdates` schema at runtime
- Pushes to all currently connected SSE clients
- Stores the message in `sse_messages` SQLite table with a sequence number
- On replay: **skipped for push**, but the stored message remains. New clients connecting mid-workflow receive all persisted `emit` messages in order before getting live updates.

### `sse.close()` - Close Connections

Closes all SSE connections for this workflow instance. Sends a special `close` event to clients.

### Replay Detection

Reuses the existing mechanism - the engine already knows whether a `step.do()` is replaying from cache or executing fresh. The `SSE` object receives an `isReplay` flag that flips to `false` once execution passes the last completed step.

## Persistence

New `sse_messages` table in the DO's SQLite database:

```sql
CREATE TABLE sse_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

## Server-Side SSE Response Helper

The package exports a helper that returns a raw `Response`. Users mount it on whatever route they want:

```ts
import { createSSEStream } from '@der-ablauf/workflows';

app.get('/workflows/:id/sse', async (c) => {
	const user = await getUser(c.req);
	if (!user) return c.json({ error: 'unauthorized' }, 401);
	return createSSEStream(c.env.WORKFLOW_RUNNER, c.req.params.id);
});
```

### Under the Hood

`createSSEStream(binding, workflowId)`:

1. Resolves the DO stub from the binding + workflow ID
2. Calls a new RPC method on the DO: `connectSSE()` which returns a `ReadableStream`
3. Wraps it in a `Response` with SSE headers (`text/event-stream`, `no-cache`, `Connection: keep-alive`)

Inside the DO, `connectSSE()`:

1. Creates a `TransformStream` pair
2. Stores the writable end in an in-memory `Set<WritableStreamDefaultWriter>` on the DO instance
3. Flushes any persisted `emit` messages to the new client (replay catch-up)
4. Returns the readable end

Dead connections are detected and cleaned up on write failure.

### Wire Format

```
data: {"type":"progress","percent":50}

data: {"type":"status","message":"Order complete"}

event: close
data: {}
```

## Client-Side: `@der-ablauf/client` Package

Lightweight, framework-agnostic TypeScript package. Zero dependency on `@der-ablauf/workflows`.

### Singleton Client

```ts
// lib/ablauf.ts
import { createAblaufClient } from '@der-ablauf/client';

export const ablaufClient = createAblaufClient({
	url: '/api/workflows',
	withCredentials: true,
	headers: {
		Authorization: `Bearer ${getToken()}`,
	},
});
```

Uses `fetch()` with a manual SSE parser on the readable stream internally (not native `EventSource`) to support custom headers.

### Subscribe API

```ts
import type { OrderWorkflow } from '@/workflows/order-workflow';

const sub = ablaufClient.subscribe<typeof OrderWorkflow>('order-123', (data) => {
	// data: { type: 'progress', percent: number } | { type: 'status', message: string }
	if (data.type === 'progress') {
		updateProgressBar(data.percent);
	}
});

sub.on('error', (e) => showReconnecting());
sub.on('close', () => showDone());
sub.unsubscribe();
```

Constructs URL as `${baseUrl}/${workflowId}/sse`, auto-reconnects with backoff on connection drop, and the server `close` event triggers cleanup.

## Type Flow

```
WorkflowClass.sseUpdates (Zod schema)
        |
  z.infer<typeof sseUpdates>  ->  SSE<Updates> parameter in run()
        |
  typeof WorkflowClass  ->  extracted by type helper on client
        |
  subscribe<typeof OrderWorkflow>()  ->  callback data is typed
```

Type extraction helper in `@der-ablauf/client`:

```ts
type InferSSEUpdates<W> = W extends { sseUpdates: z.ZodType<infer T> } ? T : never

subscribe<W extends { sseUpdates?: z.ZodType<any> }>(
  workflowId: string,
  callback?: (data: InferSSEUpdates<W>) => void
): Subscription<InferSSEUpdates<W>>
```

Client-side uses `import type` which TypeScript erases at build time - no server code leaks into the browser bundle. Users import workflow types from their own codebase, not from `@der-ablauf/workflows`.

## Package Boundaries

### `@der-ablauf/workflows` (existing, server-side)

- New: `SSE<T>` type and `SSEContext` implementation
- New: `sse_messages` table + migration
- New: `createSSEStream()` helper
- New: `connectSSE()` RPC method on DO
- Modified: `BaseWorkflow.run()` signature gets optional third `sse` param
- Modified: `sseUpdates` optional static field on `BaseWorkflow`
- Modified: `createWorkflowRunner()` wires up SSE context + replay logic

### `@der-ablauf/client` (new, browser-safe)

- `createAblaufClient(config)` - factory for the singleton
- `InferSSEUpdates<W>` - type helper
- `Subscription<T>` - return type with `.on()` / `.unsubscribe()`
- Zero dependency on `@der-ablauf/workflows` - only imports `zod` for type-level extraction
