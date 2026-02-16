import type { TimelineEntry } from '../dashboard';
import type {
	FlushReason,
	StepType,
	WorkflowIndexEntry,
	WorkflowShardConfig,
	WorkflowRunnerStub,
	WorkflowIndexListFilters,
	WorkflowStatus,
	WorkflowStatusResponse,
} from './types';
import { listIndexEntries } from './index-listing';
import { shardIndex } from './shard';

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
	/** Unix timestamp (ms) when the workflow was originally created. Present on events emitted outside the main replay cycle (pause, resume, terminate). */
	createdAt?: number;
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
	 * When `limit` is specified, results should be sorted by `updatedAt` descending
	 * (newest first) so the most recent entries are returned.
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

/**
 * Internal collector used by {@link ShardObservabilityProvider} to accumulate
 * workflow-level state during a single execution cycle.
 *
 * Captures the minimal information needed to write an index shard entry
 * at flush time: workflow identity, current status, and timestamps.
 */
interface ShardCollector {
	/** Unique identifier of the workflow instance. */
	workflowId: string;
	/** Workflow type string (e.g., `"order-processing"`). */
	type: string;
	/** Current lifecycle status of the workflow. */
	status: WorkflowStatus;
	/** Unix timestamp (ms) when the workflow instance was created. */
	createdAt: number;
	/** Unix timestamp (ms) of the most recent status update. */
	updatedAt: number;
}

/**
 * Built-in observability provider that uses the shard-based indexing system
 * to track workflow instances across Durable Objects.
 *
 * This is the default provider when users enable observability (`observability: true`).
 * It consolidates the index writing logic previously in `WorkflowRunner.updateIndex()`
 * and the query logic previously inline in the dashboard oRPC handlers.
 *
 * ## How it works
 *
 * - **Collector pattern**: Each execution cycle creates a lightweight {@link ShardCollector}
 *   that accumulates the workflow's current status and timestamps.
 * - **Flush**: At the end of each cycle, the collector is flushed to the appropriate
 *   index shard Durable Object via `indexWrite()`. The shard is determined by
 *   `shardIndex(workflowId, shardCount)`.
 * - **Step events are no-ops**: Step-level data lives in each workflow's own Durable Object
 *   SQLite database. The shard index only tracks workflow-level metadata (id, status, timestamps).
 * - **Queries**: `listWorkflows()` fans out to all index shards, deduplicates, and sorts.
 *   `getWorkflowStatus()` and `getWorkflowTimeline()` go directly to the workflow's DO.
 *
 * ## Configuration
 *
 * Shard counts per workflow type are provided via the constructor config or merged
 * from `WorkflowRegistration` tuples at setup time. Defaults to 1 shard per type.
 *
 * @example
 * ```ts
 * const provider = new ShardObservabilityProvider(env.WORKFLOW_RUNNER, {
 *   shards: { "order-processing": { shards: 8 } },
 *   workflowTypes: ["order-processing", "notification"],
 * });
 * ```
 */
export class ShardObservabilityProvider implements ObservabilityProvider<ShardCollector> {
	/** Durable Object namespace binding for communicating with workflow runner DOs. */
	private binding: DurableObjectNamespace;

	/** Per-type shard configuration (shard counts and previous shard counts for migration). */
	private shardConfigs: Record<string, WorkflowShardConfig>;

	/** List of all registered workflow type strings, used by `listWorkflows()` to fan out queries. */
	private workflowTypes: string[];

	/**
	 * Create a new shard-based observability provider.
	 *
	 * @param binding - The `DurableObjectNamespace` binding for the `WorkflowRunner` DO class.
	 * @param config - Optional configuration for shard counts and known workflow types.
	 * @param config.shards - Per-type shard configuration. Keys are workflow type strings.
	 * @param config.workflowTypes - List of all registered workflow type strings. Used by
	 *                               `listWorkflows()` when no type filter is provided.
	 */
	constructor(binding: DurableObjectNamespace, config?: { shards?: Record<string, WorkflowShardConfig>; workflowTypes?: string[] }) {
		this.binding = binding;
		this.shardConfigs = config?.shards ?? {};
		this.workflowTypes = config?.workflowTypes ?? [];
	}

