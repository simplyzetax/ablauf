import { defineWorkflow } from '@der-ablauf/workflows';

export const TestWorkflow = defineWorkflow((t) => ({
	type: 'test',
	input: t.object({ name: t.string() }),
	events: {
		approval: t.object({ approved: t.boolean() }),
	},
	defaults: {
		retries: { limit: 2, delay: '500ms', backoff: 'exponential' as const },
	},
	run: async (step, payload) => {
		const greeting = await step.do('greet', async () => {
			return `Hello, ${payload.name}!`;
		});

		await step.sleep('pause', '5s');

		const approval = await step.waitForEvent('approval', {
			timeout: '1m',
		});

		const message = approval.approved ? `${payload.name} was approved` : `${payload.name} was rejected`;

		return { message, greeting };
	},
}));
