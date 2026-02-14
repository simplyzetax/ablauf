import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';

const inputSchema = z.object({ name: z.string() });

export const MultiEventWorkflow = defineWorkflow({
	type: 'multi-event',
	input: inputSchema,
	events: {
		'first-approval': z.object({ ok: z.boolean() }),
		'second-approval': z.object({ ok: z.boolean() }),
	},
	run: async (step, payload) => {
		const greeting = await step.do('greet', async () => `Hi, ${payload.name}`);
		const first = await step.waitForEvent('first-approval', { timeout: '1m' });
		const second = await step.waitForEvent('second-approval', { timeout: '1m' });
		return { greeting, first: first.ok, second: second.ok };
	},
});
