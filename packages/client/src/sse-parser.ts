export interface SSEParserCallbacks {
	onMessage(data: string, event?: string): void;
	onError(error: Error): void;
}

export async function parseSSEStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	callbacks: SSEParserCallbacks,
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			let currentData = "";
			let currentEvent = "";

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
		callbacks.onError(e instanceof Error ? e : new Error(String(e)));
	}
}
