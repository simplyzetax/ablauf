/** A single parsed event from an SSE stream. */
export interface SSEStreamEvent {
	/** The event type (from `event:` lines, defaults to `"message"`). */
	event: string;
	/** The parsed JSON payload from the `data:` line. */
	data: unknown;
}

/**
 * Parse a raw SSE byte stream into typed {@link SSEStreamEvent} objects.
 *
 * Handles chunked reads, line splitting, `event:`/`data:` field parsing,
 * and abort signal support. Malformed JSON payloads are silently skipped.
 *
 * @param stream - The raw `ReadableStream<Uint8Array>` to consume.
 * @param options - Optional abort signal to cancel reading.
 * @yields Parsed SSE events as `{ event, data }` objects.
 *
 * @example
 * ```ts
 * for await (const update of parseSSEStream(stream, { signal })) {
 *   if (update.event === "progress") {
 *     console.log("Progress:", update.data);
 *   }
 * }
 * ```
 */
export async function* parseSSEStream(
	stream: ReadableStream<Uint8Array>,
	options?: { signal?: AbortSignal },
): AsyncGenerator<SSEStreamEvent, void, unknown> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let currentEvent = 'message';
	const signal = options?.signal;

	const isAborted = () => signal?.aborted ?? false;

	const abortHandler = () => {
		reader.cancel().catch(() => {});
	};

	signal?.addEventListener('abort', abortHandler);

	try {
		while (!isAborted()) {
			let done: boolean;
			let value: Uint8Array | undefined;
			try {
				({ done, value } = await reader.read());
			} catch (error) {
				if (isAborted()) {
					return;
				}
				const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
				if (message.includes('cancel')) {
					return;
				}
				throw error;
			}
			if (done) {
				return;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const rawLine of lines) {
				const line = rawLine.trim();
				if (!line) continue;

				if (line.startsWith('event: ')) {
					currentEvent = line.slice(7).trim();
					continue;
				}

				if (line.startsWith('data: ')) {
					try {
						yield { event: currentEvent, data: JSON.parse(line.slice(6)) };
					} catch {
						// Ignore malformed payload frames.
					}
				}
			}
		}
	} finally {
		signal?.removeEventListener('abort', abortHandler);
		await reader.cancel().catch(() => {});
	}
}
