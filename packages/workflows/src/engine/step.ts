import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { eq, sql } from 'drizzle-orm';
import { stepsTable, eventBufferTable } from '../db/schema';
import { SleepInterrupt, WaitInterrupt } from './interrupts';
import {
	StepRetryExhaustedError,
	DuplicateStepError,
	WorkflowError,
	NonRetriableError,
	StepFailedError,
	InvalidDateError,
} from '../errors';
import { parseDuration } from './duration';
import { parseSize } from './size';
import type { Step, StepDoOptions, StepWaitOptions, RetryConfig, WorkflowDefaults, ResultSizeLimitConfig } from './types';
import { DEFAULT_RETRY_CONFIG, DEFAULT_RESULT_SIZE_LIMIT } from './types';
import type { StepObserver } from './observability';
import superjson from 'superjson';

/**
 * Concrete implementation of the {@link Step} interface backed by SQLite.
 *
 * Each step's result is persisted via Drizzle ORM. On replay, completed steps
 * return their cached results instead of re-executing, enabling durable
 * execution across Durable Object wake-ups.
 *
 * @typeParam Events - Map of event names to payload types this workflow can receive.
 */
export class StepContext<Events extends object = {}> implements Step<Events> {
	private defaults: WorkflowDefaults;
	private resultSizeLimitBytes: number;
	private resultSizeLimitConfig: ResultSizeLimitConfig;
	/**
	 * Callback invoked when the first non-cached step executes.
	 * Used by the workflow runner to switch SSE from replay mode to live mode.
	 */
	public onFirstExecution: (() => void) | null = null;
	private hasExecuted = false;
	private usedNames = new Set<string>();

	/**
	 * @param db - Drizzle ORM database instance backed by Durable Object SQLite storage.
	 * @param defaults - Optional workflow-level defaults for retry and result size limits.
	 * @param observer - Optional observer for emitting step lifecycle events to the observability provider.
	 */
	constructor(
		private db: DrizzleSqliteDODatabase,
		defaults?: Partial<WorkflowDefaults>,
		private observer?: StepObserver,
	) {
		const resolvedSizeLimit: ResultSizeLimitConfig = { ...DEFAULT_RESULT_SIZE_LIMIT, ...defaults?.resultSizeLimit };
		this.defaults = {
			retries: { ...DEFAULT_RETRY_CONFIG, ...defaults?.retries },
			resultSizeLimit: resolvedSizeLimit,
		};
		this.resultSizeLimitConfig = resolvedSizeLimit;
		this.resultSizeLimitBytes = parseSize(resolvedSizeLimit.maxSize);
	}

	private checkDuplicateName(name: string, method: string): void {
		if (this.usedNames.has(name)) {
			throw new DuplicateStepError(name, method);
		}
		this.usedNames.add(name);
	}

