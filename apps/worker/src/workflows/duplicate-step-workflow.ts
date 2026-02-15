import { defineWorkflow } from '@der-ablauf/workflows';

export const DuplicateStepWorkflow = defineWorkflow((t) => ({
	type: 'duplicate-step',
	input: t.object({}),
	run: async (step) => {
		const a = await step.do('fetch-data', () => 'first');
		const b = await step.do('fetch-data', () => 'second');
		return { a, b };
	},
}));
