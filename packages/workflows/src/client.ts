import { EventValidationError, ObservabilityDisabledError, UpdateTimeoutError, WorkflowNotRunningError, extractZodIssues } from './errors';
import { listIndexEntries } from './engine/index-listing';
import { parseDuration } from './engine/duration';
import { parseSSEStream } from './engine/sse-stream';
import type {
	WorkflowClass,
	WorkflowRunnerStub,
	WorkflowRunnerInitProps,
	WorkflowStatusResponse,
	WorkflowStatusResponseFor,
	TypedWorkflowRunnerStub,
	WorkflowEventProps,
	WorkflowIndexListFilters,
	WorkflowIndexEntry,
	WorkflowShardConfig,
} from './engine/types';
import type { WorkflowRegistration } from './engine/workflow-runner';
import { createWorkflowRunner } from './engine/workflow-runner';
import { FetchHandler } from '@orpc/server/fetch';
import { StandardHandler, StandardRPCCodec, StandardRPCMatcher } from '@orpc/server/standard';
import { dashboardRouter } from './dashboard';
import type { DashboardContext } from './dashboard';
import { CORSPlugin, StrictGetMethodPlugin } from '@orpc/server/plugins';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import SuperJSON from 'superjson';

/** Configuration for the Ablauf workflow engine. */
export interface AblaufConfig {
	/** Workflow classes (or `[WorkflowClass, ShardConfig]` tuples) to register. */
	workflows?: WorkflowRegistration[];
	/** Per-type shard configuration overrides for index listing. */
	shards?: Record<string, WorkflowShardConfig>;
	/** Whether observability (index sharding and listing) is enabled. Defaults to `true`. */
	observability?: boolean;
	/** An array of allowed CORS origins for the oRPC API. */
	corsOrigins?: string[];
}

/**
 * Main API for creating and managing durable workflow instances.
 * Backed by Cloudflare Durable Objects for persistence and scheduling.
 */
export class Ablauf {
	private binding: DurableObjectNamespace;
	private shardConfigs: Record<string, WorkflowShardConfig>;
	private workflows: WorkflowClass[];
	private registry: Record<string, WorkflowClass>;
	private observability: boolean;

	/**
	 * @param binding - The `WORKFLOW_RUNNER` Durable Object namespace from your worker's `env`.
	 * @param config - Optional configuration for registered workflows, sharding, and observability.
	 */
	constructor(
		binding: DurableObjectNamespace,
		private config?: AblaufConfig,
	) {
		this.binding = binding;
		this.shardConfigs = {};
		this.workflows = [];
		this.registry = {};
		this.observability = config?.observability ?? true;

		if (config?.workflows) {
			for (const entry of config.workflows) {
				const [wf, shardConfig] = Array.isArray(entry) ? entry : [entry, undefined];
				this.workflows.push(wf);
				this.registry[wf.type] = wf;
				if (shardConfig) {
					this.shardConfigs[wf.type] = shardConfig;
				}
			}
		}

		if (config?.shards) {
			for (const [type, shardConfig] of Object.entries(config.shards)) {
				this.shardConfigs[type] = shardConfig;
			}
		}
	}

	private getStub(id: string): WorkflowRunnerStub {
		return this.binding.get(this.binding.idFromName(id)) as unknown as WorkflowRunnerStub;
	}

	/**
	 * Create and start a new workflow instance.
	 *
	 * @param workflow - The workflow class defining the type and input schema.
	 * @param props - The instance ID and payload.
	 * @returns A typed stub for interacting with the created workflow instance.
	 * @throws {PayloadValidationError} If the payload fails Zod schema validation.
	 * @throws {WorkflowAlreadyExistsError} If a workflow with the given ID already exists.
	 *
	 * @example
	 * ```ts
	 * const stub = await ablauf.create(OrderWorkflow, {
	 *   id: "order-123",
	 *   payload: { orderId: "123", amount: 99.99 },
	 * });
	 * ```
	 */
	async create<Payload, Result, Events extends object, Type extends string>(
		workflow: WorkflowClass<Payload, Result, Events, Type>,
		props: { id: string; payload: NoInfer<Payload> },
	): Promise<TypedWorkflowRunnerStub<Payload, Result, Events, Type>> {
		const payload = workflow.inputSchema.parse(props.payload);
		const stub = this.getStub(props.id);
		const initProps: WorkflowRunnerInitProps = { type: workflow.type, id: props.id, payload };
		await stub.initialize(initProps);
		return stub as TypedWorkflowRunnerStub<Payload, Result, Events, Type>;
	}

