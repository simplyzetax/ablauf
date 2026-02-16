import { z } from 'zod';

/**
 * Possible states of a workflow instance during its lifecycle.
 *
 * - `"created"` — Exists but has not started execution yet.
 * - `"running"` — Actively executing workflow steps.
 * - `"completed"` — All steps finished; result is available.
 * - `"errored"` — Failed with an unrecoverable error.
 * - `"paused"` — Manually paused; will not progress until resumed.
 * - `"sleeping"` — Waiting for a `step.sleep()` duration to elapse.
 * - `"waiting"` — Blocked on an external event via `step.waitForEvent()`.
 * - `"terminated"` — Manually terminated; cannot be resumed.
 */
export const workflowStatusSchema = z.enum(['created', 'running', 'completed', 'errored', 'paused', 'sleeping', 'waiting', 'terminated']);
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

export const stepStatusSchema = z.enum(['running', 'completed', 'failed', 'sleeping', 'waiting']);
export type StepStatus = z.infer<typeof stepStatusSchema>;

export const stepTypeSchema = z.enum(['do', 'sleep', 'sleep_until', 'wait_for_event']);
export type StepType = z.infer<typeof stepTypeSchema>;

/**
 * Strategy for calculating the delay between retry attempts.
 *
 * - `"fixed"` — Same delay every attempt.
 * - `"linear"` — Delay increases linearly (`delay * attempt`).
 * - `"exponential"` — Delay doubles each attempt (`delay * 2^attempt`).
 */
export type BackoffStrategy = 'fixed' | 'linear' | 'exponential';

/** Configuration for step retry behavior. */
export interface RetryConfig {
	/** Maximum number of retry attempts before the step fails permanently. */
	limit: number;
	/** Delay between retries as a duration string (e.g., `"1s"`, `"5m"`). */
	delay: string;
	/** Strategy for scaling the delay across successive retries. */
	backoff: BackoffStrategy;
}

/** Per-step options for `step.do()`. */
export interface StepDoOptions {
	/** Partial retry configuration that overrides the workflow-level defaults. */
	retries?: Partial<RetryConfig>;
}

/** Options for `step.waitForEvent()`. */
export interface StepWaitOptions {
	/** Maximum time to wait as a duration string (e.g., `"5m"`, `"1h"`, `"7d"`). */
	timeout: string;
}

/** Behavior when a step result exceeds the cumulative size limit. */
export type ResultSizeOverflow = 'fail' | 'retry';

/**
 * Configuration for the cumulative result size limit.
 *
 * Ablauf tracks the total serialized size of all completed step results.
 * When a new step result would push the total over `maxSize`, the step
 * fails according to the `onOverflow` strategy.
 *
 * @see {@link DEFAULT_RESULT_SIZE_LIMIT}
 */
export interface ResultSizeLimitConfig {
	/**
	 * Maximum cumulative byte budget for all step results in the workflow.
	 * Accepts human-readable size strings: `"512kb"`, `"64mb"`, `"1gb"`.
	 * @defaultValue `"64mb"`
	 */
	maxSize: string;
	/**
	 * Strategy when a step result exceeds the budget.
	 * - `"fail"` — throws `NonRetriableError` (default). Step is not retried.
	 * - `"retry"` — throws `StepFailedError`. Normal retry logic applies.
	 * @defaultValue `"fail"`
	 */
	onOverflow: ResultSizeOverflow;
}

/**
 * Default result size limit: 64 MB budget, non-retryable on overflow.
 *
 * The 64 MB default leaves ~64 MB headroom for the engine runtime, workflow
 * code, and deserialized objects within the 128 MB Cloudflare isolate limit.
 */
export const DEFAULT_RESULT_SIZE_LIMIT: ResultSizeLimitConfig = {
	maxSize: '64mb',
	onOverflow: 'fail',
};

/** Default configuration values applied to all steps in a workflow unless overridden. */
export interface WorkflowDefaults {
	/** Default retry configuration for all `step.do()` calls. */
	retries: RetryConfig;
	/** Cumulative result size limit configuration. Individual fields are optional and fall back to {@link DEFAULT_RESULT_SIZE_LIMIT}. */
	resultSizeLimit: Partial<ResultSizeLimitConfig>;
}

/** Base type for the events map. Maps event names to their payload types. */
export type WorkflowEvents = Record<string, unknown>;
type EventKey<Events extends object> = Extract<keyof Events, string>;
type SSEUpdateKey<Updates extends object> = Extract<keyof Updates, string>;

