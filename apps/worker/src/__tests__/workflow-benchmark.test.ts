import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../index';

const BENCHMARK_TOKEN = 'test-benchmark-token';

async function callBenchmark(body: Record<string, unknown>, token: string = BENCHMARK_TOKEN): Promise<Response> {
	Reflect.set(env as unknown as Record<string, unknown>, 'BENCHMARK_TOKEN', BENCHMARK_TOKEN);

	const request = new Request('http://localhost/benchmarks/workflows', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-benchmark-token': token,
		},
		body: JSON.stringify(body),
	});

	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

describe('Workflow benchmark endpoint', () => {
	it('rejects invalid benchmark token', async () => {
		const response = await callBenchmark({ iterations: 1, steps: 2 }, 'wrong-token');
		expect(response.status).toBe(401);
	});

	it('compares Ablauf and Cloudflare Workflows with fair alternating rounds', async () => {
		const response = await callBenchmark({
			iterations: 2,
			warmups: 1,
			steps: 3,
			workIterations: 1_000,
			pollIntervalMs: 5,
		});
		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			fairness: {
				executionPattern: string;
				measuredRoundOrder: Array<{ round: number; order: string[] }>;
			};
			engines: {
				ablauf: {
					runs: Array<{
						output: {
							startupMs: number;
							steps: Array<{ name: string; wallMs: number }>;
							checksum: number;
						};
					}>;
					summary: { runCount: number; completionMs: { mean: number } };
				};
				cloudflare: {
					runs: Array<{
						output: {
							startupMs: number;
							steps: Array<{ name: string; wallMs: number }>;
							checksum: number;
						};
					}>;
					summary: { runCount: number; completionMs: { mean: number } };
				};
			};
			comparison: {
				completion: { meanDeltaMs: number; meanRatio: number };
			};
		};

		expect(body.fairness.executionPattern).toBe('alternating-order-per-round');
		expect(body.fairness.measuredRoundOrder).toHaveLength(2);
		expect(body.fairness.measuredRoundOrder[0].order).not.toEqual(body.fairness.measuredRoundOrder[1].order);

		expect(body.engines.ablauf.runs).toHaveLength(2);
		expect(body.engines.cloudflare.runs).toHaveLength(2);
		expect(body.engines.ablauf.summary.runCount).toBe(2);
		expect(body.engines.cloudflare.summary.runCount).toBe(2);
		expect(body.engines.ablauf.summary.completionMs.mean).toBeGreaterThan(0);
		expect(body.engines.cloudflare.summary.completionMs.mean).toBeGreaterThan(0);

		for (const run of body.engines.ablauf.runs) {
			expect(run.output.startupMs).toBeGreaterThanOrEqual(0);
			expect(run.output.steps).toHaveLength(3);
		}
		for (const run of body.engines.cloudflare.runs) {
			expect(run.output.startupMs).toBeGreaterThanOrEqual(0);
			expect(run.output.steps).toHaveLength(3);
		}

		const ablaufChecksums = body.engines.ablauf.runs.map((run) => run.output.checksum);
		const cloudflareChecksums = body.engines.cloudflare.runs.map((run) => run.output.checksum);
		expect(new Set(ablaufChecksums).size).toBe(1);
		expect(new Set(cloudflareChecksums).size).toBe(1);
		expect(ablaufChecksums[0]).toBe(cloudflareChecksums[0]);

		expect(typeof body.comparison.completion.meanDeltaMs).toBe('number');
		expect(typeof body.comparison.completion.meanRatio).toBe('number');
	}, 60_000);
});
