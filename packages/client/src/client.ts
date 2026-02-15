import { createORPCClient } from '@orpc/client';
import { StandardLink, StandardRPCLinkCodec } from '@orpc/client/standard';
import { LinkFetchClient } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import type { dashboardRouter, WorkflowClass } from '@der-ablauf/workflows';
import type { AblaufClientConfig } from './types';
import SuperJSON from 'superjson';

export type DashboardClient = RouterClient<typeof dashboardRouter>;

export type InferSSEUpdates<W> =
	W extends WorkflowClass<infer _Payload, infer _Result, infer _Events, infer _Type, infer SSEUpdates>
		? {
				[K in Extract<keyof SSEUpdates, string>]: { event: K; data: SSEUpdates[K] };
			}[Extract<keyof SSEUpdates, string>]
		: never;

export interface AblaufClient extends DashboardClient {
	subscribe<W extends WorkflowClass>(id: string, options?: { signal?: AbortSignal }): AsyncGenerator<InferSSEUpdates<W>, void, unknown>;
}

/** Create a raw oRPC client for the dashboard API. */
export function createDashboardClient(config: AblaufClientConfig): DashboardClient {
	const serializer = {
		serialize: (data: unknown) => SuperJSON.serialize(data),
		deserialize: (data: any) => SuperJSON.deserialize(data),
	};
	const linkOptions = {
		url: config.url,
		headers: config.headers ? () => config.headers! : undefined,
		fetch: config.withCredentials ? (input: any, init: any) => fetch(input, { ...init, credentials: 'include' }) : undefined,
	};
	const link = new StandardLink(new StandardRPCLinkCodec(serializer as any, linkOptions), new LinkFetchClient(linkOptions));
	return createORPCClient(link) as DashboardClient;
}

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
					signal?.addEventListener(
						'abort',
						() => {
							ws.close();
							reject(new DOMException('Aborted', 'AbortError'));
						},
						{ once: true },
					);
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
						await new Promise<void>((r) => {
							resolve = r;
						});
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
