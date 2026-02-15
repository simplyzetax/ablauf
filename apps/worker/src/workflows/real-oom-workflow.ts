import { defineWorkflow } from '@der-ablauf/workflows';

export const RealOOMWorkflow = defineWorkflow((t) => ({
	resultSizeLimit: {
		maxSize: '1mb',
		onOverflow: 'retry',
	},
	type: 'real-oom',
	input: t.object({}),
	run: async (step) => {
		const a = await step.do('a', async () => 'a');
		await step.sleep('b-sleep', '1s');
		const b = await step.do('b', async () => {
			// Generate 128MB of random data (getRandomValues max 64KB per call)
			const size = 128 * 1024 * 1024;
			const chunkSize = 65536; // max for getRandomValues
			const data = new Uint8Array(size);
			for (let i = 0; i < size; i += chunkSize) {
				crypto.getRandomValues(data.subarray(i, i + chunkSize));
			}
			return data;
		});
		return { a, b };
	},
}));
