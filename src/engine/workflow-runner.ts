import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/migrations";
import { workflowTable, stepsTable, instancesTable } from "../db/schema";
import { registry } from "../workflows/registry";
import { StepContext } from "./step";
import { SleepInterrupt, WaitInterrupt, PauseInterrupt, isInterrupt } from "./interrupts";
import { eq, or } from "drizzle-orm";
import type { WorkflowStatus, WorkflowStatusResponse, StepInfo } from "./types";

export class WorkflowRunner extends DurableObject<Env> {
	private db: DrizzleSqliteDODatabase;
	private workflowType: string | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.db = drizzle(ctx.storage, { logger: false });
		ctx.blockConcurrencyWhile(async () => {
			migrate(this.db, migrations);
		});
	}

	// ─── Workflow RPC Methods ───

	async initialize(props: { type: string; id: string; payload: unknown }): Promise<void> {
		// Idempotency guard: if already initialized, return early
		const [existing] = await this.db.select().from(workflowTable);
		if (existing) {
			return;
		}

		const now = Date.now();
		this.workflowType = props.type;
		await this.db.insert(workflowTable).values({
			type: props.type,
			status: "running",
			payload: JSON.stringify(props.payload),
			createdAt: now,
			updatedAt: now,
		});
		await this.updateIndex(props.type, props.id, "running", now);
		await this.replay();
	}

	async getStatus(): Promise<WorkflowStatusResponse> {
		const [wf] = await this.db.select().from(workflowTable);
		if (!wf) {
			throw new Error("Workflow not initialized");
		}
		const stepRows = await this.db.select().from(stepsTable);
		const steps: StepInfo[] = stepRows.map((s) => ({
			name: s.name,
			type: s.type,
			status: s.status,
			attempts: s.attempts,
			result: s.result ? JSON.parse(s.result) : null,
			error: s.error,
			completedAt: s.completedAt,
		}));
		return {
			id: this.ctx.id.toString(),
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

	async deliverEvent(props: { event: string; payload: unknown }): Promise<void> {
		const [step] = await this.db
			.select()
			.from(stepsTable)
			.where(eq(stepsTable.name, props.event));

		if (!step || step.status !== "waiting") {
			throw new Error(`No waiting step found for event "${props.event}"`);
		}

		await this.db
			.update(stepsTable)
			.set({
				status: "completed",
				result: JSON.stringify(props.payload),
				completedAt: Date.now(),
			})
			.where(eq(stepsTable.name, props.event));

		await this.scheduleNextAlarm();
		await this.setStatus("running");
		await this.replay();
	}

	async pause(): Promise<void> {
		await this.db.update(workflowTable).set({ paused: 1, updatedAt: Date.now() });
		await this.setStatus("paused");
	}

	async resume(): Promise<void> {
		await this.db.update(workflowTable).set({ paused: 0, updatedAt: Date.now() });
		await this.setStatus("running");
		await this.replay();
	}

	async terminate(): Promise<void> {
		await this.ctx.storage.deleteAlarm();
		await this.setStatus("terminated");
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
							error: `Event "${step.name}" timed out`,
							completedAt: now,
						})
						.where(eq(stepsTable.name, step.name));
				}
			}
		}

		// Schedule next alarm for any remaining pending steps
		await this.scheduleNextAlarm();
		await this.setStatus("running");
		await this.replay();
	}

	// ─── Internal ───

	private async replay(): Promise<void> {
		const [wf] = await this.db.select().from(workflowTable);
		if (!wf) return;

		this.workflowType = wf.type;

		const WorkflowClass = registry[wf.type];
		if (!WorkflowClass) {
			await this.setStatus("errored");
			await this.db.update(workflowTable).set({ error: `Unknown workflow type: "${wf.type}"` });
			return;
		}

		const instance = new WorkflowClass();
		const stepCtx = new StepContext(this.db, WorkflowClass.defaults);

		if (wf.paused) {
			await this.setStatus("paused");
			return;
		}

		const payload = wf.payload ? JSON.parse(wf.payload) : null;

		try {
			const result = await instance.run(stepCtx, payload);
			await this.db.update(workflowTable).set({
				status: "completed",
				result: JSON.stringify(result),
				updatedAt: Date.now(),
			});
			await this.updateIndex(wf.type, this.ctx.id.toString(), "completed", Date.now());
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
				const errorMsg = e instanceof Error ? e.message : String(e);
				await this.db.update(workflowTable).set({
					status: "errored",
					error: errorMsg,
					updatedAt: Date.now(),
				});
				await this.updateIndex(wf.type, this.ctx.id.toString(), "errored", Date.now());
			}
		}
	}

	private async scheduleNextAlarm(): Promise<void> {
		await this.ctx.storage.deleteAlarm();

		// Include failed steps with wakeAt (pending retries)
		const pendingSteps = await this.db
			.select()
			.from(stepsTable)
			.where(or(eq(stepsTable.status, "sleeping"), eq(stepsTable.status, "waiting"), eq(stepsTable.status, "failed")));

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

		const type = this.workflowType ?? (await this.db.select().from(workflowTable)).at(0)?.type;
		if (type) {
			this.workflowType = type;
			await this.updateIndex(type, this.ctx.id.toString(), status, now);
		}
	}

	private async updateIndex(type: string, id: string, status: string, now: number): Promise<void> {
		try {
			const indexId = this.env.WORKFLOW_RUNNER.idFromName(`__index:${type}`);
			const indexStub = this.env.WORKFLOW_RUNNER.get(indexId);
			await indexStub.indexWrite({ id, status, createdAt: now, updatedAt: now });
		} catch {
			// Index update is best-effort
		}
	}
}
