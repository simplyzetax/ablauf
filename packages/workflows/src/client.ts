import {
	EventValidationError,
	ObservabilityDisabledError,
	UpdateTimeoutError,
	WorkflowNotRunningError,
	extractZodIssues,
} from "./errors";
import { listIndexEntries } from "./engine/index-listing";
import { parseDuration } from "./engine/duration";
import { parseSSEStream } from "./engine/sse-stream";
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
} from "./engine/types";
import type { WorkflowRegistration } from "./engine/workflow-runner";
import { createWorkflowRunner } from "./engine/workflow-runner";
import { RPCHandler } from "@orpc/server/fetch";
import { dashboardRouter } from "./dashboard";
import type { DashboardContext } from "./dashboard";

export interface AblaufConfig {
	workflows?: WorkflowRegistration[];
	shards?: Record<string, WorkflowShardConfig>;
	observability?: boolean;
}

export class Ablauf {
	private binding: DurableObjectNamespace;
	private shardConfigs: Record<string, WorkflowShardConfig>;
	private workflows: WorkflowClass[];
	private registry: Record<string, WorkflowClass>;
	private observability: boolean;

	constructor(binding: DurableObjectNamespace, config?: AblaufConfig) {
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

	async sendEvent<Payload, Result, Events extends object, Type extends string>(
		workflow: WorkflowClass<Payload, Result, Events, Type>,
		props: { id: string } & NoInfer<WorkflowEventProps<Events>>,
	): Promise<void> {
		const schema = workflow.events[props.event];
		if (!schema) {
			throw new EventValidationError(props.event, [
				{ message: `Unknown event "${props.event}" for workflow type "${workflow.type}"` },
			]);
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

	async status(id: string): Promise<WorkflowStatusResponse>;
	async status<Payload, Result, Events extends object, Type extends string>(
		id: string,
		workflow: WorkflowClass<Payload, Result, Events, Type>,
	): Promise<WorkflowStatusResponseFor<Payload, Result, Type>>;
	async status(id: string, workflow?: WorkflowClass): Promise<WorkflowStatusResponse> {
		void workflow; // used only for type narrowing
		const stub = this.getStub(id);
		return stub.getStatus();
	}

	async pause(id: string): Promise<void> {
		const stub = this.getStub(id);
		await stub.pause();
	}

	async resume(id: string): Promise<void> {
		const stub = this.getStub(id);
		await stub.resume();
	}

	async terminate(id: string): Promise<void> {
		const stub = this.getStub(id);
		await stub.terminate();
	}

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
				if (update.event === "close") {
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
				await readPromiseHandled;
			}
			throw error;
		} finally {
			if (timer) {
				clearTimeout(timer);
			}
			abortController.abort();
		}
	}

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

	getDashboardContext(): DashboardContext {
		return {
			binding: this.binding,
			workflows: this.workflows,
			shardConfigs: this.shardConfigs,
			observability: this.observability,
		};
	}

	get router() {
		return dashboardRouter;
	}

	createRPCHandler() {
		return new RPCHandler(dashboardRouter);
	}

}
