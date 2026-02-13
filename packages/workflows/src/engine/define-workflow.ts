import type { z } from "zod";
import { BaseWorkflow } from "./base-workflow";
import type { Step, SSE, WorkflowDefaults, WorkflowEventSchemas, WorkflowClass } from "./types";

/**
 * Options for defining a workflow using the functional API.
 * Types are inferred from schemas — no manual generics needed.
 */
interface DefineWorkflowOptions<
	Type extends string,
	Input extends z.ZodType,
	Result,
	Events extends Record<string, z.ZodType>,
	SSEUpdates extends z.ZodType | undefined = undefined,
> {
	type: Type;
	input: Input;
	events?: Events;
	defaults?: Partial<WorkflowDefaults>;
	sseUpdates?: SSEUpdates;
	run: (
		step: Step<{ [K in keyof Events]: z.infer<Events[K]> }>,
		payload: z.infer<Input>,
		sse: SSE<SSEUpdates extends z.ZodType ? z.infer<SSEUpdates> : never>,
	) => Promise<Result>;
}

/**
 * Define a workflow using a simple object instead of a class.
 * All types are inferred from the schemas you provide.
 *
 * @example
 * ```ts
 * const MyWorkflow = defineWorkflow({
 *   type: "my-workflow",
 *   input: z.object({ name: z.string() }),
 *   events: { approval: z.object({ approved: z.boolean() }) },
 *   run: async (step, payload, sse) => {
 *     const greeting = await step.do("greet", () => `Hello, ${payload.name}!`);
 *     const approval = await step.waitForEvent("approval");
 *     return { greeting, approved: approval.approved };
 *   },
 * });
 * ```
 */
export function defineWorkflow<
	Type extends string,
	Input extends z.ZodType,
	Result,
	Events extends Record<string, z.ZodType> = {},
	SSEUpdates extends z.ZodType | undefined = undefined,
>(
	options: DefineWorkflowOptions<Type, Input, Result, Events, SSEUpdates>,
): WorkflowClass<
	z.infer<Input>,
	Result,
	{ [K in keyof Events]: z.infer<Events[K]> },
	Type,
	SSEUpdates extends z.ZodType ? z.infer<SSEUpdates> : never
> {
	type InferredPayload = z.infer<Input>;
	type InferredEvents = { [K in keyof Events]: z.infer<Events[K]> };
	type InferredSSE = SSEUpdates extends z.ZodType ? z.infer<SSEUpdates> : never;

	const workflow = class extends BaseWorkflow<InferredPayload, Result, InferredEvents, InferredSSE> {
		static type = options.type;
		static inputSchema = options.input;
		static events = (options.events ?? {}) as WorkflowEventSchemas<InferredEvents>;
		static defaults = options.defaults ?? {};
		static sseUpdates = options.sseUpdates as z.ZodType<unknown> | undefined;

		async run(step: Step<InferredEvents>, payload: InferredPayload, sse: SSE<InferredSSE>): Promise<Result> {
			return options.run(step, payload, sse);
		}
	};

	// Set a readable name for debugging
	Object.defineProperty(workflow, "name", { value: `Workflow(${options.type})` });

	return workflow as unknown as WorkflowClass<
		z.infer<Input>,
		Result,
		InferredEvents,
		Type,
		InferredSSE
	>;
}
