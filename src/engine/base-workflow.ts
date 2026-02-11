import { z } from "zod";
import type {
	Step,
	WorkflowClass,
	WorkflowDefaults,
	WorkflowRunnerStub,
	WorkflowRunnerInitProps,
	WorkflowStatusResponseFor,
	TypedWorkflowRunnerStub,
	WorkflowEventProps,
} from "./types";

export abstract class BaseWorkflow<
	Payload = unknown,
	Result = unknown,
	Events extends object = {},
> {
	static type: string;
	static inputSchema: z.ZodType<unknown> = z.unknown();
	static events: Record<string, z.ZodType<unknown>> = {};
	static defaults: Partial<WorkflowDefaults> = {};

	abstract run(step: Step<Events>, payload: Payload): Promise<Result>;

	private static getStub(env: Env, id: string): WorkflowRunnerStub {
		return env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName(id)) as unknown as WorkflowRunnerStub;
	}

	static async create<
		Payload,
		Result,
		Events extends object,
		Type extends string,
	>(
		this: WorkflowClass<Payload, Result, Events, Type>,
		env: Env,
		props: { id: string; payload: Payload },
	): Promise<TypedWorkflowRunnerStub<Payload, Result, Events, Type>> {
		const payload = this.inputSchema.parse(props.payload);
		const stub = BaseWorkflow.getStub(env, props.id);
		const initProps: WorkflowRunnerInitProps = { type: this.type, id: props.id, payload };
		await stub.initialize(initProps);
		return stub as TypedWorkflowRunnerStub<Payload, Result, Events, Type>;
	}

	static async sendEvent<
		Payload,
		Result,
		Events extends object,
		Type extends string,
	>(
		this: WorkflowClass<Payload, Result, Events, Type>,
		env: Env,
		props: { id: string } & WorkflowEventProps<Events>,
	) {
		const schema = this.events[props.event];
		if (!schema) {
			throw new Error(`Unknown event "${props.event}" for workflow type "${this.type}"`);
		}
		const payload = schema.parse(props.payload);
		const stub = BaseWorkflow.getStub(env, props.id);
		await stub.deliverEvent({ event: props.event, payload });
	}

	static async status<
		Payload,
		Result,
		Events extends object,
		Type extends string,
	>(
		this: WorkflowClass<Payload, Result, Events, Type>,
		env: Env,
		id: string,
	): Promise<WorkflowStatusResponseFor<Payload, Result, Type>> {
		const stub = BaseWorkflow.getStub(env, id);
		return stub.getStatus() as Promise<WorkflowStatusResponseFor<Payload, Result, Type>>;
	}

	static async pause(env: Env, id: string) {
		const stub = BaseWorkflow.getStub(env, id);
		await stub.pause();
	}

	static async resume(env: Env, id: string) {
		const stub = BaseWorkflow.getStub(env, id);
		await stub.resume();
	}

	static async terminate(env: Env, id: string) {
		const stub = BaseWorkflow.getStub(env, id);
		await stub.terminate();
	}
}
