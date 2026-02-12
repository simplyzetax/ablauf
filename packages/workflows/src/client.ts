import { EventValidationError, extractZodIssues } from "./errors";
import type {
	WorkflowClass,
	WorkflowRunnerStub,
	WorkflowRunnerInitProps,
	WorkflowStatusResponse,
	WorkflowStatusResponseFor,
	TypedWorkflowRunnerStub,
	WorkflowEventProps,
	WorkflowIndexListFilters,
	WorkflowIndexEntry,
} from "./engine/types";

export class Ablauf {
	constructor(private binding: DurableObjectNamespace) {}

	private getStub(id: string): WorkflowRunnerStub {
		return this.binding.get(this.binding.idFromName(id)) as unknown as WorkflowRunnerStub;
	}

	async create<Payload, Result, Events extends object, Type extends string>(
		workflow: WorkflowClass<Payload, Result, Events, Type>,
		props: { id: string; payload: NoInfer<Payload> },
	): Promise<TypedWorkflowRunnerStub<Payload, Result, Events, Type>> {
		const payload = workflow.inputSchema.parse(props.payload);
		const stub = this.getStub(props.id);
		const initProps: WorkflowRunnerInitProps = { type: workflow.type, id: props.id, payload };
		await stub.initialize(initProps);
		return stub as TypedWorkflowRunnerStub<Payload, Result, Events, Type>;
	}

	async sendEvent<Payload, Result, Events extends object, Type extends string>(
		workflow: WorkflowClass<Payload, Result, Events, Type>,
		props: { id: string } & NoInfer<WorkflowEventProps<Events>>,
	): Promise<void> {
		const schema = workflow.events[props.event];
		if (!schema) {
			throw new EventValidationError(props.event, [
				{ message: `Unknown event "${props.event}" for workflow type "${workflow.type}"` },
			]);
		}
		let payload: unknown;
		try {
			payload = schema.parse(props.payload);
		} catch (e) {
			const issues = extractZodIssues(e);
			throw new EventValidationError(props.event, issues);
		}
		const stub = this.getStub(props.id);
		await stub.deliverEvent({ event: props.event, payload });
	}

	async status(id: string): Promise<WorkflowStatusResponse>;
	async status<Payload, Result, Events extends object, Type extends string>(
		id: string,
		workflow: WorkflowClass<Payload, Result, Events, Type>,
	): Promise<WorkflowStatusResponseFor<Payload, Result, Type>>;
	async status(id: string, workflow?: WorkflowClass): Promise<WorkflowStatusResponse> {
		void workflow; // used only for type narrowing
		const stub = this.getStub(id);
		return stub.getStatus();
	}

	async pause(id: string): Promise<void> {
		const stub = this.getStub(id);
		await stub.pause();
	}

	async resume(id: string): Promise<void> {
		const stub = this.getStub(id);
		await stub.resume();
	}

	async terminate(id: string): Promise<void> {
		const stub = this.getStub(id);
		await stub.terminate();
	}

	async list(type: string, filters?: WorkflowIndexListFilters): Promise<WorkflowIndexEntry[]> {
		const indexId = this.binding.idFromName(`__index:${type}`);
		const indexStub = this.binding.get(indexId) as unknown as WorkflowRunnerStub;
		return indexStub.indexList(filters);
	}
}
