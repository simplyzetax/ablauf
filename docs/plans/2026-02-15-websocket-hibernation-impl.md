# WebSocket Hibernation Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace SSE transport with Cloudflare Durable Object Hibernatable WebSockets so DOs can sleep while clients stay connected, reducing memory cost and enabling cleaner real-time updates.

**Architecture:** The workflow engine's real-time transport swaps from `TransformStream`-based SSE to `WebSocketPair` + `ctx.acceptWebSocket()` with hibernation. The `broadcast()`/`emit()` split, replay detection, and Zod validation are preserved. The DO gains `webSocketMessage`/`webSocketClose`/`webSocketError` handlers. The client package switches from `fetch()`+SSE-parser to native `WebSocket` with reconnection.

**Tech Stack:** Cloudflare Workers (Durable Objects, Hibernatable WebSocket API), TypeScript, Zod, superjson, Drizzle ORM, vitest + @cloudflare/vitest-pool-workers, oRPC, React (TanStack Query)

---

## Task 1: Refactor SSEContext to use WebSockets (`sse.ts`)

This is the core transport change. Replace `Set<WritableStreamDefaultWriter>` with `DurableObjectState.getWebSockets()`.

**Files:**
- Modify: `packages/workflows/src/engine/sse.ts` (full rewrite)

**Step 1: Write the failing test**

Create test file `apps/worker/src/__tests__/ws.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf } from '@der-ablauf/workflows';
import type { WorkflowRunnerStub } from '@der-ablauf/workflows';
import { SSEWorkflow } from '../workflows/sse-workflow';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

describe('WebSocket live updates', () => {
	it('workflow completes and persists emit messages', async () => {
		const stub = await ablauf.create(SSEWorkflow, {
			id: 'ws-1',
			payload: { itemCount: 10 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe('completed');
		expect(status.result).toEqual({ processed: 10 });
	});

	it('connectWS returns persisted messages to a new WebSocket client', async () => {
		await ablauf.create(SSEWorkflow, {
			id: 'ws-stream-1',
			payload: { itemCount: 6 },
		});

		// Connect via WebSocket to the DO
		const rawStub = env.WORKFLOW_RUNNER.get(
			env.WORKFLOW_RUNNER.idFromName('ws-stream-1'),
		);
		const resp = await rawStub.fetch('http://fake-host/ws', {
			headers: { Upgrade: 'websocket' },
		});
		expect(resp.status).toBe(101);

		const ws = resp.webSocket!;
		ws.accept();

		// Should receive persisted emit messages
		const messages: string[] = [];
		const done = new Promise<void>((resolve) => {
			ws.addEventListener('message', (evt) => {
				messages.push(evt.data as string);
				const parsed = JSON.parse(evt.data as string);
				if (parsed.event === 'close') {
					resolve();
				}
			});
			// Fallback timeout
			setTimeout(resolve, 2000);
		});
		await done;

		const parsed = messages.map((m) => JSON.parse(m));
		const doneMsg = parsed.find((m: any) => m.event === 'done');
		expect(doneMsg).toBeDefined();
		expect(doneMsg.data).toContain('Processed 6 items');

		ws.close();
	});

	it('broadcast messages are not persisted (fire-and-forget)', async () => {
		await ablauf.create(SSEWorkflow, {
			id: 'ws-broadcast-1',
			payload: { itemCount: 4 },
		});

		const rawStub = env.WORKFLOW_RUNNER.get(
			env.WORKFLOW_RUNNER.idFromName('ws-broadcast-1'),
		);
		const resp = await rawStub.fetch('http://fake-host/ws', {
			headers: { Upgrade: 'websocket' },
		});
		const ws = resp.webSocket!;
		ws.accept();

		const messages: string[] = [];
		const done = new Promise<void>((resolve) => {
			ws.addEventListener('message', (evt) => {
				messages.push(evt.data as string);
				const parsed = JSON.parse(evt.data as string);
				if (parsed.event === 'close') resolve();
			});
			setTimeout(resolve, 2000);
		});
		await done;

		const parsed = messages.map((m) => JSON.parse(m));
		expect(parsed.some((m: any) => m.event === 'done')).toBe(true);
		expect(parsed.some((m: any) => m.event === 'progress')).toBe(false);

		ws.close();
	});

	it('connectWS on workflow without sseUpdates returns 1008 close', async () => {
		const { EchoWorkflow } = await import('../workflows/echo-workflow');

		await new Ablauf(env.WORKFLOW_RUNNER).create(EchoWorkflow, {
			id: 'ws-no-schema-1',
			payload: { message: 'no sse' },
		});

		const rawStub = env.WORKFLOW_RUNNER.get(
			env.WORKFLOW_RUNNER.idFromName('ws-no-schema-1'),
		);
		const resp = await rawStub.fetch('http://fake-host/ws', {
			headers: { Upgrade: 'websocket' },
		});
		const ws = resp.webSocket!;
		ws.accept();

		const closed = new Promise<{ code: number }>((resolve) => {
			ws.addEventListener('close', (evt) => {
				resolve({ code: evt.code });
			});
		});
		const result = await closed;
		expect(result.code).toBe(1008); // Policy violation — no SSE schema
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- --testPathPattern ws.test`
Expected: FAIL — `connectWS` doesn't exist yet, no WebSocket upgrade path in DO.

