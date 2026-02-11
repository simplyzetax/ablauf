export type WorkflowStatus = "created" | "running" | "completed" | "errored" | "paused" | "sleeping" | "waiting" | "terminated";

export type BackoffStrategy = "fixed" | "linear" | "exponential";

export interface RetryConfig {
	limit: number;
	delay: string;
	backoff: BackoffStrategy;
}

export interface StepDoOptions {
	retries?: Partial<RetryConfig>;
}

export interface StepWaitOptions {
	timeout: string;
}

export interface WorkflowDefaults {
	retries: RetryConfig;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	limit: 3,
	delay: "1s",
	backoff: "exponential",
};

export interface Step<Events extends Record<string, unknown> = Record<string, never>> {
	do<T>(name: string, fn: () => Promise<T> | T, options?: StepDoOptions): Promise<T>;
	sleep(name: string, duration: string): Promise<void>;
	waitForEvent<K extends Extract<keyof Events, string>>(
		name: K,
		options?: StepWaitOptions,
	): Promise<Events[K]>;
}

export interface WorkflowClass<
	Payload = unknown,
	Result = unknown,
	Events extends Record<string, unknown> = Record<string, never>,
> {
	type: string;
	events?: Events;
	defaults?: Partial<WorkflowDefaults>;
	new (): WorkflowInstance<Payload, Result, Events>;
}

export interface WorkflowInstance<
	Payload = unknown,
	Result = unknown,
	Events extends Record<string, unknown> = Record<string, never>,
> {
	run(step: Step<Events>, payload: Payload): Promise<Result>;
}

export interface WorkflowStatusResponse {
	id: string;
	type: string;
	status: WorkflowStatus;
	payload: unknown;
	result: unknown;
	error: string | null;
	steps: StepInfo[];
	createdAt: number;
	updatedAt: number;
}

export interface StepInfo {
	name: string;
	type: string;
	status: string;
	attempts: number;
	result: unknown;
	error: string | null;
	completedAt: number | null;
}

export interface WorkflowRunnerInitProps {
	type: string;
	id: string;
	payload: unknown;
}

export interface WorkflowRunnerEventProps {
	event: string;
	payload: unknown;
}

export interface WorkflowIndexEntry {
	id: string;
	status: string;
	createdAt: number;
	updatedAt: number;
}

export interface WorkflowIndexListFilters {
	status?: string;
	limit?: number;
}

export interface WorkflowRunnerStub {
	initialize(props: WorkflowRunnerInitProps): Promise<void>;
	getStatus(): Promise<WorkflowStatusResponse>;
	deliverEvent(props: WorkflowRunnerEventProps): Promise<void>;
	pause(): Promise<void>;
	resume(): Promise<void>;
	terminate(): Promise<void>;
	indexWrite(props: WorkflowIndexEntry): Promise<void>;
	indexList(filters?: WorkflowIndexListFilters): Promise<WorkflowIndexEntry[]>;
	_expireTimers(): Promise<void>;
}
