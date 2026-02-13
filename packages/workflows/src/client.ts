import { EventValidationError, extractZodIssues } from "./errors";
import { shardIndex } from "./engine/shard";
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
import { dashboardRouter } from "./dashboard";
import type { DashboardContext } from "./dashboard";
import { createSSEStream } from "./sse-stream";

export interface AblaufConfig {
	workflows?: WorkflowRegistration[];
	shards?: Record<string, WorkflowShardConfig>;
}

export class Ablauf {
	private binding: DurableObjectNamespace;
	private shardConfigs: Record<string, WorkflowShardConfig>;
	private workflows: WorkflowClass[];
	private registry: Record<string, WorkflowClass>;

	constructor(binding: DurableObjectNamespace, config?: AblaufConfig) {
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

	async list(type: string, filters?: WorkflowIndexListFilters): Promise<WorkflowIndexEntry[]> {
		const config = this.shardConfigs[type] ?? {};
		const shardCount = config.shards ?? 1;
		const prevShards = config.previousShards;

		const shardNames = new Set<string>();
		for (let i = 0; i < shardCount; i++) {
			shardNames.add(`__index:${type}:${i}`);
		}
		if (prevShards) {
			for (let i = 0; i < prevShards; i++) {
				shardNames.add(`__index:${type}:${i}`);
			}
		}

		const results = await Promise.all(
			[...shardNames].map((name) => {
				const stub = this.binding.get(this.binding.idFromName(name)) as unknown as WorkflowRunnerStub;
				return stub.indexList(filters);
			}),
		);

		// Deduplicate by workflow ID (same entry may exist in old + new shard during resize)
		const seen = new Map<string, WorkflowIndexEntry>();
		for (const entry of results.flat()) {
			const existing = seen.get(entry.id);
			if (!existing || entry.updatedAt > existing.updatedAt) {
				seen.set(entry.id, entry);
			}
		}

		let merged = [...seen.values()];
		if (filters?.limit) {
			merged.sort((a, b) => b.updatedAt - a.updatedAt);
			merged = merged.slice(0, filters.limit);
		}
		return merged;
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
		});
	}

	getDashboardContext(): DashboardContext {
		return {
			binding: this.binding,
			workflows: this.workflows,
			shardConfigs: this.shardConfigs,
		};
	}

	get router() {
		return dashboardRouter;
	}

	sseStream(workflowId: string): Response {
		return createSSEStream(this.binding, workflowId);
	}
}
