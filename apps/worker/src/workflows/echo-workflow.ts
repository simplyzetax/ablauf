import { z } from "zod";
import { BaseWorkflow } from "@ablauf/workflows";
import type { Step } from "@ablauf/workflows";

const inputSchema = z.object({ message: z.string() });
type EchoPayload = z.infer<typeof inputSchema>;

interface EchoResult {
	original: string;
	echoed: string;
	timestamp: number;
}

export class EchoWorkflow extends BaseWorkflow<EchoPayload, EchoResult> {
	static type = "echo" as const;
	static inputSchema = inputSchema;

	async run(step: Step, payload: EchoPayload): Promise<EchoResult> {
		return await step.do("echo", async () => ({
			original: payload.message,
			echoed: payload.message,
			timestamp: Date.now(),
		}));
	}
}
