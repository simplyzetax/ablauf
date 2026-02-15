import type { Ablauf, WorkflowClass } from '@der-ablauf/workflows';
import { isWorkflowBenchmarkOutput, type WorkflowBenchmarkPayload } from '../benchmarks/workflow-benchmark';
import { roundMs } from './benchmark-stats';
import type { BenchmarkConfig, BenchmarkEngine, BenchmarkRun } from './benchmark-types';

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAblaufBenchmark(
	ablauf: Ablauf,
	workflowClass: WorkflowClass,
	config: BenchmarkConfig,
): Promise<Omit<BenchmarkRun, 'round' | 'orderInRound'>> {
	const payload: WorkflowBenchmarkPayload = {
		requestedAtMs: Date.now(),
		steps: config.steps,
		workIterations: config.workIterations,
	};

	const createStartedAt = performance.now();
	const workflow = await ablauf.create(workflowClass, {
		id: `benchmark-ablauf-${crypto.randomUUID()}`,
		payload,
	});
	const createMs = roundMs(performance.now() - createStartedAt);

	let polls = 0;
	let statusChecksMs = 0;

	while (true) {
		polls += 1;
		const statusStartedAt = performance.now();
		const status = await workflow.getStatus();
		statusChecksMs += performance.now() - statusStartedAt;

		if (status.status === 'completed') {
			if (!isWorkflowBenchmarkOutput(status.result)) {
				throw new Error('Ablauf benchmark returned an invalid output shape');
			}
			const completionMs = roundMs(performance.now() - createStartedAt);
			return {
				createMs,
				completionMs,
				statusChecksMs: roundMs(statusChecksMs),
				polls,
				throughputStepsPerSecond: roundMs(config.steps / (completionMs / 1000)),
				output: status.result,
			};
		}

		if (status.status === 'errored' || status.status === 'terminated') {
			throw new Error(`Ablauf benchmark failed with status "${status.status}": ${status.error ?? 'no details'}`);
		}

		await delay(config.pollIntervalMs);
	}
}

export async function runCloudflareBenchmark(
	binding: Workflow<WorkflowBenchmarkPayload>,
	config: BenchmarkConfig,
): Promise<Omit<BenchmarkRun, 'round' | 'orderInRound'>> {
	const payload: WorkflowBenchmarkPayload = {
		requestedAtMs: Date.now(),
		steps: config.steps,
		workIterations: config.workIterations,
	};

	const createStartedAt = performance.now();
	const instance = await binding.create({
		id: `benchmark-cloudflare-${crypto.randomUUID()}`,
		params: payload,
	});
	const createMs = roundMs(performance.now() - createStartedAt);

	let polls = 0;
	let statusChecksMs = 0;

	while (true) {
		polls += 1;
		const statusStartedAt = performance.now();
		const status = await instance.status();
		statusChecksMs += performance.now() - statusStartedAt;

		if (status.status === 'complete') {
			if (!isWorkflowBenchmarkOutput(status.output)) {
				throw new Error('Cloudflare benchmark returned an invalid output shape');
			}
			const completionMs = roundMs(performance.now() - createStartedAt);
			return {
				createMs,
				completionMs,
				statusChecksMs: roundMs(statusChecksMs),
				polls,
				throughputStepsPerSecond: roundMs(config.steps / (completionMs / 1000)),
				output: status.output,
			};
		}

		if (status.status === 'errored' || status.status === 'terminated') {
			throw new Error(`Cloudflare benchmark failed with status "${status.status}": ${status.error?.message ?? 'no details'}`);
		}

		await delay(config.pollIntervalMs);
	}
}

export async function runBenchmarkRounds(params: {
	ablauf: Ablauf;
	benchmarkWorkflowClass: WorkflowClass;
	cloudflareBinding: Workflow<WorkflowBenchmarkPayload>;
	config: BenchmarkConfig;
}) {
	const runs: Record<BenchmarkEngine, BenchmarkRun[]> = {
		ablauf: [],
		cloudflare: [],
	};
	const measuredRoundOrder: Array<{ round: number; order: BenchmarkEngine[] }> = [];
	const totalRounds = params.config.warmups + params.config.iterations;

	for (let round = 0; round < totalRounds; round += 1) {
		const order: BenchmarkEngine[] = round % 2 === 0 ? ['ablauf', 'cloudflare'] : ['cloudflare', 'ablauf'];
		const measuredRound = round - params.config.warmups;
		const isMeasured = measuredRound >= 0;
		if (isMeasured) {
			measuredRoundOrder.push({ round: measuredRound, order: [...order] });
		}

		for (const [orderIndex, engine] of order.entries()) {
			const run =
				engine === 'ablauf'
					? await runAblaufBenchmark(params.ablauf, params.benchmarkWorkflowClass, params.config)
					: await runCloudflareBenchmark(params.cloudflareBinding, params.config);

			if (isMeasured) {
				runs[engine].push({
					round: measuredRound,
					orderInRound: orderIndex === 0 ? 'first' : 'second',
					...run,
				});
			}
		}
	}

	return { runs, measuredRoundOrder };
}
