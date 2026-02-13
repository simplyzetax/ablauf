import { z } from "zod";
import { defineWorkflow } from "@ablauf/workflows";

export const EchoWorkflow = defineWorkflow({
	type: "echo",
	input: z.object({ message: z.string() }),
	run: async (step, payload) => {
		return await step.do("echo", async () => ({
			original: payload.message,
			echoed: payload.message,
			timestamp: Date.now(),
		}));
	},
});
