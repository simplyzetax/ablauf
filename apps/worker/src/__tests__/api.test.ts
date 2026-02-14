import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Demo API', () => {
	it('waits through active states and returns once workflow is non-complete', async () => {
		const request = SELF.fetch('http://localhost/workflows/test', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'QuickCheck' }),
		});

		const response = await new Promise<Response>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error('Timed out waiting for create endpoint response'));
			}, 2000);

			request
				.then((res) => {
					clearTimeout(timeout);
					resolve(res);
				})
				.catch((err) => {
					clearTimeout(timeout);
					reject(err);
				});
		});

		expect(response.status).toBe(202);

		const body = (await response.json()) as {
			id: string;
			type: string;
			status: string;
		};

		expect(body.id).toBeTypeOf('string');
		expect(body.type).toBe('test');
		expect(['sleeping', 'waiting', 'paused', 'errored', 'terminated']).toContain(body.status);
	}, 10000);
});
