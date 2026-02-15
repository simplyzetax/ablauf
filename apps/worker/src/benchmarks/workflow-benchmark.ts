export type WorkflowBenchmarkPayload = {
	requestedAtMs: number;
	steps: number;
	workIterations: number;
};

export type WorkflowBenchmarkStepMetric = {
	name: string;
	wallMs: number;
	callbackMs: number;
	orchestrationMs: number;
	checksum: number;
};

export type WorkflowBenchmarkOutput = {
	startupMs: number;
	runMs: number;
	totalStepWallMs: number;
	totalCallbackMs: number;
	totalOrchestrationMs: number;
	checksum: number;
	steps: WorkflowBenchmarkStepMetric[];
};

type BenchmarkStepAdapter = {
	do<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

const CHECKSUM_MOD = 2_147_483_647;

function roundMs(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function deterministicWork(iterations: number, seed: number): number {
	let checksum = seed + 1;
	for (let i = 0; i < iterations; i += 1) {
		checksum = (checksum * 48_271 + i + seed + 1) % CHECKSUM_MOD;
	}
	return checksum;
}

export async function executeWorkflowBenchmark(
	step: BenchmarkStepAdapter,
	payload: WorkflowBenchmarkPayload,
): Promise<WorkflowBenchmarkOutput> {
	const workflowStartedAt = performance.now();
	let firstStepEpochMs = Date.now();
	let checksum = 0;
	const steps: WorkflowBenchmarkStepMetric[] = [];

	for (let index = 0; index < payload.steps; index += 1) {
		const stepName = `step-${index + 1}`;
		const wallStart = performance.now();
		if (index === 0) {
			firstStepEpochMs = Date.now();
		}

		const result = await step.do(stepName, async () => {
			const callbackStart = performance.now();
			const value = deterministicWork(payload.workIterations, index);
			const callbackEnd = performance.now();
			return {
				callbackMs: roundMs(callbackEnd - callbackStart),
				checksum: value,
			};
		});

		const wallEnd = performance.now();
		const wallMs = roundMs(wallEnd - wallStart);
		const orchestrationMs = roundMs(Math.max(0, wallMs - result.callbackMs));
		checksum = (checksum + result.checksum) % CHECKSUM_MOD;

		steps.push({
			name: stepName,
			wallMs,
			callbackMs: result.callbackMs,
			orchestrationMs,
			checksum: result.checksum,
		});
	}

	const workflowEndedAt = performance.now();
	const totalStepWallMs = roundMs(steps.reduce((sum, current) => sum + current.wallMs, 0));
	const totalCallbackMs = roundMs(steps.reduce((sum, current) => sum + current.callbackMs, 0));
	const totalOrchestrationMs = roundMs(steps.reduce((sum, current) => sum + current.orchestrationMs, 0));

	return {
		startupMs: roundMs(firstStepEpochMs - payload.requestedAtMs),
		runMs: roundMs(workflowEndedAt - workflowStartedAt),
		totalStepWallMs,
		totalCallbackMs,
		totalOrchestrationMs,
		checksum,
		steps,
	};
}

export function isWorkflowBenchmarkOutput(value: unknown): value is WorkflowBenchmarkOutput {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<WorkflowBenchmarkOutput>;
	if (
		typeof candidate.startupMs !== 'number' ||
		typeof candidate.runMs !== 'number' ||
		typeof candidate.totalStepWallMs !== 'number' ||
		typeof candidate.totalCallbackMs !== 'number' ||
		typeof candidate.totalOrchestrationMs !== 'number' ||
		typeof candidate.checksum !== 'number' ||
		!Array.isArray(candidate.steps)
	) {
		return false;
	}

	return candidate.steps.every(
		(step) =>
			typeof step === 'object' &&
			step !== null &&
			typeof step.name === 'string' &&
			typeof step.wallMs === 'number' &&
			typeof step.callbackMs === 'number' &&
			typeof step.orchestrationMs === 'number' &&
			typeof step.checksum === 'number',
	);
}
