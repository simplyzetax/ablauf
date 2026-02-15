import { defineWorkflow } from '@der-ablauf/workflows';

export const EchoWorkflow = defineWorkflow((t) => ({
	type: 'echo',
	input: t.object({ message: t.string() }),
	run: async (step, payload) => {
		return await step.do('echo', async () => ({
			original: payload.message,
			echoed: payload.message,
			timestamp: Date.now(),
		}));
	},
}));
