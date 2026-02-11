import { BaseWorkflow } from "../engine/base-workflow";
import type { Step } from "../engine/types";

interface TestPayload {
	name: string;
}

interface TestResult {
	message: string;
	greeting: string;
}

type TestEvents = {
	approval: { approved: boolean };
};

export class TestWorkflow extends BaseWorkflow<TestPayload, TestResult, TestEvents> {
	static type = "test" as const;
	static events = {
		approval: {} as { approved: boolean },
	};
	static defaults = {
		retries: { limit: 2, delay: "500ms", backoff: "exponential" as const },
	};

	async run(step: Step<TestEvents>, payload: TestPayload): Promise<TestResult> {
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
