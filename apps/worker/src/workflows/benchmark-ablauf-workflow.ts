import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';
import { executeWorkflowBenchmark } from '../benchmarks/workflow-benchmark';

const inputSchema = z.object({
	requestedAtMs: z.number().int().nonnegative(),
	steps: z.number().int().min(1).max(50),
	workIterations: z.number().int().min(10).max(500_000),
});

export const BenchmarkAblaufWorkflow = defineWorkflow({
	type: 'benchmark-ablauf',
	input: inputSchema,
	run: async (step, payload) => executeWorkflowBenchmark(step, payload),
});
