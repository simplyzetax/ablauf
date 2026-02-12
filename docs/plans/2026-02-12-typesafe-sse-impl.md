# Type-Safe SSE Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time type-safe SSE streaming from Durable Object workflows to browser clients via `sse.broadcast()` / `sse.emit()` in workflows and a new `@ablauf/client` package.

**Architecture:** Workflows get an `sse` parameter in `run()` backed by an `SSEContext` that writes to connected `TransformStream` writers stored in-memory on the DO. `emit()` persists messages to a new `sse_messages` SQLite table for replay to late-joining clients. A `createSSEStream()` helper returns a raw `Response` for user-defined routes. The `@ablauf/client` package provides a `createAblaufClient()` singleton with typed `subscribe()` using `fetch()`-based SSE parsing.

**Tech Stack:** TypeScript, Zod, Drizzle ORM, Cloudflare Durable Objects, ReadableStream/TransformStream APIs

**Design Doc:** `docs/plans/2026-02-12-typesafe-sse-design.md`

---

### Task 1: Add `sse_messages` Table to DB Schema

**Files:**
- Modify: `packages/workflows/src/db/schema.ts`

**Step 1: Add the `sseMessagesTable` to the schema**

Add after `stepsTable`:

```ts
export const sseMessagesTable = sqliteTable("sse_messages", {
	seq: integer("seq").primaryKey({ autoIncrement: true }),
	data: text("data").notNull(),
	createdAt: integer("created_at").notNull(),
});
```

**Step 2: Generate the Drizzle migration**

Run: `cd packages/workflows && bun run db:generate`

This creates a new SQL migration file in `packages/workflows/drizzle/`.

**Step 3: Update `migrations.js` to include the new migration**

The `drizzle-kit generate` command should update `drizzle/meta/_journal.json` and create a new `.sql` file. Verify the new migration file contains `CREATE TABLE sse_messages`. Then update `packages/workflows/drizzle/migrations.js` to import the new migration file (following the pattern of existing imports).

**Step 4: Export `sseMessagesTable` from the package**

In `packages/workflows/src/index.ts`, add `sseMessagesTable` to the existing `schema` export line:

```ts
export { workflowTable, stepsTable, instancesTable, sseMessagesTable } from "./db/schema";
```

**Step 5: Commit**

```bash
git add packages/workflows/src/db/schema.ts packages/workflows/drizzle/ packages/workflows/src/index.ts
git commit -m "feat(sse): add sse_messages table for persisted SSE events"
```

---

### Task 2: Add SSE Types

**Files:**
- Modify: `packages/workflows/src/engine/types.ts`
- Modify: `packages/workflows/src/index.ts`

**Step 1: Add the `SSE` interface and related types to `types.ts`**

Add at the end of `packages/workflows/src/engine/types.ts`:

```ts
export interface SSE<T = never> {
	broadcast(data: T): void;
	emit(data: T): void;
	close(): void;
}
```

**Step 2: Update `WorkflowInstance` to include the optional `sse` parameter**

In `packages/workflows/src/engine/types.ts`, update the `WorkflowInstance` interface:

```ts
export interface WorkflowInstance<
	Payload = unknown,
	Result = unknown,
	Events extends object = {},
	SSEUpdates = never,
> {
	run(step: Step<Events>, payload: Payload, sse: SSE<SSEUpdates>): Promise<Result>;
}
```

**Step 3: Update `WorkflowClass` to include `sseUpdates` and the new generic**

```ts
export interface WorkflowClass<
	Payload = unknown,
	Result = unknown,
	Events extends object = WorkflowEvents,
	Type extends string = string,
	SSEUpdates = never,
> {
	type: Type;
	inputSchema: import("zod").z.ZodType<Payload>;
	events: WorkflowEventSchemas<Events>;
	defaults?: Partial<WorkflowDefaults>;
	sseUpdates?: import("zod").z.ZodType<SSEUpdates>;
	new (): WorkflowInstance<Payload, Result, Events, SSEUpdates>;
}
```

