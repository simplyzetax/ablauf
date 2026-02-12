import { z } from "zod";
import type { Step, SSE, WorkflowDefaults } from "./types";

export abstract class BaseWorkflow<
	Payload = unknown,
	Result = unknown,
	Events extends object = {},
	SSEUpdates = never,
> {
	static type: string;
	static inputSchema: z.ZodType<unknown> = z.unknown();
	static events: Record<string, z.ZodType<unknown>> = {};
	static defaults: Partial<WorkflowDefaults> = {};
	static sseUpdates?: z.ZodType<unknown>;

	abstract run(step: Step<Events>, payload: Payload, sse: SSE<SSEUpdates>): Promise<Result>;
}
