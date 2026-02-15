import type { TimelineEntry } from '../dashboard';
import type { FlushReason, StepType, WorkflowIndexEntry, WorkflowStatus, WorkflowStatusResponse } from './types';

// ─── Event Types ───────────────────────────────────────────────────────────────

/**
 * Emitted when a workflow instance begins execution for the first time.
 *
 * This event fires once per workflow instance, immediately after initialization
 * and before any steps are executed.
 */
export interface WorkflowStartEvent {
	/** Unique identifier of the workflow instance. */
	workflowId: string;
	/** Workflow type string (e.g., `"order-processing"`). */
	type: string;
	/** The validated input payload the workflow was started with. */
	payload: unknown;
	/** Unix timestamp (ms) when the workflow started. */
	timestamp: number;
}

/**
 * Emitted when a workflow's lifecycle status changes.
 *
 * Covers transitions such as running → completed, running → errored,
 * running → sleeping, running → waiting, running → paused, and
 * any status → terminated.
 */
export interface WorkflowStatusChangeEvent {
	/** Unique identifier of the workflow instance. */
	workflowId: string;
	/** Workflow type string (e.g., `"order-processing"`). */
	type: string;
	/** The new lifecycle status the workflow transitioned to. */
	status: WorkflowStatus;
	/** The workflow result, present only when status is `"completed"`. */
	result?: unknown;
	/** Error message, present only when status is `"errored"`. */
	error?: string;
	/** Unix timestamp (ms) when the status change occurred. */
	timestamp: number;
}

/**
 * Emitted when a step begins execution.
 *
 * For replay-safe steps that already have a cached result, this event
 * is not emitted — only genuinely executing steps fire this event.
 */
export interface StepStartEvent {
	/** Unique identifier of the workflow instance this step belongs to. */
	workflowId: string;
	/** Workflow type string (e.g., `"order-processing"`). */
	type: string;
	/** Unique name of the step within this workflow run. */
	stepName: string;
	/** The kind of step: `"do"`, `"sleep"`, `"sleep_until"`, or `"wait_for_event"`. */
	stepType: StepType;
	/** Unix timestamp (ms) when the step started executing. */
	timestamp: number;
}

/**
 * Emitted when a step completes successfully.
 *
 * Contains the step result and wall-clock duration of execution.
 */
export interface StepCompleteEvent {
	/** Unique identifier of the workflow instance this step belongs to. */
	workflowId: string;
	/** Workflow type string (e.g., `"order-processing"`). */
	type: string;
	/** Unique name of the step within this workflow run. */
	stepName: string;
	/** The kind of step: `"do"`, `"sleep"`, `"sleep_until"`, or `"wait_for_event"`. */
	stepType: StepType;
	/** The result returned by the step, or `undefined` for void steps like `sleep`. */
	result?: unknown;
	/** Wall-clock execution duration in milliseconds. */
	duration: number;
	/** Unix timestamp (ms) when the step completed. */
	timestamp: number;
}

/**
 * Emitted when a step fails and is scheduled for retry.
 *
 * This event fires once per failed attempt. If all retries are exhausted,
 * the workflow transitions to `"errored"` and a {@link WorkflowStatusChangeEvent}
 * is emitted instead.
 */
export interface StepRetryEvent {
	/** Unique identifier of the workflow instance this step belongs to. */
	workflowId: string;
	/** Workflow type string (e.g., `"order-processing"`). */
	type: string;
	/** Unique name of the step within this workflow run. */
	stepName: string;
	/** The retry attempt number (1-based). */
	attempt: number;
	/** Error message from the failed attempt. */
	error: string;
	/** Stack trace from the failed attempt, if available. */
	errorStack?: string;
	/** Unix timestamp (ms) when the next retry attempt is scheduled. */
	nextRetryAt: number;
	/** Unix timestamp (ms) when the retry event was recorded. */
	timestamp: number;
}

// ─── Filters ───────────────────────────────────────────────────────────────────

/**
 * Filters for querying workflow instances through an observability provider.
 *
 * Used by {@link ObservabilityProvider.listWorkflows} to narrow results
 * by workflow type, status, or count.
 */
export interface WorkflowListFilters {
	/** Filter to only include workflows of this type. */
	type?: string;
	/** Filter to only include workflows with this lifecycle status. */
	status?: WorkflowStatus;
	/** Maximum number of entries to return. */
	limit?: number;
}

// ─── ObservabilityProvider ──────────────────────────────────────────────────────

/**
 * Pluggable interface for observing workflow and step lifecycle events.
 *
 * Implementations receive fine-grained events during workflow execution and
 * can use them for logging, tracing, metrics, indexing, or any external
 * integration. The built-in shard-based indexing system implements this
 * interface, and users can supply their own providers for custom behavior.
 *
 * ## Collector pattern
 *
 * Each workflow execution cycle creates a **collector** via
 * {@link createCollector}. All events within that cycle are passed to the
 * collector, and {@link flush} is called at the end of the cycle to persist
 * or transmit the accumulated data. This batching pattern minimizes I/O
 * during the hot replay loop.
 *
 * @typeParam TCollector - The type of the per-cycle collector object.
 *                         Defaults to `void` for providers that don't need
 *                         accumulated state (e.g., fire-and-forget logging).
 */
export interface ObservabilityProvider<TCollector = void> {
	/**
	 * Create a new collector for a single workflow execution cycle.
	 *
	 * Called at the start of each replay cycle. The returned collector is
	 * passed to all subsequent event callbacks and finally to {@link flush}.
	 *
	 * @param workflowId - Unique identifier of the workflow instance.
	 * @param type - Workflow type string (e.g., `"order-processing"`).
	 * @returns A new collector instance for this execution cycle.
	 */
	createCollector(workflowId: string, type: string): TCollector;