**Step 4: Export `SSE` from `index.ts`**

Add to the types export block in `packages/workflows/src/index.ts`:

```ts
export type { SSE } from "./engine/types";
```

**Step 5: Run type check**

Run: `cd packages/workflows && bunx tsc --noEmit`

This will fail because `BaseWorkflow.run()` and `WorkflowRunner.replay()` don't match the new signature yet. That's expected — we fix it in the next tasks.

**Step 6: Commit**

```bash
git add packages/workflows/src/engine/types.ts packages/workflows/src/index.ts
git commit -m "feat(sse): add SSE interface and update WorkflowClass/WorkflowInstance types"
```

---

### Task 3: Implement `SSEContext`

**Files:**
- Create: `packages/workflows/src/engine/sse.ts`
- Modify: `packages/workflows/src/index.ts`

**Step 1: Create `SSEContext` class**

Create `packages/workflows/src/engine/sse.ts`:

```ts
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type { z } from "zod";
import { sseMessagesTable } from "../db/schema";
import type { SSE } from "./types";

export class SSEContext<T = never> implements SSE<T> {
	private writers = new Set<WritableStreamDefaultWriter>();
	private closed = false;

	constructor(
		private db: DrizzleSqliteDODatabase,
		private schema: z.ZodType<T> | null,
		private isReplay: boolean,
	) {}

	setReplay(isReplay: boolean): void {
		this.isReplay = isReplay;
	}

	addWriter(writer: WritableStreamDefaultWriter): void {
		this.writers.add(writer);
	}

	removeWriter(writer: WritableStreamDefaultWriter): void {
		this.writers.delete(writer);
	}

	get writerCount(): number {
		return this.writers.size;
	}

	broadcast(data: T): void {
		if (this.closed || this.isReplay) return;
		if (this.schema) {
			this.schema.parse(data);
		}
		this.writeToClients(data);
	}

	emit(data: T): void {
		if (this.closed) return;
		if (this.schema) {
			this.schema.parse(data);
		}
		if (!this.isReplay) {
			this.writeToClients(data);
		}
		// Always persist, even on replay (idempotent via step tracking upstream)
		// Actually on replay the emit was already persisted, so skip
		if (!this.isReplay) {
			this.db.insert(sseMessagesTable).values({
				data: JSON.stringify(data),
				createdAt: Date.now(),
			}).run();
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		const encoder = new TextEncoder();
		const closeMsg = encoder.encode("event: close\ndata: {}\n\n");
		for (const writer of this.writers) {
			try {
				writer.write(closeMsg);
				writer.close();
			} catch {
				// Client already disconnected
			}
		}
		this.writers.clear();
	}

	async flushPersistedMessages(writer: WritableStreamDefaultWriter): Promise<void> {
		const messages = await this.db.select().from(sseMessagesTable);
		const encoder = new TextEncoder();
		for (const msg of messages) {
			try {
				writer.write(encoder.encode(`data: ${msg.data}\n\n`));
			} catch {
				break;
			}
		}
	}

	private writeToClients(data: T): void {
		const encoder = new TextEncoder();
		const message = encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
		for (const writer of this.writers) {
			try {
				writer.write(message);
			} catch {
				// Client disconnected, clean up
				this.writers.delete(writer);
			}
		}
	}
}

/** No-op SSE context for workflows that don't define sseUpdates */
export class NoOpSSEContext implements SSE<never> {
	broadcast(_data: never): void {}
	emit(_data: never): void {}
	close(): void {}
}
```

**Step 2: Export `SSEContext` from `index.ts`**

Add to `packages/workflows/src/index.ts`:

```ts
export { SSEContext } from "./engine/sse";
```

**Step 3: Commit**

```bash
git add packages/workflows/src/engine/sse.ts packages/workflows/src/index.ts
git commit -m "feat(sse): implement SSEContext with broadcast, emit, and close"
```

---