/** Zod schema map for validating incoming workflow events at runtime. */
export type WorkflowEventSchemas<Events extends object> = {
	[K in EventKey<Events>]: import('zod').z.ZodType<Events[K]>;
};

/** Zod schema map for validating SSE updates emitted by a workflow. */
export type WorkflowSSESchemas<Updates extends object> = {
	[K in SSEUpdateKey<Updates>]: import('zod').z.ZodType<Updates[K]>;
};

/**
 * Discriminated union of `{ event, payload }` objects for delivering events to a workflow.
 * Resolves to `never` when the workflow defines no events.
 */
export type WorkflowEventProps<Events extends object> = [EventKey<Events>] extends [never]
	? never
	: {
			[K in EventKey<Events>]: {
				event: K;
				payload: Events[K];
			};
		}[EventKey<Events>];

/**
 * Default retry configuration: 3 attempts, 1s delay, exponential backoff.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	limit: 3,
	delay: '1s',
	backoff: 'exponential',
};

/**
 * Step context passed to a workflow's `run()` method, providing durable step primitives.
 *
 * All step methods are replay-safe: on re-execution, completed steps return their
 * cached results from SQLite rather than re-running.
 *
 * @typeParam Events - Map of event names to payload types this workflow can receive.
 */
export interface Step<Events extends object = {}> {
	/**
	 * Execute a named step with automatic persistence and optional retries.
	 *
	 * On first execution the function runs and its result is persisted.
	 * On replay the cached result is returned without re-executing.
	 *
	 * @param name - Unique step name within this workflow run.
	 * @param fn - The function to execute (sync or async).
	 * @param options - Optional retry configuration overriding workflow defaults.
	 * @returns The result of `fn`.
	 * @throws {@link StepRetryExhaustedError} When all retry attempts are exhausted.
	 * @throws {@link DuplicateStepError} When another step with the same name exists.
	 *
	 * @example
	 * ```ts
	 * const user = await step.do("fetch-user", async () => {
	 *   return await db.getUser(payload.userId);
	 * });
	 * ```
	 */
	do<T>(name: string, fn: () => Promise<T> | T, options?: StepDoOptions): Promise<T>;

	/**
	 * Pause workflow execution for a specified duration.
	 *
	 * Uses a Durable Object alarm; the workflow status becomes `"sleeping"`.
	 *
	 * @param name - Unique step name within this workflow run.
	 * @param duration - How long to sleep (e.g., `"5s"`, `"10m"`, `"1h"`).
	 * @throws {@link InvalidDurationError} When the duration string can't be parsed.
	 *
	 * @example
	 * ```ts
	 * await step.sleep("cooldown", "30s");
	 * ```
	 */
	sleep(name: string, duration: string): Promise<void>;

	/**
	 * Pause workflow execution until a specific point in time.
	 *
	 * Unlike {@link sleep} which accepts a relative duration, `sleepUntil` accepts an
	 * absolute `Date`. Uses a Durable Object alarm; the workflow status becomes `"sleeping"`.
	 * If the date is in the past the alarm fires immediately and execution continues.
	 *
	 * @param name - Unique step name within this workflow run.
	 * @param date - The absolute point in time to sleep until.
	 * @throws {@link InvalidDateError} When the date is not a valid `Date` instance.
	 * @throws {@link DuplicateStepError} When another step with the same name exists.
	 *
	 * @example
	 * ```ts
	 * // Sleep until midnight UTC on 2025-01-15
	 * await step.sleepUntil("wait-for-midnight", new Date("2025-01-15T00:00:00Z"));
	 *
	 * // Sleep until 30 minutes from now (equivalent to step.sleep("x", "30m"))
	 * await step.sleepUntil("nap", new Date(Date.now() + 30 * 60 * 1000));
	 * ```
	 */
	sleepUntil(name: string, date: Date): Promise<void>;

	/**
	 * Suspend workflow execution until an external event is delivered.
	 *
	 * If the event was already sent before the workflow reached this step, the
	 * buffered event is consumed immediately and execution continues without
	 * suspending. Otherwise, the workflow status becomes `"waiting"` until the
	 * event arrives via `sendEvent()`.
	 *
	 * @param name - The event name to wait for (must match a key in the workflow's events map).
	 * @param options - Optional timeout configuration.
	 * @returns The validated event payload.
	 * @throws {@link EventTimeoutError} When the timeout elapses without receiving the event.
	 *
	 * @example
	 * ```ts
	 * const approval = await step.waitForEvent("approval", { timeout: "24h" });
	 * ```
	 */
	waitForEvent<K extends Extract<keyof Events, string>>(name: K, options?: StepWaitOptions): Promise<Events[K]>;
}

