import { z } from 'zod';
import type { Step, SSE, WorkflowDefaults } from './types';

/**
 * Abstract base class for class-based workflow definitions.
 *
 * Provides sensible defaults for all static properties so subclasses only
 * need to override what they use. Subclasses must implement the `run()`
 * method containing the workflow logic.
 *
 * @typeParam Payload - Input payload type validated by {@link BaseWorkflow.inputSchema}.
 * @typeParam Result - Return type of {@link BaseWorkflow.run | run()}.
 * @typeParam Events - Map of event names to payload types the workflow can receive.
 * @typeParam SSEUpdates - Map of SSE update names to data types for real-time streaming.
 *
 * @example
 * ```ts
 * class OrderWorkflow extends BaseWorkflow<OrderPayload, OrderResult, OrderEvents> {
 *   static type = "process-order" as const;
 *   static inputSchema = z.object({ orderId: z.string() });
 *   static events = { "payment-received": z.object({ amount: z.number() }) };
 *
 *   async run(step, payload, sse) {
 *     const order = await step.do("fetch-order", () => db.getOrder(payload.orderId));
 *     const payment = await step.waitForEvent("payment-received", { timeout: "24h" });
 *     return { orderId: order.id, paid: payment.amount };
 *   }
 * }
 * ```
 */
export abstract class BaseWorkflow<Payload = unknown, Result = unknown, Events extends object = {}, SSEUpdates extends object = {}> {
	/** Unique string identifier for this workflow type (e.g., `"process-order"`). */
	static type: string;
	/** Zod schema for validating the input payload at runtime. Defaults to `z.unknown()`. */
	static inputSchema: z.ZodType<unknown> = z.unknown();
	/** Map of event names to Zod schemas for validating event payloads. Defaults to `{}`. */
	static events: Record<string, z.ZodType<unknown>> = {};
	/** Default configuration (e.g., retry settings) for all steps. Defaults to `{}`. */
	static defaults: Partial<WorkflowDefaults> = {};
	/** Optional map of SSE update names to Zod schemas for real-time streaming validation. */
	static sseUpdates?: Record<string, z.ZodType<unknown>>;

	/**
	 * Execute the workflow logic using durable step primitives.
	 *
	 * @param step - Step context providing `do()`, `sleep()`, and `waitForEvent()`.
	 * @param payload - The validated input payload.
	 * @param sse - SSE context for broadcasting real-time updates.
	 * @returns The workflow result, persisted upon completion.
	 */
	abstract run(step: Step<Events>, payload: Payload, sse: SSE<SSEUpdates>): Promise<Result>;
}
