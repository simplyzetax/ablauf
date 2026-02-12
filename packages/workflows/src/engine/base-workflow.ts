import { z } from "zod";
import type { Step, WorkflowDefaults } from "./types";

export abstract class BaseWorkflow<
	Payload = unknown,
	Result = unknown,
	Events extends object = {},
> {
	static type: string;
	static inputSchema: z.ZodType<unknown> = z.unknown();
	static events: Record<string, z.ZodType<unknown>> = {};
	static defaults: Partial<WorkflowDefaults> = {};

	abstract run(step: Step<Events>, payload: Payload): Promise<Result>;
}