	async do<T>(name: string, fn: () => Promise<T> | T, options?: StepDoOptions): Promise<T> {
		this.checkDuplicateName(name, 'step.do');
		const [existing] = await this.db.select().from(stepsTable).where(eq(stepsTable.name, name));

		if (existing?.status === 'completed') {
			return (existing.result ? superjson.parse(existing.result) : null) as T;
		}

		const retryConfig: RetryConfig = {
			...this.defaults.retries,
			...options?.retries,
		};

		const attempts = existing?.attempts ?? 0;

		// If step is pending retry and wakeAt hasn't passed yet, re-throw to keep sleeping
		if (existing?.status === 'failed' && existing.wakeAt && existing.wakeAt > Date.now()) {
			throw new SleepInterrupt(name, existing.wakeAt);
		}

		// Crash recovery: step was executing when isolate died (OOM or unrecoverable crash).
		// The write-ahead below sets status='running' before fn() executes. If the isolate
		// is killed mid-execution, this status persists in SQLite. On the next replay we
		// detect it here and feed the crash into the normal retry mechanism.
		if (existing?.status === 'running') {
			const crashedAttempts = existing.attempts;
			const errorMsg =
				'Step crashed — Loss of isolate (possible OOM). See: https://developers.cloudflare.com/workers/observability/errors/#durable-objects';

			const existingHistory: Array<{ attempt: number; error: string; errorStack: string | null; timestamp: number; duration: number }> =
				existing.retryHistory ? JSON.parse(existing.retryHistory) : [];
			const crashDuration = existing.startedAt ? Date.now() - existing.startedAt : 0;
			const updatedHistory = [
				...existingHistory,
				{
					attempt: crashedAttempts,
					error: errorMsg,
					errorStack: null,
					timestamp: existing.startedAt ?? Date.now(),
					duration: crashDuration,
				},
			];
			const retryHistorySerialized = JSON.stringify(updatedHistory);

			if (crashedAttempts >= retryConfig.limit) {
				await this.db
					.update(stepsTable)
					.set({
						status: 'failed',
						error: errorMsg,
						wakeAt: null,
						errorStack: null,
						retryHistory: retryHistorySerialized,
					})
					.where(eq(stepsTable.name, name));
				throw new StepRetryExhaustedError(name, crashedAttempts, errorMsg);
			}

			const baseDelay = parseDuration(retryConfig.delay);
			const delay = this.calculateBackoff(baseDelay, crashedAttempts, retryConfig.backoff);
			const wakeAt = Date.now() + delay;

			await this.db
				.update(stepsTable)
				.set({
					status: 'failed',
					error: errorMsg,
					wakeAt,
					errorStack: null,
					retryHistory: retryHistorySerialized,
				})
				.where(eq(stepsTable.name, name));

			this.observer?.onStepRetry(name, crashedAttempts, errorMsg, undefined, wakeAt, Date.now());
			throw new SleepInterrupt(name, wakeAt);
		}

		const startedAt = Date.now();
		const newAttempts = attempts + 1;

		// Write-ahead: mark step as 'running' before execution so that if the isolate
		// is killed (OOM), the next replay can detect the crash and handle retries.
		if (existing) {
			await this.db.update(stepsTable).set({ status: 'running', attempts: newAttempts, startedAt }).where(eq(stepsTable.name, name));
		} else {
			await this.db.insert(stepsTable).values({
				name,
				type: 'do',
				status: 'running',
				attempts: newAttempts,
				startedAt,
			});
		}

		try {
			if (!this.hasExecuted) {
				this.hasExecuted = true;
				this.onFirstExecution?.();
			}
			this.observer?.onStepStart(name, 'do', startedAt);
			const result = await fn();
			const serialized = superjson.stringify(result);
			await this.checkResultSizeLimit(name, serialized);
			const duration = Date.now() - startedAt;

			await this.db
				.update(stepsTable)
				.set({
					status: 'completed',
					result: serialized,
					attempts: newAttempts,
					completedAt: Date.now(),
					startedAt,
					duration,
				})
				.where(eq(stepsTable.name, name));

			this.observer?.onStepComplete(name, 'do', result, duration, Date.now());
			return result;
		} catch (e) {
			// Non-retriable errors bypass retry logic entirely
			if (e instanceof NonRetriableError) {
				const duration = Date.now() - startedAt;
				const existingHistory: Array<{ attempt: number; error: string; errorStack: string | null; timestamp: number; duration: number }> =
					existing?.retryHistory ? JSON.parse(existing.retryHistory) : [];
				const updatedHistory = [
					...existingHistory,
					{ attempt: newAttempts, error: e.message, errorStack: e.stack ?? null, timestamp: startedAt, duration },
				];

				await this.db
					.update(stepsTable)
					.set({
						status: 'failed',
						error: e.message,
						attempts: newAttempts,
						wakeAt: null,
						startedAt,
						duration,
						errorStack: e.stack ?? null,
						retryHistory: JSON.stringify(updatedHistory),
					})
					.where(eq(stepsTable.name, name));

				throw new StepFailedError(name, e.message);
			}

			// existing retry logic continues unchanged below...
			const errorMsg = e instanceof Error ? e.message : String(e);
			const errorStack = e instanceof Error ? (e.stack ?? null) : null;
			const duration = Date.now() - startedAt;

			// Build retry history
			const existingHistory: Array<{ attempt: number; error: string; errorStack: string | null; timestamp: number; duration: number }> =
				existing?.retryHistory ? JSON.parse(existing.retryHistory) : [];
			const updatedHistory = [...existingHistory, { attempt: newAttempts, error: errorMsg, errorStack, timestamp: startedAt, duration }];
			const retryHistorySerialized = JSON.stringify(updatedHistory);

			if (newAttempts >= retryConfig.limit) {
				await this.db
					.update(stepsTable)
					.set({
						status: 'failed',
						error: errorMsg,
						attempts: newAttempts,
						wakeAt: null,
						startedAt,
						duration,
						errorStack,
						retryHistory: retryHistorySerialized,
					})
					.where(eq(stepsTable.name, name));
				const cause = e instanceof Error ? e.message : String(e);
				throw new StepRetryExhaustedError(name, newAttempts, cause);
			}

			// Retries remaining: schedule retry via alarm instead of blocking
			const baseDelay = parseDuration(retryConfig.delay);
			const delay = this.calculateBackoff(baseDelay, newAttempts, retryConfig.backoff);
			const wakeAt = Date.now() + delay;

			await this.db
				.update(stepsTable)
				.set({
					status: 'failed',
					error: errorMsg,
					attempts: newAttempts,
					wakeAt,
					startedAt,
					duration,
					errorStack,
					retryHistory: retryHistorySerialized,
				})
				.where(eq(stepsTable.name, name));

			this.observer?.onStepRetry(name, newAttempts, errorMsg, errorStack ?? undefined, wakeAt, Date.now());
			// Use alarm-based retry: throw SleepInterrupt so the DO sets an alarm
			throw new SleepInterrupt(name, wakeAt);
		}
	}

