import { defineWorkflow } from '@der-ablauf/workflows';

const callCounts = new Map<string, number>();

export const BackoffConfigWorkflow = defineWorkflow((t) => ({
	type: 'backoff-config',
	input: t.object({
		failCount: t.number(),
		strategy: t.enum(['fixed', 'linear', 'exponential']),
	}),
	defaults: {
		retries: { limit: 5, delay: '100ms', backoff: 'fixed' as const },
	},
	run: async (step, payload) => {
		const key = `backoff:${payload.strategy}:${payload.failCount}`;
		const result = await step.do(
			'configurable-step',
			async () => {
				const count = (callCounts.get(key) ?? 0) + 1;
				callCounts.set(key, count);
				if (count <= payload.failCount) {
					throw new Error(`Fail #${count}`);
				}
				return 'ok';
			},
			{
				retries: {
					backoff: payload.strategy,
					delay: '100ms',
					limit: 5,
				},
			},
		);
		return result;
	},
}));
