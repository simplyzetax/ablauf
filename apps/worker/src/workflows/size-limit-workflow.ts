import { defineWorkflow } from '@der-ablauf/workflows';

/**
 * Test workflow for result size limit enforcement.
 * Each step returns a string of `chunkSize` characters. The cumulative
 * size is approximately `chunkSize * stepCount` bytes, which can be
 * tuned to exceed or stay within the configured budget.
 */
export const SizeLimitWorkflow = defineWorkflow((t) => ({
	type: 'size-limit',
	input: t.object({
		/** Size of the string each step returns. */
		chunkSize: t.number(),
		/** Number of steps to run. */
		stepCount: t.number(),
	}),
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
}));

/**
 * Same workflow but with `onOverflow: 'retry'` to test retryable behavior.
 */
export const SizeLimitRetryWorkflow = defineWorkflow((t) => ({
	type: 'size-limit-retry',
	input: t.object({
		/** Size of the string each step returns. */
		chunkSize: t.number(),
		/** Number of steps to run. */
		stepCount: t.number(),
	}),
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
}));
