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

export type WorkflowEvents = Record<string, unknown>;
type EventKey<Events extends object> = Extract<keyof Events, string>;

export type WorkflowEventSchemas<Events extends object> = {
	[K in EventKey<Events>]: import("zod").z.ZodType<Events[K]>;
};

export type WorkflowEventProps<Events extends object> = [EventKey<Events>] extends [never]
	? never
	: {
			[K in EventKey<Events>]: {
				event: K;
				payload: Events[K];
			};
		}[EventKey<Events>];

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	limit: 3,
	delay: "1s",
	backoff: "exponential",
};

export interface Step<Events extends object = {}> {
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
	Events extends object = WorkflowEvents,
	Type extends string = string,
	SSEUpdates = never,
> {
	type: Type;
	inputSchema: import("zod").z.ZodType<Payload>;
	events: WorkflowEventSchemas<Events>;
	defaults?: Partial<WorkflowDefaults>;
	sseUpdates?: import("zod").z.ZodType<unknown>;
	new (): WorkflowInstance<Payload, Result, Events, SSEUpdates>;
}

export interface WorkflowInstance<
	Payload = unknown,
	Result = unknown,
	Events extends object = {},
	SSEUpdates = never,
> {
	run(step: Step<Events>, payload: Payload, sse: SSE<SSEUpdates>): Promise<Result>;
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

export type WorkflowStatusResponseFor<
	Payload = unknown,
	Result = unknown,
	Type extends string = string,
> = Omit<WorkflowStatusResponse, "type" | "payload" | "result"> & {
	type: Type;
	payload: Payload;
	result: Result | null;
};

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

export interface WorkflowShardConfig {
	shards?: number;
	previousShards?: number;
}

export interface WorkflowRunnerStub {
	initialize(props: WorkflowRunnerInitProps): Promise<void>;
	getStatus(): Promise<WorkflowStatusResponse>;
	deliverEvent(props: WorkflowRunnerEventProps): Promise<void>;
	pause(): Promise<void>;
	resume(): Promise<void>;
	terminate(): Promise<void>;
	connectSSE(): Promise<ReadableStream>;
	indexWrite(props: WorkflowIndexEntry): Promise<void>;
	indexList(filters?: WorkflowIndexListFilters): Promise<WorkflowIndexEntry[]>;
	_expireTimers(): Promise<void>;
}

export type TypedWorkflowRunnerStub<
	Payload,
	Result,
	Events extends object,
	Type extends string = string,
> = Omit<WorkflowRunnerStub, "getStatus" | "deliverEvent"> & {
	getStatus(): Promise<WorkflowStatusResponseFor<Payload, Result, Type>>;
	deliverEvent(props: WorkflowEventProps<Events>): Promise<void>;
};

export interface SSE<T = never> {
	broadcast(data: T): void;
	emit(data: T): void;
	close(): void;
}