	/**
	 * Send a typed event to a running workflow instance.
	 *
	 * @param workflow - The workflow class (for type inference and event schema lookup).
	 * @param props - The instance ID, event name, and event payload.
	 * @throws {EventValidationError} If the event name is unknown or the payload fails validation.
	 * @throws {WorkflowNotRunningError} If the workflow is not waiting for this event.
	 *
	 * @example
	 * ```ts
	 * await ablauf.sendEvent(OrderWorkflow, {
	 *   id: "order-123",
	 *   event: "payment-received",
	 *   payload: { amount: 99.99, transactionId: "tx-456" },
	 * });
	 * ```
	 */
	async sendEvent<Payload, Result, Events extends object, Type extends string>(
		workflow: WorkflowClass<Payload, Result, Events, Type>,
		props: { id: string } & NoInfer<WorkflowEventProps<Events>>,
	): Promise<void> {
		const schema = workflow.events[props.event];
		if (!schema) {
			throw new EventValidationError(props.event, [{ message: `Unknown event "${props.event}" for workflow type "${workflow.type}"` }]);
		}
		let payload: unknown;
		try {
			payload = schema.parse(props.payload);
		} catch (e) {
			const issues = extractZodIssues(e);
			throw new EventValidationError(props.event, issues);
		}
		const stub = this.getStub(props.id);
		await stub.deliverEvent({ event: props.event, payload });
	}

	/**
	 * Get the current status of a workflow instance.
	 *
	 * @param id - The workflow instance ID.
	 * @returns The untyped workflow status response.
	 */
	async status(id: string): Promise<WorkflowStatusResponse>;
	/**
	 * Get the current status of a workflow instance with typed payload and result.
	 *
	 * @param id - The workflow instance ID.
	 * @param workflow - The workflow class for narrowing the response type.
	 * @returns A typed status response with inferred payload, result, and type.
	 */
	async status<Payload, Result, Events extends object, Type extends string>(
		id: string,
		workflow: WorkflowClass<Payload, Result, Events, Type>,
	): Promise<WorkflowStatusResponseFor<Payload, Result, Type>>;
	async status(id: string, workflow?: WorkflowClass): Promise<WorkflowStatusResponse> {
		void workflow; // used only for type narrowing
		const stub = this.getStub(id);
		return stub.getStatus();
	}

	/**
	 * Pause a running workflow. It will finish its current step, then suspend.
	 *
	 * @param id - The workflow instance ID.
	 */
	async pause(id: string): Promise<void> {
		const stub = this.getStub(id);
		await stub.pause();
	}

	/**
	 * Resume a paused workflow. Replays execution history and continues from where it stopped.
	 *
	 * @param id - The workflow instance ID.
	 */
	async resume(id: string): Promise<void> {
		const stub = this.getStub(id);
		await stub.resume();
	}

	/**
	 * Permanently terminate a workflow. It cannot be resumed after termination.
	 *
	 * @param id - The workflow instance ID.
	 */
	async terminate(id: string): Promise<void> {
		const stub = this.getStub(id);
		await stub.terminate();
	}

