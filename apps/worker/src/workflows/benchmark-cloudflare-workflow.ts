import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { executeWorkflowBenchmark, type WorkflowBenchmarkPayload } from '../benchmarks/workflow-benchmark';

export class BenchmarkCloudflareWorkflow extends WorkflowEntrypoint<Env, WorkflowBenchmarkPayload> {
	override async run(event: Readonly<WorkflowEvent<WorkflowBenchmarkPayload>>, step: WorkflowStep) {
		return executeWorkflowBenchmark(step, event.payload);
	}
}
