export interface SSEStreamEvent {
	event: string;
	data: unknown;
}

export async function* parseSSEStream(
	stream: ReadableStream<Uint8Array>,
	options?: { signal?: AbortSignal },
): AsyncGenerator<SSEStreamEvent, void, unknown> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let currentEvent = "message";

	const isAborted = () => options?.signal?.aborted ?? false;

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
				throw error;
			}
			if (done) {
				return;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const rawLine of lines) {
				const line = rawLine.trim();
				if (!line) continue;

				if (line.startsWith("event: ")) {
					currentEvent = line.slice(7).trim();
					continue;
				}

				if (line.startsWith("data: ")) {
					try {
						yield { event: currentEvent, data: JSON.parse(line.slice(6)) };
					} catch {
						// Ignore malformed payload frames.
					}
				}
			}
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
}