	/**
	 * Called when a workflow instance begins execution for the first time.
	 *
	 * @param collector - The collector for this execution cycle.
	 * @param event - Details of the workflow start.
	 */
	onWorkflowStart(collector: TCollector, event: WorkflowStartEvent): void;

	/**
	 * Called when a workflow's lifecycle status changes.
	 *
	 * @param collector - The collector for this execution cycle.
	 * @param event - Details of the status transition.
	 */
	onWorkflowStatusChange(collector: TCollector, event: WorkflowStatusChangeEvent): void;

	/**
	 * Called when a step begins execution (not on replay cache hits).
	 *
	 * @param collector - The collector for this execution cycle.
	 * @param event - Details of the step start.
	 */
	onStepStart(collector: TCollector, event: StepStartEvent): void;

	/**
	 * Called when a step completes successfully.
	 *
	 * @param collector - The collector for this execution cycle.
	 * @param event - Details of the step completion including result and duration.
	 */
	onStepComplete(collector: TCollector, event: StepCompleteEvent): void;

	/**
	 * Called when a step fails and is scheduled for retry.
	 *
	 * @param collector - The collector for this execution cycle.
	 * @param event - Details of the retry including attempt number and next retry time.
	 */
	onStepRetry(collector: TCollector, event: StepRetryEvent): void;

	/**
	 * Flush accumulated data at the end of an execution cycle.
	 *
	 * Called once per replay cycle after the workflow reaches a rest point
	 * (completed, errored, sleeping, waiting, paused, or terminated).
	 * Implementations should persist or transmit the collected data here.
	 *
	 * @param collector - The collector containing accumulated event data.
	 * @param reason - The workflow status at the time of flush, indicating
	 *                 why the execution cycle ended.
	 */
	flush(collector: TCollector, reason: FlushReason): Promise<void>;

	/**
	 * List workflow instances matching the given filters.
	 *
	 * Optional — only required for providers that support indexed queries
	 * (e.g., the built-in shard provider or an external database).
	 * Used by the dashboard API to populate workflow lists.
	 *
	 * @param filters - Criteria for narrowing results by type, status, or count.
	 * @returns Array of index entries augmented with the workflow type.
	 */
	listWorkflows?(filters: WorkflowListFilters): Promise<(WorkflowIndexEntry & { type: string })[]>;

	/**
	 * Get the full status snapshot of a single workflow instance.
	 *
	 * Optional — only required for providers that can retrieve full workflow
	 * state independently of the Durable Object (e.g., an external database).
	 *
	 * @param id - Unique identifier of the workflow instance.
	 * @returns The complete workflow status including steps, payload, and result.
	 */
	getWorkflowStatus?(id: string): Promise<WorkflowStatusResponse>;

	/**
	 * Get a chronological timeline of executed steps for a workflow instance.
	 *
	 * Optional — only required for providers that can reconstruct the step
	 * timeline independently of the Durable Object.
	 *
	 * @param id - Unique identifier of the workflow instance.
	 * @returns The workflow identity, current status, and ordered timeline entries.
	 */
	getWorkflowTimeline?(id: string): Promise<{
		/** Unique identifier of the workflow instance. */
		id: string;
		/** Workflow type string. */
		type: string;
		/** Current lifecycle status. */
		status: WorkflowStatus;
		/** Chronologically ordered list of step timeline entries. */
		timeline: TimelineEntry[];
	}>;
}

// ─── StepObserver ──────────────────────────────────────────────────────────────

/**
 * Lightweight observer interface for step-level events within a single workflow.
 *
 * Used internally by the step execution engine to report step lifecycle events
 * without coupling to the full {@link ObservabilityProvider}. The workflow runner
 * bridges this interface to the provider by adding workflow-level context
 * (workflowId, type) before forwarding events.
 */
export interface StepObserver {
	/**
	 * Called when a step begins execution.
	 *
	 * @param stepName - Unique name of the step within this workflow run.
	 * @param stepType - The kind of step: `"do"`, `"sleep"`, `"sleep_until"`, or `"wait_for_event"`.
	 * @param timestamp - Unix timestamp (ms) when execution started.
	 */
	onStepStart(stepName: string, stepType: StepType, timestamp: number): void;

	/**
	 * Called when a step completes successfully.
	 *
	 * @param stepName - Unique name of the step within this workflow run.
	 * @param stepType - The kind of step: `"do"`, `"sleep"`, `"sleep_until"`, or `"wait_for_event"`.
	 * @param result - The value returned by the step.
	 * @param duration - Wall-clock execution duration in milliseconds.
	 * @param timestamp - Unix timestamp (ms) when the step completed.
	 */
	onStepComplete(stepName: string, stepType: StepType, result: unknown, duration: number, timestamp: number): void;

	/**
	 * Called when a step fails and is scheduled for retry.
	 *
	 * @param stepName - Unique name of the step within this workflow run.
	 * @param attempt - The retry attempt number (1-based).
	 * @param error - Error message from the failed attempt.
	 * @param errorStack - Stack trace from the failed attempt, if available.
	 * @param nextRetryAt - Unix timestamp (ms) when the next retry is scheduled.
	 * @param timestamp - Unix timestamp (ms) when the retry event was recorded.
	 */
	onStepRetry(
		stepName: string,
		attempt: number,
		error: string,
		errorStack: string | undefined,
		nextRetryAt: number,
		timestamp: number,
	): void;
}
