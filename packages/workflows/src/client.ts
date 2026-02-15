import { ObservabilityReadNotConfiguredError } from './errors';
import type { ObservabilityProvider } from './engine/observability';
import { ShardObservabilityProvider } from './engine/observability';
import type {
	WorkflowClass,
	WorkflowRunnerStub,
	WorkflowRunnerInitProps,
	WorkflowEvents,
	WorkflowStatus,
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
import { WorkflowHandle } from './handle';

/** Configuration for the Ablauf workflow engine. */
export interface AblaufConfig {
	/** Workflow classes (or `[WorkflowClass, ShardConfig]` tuples) to register. */
	workflows?: WorkflowRegistration[];
	/** Per-type shard configuration overrides for index listing. @deprecated Use `ShardObservabilityProvider` constructor instead. */
	shards?: Record<string, WorkflowShardConfig>;
	/**
	 * Observability configuration.
	 *
	 * - `true` (default) — uses the built-in {@link ShardObservabilityProvider}
	 * - `false` — disables all observability (no index writes, no dashboard)
	 * - `ObservabilityProvider` — uses a custom provider for full replacement
	 */
	observability?: boolean | ObservabilityProvider<any>;
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
	/** Resolved observability provider, or `null` when observability is disabled. */
	private provider: ObservabilityProvider<any> | null;

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

		// Resolve the observability provider from the config value.
		const obs = config?.observability;
		if (obs === false) {
			this.provider = null;
		} else if (typeof obs === 'object') {
			// Custom provider instance — use as-is
			this.provider = obs;
		} else {
			// Default (true or undefined): built-in shard-based provider
			const shard = new ShardObservabilityProvider(binding, {
				shards: this.shardConfigs,
				workflowTypes: this.workflows.map((w) => w.type),
			});
			this.provider = shard;
		}
	}

	private createHandle<
		Payload,
		Result,
		Events extends object = WorkflowEvents,
		Type extends string = string,
		SSEUpdates extends object = {},
	>(
		workflow: WorkflowClass<Payload, Result, Events, Type, SSEUpdates>,
		id: string,
	): WorkflowHandle<Payload, Result, Events, Type, SSEUpdates> {
		const doId = this.binding.idFromName(id);
		const rawStub = this.binding.get(doId);
		const rpcStub = rawStub as unknown as WorkflowRunnerStub;
		return new WorkflowHandle(rpcStub, rawStub, workflow, id);
	}

	/**
	 * Create and start a new workflow instance.
	 *
	 * @param workflow - The workflow class defining the type and input schema.
	 * @param props - The instance ID and payload.
	 * @returns A {@link WorkflowHandle} for interacting with the created workflow instance.
	 * @throws {PayloadValidationError} If the payload fails Zod schema validation.
	 * @throws {WorkflowAlreadyExistsError} If a workflow with the given ID already exists.
	 *
	 * @example
	 * ```ts
	 * const order = await ablauf.create(OrderWorkflow, {
	 *   id: "order-123",
	 *   payload: { orderId: "123", amount: 99.99 },
	 * });
	 * const status = await order.getStatus();
	 * ```
	 */
	async create<Payload, Result, Events extends object, Type extends string, SSEUpdates extends object = {}>(
		workflow: WorkflowClass<Payload, Result, Events, Type, SSEUpdates>,
		props: { id: string; payload: NoInfer<Payload> },
	): Promise<WorkflowHandle<Payload, Result, Events, Type, SSEUpdates>> {
		const payload = workflow.inputSchema.parse(props.payload);
		const handle = this.createHandle(workflow, props.id);
		const initProps: WorkflowRunnerInitProps = { type: workflow.type, id: props.id, payload };
		await handle._rpc.initialize(initProps);
		return handle;
	}

	/**
	 * Get a handle for an existing workflow instance.
	 *
	 * This does not make a network call — it returns a handle that can be used
	 * to interact with the workflow via its methods.
	 *
	 * @param workflow - The workflow class (for type inference and event schema).
	 * @param props - The instance ID.
	 * @returns A {@link WorkflowHandle} for the workflow instance.
	 *
	 * @example
	 * ```ts
	 * const order = ablauf.get(OrderWorkflow, { id: 'order-123' });
	 * const status = await order.getStatus();
	 * await order.sendEvent({ event: 'payment', payload: { amount: 99 } });
	 * ```
	 */
	get<Payload, Result, Events extends object, Type extends string, SSEUpdates extends object = {}>(
		workflow: WorkflowClass<Payload, Result, Events, Type, SSEUpdates>,
		props: { id: string },
	): WorkflowHandle<Payload, Result, Events, Type, SSEUpdates> {
		return this.createHandle(workflow, props.id);
	}

	/**
	 * List workflow instances of a given type via the observability provider.
	 *
	 * @param type - The workflow type string (e.g., `"process-order"`).
	 * @param filters - Optional filters for status and result limit.
	 * @returns An array of index entries, sorted by `updatedAt` descending when a limit is applied.
	 * @throws {ObservabilityReadNotConfiguredError} If the provider is disabled or doesn't implement `listWorkflows`.
	 */
	async list(type: string, filters?: WorkflowIndexListFilters): Promise<WorkflowIndexEntry[]> {
		if (!this.provider?.listWorkflows) {
			throw new ObservabilityReadNotConfiguredError();
		}
		return this.provider.listWorkflows({ type, status: filters?.status as WorkflowStatus | undefined, limit: filters?.limit });
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
			provider: this.provider,
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
			provider: this.provider,
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
