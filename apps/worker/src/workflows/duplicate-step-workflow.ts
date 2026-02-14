import { z } from "zod";
import { defineWorkflow } from "@ablauf/workflows";

const inputSchema = z.object({});

export const DuplicateStepWorkflow = defineWorkflow({
	type: "duplicate-step",
	input: inputSchema,
	run: async (step) => {
		const a = await step.do("fetch-data", () => "first");
		const b = await step.do("fetch-data", () => "second");
		return { a, b };
	},
});
