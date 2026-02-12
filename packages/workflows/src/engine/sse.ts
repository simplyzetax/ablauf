import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type { z } from "zod";
import { sseMessagesTable } from "../db/schema";
import type { SSE } from "./types";

export class SSEContext<T = never> implements SSE<T> {
	private writers = new Set<WritableStreamDefaultWriter>();
	private closed = false;
	private encoder = new TextEncoder();

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
			this.db.insert(sseMessagesTable).values({
				data: JSON.stringify(data),
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
				writer.write(this.encoder.encode(`data: ${msg.data}\n\n`));
			} catch {
				break;
			}
		}
	}

	private writeToClients(data: T): void {
		const message = this.encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
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
	broadcast(_data: never): void {}
	emit(_data: never): void {}
	close(): void {}
}