/**
 * Static shape of a workflow definition (class-based or functional).
 *
 * @typeParam Payload - Input payload type validated by `inputSchema`.
 * @typeParam Result - Return type of `run()`.
 * @typeParam Events - Map of event names to payload types.
 * @typeParam Type - String literal workflow type identifier.
 * @typeParam SSEUpdates - Map of SSE update names to data types.
 */
export interface WorkflowClass<
	Payload = unknown,
	Result = unknown,
	Events extends object = WorkflowEvents,
	Type extends string = string,
	SSEUpdates extends object = {},
> {
	/** Unique string identifier for this workflow type (e.g., `"order-processing"`). */
	type: Type;
	/** Zod schema for validating the input payload at runtime. */
	inputSchema: import('zod').z.ZodType<Payload>;
	/** Map of event names to Zod schemas for validating event payloads. */
	events: WorkflowEventSchemas<Events>;
	/** Optional default configuration (e.g., retry settings) for all steps. */
	defaults?: Partial<WorkflowDefaults>;
	/** Optional cumulative result size limit. Overrides the 64 MB default. */
	resultSizeLimit?: Partial<ResultSizeLimitConfig>;
	/** Optional map of SSE update names to Zod schemas. */
	sseUpdates?: WorkflowSSESchemas<SSEUpdates>;
	/** Constructor producing a workflow instance with a `run()` method. */
	new (): WorkflowInstance<Payload, Result, Events, SSEUpdates>;
}

/** Instance of a workflow class with the `run()` method containing workflow logic. */
export interface WorkflowInstance<Payload = unknown, Result = unknown, Events extends object = {}, SSEUpdates extends object = {}> {
	/**
	 * Execute the workflow logic using durable step primitives.
	 *
	 * @param step - Step context providing `do()`, `sleep()`, and `waitForEvent()`.
	 * @param payload - The validated input payload.
	 * @param sse - SSE context for broadcasting real-time updates.
	 * @returns The workflow result, persisted upon completion.
	 */
	run(step: Step<Events>, payload: Payload, sse: SSE<SSEUpdates>): Promise<Result>;
}

/** Zod schema for a single failed retry attempt within a step's retry history. */
export const retryHistoryEntrySchema = z.object({
	/** The retry attempt number (1-based). */
	attempt: z.number(),
	/** Error message from the failed attempt. */
	error: z.string(),
	/** Stack trace from the failed attempt, or `null` if unavailable. */
	errorStack: z.string().nullable(),
	/** Unix timestamp (ms) when the attempt started. */
	timestamp: z.number(),
	/** Wall-clock execution duration of the attempt in milliseconds. */
	duration: z.number(),
});

/** A single entry in a step's retry history, representing one failed attempt. */
export type RetryHistoryEntry = z.infer<typeof retryHistoryEntrySchema>;

/** Zod schema for a single step's execution details. */
export const stepInfoSchema = z.object({
	/** Unique name of the step. */
	name: z.string(),
	/** Step type: `"do"`, `"sleep"`, or `"wait_for_event"`. */
	type: stepTypeSchema,
	/** Current status (e.g., `"completed"`, `"failed"`, `"sleeping"`, `"waiting"`). */
	status: stepStatusSchema,
	/** Number of execution attempts (including retries). */
	attempts: z.number(),
	/** Persisted result, or `null` if not yet completed. */
	result: z.unknown(),
	/** Error message from the most recent failure, or `null`. */
	error: z.string().nullable(),
	/** Unix timestamp (ms) when the step completed, or `null`. */
	completedAt: z.number().nullable(),
	/** Unix timestamp (ms) when the step started, or `null`. */
	startedAt: z.number().nullable(),
	/** Execution duration in milliseconds, or `null`. */
	duration: z.number().nullable(),
	/** Error stack trace from the most recent failure, or `null`. */
	errorStack: z.string().nullable(),
	/** History of failed retry attempts, or `null` if no retries occurred. */
	retryHistory: z.array(retryHistoryEntrySchema).nullable(),
});

/** Detailed information about a single step's execution. */
export type StepInfo = z.infer<typeof stepInfoSchema>;