**Step 3: Rewrite `SSEContext` to `LiveContext`**

Replace the entire contents of `packages/workflows/src/engine/sse.ts`:

```ts
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import type { z } from 'zod';
import type { DurableObjectState } from 'cloudflare:workers';
import { sseMessagesTable } from '../db/schema';
import type { SSE } from './types';
import superjson from 'superjson';

type UpdateKey<Updates extends object> = Extract<keyof Updates, string>;

/**
 * Manages real-time WebSocket updates for a workflow instance.
 *
 * Two modes via `isReplay` flag:
 * - **Replay** (`true`): `broadcast()` is a no-op; `emit()` only persists.
 * - **Live** (`false`): Both `broadcast()` and `emit()` send to connected WebSocket clients.
 *
 * Uses Cloudflare's Hibernatable WebSocket API — the platform manages connections
 * so the Durable Object can hibernate between events.
 */
export class LiveContext<Updates extends object = {}> implements SSE<Updates> {
	private closed = false;

	constructor(
		private doState: DurableObjectState,
		private db: DrizzleSqliteDODatabase,
		private schemas: Record<string, z.ZodType<unknown>> | null,
		private isReplay: boolean,
	) {}

	setReplay(isReplay: boolean): void {
		this.isReplay = isReplay;
	}

	broadcast<K extends UpdateKey<Updates>>(name: K, data: Updates[K]): void {
		if (this.closed || this.isReplay) return;
		const parsed = this.validate(name, data);
		this.sendToClients(name, parsed);
	}

	emit<K extends UpdateKey<Updates>>(name: K, data: Updates[K]): void {
		if (this.closed) return;
		const parsed = this.validate(name, data);
		if (!this.isReplay) {
			this.sendToClients(name, parsed);
			this.db
				.insert(sseMessagesTable)
				.values({
					event: name,
					data: superjson.stringify(parsed),
					createdAt: Date.now(),
				})
				.run();
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		const msg = JSON.stringify({ event: 'close', data: {} });
		for (const ws of this.doState.getWebSockets()) {
			try {
				ws.send(msg);
				ws.close(1000, 'Workflow ended');
			} catch {
				// Client already disconnected
			}
		}
	}

	async flushPersistedMessages(ws: WebSocket): Promise<void> {
		const messages = await this.db.select().from(sseMessagesTable);
		for (const msg of messages) {
			try {
				ws.send(JSON.stringify({ event: msg.event, data: superjson.parse(msg.data) }));
			} catch {
				break;
			}
		}
	}

	private validate<K extends UpdateKey<Updates>>(name: K, data: Updates[K]): Updates[K] {
		if (!this.schemas) {
			throw new Error(`Workflow does not define sseUpdates; cannot emit "${name}"`);
		}
		const schema = this.schemas[name];
		if (!schema) {
			throw new Error(`Unknown SSE update "${name}"`);
		}
		return schema.parse(data) as Updates[K];
	}

	private sendToClients<K extends UpdateKey<Updates>>(name: K, data: Updates[K]): void {
		const msg = JSON.stringify({ event: name, data: superjson.stringify(data) });
		for (const ws of this.doState.getWebSockets()) {
			try {
				ws.send(msg);
			} catch {
				// Dead socket — platform will clean up
			}
		}
	}
}

/** No-op context used when a workflow does not define `sseUpdates`. */
export class NoOpSSEContext implements SSE<never> {
	broadcast<K extends never>(_name: K, _data: never): void {}
	emit<K extends never>(_name: K, _data: never): void {}
	close(): void {}
}
```

