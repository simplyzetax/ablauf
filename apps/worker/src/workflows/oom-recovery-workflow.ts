import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';

const inputSchema = z.object({});

/**
 * Test workflow for OOM crash recovery.
 * Has two steps separated by a sleep so tests can inject a simulated
 * OOM crash (step left in 'running' state) before the second step executes.
 */
export const OOMRecoveryWorkflow = defineWorkflow({
	type: 'oom-recovery',
	input: inputSchema,
	defaults: {
		retries: { limit: 3, delay: '500ms', backoff: 'exponential' as const },
	},
	run: async (step) => {
		const a = await step.do('first', async () => 'safe');
		await step.sleep('gap', '1s');
		const b = await step.do('second', async () => 'recovered');
		return { a, b };
	},
});
