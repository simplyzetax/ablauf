import { z } from "zod";
import { BaseWorkflow } from "@ablauf/workflows";
import type { Step } from "@ablauf/workflows";

const inputSchema = z.object({ failCount: z.number() });
type FailingPayload = z.infer<typeof inputSchema>;

// Module-level counter persists across replay() calls within the same DO isolate.
const callCounts = new Map<string, number>();

/**
 * Test-only workflow: step.do throws `failCount` times, then succeeds.
 * Used to verify alarm-based retry with exponential backoff.
 */
export class FailingStepWorkflow extends BaseWorkflow<FailingPayload, string> {
	static type = "failing-step" as const;
	static inputSchema = inputSchema;
	static defaults = {
		retries: { limit: 3, delay: "500ms", backoff: "exponential" as const },
	};

	async run(step: Step, payload: FailingPayload): Promise<string> {
		const key = `unreliable:${payload.failCount}`;
		const result = await step.do("unreliable", async () => {
			const count = (callCounts.get(key) ?? 0) + 1;
			callCounts.set(key, count);
			if (count <= payload.failCount) {
				throw new Error(`Intentional failure #${count}`);
			}
			return "recovered";
		});

		return result;
	}
}