**Step 4: Run type-check**

Run: `bun run check-types`
Expected: Will show errors in `workflow-runner.ts` since it still references `SSEContext`. That's expected — we fix it in Task 2.

**Step 5: Commit**

```bash
git add packages/workflows/src/engine/sse.ts apps/worker/src/__tests__/ws.test.ts
git commit -m "refactor: replace SSEContext with LiveContext using WebSocket API"
```

---

## Task 2: Update WorkflowRunner DO for WebSocket upgrade + hibernation (`workflow-runner.ts`)

Add the WebSocket upgrade path in `fetch()`, wire up `LiveContext`, add hibernation handlers, and remove the old `connectSSE()` RPC method.

**Files:**
- Modify: `packages/workflows/src/engine/workflow-runner.ts:1-465`

**Step 1: Update imports and class fields**

In `workflow-runner.ts`, change the import from:
```ts
import { SSEContext, NoOpSSEContext } from './sse';
```
to:
```ts
import { LiveContext, NoOpSSEContext } from './sse';
```

Change the `sseCtx` field type from:
```ts
private sseCtx: SSEContext<Record<string, unknown>> | null = null;
```
to:
```ts
private liveCtx: LiveContext<Record<string, unknown>> | null = null;
```

**Step 2: Add `fetch()` method with WebSocket upgrade**

Add a `fetch()` override to the `WorkflowRunner` class (before the RPC methods section):

```ts
async fetch(request: Request): Promise<Response> {
	if (request.headers.get('Upgrade') !== 'websocket') {
		return new Response('Expected WebSocket', { status: 426 });
	}

	const [wf] = await this.db.select().from(workflowTable);
	if (!wf) {
		return new Response('Workflow not found', { status: 404 });
	}

	const WorkflowCls = registry[wf.type];
	const sseSchemas = WorkflowCls?.sseUpdates ?? null;

	if (!sseSchemas) {
		// No SSE schema — reject with close code
		const pair = new WebSocketPair();
		this.ctx.acceptWebSocket(pair[1]);
		pair[1].close(1008, 'Workflow does not define sseUpdates');
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	const pair = new WebSocketPair();
	this.ctx.acceptWebSocket(pair[1]);

	// Ensure LiveContext exists
	if (!this.liveCtx) {
		this.liveCtx = new LiveContext(this.ctx, this.db, sseSchemas, true);
	}

	// Flush persisted emit messages to the new client
	await this.liveCtx.flushPersistedMessages(pair[1]);

	return new Response(null, { status: 101, webSocket: pair[0] });
}
```

**Step 3: Add hibernation event handlers**

Add after the `fetch()` method:

```ts
async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
	// Future: handle client→server messages (pause, resume, cancel)
}

async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
	// Platform manages cleanup — no manual tracking needed
}

async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
	_ws.close(1011, 'Unexpected error');
}
```

**Step 4: Remove `connectSSE()` method**

Delete the entire `connectSSE()` method (lines 229-264 of the current file).

**Step 5: Update all `this.sseCtx` references to `this.liveCtx`**

In the `replay()` method, replace:
- `this.sseCtx` → `this.liveCtx`
- `new SSEContext(this.db, sseSchemas, true)` → `new LiveContext(this.ctx, this.db, sseSchemas, true)`

