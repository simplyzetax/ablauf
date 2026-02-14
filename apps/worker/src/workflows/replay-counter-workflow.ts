import { z } from 'zod';
import { defineWorkflow } from '@der-ablauf/workflows';

const inputSchema = z.object({ id: z.string() });

// Module-level counters — persist across replay() calls within the same DO isolate.
export const executionCounts = new Map<string, number>();

export const ReplayCounterWorkflow = defineWorkflow({
	type: 'replay-counter',
	input: inputSchema,
	events: {
		continue: z.object({}),
	},
	run: async (step, payload) => {
		const key1 = `${payload.id}:step-1`;
		const result1 = await step.do('step-1', async () => {
			executionCounts.set(key1, (executionCounts.get(key1) ?? 0) + 1);
			return 'first';
		});

		const key2 = `${payload.id}:step-2`;
		const result2 = await step.do('step-2', async () => {
			executionCounts.set(key2, (executionCounts.get(key2) ?? 0) + 1);
			return 'second';
		});

		const _event = await step.waitForEvent('continue');

		const key3 = `${payload.id}:step-3`;
		const result3 = await step.do('step-3', async () => {
			executionCounts.set(key3, (executionCounts.get(key3) ?? 0) + 1);
			return 'third';
		});

		return { result1, result2, result3 };
	},
});
