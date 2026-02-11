import { z } from "zod";
import type {
	Step,
	WorkflowDefaults,
	WorkflowStatusResponse,
	WorkflowRunnerStub,
	WorkflowRunnerInitProps,
	WorkflowRunnerEventProps,
} from "./types";

export abstract class BaseWorkflow<
	Payload = unknown,
	Result = unknown,
	Events extends Record<string, unknown> = Record<string, never>,
> {
	static type: string;
	static inputSchema: z.ZodType = z.unknown();
	static events: Record<string, z.ZodType> = {};
	static defaults: Partial<WorkflowDefaults> = {};

	abstract run(step: Step<Events>, payload: Payload): Promise<Result>;

	private static getStub(env: Env, id: string) {
		return env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName(id)) as unknown as WorkflowRunnerStub;
	}

	static async create(env: Env, props: { id: string; payload: unknown }) {
		const payload = this.inputSchema.parse(props.payload);
		const stub = this.getStub(env, props.id);
		const initProps: WorkflowRunnerInitProps = { type: this.type, id: props.id, payload };
		await stub.initialize(initProps);
		return stub;
	}

	static async sendEvent(env: Env, props: { id: string; event: string; payload: unknown }) {
		const schema = this.events[props.event];
		const payload = schema ? schema.parse(props.payload) : props.payload;
		const stub = this.getStub(env, props.id);
		const eventProps: WorkflowRunnerEventProps = { event: props.event, payload };
		await stub.deliverEvent(eventProps);
	}

	static async status(env: Env, id: string): Promise<WorkflowStatusResponse> {
		const stub = this.getStub(env, id);
		return stub.getStatus();
	}

	static async pause(env: Env, id: string) {
		const stub = this.getStub(env, id);
		await stub.pause();
	}

	static async resume(env: Env, id: string) {
		const stub = this.getStub(env, id);
		await stub.resume();
	}

	static async terminate(env: Env, id: string) {
		const stub = this.getStub(env, id);
		await stub.terminate();
	}
}