In `setStatus()`, replace:
- `this.sseCtx?.close()` → `this.liveCtx?.close()`

In the `replay()` catch block, replace:
- `this.sseCtx?.close()` → `this.liveCtx?.close()`

**Step 6: Run tests**

Run: `bun run test -- --testPathPattern ws.test`
Expected: WebSocket tests should pass.

**Step 7: Commit**

```bash
git add packages/workflows/src/engine/workflow-runner.ts
git commit -m "feat: add WebSocket upgrade + hibernation handlers to WorkflowRunner"
```

---

## Task 3: Update types and public API surface

Update `WorkflowRunnerStub`, the `SSE` interface naming, and `index.ts` exports.

**Files:**
- Modify: `packages/workflows/src/engine/types.ts:325-337` (WorkflowRunnerStub)
- Modify: `packages/workflows/src/index.ts:72` (export rename)

**Step 1: Update `WorkflowRunnerStub`**

In `types.ts`, remove the `connectSSE` line from `WorkflowRunnerStub`:

```ts
export interface WorkflowRunnerStub {
	initialize(props: WorkflowRunnerInitProps): Promise<void>;
	getStatus(): Promise<WorkflowStatusResponse>;
	deliverEvent(props: WorkflowRunnerEventProps): Promise<void>;
	pause(): Promise<void>;
	resume(): Promise<void>;
	terminate(): Promise<void>;
	indexWrite(props: WorkflowIndexEntry): Promise<void>;
	indexList(filters?: WorkflowIndexListFilters): Promise<WorkflowIndexEntry[]>;
	_expireTimers(): Promise<void>;
}
```

Note: `connectSSE()` is removed because WebSocket connections now go through `fetch()`, not RPC.

**Step 2: Update `index.ts` exports**

In `packages/workflows/src/index.ts`, change line 72 from:
```ts
export { SSEContext } from './engine/sse';
```
to:
```ts
export { LiveContext } from './engine/sse';
```

**Step 3: Run type-check**

Run: `bun run check-types`
Expected: Should find compile errors in `client.ts` (Ablauf class) and `dashboard.ts` where `connectSSE()` is called. We fix those next.

**Step 4: Commit**

```bash
git add packages/workflows/src/engine/types.ts packages/workflows/src/index.ts
git commit -m "refactor: update WorkflowRunnerStub and exports for WebSocket"
```

---

## Task 4: Update Ablauf client class (`client.ts`)

The `waitForUpdate()` method currently uses `connectSSE()` + `parseSSEStream()`. Replace it with a WebSocket-based approach using the DO's `fetch()`.

**Files:**
- Modify: `packages/workflows/src/client.ts:228-295`

**Step 1: Rewrite `waitForUpdate()`**

The challenge: `waitForUpdate()` needs to connect a WebSocket to the DO. Since it has the DO binding, it can call `stub.fetch()` directly with the upgrade header. Replace the method body:

```ts
async waitForUpdate<
	Payload,
	Result,
	Events extends object,
	Type extends string,
	SSEUpdates extends object,
	K extends Extract<keyof SSEUpdates, string>,
>(
	workflow: WorkflowClass<Payload, Result, Events, Type, SSEUpdates>,
	props: { id: string; update: K; timeout?: string },
): Promise<SSEUpdates[K]> {
	void workflow;
	const doId = this.binding.idFromName(props.id);
	const stub = this.binding.get(doId);
	const resp = await stub.fetch('http://fake-host/ws', {
		headers: { Upgrade: 'websocket' },
	});

	const ws = resp.webSocket;
	if (!ws) {
		throw new WorkflowNotRunningError(props.id, 'WebSocket upgrade failed');
	}
	ws.accept();

	const timeoutMs = props.timeout ? parseDuration(props.timeout) : null;

	return new Promise<SSEUpdates[K]>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | null = null;

		const cleanup = () => {
			if (timer) clearTimeout(timer);
			try { ws.close(); } catch { /* already closed */ }
		};

		ws.addEventListener('message', (evt) => {
			try {
				const parsed = JSON.parse(evt.data as string);
				if (parsed.event === 'close') {
					cleanup();
					this.getStub(props.id).getStatus().then((status) => {
						reject(new WorkflowNotRunningError(props.id, status.status));
					}).catch(reject);
					return;
				}
				if (parsed.event === props.update) {
					cleanup();
					resolve(superjson.parse(parsed.data) as SSEUpdates[K]);
				}
			} catch {
				// Malformed message, skip
			}
		});

		ws.addEventListener('close', () => {
			cleanup();
			this.getStub(props.id).getStatus().then((status) => {
				reject(new WorkflowNotRunningError(props.id, status.status));
			}).catch(reject);
		});

		ws.addEventListener('error', () => {
			cleanup();
			reject(new WorkflowNotRunningError(props.id, 'WebSocket error'));
		});

		if (timeoutMs !== null) {
			timer = setTimeout(() => {
				cleanup();
				reject(new UpdateTimeoutError(String(props.update), props.timeout ?? `${timeoutMs}ms`));
			}, timeoutMs);
		}
	});
}
```

