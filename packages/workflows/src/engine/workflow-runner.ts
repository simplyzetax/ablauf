import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/migrations";
import { workflowTable, stepsTable, instancesTable } from "../db/schema";
import { StepContext } from "./step";
import { SleepInterrupt, WaitInterrupt, PauseInterrupt, isInterrupt } from "./interrupts";
import { SSEContext, NoOpSSEContext } from "./sse";
import {
	WorkflowNotFoundError,
	WorkflowTypeUnknownError,
	PayloadValidationError,
	EventValidationError,
	EventTimeoutError,
	WorkflowNotRunningError,
	WorkflowError,
	extractZodIssues,
} from "../errors";
import { eq, or } from "drizzle-orm";
import { shardIndex } from "./shard";
import type {
	WorkflowStatus,
	WorkflowStatusResponse,
	StepInfo,
	WorkflowRunnerStub,
	WorkflowRunnerEventProps,
	WorkflowRunnerInitProps,
	WorkflowClass,
	WorkflowShardConfig,
} from "./types";

export type WorkflowRegistration = WorkflowClass | [WorkflowClass, WorkflowShardConfig];

export interface CreateWorkflowRunnerConfig {
	workflows: WorkflowRegistration[];
	binding?: string;
}

export function createWorkflowRunner(config: CreateWorkflowRunnerConfig) {
	const bindingName = config.binding ?? "WORKFLOW_RUNNER";

	const registry: Record<string, WorkflowClass> = {};
	const shardConfigs: Record<string, WorkflowShardConfig> = {};
	for (const entry of config.workflows) {
		const [wf, shardConfig] = Array.isArray(entry) ? entry : [entry, {}];
		registry[wf.type] = wf;
		shardConfigs[wf.type] = shardConfig;
	}

	return class WorkflowRunner extends DurableObject<Record<string, unknown>> {
		private db: DrizzleSqliteDODatabase;
		private workflowType: string | null = null;
		private workflowId: string | null = null;
		private sseCtx: SSEContext<unknown> | null = null;

		constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
			super(ctx, env);
			this.db = drizzle(ctx.storage, { logger: false });
			ctx.blockConcurrencyWhile(async () => {
				migrate(this.db, migrations);
			});
		}

		private getBinding(): DurableObjectNamespace {
			return this.env[bindingName] as DurableObjectNamespace;
		}

		// ─── Workflow RPC Methods ───

		async initialize(props: WorkflowRunnerInitProps): Promise<void> {
			const [existing] = await this.db.select().from(workflowTable);
			if (existing) {
				return;
			}

			const now = Date.now();
			this.workflowType = props.type;
			this.workflowId = props.id;
			await this.db.insert(workflowTable).values({
				workflowId: props.id,
				type: props.type,
				status: "running",
				payload: JSON.stringify(props.payload),
				createdAt: now,
				updatedAt: now,
			});
			this.updateIndex(props.type, props.id, "running", now);
			await this.replay();
		}

		async getStatus(): Promise<WorkflowStatusResponse> {
			const [wf] = await this.db.select().from(workflowTable);
			if (!wf) {
				throw new WorkflowNotFoundError(this.workflowId ?? "unknown");
			}
			const stepRows = await this.db.select().from(stepsTable);
			const steps = stepRows.map<StepInfo>((s) => ({
				name: s.name,
				type: s.type,
				status: s.status,
				attempts: s.attempts,
				result: s.result ? JSON.parse(s.result) : null,
				error: s.error,
				completedAt: s.completedAt,
			}));
			return {
				id: wf.workflowId,
				type: wf.type,
				status: wf.status as WorkflowStatus,
				payload: wf.payload ? JSON.parse(wf.payload) : null,
				result: wf.result ? JSON.parse(wf.result) : null,
				error: wf.error,
				steps,
				createdAt: wf.createdAt,
				updatedAt: wf.updatedAt,
			};
		}

		async deliverEvent(props: WorkflowRunnerEventProps): Promise<void> {
			try {
				await this._deliverEventInner(props);
			} catch (e) {
				if (e instanceof WorkflowError) {
					throw new Error(JSON.stringify(e.toJSON()));
				}
				throw e;
			}
		}

		private async _deliverEventInner(props: WorkflowRunnerEventProps): Promise<void> {
			const [wf] = await this.db.select().from(workflowTable);
			if (!wf) {
				throw new WorkflowNotFoundError(this.workflowId ?? "unknown");
			}

			const WorkflowCls = registry[wf.type];
			if (!WorkflowCls) {
				throw new WorkflowTypeUnknownError(wf.type);
			}

			const schema = WorkflowCls.events?.[props.event];
			if (!schema) {
				throw new EventValidationError(props.event, [
					{ message: `Unknown event "${props.event}" for workflow type "${wf.type}"` },
				]);
			}
			let payload: unknown;
			try {
				payload = schema.parse(props.payload);
			} catch (e) {
				const issues = extractZodIssues(e);
				throw new EventValidationError(props.event, issues);
			}

			const [step] = await this.db.select().from(stepsTable).where(eq(stepsTable.name, props.event));

			if (!step || step.status !== "waiting") {
				throw new WorkflowNotRunningError(wf.workflowId, step ? step.status : "no matching step");
			}

			await this.db
				.update(stepsTable)
				.set({
					status: "completed",
					result: JSON.stringify(payload),
					completedAt: Date.now(),
				})
				.where(eq(stepsTable.name, props.event));

			await this.scheduleNextAlarm();
			await this.setStatus("running");
			await this.replay();
		}

		async pause(): Promise<void> {
			await this.db.update(workflowTable).set({ paused: true, updatedAt: Date.now() });
			await this.setStatus("paused");
		}

		async resume(): Promise<void> {
			await this.db.update(workflowTable).set({ paused: false, updatedAt: Date.now() });
			await this.setStatus("running");
			await this.replay();
		}

		async terminate(): Promise<void> {
			await this.ctx.storage.deleteAlarm();
			await this.setStatus("terminated");
		}

		async connectSSE(): Promise<ReadableStream> {
			const [wf] = await this.db.select().from(workflowTable);
			if (!wf) {
				throw new WorkflowNotFoundError(this.workflowId ?? "unknown");
			}

			const WorkflowCls = registry[wf.type];
			const sseSchema = WorkflowCls?.sseUpdates ?? null;

			if (!this.sseCtx) {
				this.sseCtx = new SSEContext(this.db, sseSchema, true);
			}

			const { readable, writable } = new TransformStream();
			const writer = writable.getWriter();

			// Flush persisted emit messages to the new client
			await this.sseCtx.flushPersistedMessages(writer);

			// Register for live updates
			this.sseCtx.addWriter(writer);

			return readable;
		}

		// ─── Index Shard RPC Methods ───

		async indexWrite(props: { id: string; status: string; createdAt: number; updatedAt: number }): Promise<void> {
			await this.db
				.insert(instancesTable)
				.values(props)
				.onConflictDoUpdate({
					target: instancesTable.id,
					set: { status: props.status, updatedAt: props.updatedAt },
				});
		}

		async indexList(
			filters?: { status?: string; limit?: number },
		): Promise<Array<typeof instancesTable.$inferSelect>> {
			let query = this.db.select().from(instancesTable);
			if (filters?.status) {
				query = query.where(eq(instancesTable.status, filters.status)) as typeof query;
			}
			if (filters?.limit) {
				query = query.limit(filters.limit) as typeof query;
			}
			return query;
		}

		// ─── DO Alarm Handler ───

		async alarm(): Promise<void> {
			const pendingSteps = await this.db
				.select()
				.from(stepsTable)
				.where(or(eq(stepsTable.status, "sleeping"), eq(stepsTable.status, "waiting")));

			const now = Date.now();

			for (const step of pendingSteps) {
				if (step.wakeAt && step.wakeAt <= now) {
					if (step.status === "sleeping") {
						await this.db
							.update(stepsTable)
							.set({ status: "completed", completedAt: now })
							.where(eq(stepsTable.name, step.name));
					} else if (step.status === "waiting") {
						await this.db
							.update(stepsTable)
							.set({
								status: "failed",
								error: JSON.stringify(new EventTimeoutError(step.name).toJSON()),
								completedAt: now,
							})
							.where(eq(stepsTable.name, step.name));
					}
				}
			}

			await this.scheduleNextAlarm();
			await this.setStatus("running");
			await this.replay();
		}

		// ─── Test Helpers ───

		async _expireTimers(): Promise<void> {
			await this.db
				.update(stepsTable)
				.set({ wakeAt: 1 })
				.where(
					or(eq(stepsTable.status, "sleeping"), eq(stepsTable.status, "waiting"), eq(stepsTable.status, "failed")),
				);
		}

		// ─── Internal ───

		private async replay(): Promise<void> {
			const [wf] = await this.db.select().from(workflowTable);
			if (!wf) return;

			this.workflowType = wf.type;
			this.workflowId = wf.workflowId;

			const WorkflowCls = registry[wf.type];
			if (!WorkflowCls) {
				await this.setStatus("errored");
				await this.db.update(workflowTable).set({ error: `Unknown workflow type: "${wf.type}"` });
				return;
			}

			const instance = new WorkflowCls();
			const stepCtx = new StepContext(this.db, WorkflowCls.defaults);

			// Create SSE context
			const sseSchema = WorkflowCls.sseUpdates ?? null;
			if (!this.sseCtx) {
				this.sseCtx = new SSEContext(this.db, sseSchema, true);
			}
			// Start in replay mode - will be switched off after last completed step
			this.sseCtx.setReplay(true);

			stepCtx.onFirstExecution = () => {
				this.sseCtx?.setReplay(false);
			};

			if (wf.paused) {
				await this.setStatus("paused");
				return;
			}

			try {
				let payload: unknown;
				try {
					payload = WorkflowCls.inputSchema.parse(wf.payload ? JSON.parse(wf.payload) : undefined);
				} catch (e) {
					const issues = extractZodIssues(e);
					throw new PayloadValidationError("Invalid workflow input", issues);
				}
				const sseArg = this.sseCtx ?? new NoOpSSEContext();
				const result = await instance.run(stepCtx, payload, sseArg);
				await this.db.update(workflowTable).set({
					status: "completed",
					result: JSON.stringify(result),
					updatedAt: Date.now(),
				});
				this.updateIndex(wf.type, wf.workflowId, "completed", Date.now());
			} catch (e) {
				if (e instanceof SleepInterrupt) {
					await this.ctx.storage.setAlarm(e.wakeAt);
					await this.setStatus("sleeping");
				} else if (e instanceof WaitInterrupt) {
					if (e.timeoutAt) {
						await this.ctx.storage.setAlarm(e.timeoutAt);
					}
					await this.setStatus("waiting");
				} else if (e instanceof PauseInterrupt) {
					await this.setStatus("paused");
				} else if (!isInterrupt(e)) {
					const errorMsg =
						e instanceof WorkflowError
							? JSON.stringify(e.toJSON())
							: e instanceof Error
								? e.message
								: String(e);
					await this.db.update(workflowTable).set({
						status: "errored",
						error: errorMsg,
						updatedAt: Date.now(),
					});
					this.updateIndex(wf.type, wf.workflowId, "errored", Date.now());
				}
			}
		}

		private async scheduleNextAlarm(): Promise<void> {
			await this.ctx.storage.deleteAlarm();

			const pendingSteps = await this.db
				.select()
				.from(stepsTable)
				.where(
					or(eq(stepsTable.status, "sleeping"), eq(stepsTable.status, "waiting"), eq(stepsTable.status, "failed")),
				);

			let earliest: number | null = null;
			for (const step of pendingSteps) {
				if (step.wakeAt && (earliest === null || step.wakeAt < earliest)) {
					earliest = step.wakeAt;
				}
			}

			if (earliest !== null) {
				await this.ctx.storage.setAlarm(earliest);
			}
		}

		private async setStatus(status: WorkflowStatus): Promise<void> {
			const now = Date.now();
			await this.db.update(workflowTable).set({ status, updatedAt: now });

			const type = this.workflowType;
			const id = this.workflowId;
			if (type && id) {
				this.updateIndex(type, id, status, now);
			} else {
				const [wf] = await this.db.select().from(workflowTable);
				if (wf) {
					this.workflowType = wf.type;
					this.workflowId = wf.workflowId;
					this.updateIndex(wf.type, wf.workflowId, status, now);
				}
			}
		}

		private updateIndex(type: string, id: string, status: string, now: number): void {
			try {
				const binding = this.getBinding();
				const shards = shardConfigs[type]?.shards ?? 1;
				const shard = shardIndex(id, shards);
				const indexId = binding.idFromName(`__index:${type}:${shard}`);
				const indexStub = binding.get(indexId) as unknown as WorkflowRunnerStub;
				this.ctx.waitUntil(indexStub.indexWrite({ id, status, createdAt: now, updatedAt: now }));
			} catch {
				// Index update is best-effort
			}
		}
	};
}
