import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';

const inputSchema = z.object({ value: z.number() });

export const MultiStepWorkflow = defineWorkflow({
	type: 'multi-step',
	input: inputSchema,
	run: async (step, payload) => {
		const a = await step.do('step-a', async () => payload.value + 1);
		const b = await step.do('step-b', async () => a * 2);
		const c = await step.do('step-c', async () => b + 10);
		const d = await step.do('step-d', async () => `result:${c}`);
		return { a, b, c, d };
	},
});
