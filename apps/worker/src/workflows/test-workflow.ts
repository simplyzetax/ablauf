import { z } from "zod";
import { BaseWorkflow } from "@ablauf/workflows";
import type { Step, SSE } from "@ablauf/workflows";

const inputSchema = z.object({ name: z.string() });
type TestPayload = z.infer<typeof inputSchema>;

interface TestResult {
	message: string;
	greeting: string;
}

const eventSchemas = {
	approval: z.object({ approved: z.boolean() }),
};
type TestEvents = { [K in keyof typeof eventSchemas]: z.infer<(typeof eventSchemas)[K]> };

export class TestWorkflow extends BaseWorkflow<TestPayload, TestResult, TestEvents> {
	static type = "test" as const;
	static inputSchema = inputSchema;
	static events = eventSchemas;
	static defaults = {
		retries: { limit: 2, delay: "500ms", backoff: "exponential" as const },
	};

	async run(step: Step<TestEvents>, payload: TestPayload, _sse: SSE<never>): Promise<TestResult> {
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
	}
}