	async sleep(name: string, duration: string): Promise<void> {
		this.checkDuplicateName(name, 'step.sleep');
		const [existing] = await this.db.select().from(stepsTable).where(eq(stepsTable.name, name));

		if (existing?.status === 'completed') {
			return;
		}

		if (existing?.status === 'sleeping') {
			throw new SleepInterrupt(name, existing.wakeAt!);
		}

		const wakeAt = Date.now() + parseDuration(duration);

		await this.db.insert(stepsTable).values({
			name,
			type: 'sleep',
			status: 'sleeping',
			wakeAt,
			attempts: 0,
		});

		this.observer?.onStepStart(name, 'sleep', Date.now());
		throw new SleepInterrupt(name, wakeAt);
	}

	async sleepUntil(name: string, date: Date): Promise<void> {
		this.checkDuplicateName(name, 'step.sleepUntil');

		const wakeAt = date.getTime();
		if (Number.isNaN(wakeAt)) {
			throw new InvalidDateError();
		}

		const [existing] = await this.db.select().from(stepsTable).where(eq(stepsTable.name, name));

		if (existing?.status === 'completed') {
			return;
		}

		if (existing?.status === 'sleeping') {
			throw new SleepInterrupt(name, existing.wakeAt!);
		}

		await this.db.insert(stepsTable).values({
			name,
			type: 'sleep_until',
			status: 'sleeping',
			wakeAt,
			attempts: 0,
		});

		this.observer?.onStepStart(name, 'sleep_until', Date.now());
		throw new SleepInterrupt(name, wakeAt);
	}

