import { z } from "zod";
import { BaseWorkflow } from "@ablauf/workflows";
import type { Step, SSE } from "@ablauf/workflows";

const inputSchema = z.object({ itemCount: z.number() });
type SSEPayload = z.infer<typeof inputSchema>;

const sseUpdates = z.discriminatedUnion("type", [
	z.object({ type: z.literal("progress"), percent: z.number() }),
	z.object({ type: z.literal("done"), message: z.string() }),
]);
type SSEUpdates = z.infer<typeof sseUpdates>;

interface SSEResult {
	processed: number;
}

export class SSEWorkflow extends BaseWorkflow<SSEPayload, SSEResult, {}, SSEUpdates> {
	static type = "sse-test" as const;
	static inputSchema = inputSchema;
	static sseUpdates = sseUpdates;

	async run(step: Step, payload: SSEPayload, sse: SSE<SSEUpdates>): Promise<SSEResult> {
		sse.broadcast({ type: "progress", percent: 0 });

		const half = await step.do("first-half", async () => {
			return Math.floor(payload.itemCount / 2);
		});

		sse.broadcast({ type: "progress", percent: 50 });

		await step.do("second-half", async () => {
			return payload.itemCount - half;
		});

		sse.emit({ type: "done", message: `Processed ${payload.itemCount} items` });

		return { processed: payload.itemCount };
	}
}