	/**
	 * Create a new collector for a single workflow execution cycle.
	 *
	 * The collector captures the workflow's identity and initializes with
	 * `"running"` status and the current timestamp. Event callbacks update
	 * the collector's status and timestamps, and `flush()` writes the
	 * final state to the appropriate index shard.
	 *
	 * @param workflowId - Unique identifier of the workflow instance.
	 * @param type - Workflow type string (e.g., `"order-processing"`).
	 * @returns A new {@link ShardCollector} for this execution cycle.
	 */
	createCollector(workflowId: string, type: string): ShardCollector {
		const now = Date.now();
		return {
			workflowId,
			type,
			status: 'running',
			createdAt: now,
			updatedAt: now,
		};
	}

	/**
	 * Handle workflow start event.
	 *
	 * Sets the collector status to `"running"` and updates both `createdAt`
	 * and `updatedAt` to the event timestamp.
	 *
	 * @param collector - The collector for this execution cycle.
	 * @param event - Details of the workflow start including timestamp.
	 */
	onWorkflowStart(collector: ShardCollector, event: WorkflowStartEvent): void {
		collector.status = 'running';
		collector.createdAt = event.timestamp;
		collector.updatedAt = event.timestamp;
	}

	/**
	 * Handle workflow status change event.
	 *
	 * Updates the collector's status and `updatedAt` timestamp to reflect
	 * the new workflow state.
	 *
	 * @param collector - The collector for this execution cycle.
	 * @param event - Details of the status transition including the new status.
	 */
	onWorkflowStatusChange(collector: ShardCollector, event: WorkflowStatusChangeEvent): void {
		collector.status = event.status;
		collector.updatedAt = event.timestamp;
		if (event.createdAt !== undefined) {
			collector.createdAt = event.createdAt;
		}
	}

	/**
	 * Handle step start event — **no-op**.
	 *
	 * Step-level data is stored in each workflow's own Durable Object SQLite
	 * database. The shard index only tracks workflow-level metadata (id, status,
	 * timestamps), so step events don't need to be forwarded to the index.
	 *
	 * @param _collector - Unused. The collector for this execution cycle.
	 * @param _event - Unused. Details of the step start.
	 */
	onStepStart(_collector: ShardCollector, _event: StepStartEvent): void {
		// No-op: step data lives in per-workflow DO's SQLite, not in the shard index
	}

	/**
	 * Handle step complete event — **no-op**.
	 *
	 * Step-level data is stored in each workflow's own Durable Object SQLite
	 * database. The shard index only tracks workflow-level metadata (id, status,
	 * timestamps), so step events don't need to be forwarded to the index.
	 *
	 * @param _collector - Unused. The collector for this execution cycle.
	 * @param _event - Unused. Details of the step completion.
	 */
	onStepComplete(_collector: ShardCollector, _event: StepCompleteEvent): void {
		// No-op: step data lives in per-workflow DO's SQLite, not in the shard index
	}

	/**
	 * Handle step retry event — **no-op**.
	 *
	 * Step-level data is stored in each workflow's own Durable Object SQLite
	 * database. The shard index only tracks workflow-level metadata (id, status,
	 * timestamps), so step events don't need to be forwarded to the index.
	 *
	 * @param _collector - Unused. The collector for this execution cycle.
	 * @param _event - Unused. Details of the step retry.
	 */
	onStepRetry(_collector: ShardCollector, _event: StepRetryEvent): void {
		// No-op: step data lives in per-workflow DO's SQLite, not in the shard index
	}

	/**
	 * Flush the collector's accumulated state to the appropriate index shard.
	 *
	 * Computes the target shard using `shardIndex()`, obtains the shard's
	 * Durable Object stub, and calls `indexWrite()` to upsert the workflow's
	 * index entry. This is the same logic as the `updateIndex()` method in
	 * `workflow-runner.ts`, consolidated here for the provider interface.
	 *
	 * The write is best-effort: failures are silently caught to avoid crashing
	 * the workflow execution cycle over an index update failure.
	 *
	 * @param collector - The collector containing the workflow's current state.
	 * @param _reason - The workflow status at flush time (unused — status is already
	 *                  captured in the collector via `onWorkflowStatusChange`).
	 */
	async flush(collector: ShardCollector, _reason: FlushReason): Promise<void> {
		try {
			const shards = this.shardConfigs[collector.type]?.shards ?? 1;
			const shard = shardIndex(collector.workflowId, shards);
			const indexId = this.binding.idFromName(`__index:${collector.type}:${shard}`);
			const stub = this.binding.get(indexId) as unknown as WorkflowRunnerStub;
			await stub.indexWrite({
				id: collector.workflowId,
				status: collector.status,
				createdAt: collector.createdAt,
				updatedAt: collector.updatedAt,
			});
		} catch {
			// Best-effort: index shard writes should not crash the workflow execution cycle
		}
	}