**Step 2: Remove `parseSSEStream` import**

Remove the import of `parseSSEStream` from `client.ts` (line 4). Add `import superjson from 'superjson'` if not already present.

**Step 3: Run type-check**

Run: `bun run check-types`
Expected: PASS (or errors only in dashboard.ts, fixed next).

**Step 4: Run the existing `waitForUpdate` test**

Run: `bun run test -- --testPathPattern ws.test`
Expected: The `waitForUpdate` test should pass.

**Step 5: Commit**

```bash
git add packages/workflows/src/client.ts
git commit -m "refactor: update waitForUpdate to use WebSocket instead of SSE stream"
```

---

## Task 5: Update dashboard oRPC router (`dashboard.ts`)

Remove the `subscribe` endpoint from the oRPC router. The dashboard client will connect to WebSocket directly instead.

**Files:**
- Modify: `packages/workflows/src/dashboard.ts:149-176`

**Step 1: Remove the `subscribe` route and `parseSSEStream` import**

Delete the `subscribe` const (lines 149-167) and remove it from the `dashboardRouter` export (line 174). Also remove the `parseSSEStream` import (line 6).

The router becomes:
```ts
export const dashboardRouter = {
	workflows: {
		list,
		get,
		timeline,
	},
};
```

**Step 2: Run type-check**

Run: `bun run check-types`
Expected: May show errors in dashboard UI or client package where `workflows.subscribe` is referenced. We fix those in Tasks 6 and 7.

**Step 3: Commit**

```bash
git add packages/workflows/src/dashboard.ts
git commit -m "refactor: remove SSE subscribe endpoint from dashboard router"
```

---

## Task 6: Delete `sse-stream.ts` and update remaining references

**Files:**
- Delete: `packages/workflows/src/engine/sse-stream.ts`
- Modify: `packages/workflows/src/index.ts` (remove any sse-stream exports if present)

**Step 1: Delete the file**

```bash
rm packages/workflows/src/engine/sse-stream.ts
```

**Step 2: Check for remaining imports**

Search for `sse-stream` across the codebase. Remove any remaining imports. The main ones should already be gone from `client.ts` and `dashboard.ts`.

**Step 3: Run type-check**

Run: `bun run check-types`
Expected: PASS (or errors only in the client/dashboard packages, fixed next).

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete sse-stream.ts (SSE parser no longer needed)"
```

---

## Task 7: Update `@der-ablauf/client` package for WebSocket

Replace the oRPC-based `subscribe()` with a direct WebSocket connection.

**Files:**
- Modify: `packages/client/src/client.ts:38-54`
- Modify: `packages/client/src/types.ts`

**Step 1: Add `wsUrl` to client config**

In `packages/client/src/types.ts`, add:

```ts
export interface AblaufClientConfig {
	/** Base URL for the oRPC endpoint (e.g. "https://api.example.com/__ablauf") */
	url: string;
	/** Base URL for WebSocket connections. Defaults to url with protocol swapped to ws(s):// */
	wsUrl?: string;
	/** Include credentials (cookies) in requests */
	withCredentials?: boolean;
	/** Custom headers to send with requests */
	headers?: Record<string, string>;
}
```

**Step 2: Rewrite `createAblaufClient` with WebSocket subscribe**

In `packages/client/src/client.ts`, replace the `createAblaufClient` function:

```ts
function deriveWsUrl(httpUrl: string): string {
	return httpUrl.replace(/^http/, 'ws');
}

