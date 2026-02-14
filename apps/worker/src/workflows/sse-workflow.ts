import { z } from "zod";
import { defineWorkflow } from "@ablauf/workflows";

const inputSchema = z.object({ itemCount: z.number() });

const sseUpdates = {
	progress: z.object({ percent: z.number() }),
	done: z.object({ message: z.string() }),
};

export const SSEWorkflow = defineWorkflow({
	type: "sse-test",
	input: inputSchema,
	sseUpdates,
	run: async (step, payload, sse) => {
		sse.broadcast("progress", { percent: 0 });

		const half = await step.do("first-half", async () => {
			return Math.floor(payload.itemCount / 2);
		});

		sse.broadcast("progress", { percent: 50 });

		await step.do("second-half", async () => {
			return payload.itemCount - half;
		});

		sse.emit("done", { message: `Processed ${payload.itemCount} items` });

		return { processed: payload.itemCount };
	},
});
