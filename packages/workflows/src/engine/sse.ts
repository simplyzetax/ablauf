import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import type { z } from 'zod';
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
				ws.send(JSON.stringify({ event: msg.event, data: msg.data }));
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
