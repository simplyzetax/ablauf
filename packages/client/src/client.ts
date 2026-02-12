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
			const abortController = new AbortController();
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
				on(event: "error" | "close", handler: (...args: never[]) => void) {
					if (event === "error") errorHandler = handler as unknown as (e: Event | Error) => void;
					if (event === "close") closeHandler = handler as unknown as () => void;
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
