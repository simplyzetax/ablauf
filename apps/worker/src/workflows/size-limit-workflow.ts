import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';

const inputSchema = z.object({
	/** Size of the string each step returns. */
	chunkSize: z.number(),
	/** Number of steps to run. */
	stepCount: z.number(),
});

/**
 * Test workflow for result size limit enforcement.
 * Each step returns a string of `chunkSize` characters. The cumulative
 * size is approximately `chunkSize * stepCount` bytes, which can be
 * tuned to exceed or stay within the configured budget.
 */
export const SizeLimitWorkflow = defineWorkflow({
	type: 'size-limit',
	input: inputSchema,
	resultSizeLimit: {
		maxSize: '1kb',
	},
	run: async (step, payload) => {
		const results: string[] = [];
		for (let i = 0; i < payload.stepCount; i++) {
			const chunk = await step.do(`chunk-${i}`, async () => {
				return 'x'.repeat(payload.chunkSize);
			});
			results.push(chunk);
		}
		return { totalChunks: results.length };
	},
});

/**
 * Same workflow but with `onOverflow: 'retry'` to test retryable behavior.
 */
export const SizeLimitRetryWorkflow = defineWorkflow({
	type: 'size-limit-retry',
	input: inputSchema,
	resultSizeLimit: {
		maxSize: '1kb',
		onOverflow: 'retry',
	},
	defaults: {
		retries: { limit: 2, delay: '100ms', backoff: 'fixed' as const },
	},
	run: async (step, payload) => {
		const results: string[] = [];
		for (let i = 0; i < payload.stepCount; i++) {
			const chunk = await step.do(`chunk-${i}`, async () => {
				return 'x'.repeat(payload.chunkSize);
			});
			results.push(chunk);
		}
		return { totalChunks: results.length };
	},
});
