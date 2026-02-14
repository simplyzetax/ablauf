import type { z } from "zod";
import { BaseWorkflow } from "./base-workflow";
import type { Step, SSE, WorkflowDefaults, WorkflowEventSchemas, WorkflowClass } from "./types";

/**
 * Options for defining a workflow using the functional API.
 * All types are inferred from the Zod schemas you provide — no manual generics needed.
 *
 * @typeParam Type - String literal workflow type identifier.
 * @typeParam Input - Zod schema type for the input payload.
 * @typeParam Result - Return type of the `run` function.
 * @typeParam Events - Map of event names to Zod schemas.
 * @typeParam SSEUpdates - Optional map of SSE update names to Zod schemas.
 */
interface DefineWorkflowOptions<
	Type extends string,
	Input extends z.ZodType,
	Result,
	Events extends Record<string, z.ZodType>,
	SSEUpdates extends Record<string, z.ZodType> | undefined = undefined,
> {
	/** Unique string identifier for this workflow type (e.g., `"process-order"`). */
	type: Type;
	/** Zod schema for validating the input payload at runtime. */
	input: Input;
	/** Optional map of event names to Zod schemas for validating event payloads. */
	events?: Events;
	/** Optional default configuration (e.g., retry settings) for all steps. */
	defaults?: Partial<WorkflowDefaults>;
	/** Optional map of SSE update names to Zod schemas for real-time streaming validation. */
	sseUpdates?: SSEUpdates;
	/**
	 * The workflow logic function. Receives durable step primitives, the validated
	 * payload, and an SSE context for broadcasting updates.
	 */
	run: (
		step: Step<{ [K in keyof Events]: z.infer<Events[K]> }>,
		payload: z.infer<Input>,
		sse: SSE<
			SSEUpdates extends Record<string, z.ZodType>
				? { [K in keyof SSEUpdates]: z.infer<SSEUpdates[K]> }
				: never
		>,
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
	SSEUpdates extends Record<string, z.ZodType> | undefined = undefined,
>(
	options: DefineWorkflowOptions<Type, Input, Result, Events, SSEUpdates>,
): WorkflowClass<
	z.infer<Input>,
	Result,
	{ [K in keyof Events]: z.infer<Events[K]> },
	Type,
	SSEUpdates extends Record<string, z.ZodType>
		? { [K in keyof SSEUpdates]: z.infer<SSEUpdates[K]> }
		: never
> {
	type InferredPayload = z.infer<Input>;
	type InferredEvents = { [K in keyof Events]: z.infer<Events[K]> };
	type InferredSSE = SSEUpdates extends Record<string, z.ZodType>
		? { [K in keyof SSEUpdates]: z.infer<SSEUpdates[K]> }
		: never;

	const workflow = class extends BaseWorkflow<InferredPayload, Result, InferredEvents, InferredSSE> {
		static type = options.type;
		static inputSchema = options.input;
		static events = (options.events ?? {}) as WorkflowEventSchemas<InferredEvents>;
		static defaults = options.defaults ?? {};
		static sseUpdates = options.sseUpdates as Record<string, z.ZodType<unknown>> | undefined;

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
