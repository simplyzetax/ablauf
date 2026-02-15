import { defineWorkflow } from '@der-ablauf/workflows';

export const SSEWorkflow = defineWorkflow((t) => ({
	type: 'sse-test',
	input: t.object({ itemCount: t.number() }),
	sseUpdates: {
		progress: t.object({ percent: t.number() }),
		done: t.object({ message: t.string() }),
	},
	run: async (step, payload, sse) => {
		sse.broadcast('progress', { percent: 0 });

		const half = await step.do('first-half', async () => {
			return Math.floor(payload.itemCount / 2);
		});

		sse.broadcast('progress', { percent: 50 });

		await step.do('second-half', async () => {
			return payload.itemCount - half;
		});

		sse.emit('done', { message: `Processed ${payload.itemCount} items` });

		return { processed: payload.itemCount };
	},
}));
