import { z } from 'zod';
import type { BenchmarkConfig } from './benchmark-types';

export const benchmarkRequestSchema = z.object({
	iterations: z.number().int().min(1).max(30).optional(),
	warmups: z.number().int().min(0).max(20).optional(),
	steps: z.number().int().min(1).max(20).optional(),
	workIterations: z.number().int().min(10).max(500_000).optional(),
	pollIntervalMs: z.number().int().min(1).max(250).optional(),
});

export function toBenchmarkConfig(input: z.infer<typeof benchmarkRequestSchema>): BenchmarkConfig {
	return {
		iterations: input.iterations ?? 8,
		warmups: input.warmups ?? 2,
		steps: input.steps ?? 8,
		workIterations: input.workIterations ?? 5_000,
		pollIntervalMs: input.pollIntervalMs ?? 10,
	};
}
