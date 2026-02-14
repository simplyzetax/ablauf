import { z } from "zod";
import { defineWorkflow } from "@der-ablauf/workflows";

const inputSchema = z.object({ name: z.string() });

const eventSchemas = {
	approval: z.object({ approved: z.boolean() }),
};

export const TestWorkflow = defineWorkflow({
	type: "test",
	input: inputSchema,
	events: eventSchemas,
	defaults: {
		retries: { limit: 2, delay: "500ms", backoff: "exponential" as const },
	},
	run: async (step, payload) => {
		const greeting = await step.do("greet", async () => {
			return `Hello, ${payload.name}!`;
		});

		await step.sleep("pause", "5s");

		const approval = await step.waitForEvent("approval", {
			timeout: "1m",
		});

		const message = approval.approved
			? `${payload.name} was approved`
			: `${payload.name} was rejected`;

		return { message, greeting };
	},
});
