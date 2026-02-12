import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Ablauf } from "@ablauf/workflows";
import { createAblaufClient } from "@ablauf/client";
import { SSEWorkflow } from "../workflows/sse-workflow";
import { InferSSEUpdates } from "@ablauf/client";

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

// Route global fetch through the worker's own fetch handler so
// createAblaufClient hits the real Hono routes + Durable Objects.
const originalFetch = globalThis.fetch;
beforeAll(() => {
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
		SELF.fetch(input, init)) as typeof fetch;

	// Suppress AbortError rejections from the workerd runtime.
	// When unsubscribe() aborts the fetch, workerd generates unhandled
	// rejection events for the cancelled response body. These are benign —
	// the client code handles the abort properly via its own try/catch.
	addEventListener("unhandledrejection", (event) => {
		if (
			event.reason instanceof DOMException &&
			event.reason.name === "AbortError"
		) {
			event.preventDefault();
		}
	});
});
afterAll(() => {
	globalThis.fetch = originalFetch;
});

describe("ablaufClient e2e", () => {
	it("receives persisted SSE messages from a completed workflow", async () => {
		// 1. Run the real workflow through the Durable Object
		await ablauf.create(SSEWorkflow, {
			id: "client-e2e-1",
			payload: { itemCount: 8 },
		});

		// 2. Subscribe via the client — fetch → Hono route → createSSEStream → DO
		const client = createAblaufClient({ url: "http://localhost/workflows" });
		const received: InferSSEUpdates<typeof SSEWorkflow>[] = [];

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("Timed out waiting for SSE messages")),
				5000,
			);

			const sub = client.subscribe<typeof SSEWorkflow>(
				"client-e2e-1",
				(data) => {
					received.push(data);
					// The workflow emits one persisted message; unsubscribe after receiving it
					// (completed workflows don't send a close event to late-connecting clients)
					if (data.type === "done") {
						clearTimeout(timeout);
						sub.unsubscribe();
						resolve();
					}
				},
			);

			sub.on("error", (err) => {
				clearTimeout(timeout);
				sub.unsubscribe();
				reject(err);
			});
		});

		// 3. Verify the persisted emit message was received with correct typing
		expect(received).toEqual([
			{ type: "done", message: "Processed 8 items" },
		]);
	});

	it("broadcasts are not received by late-connecting clients", async () => {
		await ablauf.create(SSEWorkflow, {
			id: "client-e2e-broadcast",
			payload: { itemCount: 4 },
		});

		const client = createAblaufClient({ url: "http://localhost/workflows" });
		const received: InferSSEUpdates<typeof SSEWorkflow>[] = [];

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("Timed out")),
				5000,
			);

			const sub = client.subscribe<typeof SSEWorkflow>(
				"client-e2e-broadcast",
				(data) => {
					received.push(data);
					if (data.type === "done") {
						clearTimeout(timeout);
						sub.unsubscribe();
						resolve();
					}
				},
			);

			sub.on("error", (err) => {
				clearTimeout(timeout);
				sub.unsubscribe();
				reject(err);
			});
		});

		// Only the emit (persisted) message should be received, not broadcast (progress) ones
		expect(received).toEqual([
			{ type: "done", message: "Processed 4 items" },
		]);
		expect(received.find((m) => m.type === "progress")).toBeUndefined();
	});

	it("error handler fires for a non-matching route", async () => {
		// Use a base URL that doesn't match any Hono route → 404
		const client = createAblaufClient({ url: "http://localhost/no-such-path" });

		const error = await new Promise<Error>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("Timed out")),
				5000,
			);

			const sub = client.subscribe<typeof SSEWorkflow>("anything", () => { });
			sub.on("error", (err) => {
				clearTimeout(timeout);
				sub.unsubscribe();
				resolve(err instanceof Error ? err : new Error(String(err)));
			});
		});

		expect(error.message).toContain("SSE connection failed");
		expect(error.message).toContain("404");
	});

	it("unsubscribe aborts without reconnecting", async () => {
		await ablauf.create(SSEWorkflow, {
			id: "client-e2e-unsub",
			payload: { itemCount: 2 },
		});

		const client = createAblaufClient({ url: "http://localhost/workflows" });
		const received: InferSSEUpdates<typeof SSEWorkflow>[] = [];

		await new Promise<void>((resolve) => {
			const sub = client.subscribe<typeof SSEWorkflow>(
				"client-e2e-unsub",
				(data) => {
					received.push(data);
					// Unsubscribe immediately after receiving the first message
					sub.unsubscribe();
					resolve();
				},
			);
		});

		const countAfterUnsub = received.length;

		// Wait and verify no reconnect produces further messages
		await new Promise((resolve) => setTimeout(resolve, 1500));
		expect(received.length).toBe(countAfterUnsub);
		expect(received.length).toBeGreaterThan(0);
	});
});
