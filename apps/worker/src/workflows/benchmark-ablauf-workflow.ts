import { defineWorkflow } from '@der-ablauf/workflows';
import { executeWorkflowBenchmark } from '../benchmarks/workflow-benchmark';

export const BenchmarkAblaufWorkflow = defineWorkflow((t) => ({
	type: 'benchmark-ablauf',
	input: t.object({
		requestedAtMs: t.number().int().nonnegative(),
		steps: t.number().int().min(1).max(50),
		workIterations: t.number().int().min(10).max(500_000),
	}),
	run: async (step, payload) => executeWorkflowBenchmark(step, payload),
}));
