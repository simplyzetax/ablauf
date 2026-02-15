import { DurableObject } from 'cloudflare:workers';
import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import migrations from '../../drizzle/migrations';
import { workflowTable, stepsTable, instancesTable, eventBufferTable } from '../db/schema';
import { StepContext } from './step';
import { SleepInterrupt, WaitInterrupt, PauseInterrupt, isInterrupt } from './interrupts';
import { LiveContext, NoOpSSEContext } from './sse';
import {
	WorkflowNotFoundError,
	WorkflowTypeUnknownError,
	PayloadValidationError,
	EventValidationError,
	EventTimeoutError,
	WorkflowNotRunningError,
	WorkflowError,
	extractZodIssues,
} from '../errors';
import { eq, or } from 'drizzle-orm';
import { shardIndex } from './shard';
import superjson from 'superjson';
import type {
	WorkflowStatus,
	WorkflowStatusResponse,
	StepInfo,
	WorkflowRunnerStub,
	WorkflowRunnerEventProps,
	WorkflowRunnerInitProps,
	WorkflowClass,
	WorkflowShardConfig,
} from './types';

/**
 * A workflow class, or a `[WorkflowClass, ShardConfig]` tuple for workflows
 * that need custom index shard counts.
 */
export type WorkflowRegistration = WorkflowClass | [WorkflowClass, WorkflowShardConfig];

/** Configuration for the {@link createWorkflowRunner} factory function. */
export interface CreateWorkflowRunnerConfig {
	/** Workflow classes (or `[WorkflowClass, ShardConfig]` tuples) to register. */
	workflows: WorkflowRegistration[];
	/** Name of the Durable Object binding in the worker's `env`. Defaults to `"WORKFLOW_RUNNER"`. */
	binding?: string;
	/** Whether observability (index sharding and listing) is enabled. Defaults to `true`. */
	observability?: boolean;
}

/**
 * Factory function that creates a configured `WorkflowRunner` Durable Object class.
 *
 * The returned class extends `DurableObject` and implements the full workflow
 * lifecycle: initialization, replay-based execution, event delivery, pause/resume,
 * terminate, SSE streaming, and index shard management.
 *
 * @param config - Configuration specifying workflows, binding name, and observability.
 * @returns A `DurableObject` subclass to export from your worker entry point.
 *
 * @example
 * ```ts
 * export const WorkflowRunner = createWorkflowRunner({
 *   workflows: [OrderWorkflow, [HighVolumeWorkflow, { shards: 8 }]],
 *   observability: true,
 * });
 * ```
 */