### Task 4: Update `BaseWorkflow` to Accept `sse` Parameter

**Files:**
- Modify: `packages/workflows/src/engine/base-workflow.ts`

**Step 1: Update `BaseWorkflow` class**

```ts
import { z } from "zod";
import type { Step, SSE, WorkflowDefaults } from "./types";

export abstract class BaseWorkflow<
	Payload = unknown,
	Result = unknown,
	Events extends object = {},
	SSEUpdates = never,
> {
	static type: string;
	static inputSchema: z.ZodType<unknown> = z.unknown();
	static events: Record<string, z.ZodType<unknown>> = {};
	static defaults: Partial<WorkflowDefaults> = {};
	static sseUpdates?: z.ZodType<unknown>;

	abstract run(step: Step<Events>, payload: Payload, sse: SSE<SSEUpdates>): Promise<Result>;
}
```

**Step 2: Commit**

```bash
git add packages/workflows/src/engine/base-workflow.ts
git commit -m "feat(sse): update BaseWorkflow with sseUpdates and sse parameter"
```

---

### Task 5: Wire SSE into `WorkflowRunner`

**Files:**
- Modify: `packages/workflows/src/engine/workflow-runner.ts`

This is the largest task. The workflow runner needs to:
1. Store an `SSEContext` instance on the DO
2. Create it during `replay()` with the correct replay flag
3. Expose a `connectSSE()` RPC method
4. Add `connectSSE` to the `WorkflowRunnerStub` interface

**Step 1: Add SSEContext import and instance field**

At the top of `workflow-runner.ts`, add:

```ts
import { SSEContext, NoOpSSEContext } from "./sse";
```

Inside the `WorkflowRunner` class (after the `private workflowId` field), add:

```ts
private sseCtx: SSEContext<unknown> | null = null;
```

**Step 2: Update `replay()` to create and inject SSEContext**

In the `replay()` method, after `const instance = new WorkflowCls();` and `const stepCtx = new StepContext(...)`:

```ts
// Create SSE context
const sseSchema = WorkflowCls.sseUpdates ?? null;
if (!this.sseCtx) {
	this.sseCtx = new SSEContext(this.db, sseSchema, true);
}
// Start in replay mode - will be switched off after last completed step
this.sseCtx.setReplay(true);
```

Then, we need to determine when replay ends and live execution begins. The replay boundary is when `step.do()` actually executes `fn()` instead of returning a cached result. We need to signal this to the SSE context.

Add a callback mechanism: modify `StepContext` to accept an `onFirstExecution` callback (see Task 6). For now, in `replay()`, set up the callback:

```ts
stepCtx.onFirstExecution = () => {
	this.sseCtx?.setReplay(false);
};
```

Update the `instance.run()` call to pass the SSE context:

```ts
const sseArg = this.sseCtx ?? new NoOpSSEContext();
const result = await instance.run(stepCtx, payload, sseArg);
```

**Step 3: Add `connectSSE()` RPC method**

Add this method to the `WorkflowRunner` class, after `terminate()`:

```ts
async connectSSE(): Promise<ReadableStream> {
	const [wf] = await this.db.select().from(workflowTable);
	if (!wf) {
		throw new WorkflowNotFoundError(this.workflowId ?? "unknown");
	}

	const WorkflowCls = registry[wf.type];
	const sseSchema = WorkflowCls?.sseUpdates ?? null;

	if (!this.sseCtx) {
		this.sseCtx = new SSEContext(this.db, sseSchema, true);
	}

	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();

	// Flush persisted emit messages to the new client
	await this.sseCtx.flushPersistedMessages(writer);

	// Register for live updates
	this.sseCtx.addWriter(writer);

	return readable;
}
```

**Step 4: Update `WorkflowRunnerStub` in `types.ts`**

Add to `WorkflowRunnerStub` interface:

```ts
connectSSE(): Promise<ReadableStream>;
```

**Step 5: Commit**

