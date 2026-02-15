import type { z } from 'zod';
import { BaseWorkflow } from './base-workflow';
import type { Step, SSE, WorkflowDefaults, WorkflowEventSchemas, WorkflowClass, ResultSizeLimitConfig } from './types';
import { t as transportSchema, validateSchema } from '../serializable';
import type { TransportSchema } from '../serializable';

// -- Helper types to extract schema information from the inferred Opts type --

/** Extract the inferred payload type from an options object's `input` schema. */
type InferPayload<Opts> = Opts extends { input: z.ZodType<infer T> } ? T : unknown;

/** Extract the events schema record type from an options object. */
type InferEventSchemas<Opts> = Opts extends { events: infer E extends Record<string, z.ZodType> } ? E : {};

/** Extract the inferred events map (name -> payload) from an options object. */
type InferEvents<Opts> = { [K in keyof InferEventSchemas<Opts>]: z.infer<InferEventSchemas<Opts>[K]> };

/** Extract the SSE schema record type from an options object. */
type InferSSESchemas<Opts> = Opts extends { sseUpdates: infer S extends Record<string, z.ZodType> } ? S : undefined;

/** Extract the inferred SSE map (name -> data) from an options object. */
type InferSSE<Opts> =
	InferSSESchemas<Opts> extends Record<string, z.ZodType>
		? { [K in keyof InferSSESchemas<Opts>]: z.infer<InferSSESchemas<Opts>[K]> }
		: never;

/** Extract the type string literal from an options object. */
type InferType<Opts> = Opts extends { type: infer T extends string } ? T : string;

/** Extract the result type from the `run` function's return type. */
type InferResult<Opts> = Opts extends { run: (...args: any[]) => Promise<infer R> } ? R : unknown;

// -- Base shape (loose constraint for the `const Opts extends` pattern) --------

/**
 * Loose base shape for workflow options. Used as a constraint for the
 * `const Opts extends` inference pattern so TypeScript can infer the full
 * concrete type of the options object returned by the factory callback.
 *
 * @internal
 */
interface BaseWorkflowOptions {
	type: string;
	input: z.ZodType;
	events?: Record<string, z.ZodType>;
	defaults?: Partial<WorkflowDefaults>;
	resultSizeLimit?: Partial<ResultSizeLimitConfig>;
	sseUpdates?: Record<string, z.ZodType>;
	run: (...args: any[]) => Promise<any>;
}

// -- Typed run callback -------------------------------------------------------

/**
 * The properly-typed `run` function signature, derived from the inferred `Opts`.
 * Used via intersection (`Opts & { run: TypedRun<Opts> }`) to provide contextual
 * typing for the `run` callback's parameters without interfering with generic inference.
 *
 * @internal
 */
type TypedRun<Opts extends BaseWorkflowOptions> = (
	step: Step<InferEvents<Opts>>,
	payload: InferPayload<Opts>,
	sse: SSE<InferSSE<Opts>>,
) => Promise<any>;

/**
 * Define a workflow using a callback that receives a constrained Zod namespace (`t`)
 * which only exposes SuperJSON-compatible types. All types are inferred from the
 * schemas you provide.
 *
 * Uses the `const Opts extends BaseWorkflowOptions` pattern to infer the full
 * concrete type of the returned options object as a single generic parameter.
 * The `& { run: TypedRun<Opts> }` intersection then provides proper contextual
 * typing for the `run` callback's `step`, `payload`, and `sse` parameters.
 *
 * @param factory - A callback that receives a {@link TransportSchema} (`t`) and returns
 *   the workflow options. Using `t` instead of raw `z` ensures all schemas are
 *   serialization-safe at the type level. A runtime check via {@link validateSchema}
 *   is also performed as a safety net.
 *
 * @example
 * ```ts
 * const MyWorkflow = defineWorkflow((t) => ({
 *   type: "my-workflow",
 *   input: t.object({ name: t.string() }),
 *   events: { approval: t.object({ approved: t.boolean() }) },
 *   run: async (step, payload, sse) => {
 *     const greeting = await step.do("greet", () => `Hello, ${payload.name}!`);
 *     const approval = await step.waitForEvent("approval");
 *     return { greeting, approved: approval.approved };
 *   },
 * }));
 * ```
 */
export function defineWorkflow<const Opts extends BaseWorkflowOptions>(
	factory: (t: TransportSchema) => Opts & { run: TypedRun<Opts> },
): WorkflowClass<InferPayload<Opts>, InferResult<Opts>, InferEvents<Opts>, InferType<Opts>, InferSSE<Opts>> {
	const options = factory(transportSchema);

	// Runtime safety net: validate all schemas use SuperJSON-compatible types
	validateSchema(options.input, 'input');
	if (options.events) {
		for (const [key, schema] of Object.entries(options.events as Record<string, z.ZodType>)) {
			validateSchema(schema, `events.${key}`);
		}
	}
	if (options.sseUpdates) {
		for (const [key, schema] of Object.entries(options.sseUpdates as Record<string, z.ZodType>)) {
			validateSchema(schema, `sseUpdates.${key}`);
		}
	}

	type Payload = InferPayload<Opts>;
	type Events = InferEvents<Opts>;
	type SSEData = InferSSE<Opts>;
	type Result = InferResult<Opts>;

	const workflow = class extends BaseWorkflow<Payload, Result, Events, SSEData> {
		static type = options.type;
		static inputSchema = options.input;
		static events = (options.events ?? {}) as WorkflowEventSchemas<Events>;
		static defaults = options.defaults ?? {};
		static resultSizeLimit = options.resultSizeLimit;
		static sseUpdates = options.sseUpdates as Record<string, z.ZodType<unknown>> | undefined;

		async run(step: Step<Events>, payload: Payload, sse: SSE<SSEData>): Promise<Result> {
			return options.run(step, payload, sse);
		}
	};

	// Set a readable name for debugging
	Object.defineProperty(workflow, 'name', { value: `Workflow(${options.type})` });

	return workflow as unknown as WorkflowClass<Payload, Result, Events, InferType<Opts>, SSEData>;
}