export function createWorkflowRunner(config: CreateWorkflowRunnerConfig) {
	const bindingName = config.binding ?? 'WORKFLOW_RUNNER';
	const observability = config.observability ?? true;

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
		private liveCtx: LiveContext<Record<string, unknown>> | null = null;

		constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
			super(ctx, env);
			this.db = drizzle(ctx.storage, { logger: false });
			ctx.blockConcurrencyWhile(async () => {
				await migrate(this.db, migrations);
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
				status: 'running',
				payload: superjson.stringify(props.payload),
				createdAt: now,
				updatedAt: now,
			});
			this.updateIndex(props.type, props.id, 'running', now);
			// Safety alarm: if replay() causes OOM and kills the isolate, this
			// durably-stored alarm fires and the alarm handler triggers crash
			// recovery via the write-ahead mechanism in step.do().
			await this.ctx.storage.setAlarm(Date.now() + 1000);
			await this.replay();
		}

		async getStatus(): Promise<WorkflowStatusResponse> {
			try {
				const [wf] = await this.db.select().from(workflowTable);
				if (!wf) {
					throw new WorkflowNotFoundError(this.workflowId ?? 'unknown');
				}
				const stepRows = await this.db.select().from(stepsTable);
				const steps = stepRows.map<StepInfo>((s) => ({
					name: s.name,
					type: s.type,
					status: s.status,
					attempts: s.attempts,
					result: s.result ? superjson.parse(s.result) : null,
					error: s.error,
					completedAt: s.completedAt,
					startedAt: s.startedAt ?? null,
					duration: s.duration ?? null,
					errorStack: s.errorStack ?? null,
					retryHistory: s.retryHistory ? JSON.parse(s.retryHistory) : null,
				}));
				return {
					id: wf.workflowId,
					type: wf.type,
					status: wf.status as WorkflowStatus,
					payload: wf.payload ? superjson.parse(wf.payload) : null,
					result: wf.result ? superjson.parse(wf.result) : null,
					error: wf.error,
					steps,
					createdAt: wf.createdAt,
					updatedAt: wf.updatedAt,
				};
			} catch (e) {
				if (e instanceof WorkflowError) {
					throw new Error(JSON.stringify(e.toJSON()));
				}
				throw e;
			}
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
				throw new WorkflowNotFoundError(this.workflowId ?? 'unknown');
			}

			const WorkflowCls = registry[wf.type];
			if (!WorkflowCls) {
				throw new WorkflowTypeUnknownError(wf.type);
			}

			const schema = WorkflowCls.events?.[props.event];
			if (!schema) {
				throw new EventValidationError(props.event, [{ message: `Unknown event "${props.event}" for workflow type "${wf.type}"` }]);
			}
			let payload: unknown;
			try {
				payload = schema.parse(props.payload);
			} catch (e) {
				const issues = extractZodIssues(e);
				throw new EventValidationError(props.event, issues);
			}

			const [step] = await this.db.select().from(stepsTable).where(eq(stepsTable.name, props.event));

			if (step?.status === 'waiting') {
				// Direct delivery: step is actively waiting for this event
				await this.db
					.update(stepsTable)
					.set({
						status: 'completed',
						result: superjson.stringify(payload),
						completedAt: Date.now(),
					})
					.where(eq(stepsTable.name, props.event));

				await this.scheduleNextAlarm();
				await this.setStatus('running');
				// Safety alarm: ensures crash recovery if OOM kills the isolate during replay
				await this.ctx.storage.setAlarm(Date.now() + 1000);
				await this.replay();
				return;
			}

			// No waiting step — buffer the event if workflow is in a non-terminal state
			const terminalStatuses = ['completed', 'errored', 'terminated'];
			if (terminalStatuses.includes(wf.status)) {
				throw new WorkflowNotRunningError(wf.workflowId, wf.status);
			}

			// Upsert: last-write-wins semantics
			await this.db
				.insert(eventBufferTable)
				.values({
					eventName: props.event,
					payload: superjson.stringify(payload),
					receivedAt: Date.now(),
				})
				.onConflictDoUpdate({
					target: eventBufferTable.eventName,
					set: {
						payload: superjson.stringify(payload),
						receivedAt: Date.now(),
					},
				});
		}

		async pause(): Promise<void> {
			await this.db.update(workflowTable).set({ paused: true, updatedAt: Date.now() });
			await this.setStatus('paused');
		}

		async resume(): Promise<void> {
			await this.db.update(workflowTable).set({ paused: false, updatedAt: Date.now() });
			await this.setStatus('running');
			// Safety alarm: ensures crash recovery if OOM kills the isolate during replay
			await this.ctx.storage.setAlarm(Date.now() + 1000);
			await this.replay();
		}

		async terminate(): Promise<void> {
			await this.ctx.storage.deleteAlarm();
			// Clean up any unconsumed buffered events
			await this.db.delete(eventBufferTable);
			await this.setStatus('terminated');
		}

		async fetch(request: Request): Promise<Response> {
			if (request.headers.get('Upgrade') !== 'websocket') {
				return new Response('Expected WebSocket', { status: 426 });
			}

			const [wf] = await this.db.select().from(workflowTable);
			if (!wf) {
				return new Response('Workflow not found', { status: 404 });
			}

			const WorkflowCls = registry[wf.type];
			const sseSchemas = WorkflowCls?.sseUpdates ?? null;

			if (!sseSchemas) {
				// No SSE schema — reject with close code
				const pair = new WebSocketPair();
				this.ctx.acceptWebSocket(pair[1]);
				pair[1].close(1008, 'Workflow does not define sseUpdates');
				return new Response(null, { status: 101, webSocket: pair[0] });
			}

			const pair = new WebSocketPair();
			this.ctx.acceptWebSocket(pair[1]);

			// Ensure LiveContext exists
			if (!this.liveCtx) {
				this.liveCtx = new LiveContext(this.ctx, this.db, sseSchemas, true);
			}

			// Flush persisted emit messages to the new client
			await this.liveCtx.flushPersistedMessages(pair[1]);

			return new Response(null, { status: 101, webSocket: pair[0] });
		}

		async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
			// Future: handle client→server messages (pause, resume, cancel)
		}

		async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
			// 1005 ("No Status Received") is a reserved code that must not be sent on the wire.
			const safeCode = code === 1005 ? 1000 : code;
			ws.close(safeCode, reason || 'Client disconnected');
		}

		async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
			_ws.close(1011, 'Unexpected error');
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

		async indexList(filters?: { status?: string; limit?: number }): Promise<Array<typeof instancesTable.$inferSelect>> {
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
			// Guard: skip replay for workflows already in a terminal state.
			// Safety alarms (set before replay in RPC methods) may fire after
			// the workflow has already completed — bail early to avoid re-running.
			const [wf] = await this.db.select().from(workflowTable);
			if (!wf || wf.status === 'completed' || wf.status === 'errored' || wf.status === 'terminated') {
				return;
			}

			const pendingSteps = await this.db
				.select()
				.from(stepsTable)
				.where(or(eq(stepsTable.status, 'sleeping'), eq(stepsTable.status, 'waiting')));

			const now = Date.now();

			for (const step of pendingSteps) {
				if (step.wakeAt && step.wakeAt <= now) {
					if (step.status === 'sleeping') {
						await this.db.update(stepsTable).set({ status: 'completed', completedAt: now }).where(eq(stepsTable.name, step.name));
					} else if (step.status === 'waiting') {
						await this.db
							.update(stepsTable)
							.set({
								status: 'failed',
								error: JSON.stringify(new EventTimeoutError(step.name).toJSON()),
								completedAt: now,
							})
							.where(eq(stepsTable.name, step.name));
					}
				}
			}

			await this.scheduleNextAlarm();
			await this.setStatus('running');
			await this.replay();
		}

		// ─── Test Helpers ───

		async _expireTimers(): Promise<void> {
			await this.db
				.update(stepsTable)
				.set({ wakeAt: 1 })
				.where(or(eq(stepsTable.status, 'sleeping'), eq(stepsTable.status, 'waiting'), eq(stepsTable.status, 'failed')));
		}

		/** Simulate an OOM crash by leaving a step in 'running' state (as the write-ahead would). */
		async _simulateOOMCrash(stepName: string, attempts: number = 1): Promise<void> {
			const [existing] = await this.db.select().from(stepsTable).where(eq(stepsTable.name, stepName));
			if (existing) {
				await this.db.update(stepsTable).set({ status: 'running', attempts }).where(eq(stepsTable.name, stepName));
			} else {
				await this.db.insert(stepsTable).values({
					name: stepName,
					type: 'do',
					status: 'running',
					attempts,
					startedAt: Date.now(),
				});
			}
		}

		// ─── Internal ───

		private async replay(): Promise<void> {
			const [wf] = await this.db.select().from(workflowTable);
			if (!wf) return;

			this.workflowType = wf.type;
			this.workflowId = wf.workflowId;

			const WorkflowCls = registry[wf.type];
			if (!WorkflowCls) {
				await this.setStatus('errored');
				await this.db.update(workflowTable).set({ error: `Unknown workflow type: "${wf.type}"` });
				return;
			}

			const instance = new WorkflowCls();
			const stepCtx = new StepContext(this.db, WorkflowCls.defaults);

			const sseSchemas = WorkflowCls.sseUpdates ?? null;
			if (sseSchemas) {
				if (!this.liveCtx) {
					this.liveCtx = new LiveContext(this.ctx, this.db, sseSchemas, true);
				}
				this.liveCtx.setReplay(true);
				stepCtx.onFirstExecution = () => {
					this.liveCtx?.setReplay(false);
				};
			} else {
				this.liveCtx = null;
			}

			if (wf.paused) {
				await this.setStatus('paused');
				return;
			}

			try {
				let payload: unknown;
				try {
					payload = WorkflowCls.inputSchema.parse(wf.payload ? superjson.parse(wf.payload) : undefined);
				} catch (e) {
					const issues = extractZodIssues(e);
					throw new PayloadValidationError('Invalid workflow input', issues);
				}
				const sseArg = this.liveCtx ?? new NoOpSSEContext();
				const result = await instance.run(stepCtx, payload, sseArg);
				await this.db.update(workflowTable).set({
					status: 'completed',
					result: superjson.stringify(result),
					updatedAt: Date.now(),
				});
				this.updateIndex(wf.type, wf.workflowId, 'completed', Date.now());
				// Clean up any unconsumed buffered events
				await this.db.delete(eventBufferTable);
				this.liveCtx?.close();
			} catch (e) {
				if (e instanceof SleepInterrupt) {
					await this.ctx.storage.setAlarm(e.wakeAt);
					await this.setStatus('sleeping');
				} else if (e instanceof WaitInterrupt) {
					if (e.timeoutAt) {
						await this.ctx.storage.setAlarm(e.timeoutAt);
					}
					await this.setStatus('waiting');
				} else if (e instanceof PauseInterrupt) {
					await this.setStatus('paused');
				} else if (!isInterrupt(e)) {
					const errorMsg = e instanceof WorkflowError ? JSON.stringify(e.toJSON()) : e instanceof Error ? e.message : String(e);
					await this.db.update(workflowTable).set({
						status: 'errored',
						error: errorMsg,
						updatedAt: Date.now(),
					});
					this.updateIndex(wf.type, wf.workflowId, 'errored', Date.now());
					// Clean up any unconsumed buffered events
					await this.db.delete(eventBufferTable);
					this.liveCtx?.close();
				}
			}
		}

		private async scheduleNextAlarm(): Promise<void> {
			await this.ctx.storage.deleteAlarm();

			const pendingSteps = await this.db
				.select()
				.from(stepsTable)
				.where(or(eq(stepsTable.status, 'sleeping'), eq(stepsTable.status, 'waiting'), eq(stepsTable.status, 'failed')));

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

			if (status === 'completed' || status === 'errored' || status === 'terminated') {
				this.liveCtx?.close();
			}
		}

		private updateIndex(type: string, id: string, status: string, now: number): void {
			if (!observability) return;
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