	/**
	 * List workflow instances matching the given filters.
	 *
	 * Fans out queries to all index shards for each relevant workflow type,
	 * deduplicates entries by ID (keeping the most recently updated), sorts
	 * by `updatedAt` descending, and applies the limit.
	 *
	 * When no `type` filter is provided, queries all registered workflow types.
	 * This is the same logic as the dashboard `list` handler, consolidated here.
	 *
	 * @param filters - Criteria for narrowing results by type, status, or count.
	 * @returns Array of index entries augmented with the `type` field, sorted by
	 *          `updatedAt` descending.
	 */
	async listWorkflows(filters: WorkflowListFilters): Promise<(WorkflowIndexEntry & { type: string })[]> {
		const types = filters.type ? [filters.type] : this.workflowTypes;
		const indexFilters: WorkflowIndexListFilters = {
			status: filters.status,
			limit: filters.limit,
		};

		const all = await Promise.all(
			types.map(async (type) => {
				try {
					const entries = await listIndexEntries(this.binding, type, this.shardConfigs, indexFilters);
					return entries.map((e) => ({ ...e, type }));
				} catch {
					// Best-effort: if querying a type's shards fails, skip it
					return [];
				}
			}),
		);

		let workflows = all.flat();

		// Deduplicate by workflow ID (entries from different types should not collide,
		// but this guards against edge cases during shard migration)
		const seen = new Map<string, (typeof workflows)[number]>();
		for (const entry of workflows) {
			const existing = seen.get(entry.id);
			if (!existing || entry.updatedAt > existing.updatedAt) {
				seen.set(entry.id, entry);
			}
		}
		workflows = [...seen.values()];

		// Sort by most recently updated first
		workflows.sort((a, b) => b.updatedAt - a.updatedAt);

		if (filters.limit) {
			workflows = workflows.slice(0, filters.limit);
		}

		return workflows;
	}

	/**
	 * Get the full status snapshot of a single workflow instance.
	 *
	 * Retrieves the workflow's Durable Object stub by name and calls `getStatus()`
	 * to obtain the complete status including steps, payload, and result.
	 *
	 * @param id - Unique identifier of the workflow instance.
	 * @returns The complete workflow status response from the Durable Object.
	 */
	async getWorkflowStatus(id: string): Promise<WorkflowStatusResponse> {
		const stub = this.binding.get(this.binding.idFromName(id)) as unknown as WorkflowRunnerStub;
		return stub.getStatus();
	}

	/**
	 * Get a chronological timeline of executed steps for a workflow instance.
	 *
	 * Retrieves the full workflow status via {@link getWorkflowStatus}, then
	 * transforms the steps into a flat timeline of executed entries. Only steps
	 * that have actually started (`startedAt != null`) are included.
	 *
	 * This is the same transformation logic as the dashboard `timeline` handler,
	 * consolidated here for the provider interface.
	 *
	 * @param id - Unique identifier of the workflow instance.
	 * @returns The workflow identity, current status, and chronologically ordered
	 *          timeline entries (sorted by `startedAt` ascending).
	 */
	async getWorkflowTimeline(id: string): Promise<{
		/** Unique identifier of the workflow instance. */
		id: string;
		/** Workflow type string. */
		type: string;
		/** Current lifecycle status. */
		status: WorkflowStatus;
		/** Chronologically ordered list of step timeline entries. */
		timeline: TimelineEntry[];
	}> {
		const status = await this.getWorkflowStatus(id);

		const timeline: TimelineEntry[] = status.steps
			.filter((s) => s.startedAt != null)
			.map((s) => ({
				name: s.name,
				type: s.type,
				status: s.status,
				startedAt: s.startedAt,
				duration: s.duration ?? 0,
				attempts: s.attempts,
				error: s.error,
				retryHistory: s.retryHistory,
			}))
			.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

		return {
			id: status.id,
			type: status.type,
			status: status.status,
			timeline,
		};
	}
}
