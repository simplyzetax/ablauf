import { z } from "zod";
import { BaseWorkflow } from "@ablauf/workflows";
import type { Step, SSE } from "@ablauf/workflows";

const inputSchema = z.object({});

export class DuplicateStepWorkflow extends BaseWorkflow<
	Record<string, never>,
	{ a: string; b: string }
> {
	static type = "duplicate-step" as const;
	static inputSchema = inputSchema;

	async run(step: Step, _payload: Record<string, never>, _sse: SSE<never>) {
		const a = await step.do("fetch-data", () => "first");
		const b = await step.do("fetch-data", () => "second");
		return { a, b };
	}
}
