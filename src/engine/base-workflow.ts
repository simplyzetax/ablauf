import type { Step, WorkflowDefaults, WorkflowStatusResponse } from "./types";

export abstract class BaseWorkflow<
	Payload = unknown,
	Result = unknown,
	Events extends Record<string, unknown> = Record<string, never>,
> {
	static type: string;
	static events: Record<string, unknown> = {};
	static defaults: Partial<WorkflowDefaults> = {};

	abstract run(step: Step<Events>, payload: Payload): Promise<Result>;

	private static getStub(env: Env, id: string) {
		return env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName(id));
	}

	static async create(env: Env, props: { id: string; payload: unknown }) {
		const stub = this.getStub(env, props.id);
		await stub.initialize({ type: this.type, id: props.id, payload: props.payload });
		return stub;
	}

	static async sendEvent(env: Env, props: { id: string; event: string; payload: unknown }) {
		const stub = this.getStub(env, props.id);
		await stub.deliverEvent({ event: props.event, payload: props.payload });
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
