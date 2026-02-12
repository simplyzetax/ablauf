export interface SSEParserCallbacks {
	onMessage(data: string, event?: string): void;
	onError(error: Error): void;
}

function isCancellation(e: unknown): boolean {
	if (!(e instanceof Error)) return false;
	return e.name === "AbortError" || e.message === "Stream was cancelled.";
}

export async function parseSSEStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	callbacks: SSEParserCallbacks,
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = "";
	let currentData = "";
	let currentEvent = "";

	try {
		while (true) {
			const { done, value } = await reader.read().catch((e) => {
				if (isCancellation(e)) return { done: true as const, value: undefined };
				throw e;
			});
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				if (line.startsWith("data: ")) {
					currentData = line.slice(6);
				} else if (line.startsWith("event: ")) {
					currentEvent = line.slice(7);
				} else if (line === "") {
					if (currentData) {
						callbacks.onMessage(currentData, currentEvent || undefined);
					}
					currentData = "";
					currentEvent = "";
				}
			}
		}
	} catch (e) {
		if (isCancellation(e)) return;
		callbacks.onError(e instanceof Error ? e : new Error(String(e)));
	}
}
