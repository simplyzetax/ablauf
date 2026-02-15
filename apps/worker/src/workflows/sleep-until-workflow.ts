import { defineWorkflow } from '@der-ablauf/workflows';

/**
 * Test workflow for validating `step.sleepUntil()` behavior.
 * Accepts a `wakeAt` timestamp and sleeps until that absolute time.
 */
export const SleepUntilWorkflow = defineWorkflow((t) => ({
	type: 'sleep-until-test',
	input: t.object({ wakeAt: t.number() }),
	events: {},
	run: async (step, payload) => {
		const before = await step.do('before-sleep', async () => 'before');
		await step.sleepUntil('nap', new Date(payload.wakeAt));
		const after = await step.do('after-sleep', async () => 'after');
		return { before, after };
	},
}));
