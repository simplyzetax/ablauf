import type { WorkflowRunnerStub } from "./engine/types";

export function createSSEStream(
	binding: DurableObjectNamespace,
	workflowId: string,
): Response {
	const stub = binding.get(
		binding.idFromName(workflowId),
	) as unknown as WorkflowRunnerStub;

	const upstream = stub.connectSSE();

	const { readable, writable } = new TransformStream();

	upstream.then(async (stream) => {
		try {
			await stream.pipeTo(writable);
		} catch {
			try { writable.close(); } catch { /* already closed */ }
		}
	}).catch((e) => {
		const writer = writable.getWriter();
		const msg = `event: error\ndata: ${JSON.stringify({ message: e instanceof Error ? e.message : String(e) })}\n\n`;
		try {
			writer.write(new TextEncoder().encode(msg));
			writer.close();
		} catch { /* already closed */ }
	});

	return new Response(readable, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
		},
	});
}