/** Create an extended client with a typed `subscribe()` helper over WebSocket. */
export function createAblaufClient(config: AblaufClientConfig): AblaufClient {
	const rawClient = createDashboardClient(config);
	const wsBaseUrl = config.wsUrl ?? deriveWsUrl(config.url);

	const client = Object.assign(rawClient, {
		async *subscribe<W extends WorkflowClass>(
			id: string,
			options?: { signal?: AbortSignal },
		): AsyncGenerator<InferSSEUpdates<W>, void, unknown> {
			const ws = new WebSocket(`${wsBaseUrl}/workflows/${id}/ws`);
			const signal = options?.signal;

			try {
				// Wait for connection
				await new Promise<void>((resolve, reject) => {
					ws.addEventListener('open', () => resolve(), { once: true });
					ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true });
					signal?.addEventListener('abort', () => {
						ws.close();
						reject(new DOMException('Aborted', 'AbortError'));
					}, { once: true });
				});

				// Yield messages as async iterable
				const messageQueue: string[] = [];
				let resolve: (() => void) | null = null;
				let done = false;

				ws.addEventListener('message', (evt) => {
					messageQueue.push(evt.data as string);
					resolve?.();
				});

				ws.addEventListener('close', () => {
					done = true;
					resolve?.();
				});

				ws.addEventListener('error', () => {
					done = true;
					resolve?.();
				});

				signal?.addEventListener('abort', () => {
					ws.close();
					done = true;
					resolve?.();
				});

				while (!done) {
					if (messageQueue.length === 0) {
						await new Promise<void>((r) => { resolve = r; });
						resolve = null;
					}

					while (messageQueue.length > 0) {
						const raw = messageQueue.shift()!;
						try {
							const parsed = JSON.parse(raw);
							if (parsed.event === 'close') {
								done = true;
								break;
							}
							yield {
								event: parsed.event,
								data: SuperJSON.parse(parsed.data),
							} as InferSSEUpdates<W>;
						} catch {
							// Malformed message, skip
						}
					}
				}
			} finally {
				if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
					ws.close();
				}
			}
		},
	});

	return client as AblaufClient;
}
```

Add `import SuperJSON from 'superjson';` to the imports. Remove the `dashboardRouter` import if it's no longer used (it was used by `workflows.subscribe` which is now gone from the type).

Note: The `AblaufClient` interface's `subscribe` signature stays the same — it still returns `AsyncGenerator<InferSSEUpdates<W>, void, unknown>`.

**Step 3: Update `DashboardClient` type**

Since `subscribe` was removed from the oRPC router, the `DashboardClient` type (which is `RouterClient<typeof dashboardRouter>`) will no longer have `workflows.subscribe`. The `AblaufClient` interface extends `DashboardClient` and adds `subscribe` as a top-level method, so this should still work. Verify the types compile.

**Step 4: Run type-check**

Run: `bun run check-types`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/client/src/client.ts packages/client/src/types.ts
git commit -m "feat: switch client subscribe() from SSE to WebSocket"
```

---

## Task 8: Update dashboard UI (`detail-panel.tsx`)

Replace the oRPC subscribe call with a direct WebSocket connection for cache invalidation.

**Files:**
- Modify: `packages/dashboard/src/components/detail-panel.tsx:45-60`
- Modify: `packages/dashboard/src/lib/orpc.ts`

**Step 1: Add a WebSocket URL helper to `orpc.ts`**

In `packages/dashboard/src/lib/orpc.ts`, add:

```ts
export function getWsUrl(): string {
	const base = getBaseUrl();
	return base.replace(/^http/, 'ws');
}
```