```bash
git add packages/workflows/src/engine/workflow-runner.ts packages/workflows/src/engine/types.ts
git commit -m "feat(sse): wire SSEContext into WorkflowRunner with connectSSE RPC"
```

---

### Task 6: Add Replay Boundary Detection to `StepContext`

**Files:**
- Modify: `packages/workflows/src/engine/step.ts`

**Step 1: Add `onFirstExecution` callback to `StepContext`**

Add a public property after the `defaults` field:

```ts
public onFirstExecution: (() => void) | null = null;
private hasExecuted = false;
```

**Step 2: Trigger the callback when a step executes fresh code**

In the `do()` method, right before `const result = await fn();` (inside the `try` block), add:

```ts
if (!this.hasExecuted) {
	this.hasExecuted = true;
	this.onFirstExecution?.();
}
```

This fires exactly once — when the engine first runs a step's function (not returning from cache). This is the replay→live boundary.

**Step 3: Run type check**

Run: `bun run check-types` from the root.

**Step 4: Commit**

```bash
git add packages/workflows/src/engine/step.ts
git commit -m "feat(sse): add onFirstExecution callback for replay boundary detection"
```

---

### Task 7: Add `createSSEStream` Helper

**Files:**
- Create: `packages/workflows/src/sse-stream.ts`
- Modify: `packages/workflows/src/index.ts`

**Step 1: Create the helper**

Create `packages/workflows/src/sse-stream.ts`:

```ts
import type { WorkflowRunnerStub } from "./engine/types";

export function createSSEStream(
	binding: DurableObjectNamespace,
	workflowId: string,
): Response {
	const stub = binding.get(
		binding.idFromName(workflowId),
	) as unknown as WorkflowRunnerStub;

	const upstream = stub.connectSSE();

	// Return a Response that streams from the DO's ReadableStream
	// We use a TransformStream to handle the async nature of connectSSE()
	const { readable, writable } = new TransformStream();

	upstream.then(async (stream) => {
		try {
			await stream.pipeTo(writable);
		} catch {
			// Client disconnected
			try { writable.close(); } catch { /* already closed */ }
		}
	}).catch(() => {
		try { writable.close(); } catch { /* already closed */ }
	});

	return new Response(readable, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
		},
	});
}
```

**Step 2: Export from `index.ts`**

Add to `packages/workflows/src/index.ts`:

```ts
export { createSSEStream } from "./sse-stream";
```

**Step 3: Commit**

```bash
git add packages/workflows/src/sse-stream.ts packages/workflows/src/index.ts
git commit -m "feat(sse): add createSSEStream helper returning raw Response"
```

---

### Task 8: Update Existing Workflows to Match New Signature

**Files:**
- Modify: `apps/worker/src/workflows/test-workflow.ts`
- Modify: `apps/worker/src/workflows/echo-workflow.ts`
- Modify: `apps/worker/src/workflows/failing-step-workflow.ts`

The `run()` signature now requires a third `sse` parameter. Existing workflows that don't use SSE just accept it and ignore it.

**Step 1: Update `TestWorkflow`**

Add `SSE` import and update the `run()` signature:

```ts
import type { Step, SSE } from "@ablauf/workflows";
```

```ts
async run(step: Step<TestEvents>, payload: TestPayload, _sse: SSE<never>): Promise<TestResult> {
```

**Step 2: Update `EchoWorkflow`**

```ts
import type { Step, SSE } from "@ablauf/workflows";
```

```ts
async run(step: Step, payload: EchoPayload, _sse: SSE<never>): Promise<EchoResult> {
```

**Step 3: Update `FailingStepWorkflow`**

```ts
import type { Step, SSE } from "@ablauf/workflows";
```

```ts
async run(step: Step, payload: FailingPayload, _sse: SSE<never>): Promise<string> {
```

**Step 4: Run type check and tests**

Run: `bun run check-types && bun run test` from the root.

All existing tests should pass — the SSE parameter is injected by the runner but existing workflows just ignore it.

**Step 5: Commit**

