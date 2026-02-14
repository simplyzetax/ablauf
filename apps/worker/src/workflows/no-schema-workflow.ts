import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';

export const NoSchemaWorkflow = defineWorkflow({
	type: 'no-schema',
	input: z.object({}),
	run: async (step) => {
		return await step.do('noop', async () => 'done');
	},
});