/** Zod schema for a full workflow status snapshot. */
export const workflowStatusResponseSchema = z.object({
	/** Unique identifier of the workflow instance. */
	id: z.string(),
	/** Workflow type string. */
	type: z.string(),
	/** Current lifecycle status. */
	status: workflowStatusSchema,
	/** The input payload the workflow was started with. */
	payload: z.unknown(),
	/** The final result, or `null` if not yet completed. */
	result: z.unknown(),
	/** Error message if errored, otherwise `null`. */
	error: z.string().nullable(),
	/** Ordered list of step execution details. */
	steps: z.array(stepInfoSchema),
	/** Unix timestamp (ms) when the instance was created. */
	createdAt: z.number(),
	/** Unix timestamp (ms) of the last status update. */
	updatedAt: z.number(),
});

/** Full status snapshot of a workflow instance. */
export type WorkflowStatusResponse = z.infer<typeof workflowStatusResponseSchema>;

/** Properties required to initialize a new workflow instance in the Durable Object. */
export interface WorkflowRunnerInitProps {
	/** Workflow type string. */
	type: string;
	/** Unique instance identifier. */
	id: string;
	/** Input payload for the workflow. */
	payload: unknown;
}

/** Properties for delivering an external event to a running workflow. */
export interface WorkflowRunnerEventProps {
	/** Event name (must match a key in the workflow's event schema map). */
	event: string;
	/** Event payload data. */
	payload: unknown;
}

/**
 * Type-safe version of {@link WorkflowStatusResponse} with narrowed `type`, `payload`, and `result`.
 */
export type WorkflowStatusResponseFor<Payload = unknown, Result = unknown, Type extends string = string> = Omit<
	WorkflowStatusResponse,
	'type' | 'payload' | 'result'
> & {
	type: Type;
	payload: Payload;
	result: Result | null;
};

/** Zod schema for a compact workflow index entry. */
export const workflowIndexEntrySchema = z.object({
	/** Unique identifier of the workflow instance. */
	id: z.string(),
	/** Current lifecycle status. */
	status: z.string(),
	/** Unix timestamp (ms) when the instance was created. */
	createdAt: z.number(),
	/** Unix timestamp (ms) of the last index update. */
	updatedAt: z.number(),
});

/** Compact index entry for listing workflow instances without loading full status. */
export type WorkflowIndexEntry = z.infer<typeof workflowIndexEntrySchema>;

/** Filters for querying the workflow index. */
export interface WorkflowIndexListFilters {
	/** Filter to only include workflows with this status. */
	status?: string;
	/** Maximum number of entries to return. */
	limit?: number;
}

/** Configuration for shard-based workflow indexing. */
export interface WorkflowShardConfig {
	/** Number of shards to distribute index entries across. */
	shards?: number;
	/** Previous shard count, used during migration to also query old shards. */
	previousShards?: number;
}

/** Low-level RPC stub interface for communicating with a WorkflowRunner Durable Object. */
export interface WorkflowRunnerStub {
	initialize(props: WorkflowRunnerInitProps): Promise<void>;
	getStatus(): Promise<WorkflowStatusResponse>;
	deliverEvent(props: WorkflowRunnerEventProps): Promise<void>;
	pause(): Promise<void>;
	resume(): Promise<void>;
	terminate(): Promise<void>;
	indexWrite(props: WorkflowIndexEntry): Promise<void>;
	indexList(filters?: WorkflowIndexListFilters): Promise<WorkflowIndexEntry[]>;
	_expireTimers(): Promise<void>;
	_simulateOOMCrash(stepName: string, attempts?: number): Promise<void>;
}

/**
 * SSE context for emitting real-time updates from within a workflow.
 *
 * @typeParam Updates - Map of update names to their data types.
 */
export interface SSE<Updates extends object = {}> {
	/** Send a named update to all connected clients without persisting (skipped during replay). */
	broadcast<K extends SSEUpdateKey<Updates>>(name: K, data: Updates[K]): void;
	/** Send a named update to all connected clients AND persist to SQLite for replay. */
	emit<K extends SSEUpdateKey<Updates>>(name: K, data: Updates[K]): void;
	/** Close all active SSE connections for this workflow instance. */
	close(): void;
}

/**
 * Reason the observability provider's `flush()` was called.
 * Corresponds to the workflow status at the time of flush — the rest point
 * that ended the current replay cycle.
 */
export type FlushReason = WorkflowStatus;