```bash
git add apps/worker/src/workflows/
git commit -m "feat(sse): update existing workflows to accept sse parameter"
```

---

### Task 9: Add SSE Integration Tests

**Files:**
- Create: `apps/worker/src/workflows/sse-workflow.ts`
- Create: `apps/worker/src/__tests__/sse.test.ts`
- Modify: `apps/worker/src/index.ts` (add SSE workflow to registry)

**Step 1: Create a test workflow that uses SSE**

Create `apps/worker/src/workflows/sse-workflow.ts`:

```ts
import { z } from "zod";
import { BaseWorkflow } from "@ablauf/workflows";
import type { Step, SSE } from "@ablauf/workflows";

const inputSchema = z.object({ itemCount: z.number() });
type SSEPayload = z.infer<typeof inputSchema>;

const sseUpdates = z.discriminatedUnion("type", [
	z.object({ type: z.literal("progress"), percent: z.number() }),
	z.object({ type: z.literal("done"), message: z.string() }),
]);
type SSEUpdates = z.infer<typeof sseUpdates>;

interface SSEResult {
	processed: number;
}

export class SSEWorkflow extends BaseWorkflow<SSEPayload, SSEResult, {}, SSEUpdates> {
	static type = "sse-test" as const;
	static inputSchema = inputSchema;
	static sseUpdates = sseUpdates;

	async run(step: Step, payload: SSEPayload, sse: SSE<SSEUpdates>): Promise<SSEResult> {
		sse.broadcast({ type: "progress", percent: 0 });

		const half = await step.do("first-half", async () => {
			return Math.floor(payload.itemCount / 2);
		});

		sse.broadcast({ type: "progress", percent: 50 });

		await step.do("second-half", async () => {
			return payload.itemCount - half;
		});

		sse.emit({ type: "done", message: `Processed ${payload.itemCount} items` });

		return { processed: payload.itemCount };
	}
}
```

**Step 2: Register the workflow in the worker**

In `apps/worker/src/index.ts`, add:

```ts
import { SSEWorkflow } from "./workflows/sse-workflow";
```

Add `SSEWorkflow` to the `workflows` array:

```ts
const workflows = [TestWorkflow, FailingStepWorkflow, EchoWorkflow, SSEWorkflow];
```

**Step 3: Write the test**

Create `apps/worker/src/__tests__/sse.test.ts`:

```ts
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";

import { Ablauf } from "@ablauf/workflows";
import type { WorkflowRunnerStub } from "@ablauf/workflows";
import { SSEWorkflow } from "../workflows/sse-workflow";

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

describe("SSE", () => {
	it("workflow completes and persists emit messages", async () => {
		const stub = await ablauf.create(SSEWorkflow, {
			id: "sse-1",
			payload: { itemCount: 10 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe("completed");
		expect(status.result).toEqual({ processed: 10 });
	});

	it("connectSSE returns a readable stream with persisted messages", async () => {
		// Create and complete a workflow first
		await ablauf.create(SSEWorkflow, {
			id: "sse-stream-1",
			payload: { itemCount: 6 },
		});

		// Now connect via SSE — should get the persisted emit message
		const rawStub = env.WORKFLOW_RUNNER.get(
			env.WORKFLOW_RUNNER.idFromName("sse-stream-1"),
		) as unknown as WorkflowRunnerStub;

		const stream = await rawStub.connectSSE();
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		// Read the first chunk — should contain the persisted emit
		const { value } = await reader.read();
		const text = decoder.decode(value);
		expect(text).toContain('"type":"done"');
		expect(text).toContain("Processed 6 items");

		reader.releaseLock();
	});

	it("broadcast messages are not persisted (fire-and-forget)", async () => {
		await ablauf.create(SSEWorkflow, {
			id: "sse-broadcast-1",
			payload: { itemCount: 4 },
		});

		// Connect SSE after completion — should only see emit messages, not broadcast
		const rawStub = env.WORKFLOW_RUNNER.get(
			env.WORKFLOW_RUNNER.idFromName("sse-broadcast-1"),
		) as unknown as WorkflowRunnerStub;

		const stream = await rawStub.connectSSE();
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		const { value } = await reader.read();
		const text = decoder.decode(value);
		// Should contain the emit (done) but NOT the broadcasts (progress)
		expect(text).toContain('"type":"done"');
		expect(text).not.toContain('"type":"progress"');

		reader.releaseLock();
	});
});
```