**Step 2: Rewrite the `useEffect` subscription in `detail-panel.tsx`**

Replace lines 45-60 with:

```ts
useEffect(() => {
	const baseWsUrl = getWsUrl();
	const ws = new WebSocket(`${baseWsUrl}/workflows/${workflowId}/ws`);

	ws.addEventListener('message', () => {
		queryClient.invalidateQueries({
			queryKey: orpc.workflows.get.queryOptions({ input: { id: workflowId } }).queryKey,
		});
	});

	ws.addEventListener('error', () => {
		// Connection failed — polling fallback handles it
	});

	return () => ws.close();
}, [workflowId, queryClient]);
```

Add `import { getWsUrl } from '~/lib/orpc';` to the imports. Remove `client` from the imports if no longer used.

**Step 3: Run type-check**

Run: `bun run check-types`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/detail-panel.tsx packages/dashboard/src/lib/orpc.ts
git commit -m "refactor: switch dashboard to WebSocket for live updates"
```

---

## Task 9: Add WebSocket upgrade route in worker (`apps/worker/src/index.ts`)

The dashboard and external clients need an HTTP route that proxies WebSocket upgrades to the DO.

**Files:**
- Modify: `apps/worker/src/index.ts`

**Step 1: Add the WebSocket upgrade route**

Add before the `app.all('/__ablauf/*', ...)` route:

```ts
app.get('/__ablauf/workflows/:id/ws', async (c) => {
	const upgradeHeader = c.req.header('Upgrade');
	if (upgradeHeader !== 'websocket') {
		return c.text('Expected WebSocket upgrade', 426);
	}
	const id = c.req.param('id');
	const doId = c.env.WORKFLOW_RUNNER.idFromName(id);
	const stub = c.env.WORKFLOW_RUNNER.get(doId);
	return stub.fetch(c.req.raw);
});
```

**Step 2: Run the full test suite**

Run: `bun run test`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: add WebSocket upgrade route for live workflow updates"
```

---

## Task 10: Delete old SSE tests and clean up

**Files:**
- Delete: `apps/worker/src/__tests__/sse.test.ts`

**Step 1: Delete the old test file**

```bash
rm apps/worker/src/__tests__/sse.test.ts
```

**Step 2: Run the full test suite**

Run: `bun run test`
Expected: All tests pass. The ws.test.ts tests cover the same scenarios.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove old SSE tests (replaced by WebSocket tests)"
```

---

## Task 11: Update documentation

Update docs to reflect the WebSocket transport change.

**Files:**
- Modify: `apps/docs/content/docs/workflows/sse.mdx` (rename to `live-updates.mdx` or update content in-place)
- Modify: `apps/docs/content/docs/client/index.mdx`

**Step 1: Update `sse.mdx`**

Rename references from "SSE" to "WebSocket" where referring to the transport layer. Keep the `broadcast()`/`emit()` API docs the same since that interface hasn't changed. Key sections to update:

- Title: "Real-time Updates" (drop "SSE" from the title)
- Remove the EventSource code example (replaced by WebSocket)
- Update the client subscribe example to note it uses WebSocket internally
- Update the "Performance Notes" section to mention hibernation benefits
- Remove the note about "long-lived HTTP connections"

**Step 2: Update `client/index.mdx`**

- Update "Real-Time Subscriptions" section to note WebSocket transport
- Update any `EventSource` references
- Add `wsUrl` config option to the table

**Step 3: Commit**

```bash
git add apps/docs/
git commit -m "docs: update real-time updates docs for WebSocket transport"
```

---

## Task 12: Final verification

**Step 1: Run full test suite**

Run: `bun run test`
Expected: All tests pass.

**Step 2: Run type-check**

Run: `bun run check-types`
Expected: No errors.

**Step 3: Verify no remaining SSE transport references**

Search for `connectSSE`, `parseSSEStream`, `sse-stream`, `TransformStream` (in the context of SSE), `WritableStreamDefaultWriter` across the codebase. None should remain in production code (docs may reference the concept but not the old implementation).

**Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup for WebSocket migration"
```
