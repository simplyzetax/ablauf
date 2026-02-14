import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type { z } from "zod";
import { sseMessagesTable } from "../db/schema";
import type { SSE } from "./types";

type UpdateKey<Updates extends object> = Extract<keyof Updates, string>;

export class SSEContext<Updates extends object = {}> implements SSE<Updates> {
	private writers = new Set<WritableStreamDefaultWriter>();
	private closed = false;
	private encoder = new TextEncoder();

	constructor(
		private db: DrizzleSqliteDODatabase,
		private schemas: Record<string, z.ZodType<unknown>> | null,
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

	broadcast<K extends UpdateKey<Updates>>(name: K, data: Updates[K]): void {
		if (this.closed || this.isReplay) return;
		const parsed = this.validate(name, data);
		this.writeToClients(name, parsed);
	}

	emit<K extends UpdateKey<Updates>>(name: K, data: Updates[K]): void {
		if (this.closed) return;
		const parsed = this.validate(name, data);
		if (!this.isReplay) {
			this.writeToClients(name, parsed);
			this.db.insert(sseMessagesTable).values({
				event: name,
				data: JSON.stringify(parsed),
				createdAt: Date.now(),
			}).run();
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		const closeMsg = this.encoder.encode("event: close\ndata: {}\n\n");
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
		for (const msg of messages) {
			try {
				writer.write(this.encoder.encode(`event: ${msg.event}\ndata: ${msg.data}\n\n`));
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

	private writeToClients<K extends UpdateKey<Updates>>(name: K, data: Updates[K]): void {
		const message = this.encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
		for (const writer of this.writers) {
			try {
				writer.write(message);
			} catch {
				this.writers.delete(writer);
			}
		}
	}
}

/** No-op SSE context for workflows that don't define sseUpdates */
export class NoOpSSEContext implements SSE<never> {
	broadcast<K extends never>(_name: K, _data: never): void {}
	emit<K extends never>(_name: K, _data: never): void {}
	close(): void {}
}