	/**
	 * Wait for a specific SSE update from a running workflow.
	 *
	 * Connects to the workflow's SSE stream and resolves when the named update
	 * arrives, or rejects if the timeout expires or the workflow stops running.
	 *
	 * @param workflow - The workflow class (for SSE update type inference).
	 * @param props - Options including the instance ID, update name, and optional timeout.
	 * @param props.id - The workflow instance ID.
	 * @param props.update - The SSE update event name to wait for.
	 * @param props.timeout - Optional timeout as a duration string (e.g., `"30s"`, `"5m"`).
	 * @returns The typed data payload of the matched SSE update event.
	 * @throws {UpdateTimeoutError} If the timeout expires before the update arrives.
	 * @throws {WorkflowNotRunningError} If the workflow completes or errors before the update.
	 *
	 * @example
	 * ```ts
	 * const progress = await ablauf.waitForUpdate(OrderWorkflow, {
	 *   id: "order-123",
	 *   update: "progress",
	 *   timeout: "30s",
	 * });
	 * ```
	 */
	async waitForUpdate<
		Payload,
		Result,
		Events extends object,
		Type extends string,
		SSEUpdates extends object,
		K extends Extract<keyof SSEUpdates, string>,
	>(
		workflow: WorkflowClass<Payload, Result, Events, Type, SSEUpdates>,
		props: { id: string; update: K; timeout?: string },
	): Promise<SSEUpdates[K]> {
		void workflow; // used only for type narrowing
		const stub = this.getStub(props.id);
		const stream = await stub.connectSSE();
		const abortController = new AbortController();

		const timeoutMs = props.timeout ? parseDuration(props.timeout) : null;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const readUntilMatch = async (): Promise<SSEUpdates[K]> => {
			for await (const update of parseSSEStream(stream, { signal: abortController.signal })) {
				if (update.event === 'close') {
					const status = await stub.getStatus();
					throw new WorkflowNotRunningError(props.id, status.status);
				}

				if (update.event === props.update) {
					return update.data as SSEUpdates[K];
				}
			}

			if (abortController.signal.aborted) {
				throw new UpdateTimeoutError(String(props.update), props.timeout ?? `${timeoutMs ?? 0}ms`);
			}

			const status = await stub.getStatus();
			throw new WorkflowNotRunningError(props.id, status.status);
		};

		const readPromise = readUntilMatch();
		const readPromiseHandled = readPromise.catch(() => undefined);
		const timeoutPromise =
			timeoutMs === null
				? null
				: new Promise<never>((_, reject) => {
						timer = setTimeout(() => {
							abortController.abort();
							reject(new UpdateTimeoutError(String(props.update), props.timeout ?? `${timeoutMs}ms`));
						}, timeoutMs);
					});

		try {
			if (!timeoutPromise) {
				return await readPromise;
			}
			return await Promise.race([readPromise, timeoutPromise]);
		} catch (error) {
			if (error instanceof UpdateTimeoutError) {
				void readPromiseHandled;
			}
			throw error;
		} finally {
			if (timer) {
				clearTimeout(timer);
			}
			abortController.abort();
		}
	}

	/**
	 * List workflow instances of a given type from the index shards.
	 *
	 * @param type - The workflow type string (e.g., `"process-order"`).
	 * @param filters - Optional filters for status and result limit.
	 * @returns An array of index entries, sorted by `updatedAt` descending when a limit is applied.
	 * @throws {ObservabilityDisabledError} If observability is disabled in the configuration.
	 */
	async list(type: string, filters?: WorkflowIndexListFilters): Promise<WorkflowIndexEntry[]> {
		if (!this.observability) {
			throw new ObservabilityDisabledError();
		}
		const entries = await listIndexEntries(this.binding, type, this.shardConfigs, filters);
		if (filters?.limit) {
			entries.sort((a, b) => b.updatedAt - a.updatedAt);
			return entries.slice(0, filters.limit);
		}
		return entries;
	}

	// ─── Unified API Methods ───

	/**
	 * Create a `WorkflowRunner` Durable Object class configured with the registered workflows.
	 *
	 * @returns A Durable Object class to export from your worker entry point.
	 */
	createWorkflowRunner(overrides?: { binding?: string }) {
		const registrations: WorkflowRegistration[] = this.workflows.map((wf) => {
			const shardConfig = this.shardConfigs[wf.type];
			return shardConfig ? [wf, shardConfig] : wf;
		});
		return createWorkflowRunner({
			workflows: registrations,
			binding: overrides?.binding,
			observability: this.observability,
		});
	}

	/**
	 * Build the context object required by the dashboard oRPC router.
	 *
	 * @returns A {@link DashboardContext} for use with the RPC handler.
	 */
	getDashboardContext(): DashboardContext {
		return {
			binding: this.binding,
			workflows: this.workflows,
			shardConfigs: this.shardConfigs,
			observability: this.observability,
		};
	}

	/** The oRPC dashboard router for type-safe API access. */
	get router() {
		return dashboardRouter;
	}

	/**
	 * Create an oRPC fetch handler for the dashboard router.
	 *
	 * @returns An {@link RPCHandler} instance that can serve the dashboard API over HTTP.
	 */
	createHandlers() {
		const corsPlugin = new CORSPlugin({
			origin: this.config?.corsOrigins,
			allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
		});
		const openApiHandler = new OpenAPIHandler(dashboardRouter, {
			plugins: [corsPlugin],
		});
		const serializer = {
			serialize: (data: unknown) => SuperJSON.serialize(data),
			deserialize: (data: any) => SuperJSON.deserialize(data),
		};
		const plugins = [corsPlugin, new StrictGetMethodPlugin()];
		const rpcHandler = new FetchHandler(
			new StandardHandler(
				dashboardRouter,
				new StandardRPCMatcher(),
				new StandardRPCCodec(serializer as any), // NEEDED ACCORDING TO ORPC DOCS https://orpc.dev/docs/advanced/superjson#superjson-serializer
				{ plugins },
			),
			{ plugins },
		);
		return {
			openApiHandler,
			rpcHandler,
		};
	}
}