**Step 4: Run the tests**

Run: `cd apps/worker && bun run test`

**Step 5: Commit**

```bash
git add apps/worker/src/workflows/sse-workflow.ts apps/worker/src/__tests__/sse.test.ts apps/worker/src/index.ts
git commit -m "test(sse): add SSE workflow and integration tests"
```

---

### Task 10: Add SSE Route to Demo Worker

**Files:**
- Modify: `apps/worker/src/index.ts`

**Step 1: Add an SSE endpoint using `createSSEStream`**

Add to imports:

```ts
import { createSSEStream } from "@ablauf/workflows";
```

Add a new route after the existing `/echo` route:

```ts
app.get("/workflows/:id/sse", (c) => {
	return createSSEStream(c.env.WORKFLOW_RUNNER, c.req.param("id"));
});
```

**Step 2: Run type check**

Run: `bun run check-types`

**Step 3: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat(sse): add SSE endpoint to demo worker"
```

---

### Task 11: Create `@ablauf/client` Package

**Files:**
- Create: `packages/client/package.json`
- Create: `packages/client/tsconfig.json`
- Create: `packages/client/src/index.ts`
- Create: `packages/client/src/client.ts`
- Create: `packages/client/src/types.ts`
- Create: `packages/client/src/sse-parser.ts`

**Step 1: Create `packages/client/package.json`**

```json
{
	"name": "@ablauf/client",
	"version": "0.0.1",
	"type": "module",
	"exports": {
		".": "./src/index.ts"
	},
	"types": "./src/index.ts",
	"scripts": {
		"check-types": "tsc --noEmit"
	},
	"dependencies": {
		"zod": "^4.3.6"
	}
}
```

**Step 2: Create `packages/client/tsconfig.json`**

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"lib": ["es2024", "dom"]
	},
	"include": ["src/**/*.ts"]
}
```

**Step 3: Create `packages/client/src/types.ts`**

```ts
import type { z } from "zod";

export type InferSSEUpdates<W> = W extends { sseUpdates: z.ZodType<infer T> }
	? T
	: never;

export interface AblaufClientConfig {
	/** Base URL for SSE endpoints (e.g. "/api/workflows" or "https://api.example.com/workflows") */
	url: string;
	/** Include credentials (cookies) in requests */
	withCredentials?: boolean;
	/** Custom headers to send with SSE connection */
	headers?: Record<string, string>;
}

export interface Subscription<T> {
	on(event: "error", handler: (error: Event | Error) => void): Subscription<T>;
	on(event: "close", handler: () => void): Subscription<T>;
	unsubscribe(): void;
}

export type SSECallback<T> = (data: T) => void;
```

**Step 4: Create `packages/client/src/sse-parser.ts`**

