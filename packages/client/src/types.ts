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
