import { defineWorkflow } from '@der-ablauf/workflows';

export const MultiEventWorkflow = defineWorkflow((t) => ({
	type: 'multi-event',
	input: t.object({ name: t.string() }),
	events: {
		'first-approval': t.object({ ok: t.boolean() }),
		'second-approval': t.object({ ok: t.boolean() }),
	},
	run: async (step, payload) => {
		const greeting = await step.do('greet', async () => `Hi, ${payload.name}`);
		const first = await step.waitForEvent('first-approval', { timeout: '1m' });
		const second = await step.waitForEvent('second-approval', { timeout: '1m' });
		return { greeting, first: first.ok, second: second.ok };
	},
}));