A minimal SSE parser for `fetch()`-based streaming (since native `EventSource` doesn't support custom headers):

```ts
export interface SSEParserCallbacks {
	onMessage(data: string, event?: string): void;
	onError(error: Error): void;
}

export async function parseSSEStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	callbacks: SSEParserCallbacks,
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			let currentData = "";
			let currentEvent = "";

			for (const line of lines) {
				if (line.startsWith("data: ")) {
					currentData = line.slice(6);
				} else if (line.startsWith("event: ")) {
					currentEvent = line.slice(7);
				} else if (line === "") {
					if (currentData) {
						callbacks.onMessage(currentData, currentEvent || undefined);
					}
					currentData = "";
					currentEvent = "";
				}
			}
		}
	} catch (e) {
		callbacks.onError(e instanceof Error ? e : new Error(String(e)));
	}
}
```

**Step 5: Create `packages/client/src/client.ts`**

```ts
import type {
	AblaufClientConfig,
	InferSSEUpdates,
	Subscription,
	SSECallback,
} from "./types";
import { parseSSEStream } from "./sse-parser";

export function createAblaufClient(config: AblaufClientConfig) {
	return {
		subscribe<W extends { sseUpdates?: import("zod").z.ZodType<unknown> }>(
			workflowId: string,
			callback?: SSECallback<InferSSEUpdates<W>>,
		): Subscription<InferSSEUpdates<W>> {
			type T = InferSSEUpdates<W>;
			let abortController = new AbortController();
			let errorHandler: ((error: Event | Error) => void) | null = null;
			let closeHandler: (() => void) | null = null;
			let shouldReconnect = true;

			const connect = async () => {
				try {
					const response = await fetch(`${config.url}/${workflowId}/sse`, {
						headers: config.headers,
						credentials: config.withCredentials ? "include" : "same-origin",
						signal: abortController.signal,
					});

					if (!response.ok || !response.body) {
						throw new Error(`SSE connection failed: ${response.status}`);
					}

					const reader = response.body.getReader();
					await parseSSEStream(reader, {
						onMessage(data: string, event?: string) {
							if (event === "close") {
								shouldReconnect = false;
								closeHandler?.();
								return;
							}
							try {
								const parsed = JSON.parse(data) as T;
								callback?.(parsed);
							} catch {
								// Skip malformed messages
							}
						},
						onError(error: Error) {
							errorHandler?.(error);
						},
					});

					// Stream ended without close event — attempt reconnect
					if (shouldReconnect) {
						setTimeout(connect, 1000);
					}
				} catch (e) {
					if (abortController.signal.aborted) return;
					errorHandler?.(e instanceof Error ? e : new Error(String(e)));
					if (shouldReconnect) {
						setTimeout(connect, 1000);
					}
				}
			};

			connect();

			const subscription: Subscription<T> = {
				on(event: string, handler: (arg?: unknown) => void) {
					if (event === "error") errorHandler = handler as (e: Event | Error) => void;
					if (event === "close") closeHandler = handler as () => void;
					return subscription;
				},
				unsubscribe() {
					shouldReconnect = false;
					abortController.abort();
				},
			};

			return subscription;
		},
	};
}
```

**Step 6: Create `packages/client/src/index.ts`**

```ts
export { createAblaufClient } from "./client";
export type { AblaufClientConfig, Subscription, InferSSEUpdates, SSECallback } from "./types";
```

**Step 7: Install dependencies**

Run: `cd /path/to/root && bun install`

**Step 8: Run type check**

Run: `bun run check-types`

**Step 9: Commit**

```bash
git add packages/client/
git commit -m "feat(sse): create @ablauf/client package with typed SSE subscribe"
```

---

### Task 12: Final Integration Verification

**Step 1: Run full test suite**

Run: `bun run test`

All tests must pass — both existing workflow tests and the new SSE tests.

**Step 2: Run type checks across entire monorepo**

Run: `bun run check-types`

**Step 3: Verify the demo worker starts**

Run: `cd apps/worker && bun run dev` — confirm no errors on startup, then Ctrl+C.

**Step 4: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "chore(sse): final integration fixes"
```

---

## Summary of Changes

| Package | Files Modified | Files Created |
|---------|---------------|---------------|
| `@ablauf/workflows` | `base-workflow.ts`, `types.ts`, `step.ts`, `workflow-runner.ts`, `schema.ts`, `index.ts` | `sse.ts`, `sse-stream.ts`, migration SQL |
| `@ablauf/client` | — | `package.json`, `tsconfig.json`, `index.ts`, `client.ts`, `types.ts`, `sse-parser.ts` |
| `@ablauf/worker` | `index.ts`, all 3 existing workflows | `sse-workflow.ts`, `sse.test.ts` |
