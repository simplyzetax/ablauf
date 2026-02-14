import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import type { dashboardRouter, WorkflowClass } from '@der-ablauf/workflows';
import type { AblaufClientConfig } from './types';

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
	const link = new RPCLink({
		url: config.url,
		headers: config.headers ? () => config.headers! : undefined,
		fetch: config.withCredentials ? (input, init) => fetch(input, { ...init, credentials: 'include' }) : undefined,
	});
	return createORPCClient(link) as DashboardClient;
}

/** Create an extended client with a typed `subscribe()` helper for SSE. */
export function createAblaufClient(config: AblaufClientConfig): AblaufClient {
	const rawClient = createDashboardClient(config);

	const client = Object.assign(rawClient, {
		async *subscribe<W extends WorkflowClass>(
			id: string,
			options?: { signal?: AbortSignal },
		): AsyncGenerator<InferSSEUpdates<W>, void, unknown> {
			const iterator = await rawClient.workflows.subscribe({ id }, options ? { signal: options.signal } : undefined);
			for await (const update of iterator as AsyncIterable<{ event: string; data: unknown }>) {
				yield update as InferSSEUpdates<W>;
			}
		},
	});

	return client as AblaufClient;
}