	async waitForEvent<K extends Extract<keyof Events, string>>(name: K, options?: StepWaitOptions): Promise<Events[K]> {
		this.checkDuplicateName(name as string, 'step.waitForEvent');
		const [existing] = await this.db
			.select()
			.from(stepsTable)
			.where(eq(stepsTable.name, name as string));

		if (existing?.status === 'completed') {
			return (existing.result ? superjson.parse(existing.result) : null) as Events[K];
		}

		if (existing?.status === 'failed') {
			throw WorkflowError.fromSerialized(new Error(existing.error ?? `Event "${name as string}" failed`));
		}

		if (existing?.status === 'waiting') {
			throw new WaitInterrupt(name as string, existing.wakeAt);
		}

		// Check event buffer for an early-delivered event
		const [buffered] = await this.db
			.select()
			.from(eventBufferTable)
			.where(eq(eventBufferTable.eventName, name as string));

		if (buffered) {
			// Consume the buffered event: persist step first, then delete from buffer.
			// Insert-before-delete order ensures crash safety: if the isolate dies after
			// the insert but before the delete, the next replay finds the completed step
			// and the orphaned buffer entry is cleaned up on terminal state.
			await this.db.insert(stepsTable).values({
				name: name as string,
				type: 'wait_for_event',
				status: 'completed',
				result: buffered.payload,
				completedAt: Date.now(),
				attempts: 0,
			});
			await this.db.delete(eventBufferTable).where(eq(eventBufferTable.eventName, name as string));
			this.observer?.onStepComplete(name as string, 'wait_for_event', superjson.parse(buffered.payload), 0, Date.now());
			return superjson.parse(buffered.payload) as Events[K];
		}

		const timeoutAt = options?.timeout ? Date.now() + parseDuration(options.timeout) : null;

		await this.db.insert(stepsTable).values({
			name: name as string,
			type: 'wait_for_event',
			status: 'waiting',
			wakeAt: timeoutAt,
			attempts: 0,
		});

		this.observer?.onStepStart(name as string, 'wait_for_event', Date.now());
		throw new WaitInterrupt(name as string, timeoutAt);
	}

	/**
	 * Check whether storing a new result would exceed the workflow's cumulative
	 * result size budget. Queries SQLite for the total bytes of all completed
	 * step results, then compares `usedBytes + newBytes` against the limit.
	 *
	 * @param stepName - Name of the step being checked (for error messages).
	 * @param serialized - The superjson-serialized result string.
	 * @throws {@link NonRetriableError} When `onOverflow` is `'fail'` (default).
	 * @throws {Error} When `onOverflow` is `'retry'` (goes through normal retry logic).
	 */
	private async checkResultSizeLimit(stepName: string, serialized: string): Promise<void> {
		if (this.resultSizeLimitBytes <= 0) return;

		const newBytes = new TextEncoder().encode(serialized).byteLength;
		const [row] = await this.db
			.select({ total: sql<number>`coalesce(sum(length(${stepsTable.result})), 0)` })
			.from(stepsTable)
			.where(eq(stepsTable.status, 'completed'));
		const usedBytes = row?.total ?? 0;

		if (usedBytes + newBytes > this.resultSizeLimitBytes) {
			const usedMB = (usedBytes / (1024 * 1024)).toFixed(1);
			const newMB = (newBytes / (1024 * 1024)).toFixed(1);
			const limitMB = (this.resultSizeLimitBytes / (1024 * 1024)).toFixed(1);
			const message = `Step "${stepName}" result (${newMB} MB) would exceed workflow result size limit (used: ${usedMB} MB / limit: ${limitMB} MB)`;

			if (this.resultSizeLimitConfig.onOverflow === 'retry') {
				throw new Error(message);
			}
			throw new NonRetriableError(message);
		}
	}

	private calculateBackoff(baseDelay: number, attempt: number, strategy: string): number {
		switch (strategy) {
			case 'exponential':
				return baseDelay * Math.pow(2, attempt - 1);
			case 'linear':
				return baseDelay * attempt;
			case 'fixed':
			default:
				return baseDelay;
		}
	}
}
