import { z } from 'zod';
import { defineWorkflow, NonRetriableError } from '@der-ablauf/workflows';

const inputSchema = z.object({ shouldFail: z.boolean() });

/**
 * Test workflow: throws NonRetriableError when shouldFail is true.
 * Used to verify that non-retriable errors skip retries and immediately
 * fail the step and workflow.
 */
export const NonRetriableWorkflow = defineWorkflow({
	type: 'non-retriable',
	input: inputSchema,
	defaults: {
		retries: { limit: 5, delay: '500ms', backoff: 'exponential' as const },
	},
	run: async (step, payload) => {
		const result = await step.do('maybe-fail', async () => {
			if (payload.shouldFail) {
				throw new NonRetriableError('Intentional permanent failure');
			}
			return 'success';
		});

		return result;
	},
});
