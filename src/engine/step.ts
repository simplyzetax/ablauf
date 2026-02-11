import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { eq } from "drizzle-orm";
import { stepsTable } from "../db/schema";
import { SleepInterrupt, WaitInterrupt } from "./interrupts";
import { StepRetryExhaustedError } from "./errors";
import { parseDuration } from "./duration";
import type { Step, StepDoOptions, StepWaitOptions, RetryConfig, WorkflowDefaults } from "./types";
import { DEFAULT_RETRY_CONFIG } from "./types";

export class StepContext<Events extends object = {}> implements Step<Events> {
	private defaults: WorkflowDefaults;

	constructor(
		private db: DrizzleSqliteDODatabase,
		defaults?: Partial<WorkflowDefaults>,
	) {
		this.defaults = {
			retries: { ...DEFAULT_RETRY_CONFIG, ...defaults?.retries },
		};
	}

	async do<T>(name: string, fn: () => Promise<T> | T, options?: StepDoOptions): Promise<T> {
		const [existing] = await this.db.select().from(stepsTable).where(eq(stepsTable.name, name));

		if (existing?.status === "completed") {
			return (existing.result ? JSON.parse(existing.result) : null) as T;
		}

		const retryConfig: RetryConfig = {
			...this.defaults.retries,
			...options?.retries,
		};

		const attempts = existing?.attempts ?? 0;

		// If step is pending retry and wakeAt hasn't passed yet, re-throw to keep sleeping
		if (existing?.status === "failed" && existing.wakeAt && existing.wakeAt > Date.now()) {
			throw new SleepInterrupt(name, existing.wakeAt);
		}

		try {
			const result = await fn();
			const serialized = JSON.stringify(result);

			if (existing) {
				await this.db
					.update(stepsTable)
					.set({
						status: "completed",
						result: serialized,
						attempts: attempts + 1,
						completedAt: Date.now(),
					})
					.where(eq(stepsTable.name, name));
			} else {
				await this.db.insert(stepsTable).values({
					name,
					type: "do",
					status: "completed",
					result: serialized,
					attempts: 1,
					completedAt: Date.now(),
				});
			}

			return result;
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			const newAttempts = attempts + 1;

			if (newAttempts >= retryConfig.limit) {
				if (existing) {
					await this.db
						.update(stepsTable)
						.set({ status: "failed", error: errorMsg, attempts: newAttempts, wakeAt: null })
						.where(eq(stepsTable.name, name));
				} else {
					await this.db.insert(stepsTable).values({
						name,
						type: "do",
						status: "failed",
						error: errorMsg,
						attempts: newAttempts,
					});
				}
				const cause = e instanceof Error ? e.message : String(e);
				throw new StepRetryExhaustedError(name, newAttempts, cause);
			}

			// Retries remaining: schedule retry via alarm instead of blocking
			const baseDelay = parseDuration(retryConfig.delay);
			const delay = this.calculateBackoff(baseDelay, newAttempts, retryConfig.backoff);
			const wakeAt = Date.now() + delay;

			if (existing) {
				await this.db
					.update(stepsTable)
					.set({ status: "failed", error: errorMsg, attempts: newAttempts, wakeAt })
					.where(eq(stepsTable.name, name));
			} else {
				await this.db.insert(stepsTable).values({
					name,
					type: "do",
					status: "failed",
					error: errorMsg,
					attempts: newAttempts,
					wakeAt,
				});
			}

			// Use alarm-based retry: throw SleepInterrupt so the DO sets an alarm
			throw new SleepInterrupt(name, wakeAt);
		}
	}

	async sleep(name: string, duration: string): Promise<void> {
		const [existing] = await this.db.select().from(stepsTable).where(eq(stepsTable.name, name));

		if (existing?.status === "completed") {
			return;
		}

		if (existing?.status === "sleeping") {
			throw new SleepInterrupt(name, existing.wakeAt!);
		}

		const wakeAt = Date.now() + parseDuration(duration);

		await this.db.insert(stepsTable).values({
			name,
			type: "sleep",
			status: "sleeping",
			wakeAt,
			attempts: 0,
		});

		throw new SleepInterrupt(name, wakeAt);
	}

	async waitForEvent<K extends Extract<keyof Events, string>>(
		name: K,
		options?: StepWaitOptions,
	): Promise<Events[K]> {
		const [existing] = await this.db.select().from(stepsTable).where(eq(stepsTable.name, name as string));

		if (existing?.status === "completed") {
			return (existing.result ? JSON.parse(existing.result) : null) as Events[K];
		}

		if (existing?.status === "failed") {
			throw new Error(existing.error ?? `Event "${name as string}" failed`);
		}

		if (existing?.status === "waiting") {
			throw new WaitInterrupt(name as string, existing.wakeAt);
		}

		const timeoutAt = options?.timeout ? Date.now() + parseDuration(options.timeout) : null;

		await this.db.insert(stepsTable).values({
			name: name as string,
			type: "wait_for_event",
			status: "waiting",
			wakeAt: timeoutAt,
			attempts: 0,
		});

		throw new WaitInterrupt(name as string, timeoutAt);
	}

	private calculateBackoff(baseDelay: number, attempt: number, strategy: string): number {
		switch (strategy) {
			case "exponential":
				return baseDelay * Math.pow(2, attempt - 1);
			case "linear":
				return baseDelay * attempt;
			case "fixed":
			default:
				return baseDelay;
		}
	}
}
