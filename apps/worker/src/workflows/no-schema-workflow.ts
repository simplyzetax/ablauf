import { defineWorkflow } from '@der-ablauf/workflows';

export const NoSchemaWorkflow = defineWorkflow((t) => ({
	type: 'no-schema',
	input: t.object({}),
	run: async (step) => {
		return await step.do('noop', async () => 'done');
	},
}));
