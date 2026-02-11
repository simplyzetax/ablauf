import { DurableObject, env } from "cloudflare:workers";

interface WorkflowRunnerProps<Payload> {
	id: string;
	payload: Payload;
}

export class WorkflowRunner extends DurableObject<Env> {

	public static create<Payload>(props: WorkflowRunnerProps<Payload>): Promise<WorkflowRunner> {
		return env.WORKFLOW_RUNNER.getByName(props.id);
	}

	async intitialize(props: WorkflowRunnerProps<Payload>): Promise<void> {
		this.ctx.storage.put("payload", props.payload);
	}

} 