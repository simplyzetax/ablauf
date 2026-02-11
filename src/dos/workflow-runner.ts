import { DurableObject } from "cloudflare:workers";

export interface WorkflowRunnerProps<Payload> {
	id: string;
	payload: Payload;
}

export abstract class WorkflowRunner<Payload, Result = void> extends DurableObject<Env> {

	abstract run(payload: Payload): Promise<Result>;

	async initialize(props: WorkflowRunnerProps<Payload>): Promise<Result> {
		await this.ctx.storage.put("payload", props.payload);
		return this.run(props.payload);
	}
}
