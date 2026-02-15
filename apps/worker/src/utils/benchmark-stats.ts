import type { BenchmarkRun, EngineSummary, MetricSummary } from './benchmark-types';

export function roundMs(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) {
		return 0;
	}
	const index = (sorted.length - 1) * p;
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower === upper) {
		return sorted[lower];
	}
	const weight = index - lower;
	return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function summarize(values: number[]): MetricSummary {
	const sorted = [...values].sort((a, b) => a - b);
	const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
	const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
	return {
		min: roundMs(sorted[0]),
		p50: roundMs(percentile(sorted, 0.5)),
		p95: roundMs(percentile(sorted, 0.95)),
		mean: roundMs(mean),
		max: roundMs(sorted[sorted.length - 1]),
		stddev: roundMs(Math.sqrt(variance)),
	};
}

export function summarizeEngine(runs: BenchmarkRun[]): EngineSummary {
	const stepCount = runs[0]?.output.steps.length ?? 0;
	const perStep = Array.from({ length: stepCount }, (_, index) => {
		const stepMetrics = runs.map((run) => run.output.steps[index]);
		return {
			name: `step-${index + 1}`,
			wallMs: summarize(stepMetrics.map((step) => step.wallMs)),
			callbackMs: summarize(stepMetrics.map((step) => step.callbackMs)),
			orchestrationMs: summarize(stepMetrics.map((step) => step.orchestrationMs)),
		};
	});

	return {
		runCount: runs.length,
		createMs: summarize(runs.map((run) => run.createMs)),
		startupMs: summarize(runs.map((run) => run.output.startupMs)),
		completionMs: summarize(runs.map((run) => run.completionMs)),
		runMs: summarize(runs.map((run) => run.output.runMs)),
		totalStepWallMs: summarize(runs.map((run) => run.output.totalStepWallMs)),
		totalCallbackMs: summarize(runs.map((run) => run.output.totalCallbackMs)),
		totalOrchestrationMs: summarize(runs.map((run) => run.output.totalOrchestrationMs)),
		averageStepWallMs: summarize(runs.map((run) => run.output.totalStepWallMs / run.output.steps.length)),
		averageStepCallbackMs: summarize(runs.map((run) => run.output.totalCallbackMs / run.output.steps.length)),
		averageStepOrchestrationMs: summarize(runs.map((run) => run.output.totalOrchestrationMs / run.output.steps.length)),
		statusChecksMs: summarize(runs.map((run) => run.statusChecksMs)),
		polls: summarize(runs.map((run) => run.polls)),
		throughputStepsPerSecond: summarize(runs.map((run) => run.throughputStepsPerSecond)),
		perStep,
	};
}

export function compareSummaries(ablaufSummary: EngineSummary, cloudflareSummary: EngineSummary) {
	const ratio = (left: number, right: number): number => {
		if (right === 0) {
			return 0;
		}
		return roundMs(left / right);
	};

	return {
		completion: {
			meanDeltaMs: roundMs(ablaufSummary.completionMs.mean - cloudflareSummary.completionMs.mean),
			meanRatio: ratio(ablaufSummary.completionMs.mean, cloudflareSummary.completionMs.mean),
		},
		startup: {
			meanDeltaMs: roundMs(ablaufSummary.startupMs.mean - cloudflareSummary.startupMs.mean),
			meanRatio: ratio(ablaufSummary.startupMs.mean, cloudflareSummary.startupMs.mean),
		},
		averageStepWall: {
			meanDeltaMs: roundMs(ablaufSummary.averageStepWallMs.mean - cloudflareSummary.averageStepWallMs.mean),
			meanRatio: ratio(ablaufSummary.averageStepWallMs.mean, cloudflareSummary.averageStepWallMs.mean),
		},
		averageStepOrchestration: {
			meanDeltaMs: roundMs(ablaufSummary.averageStepOrchestrationMs.mean - cloudflareSummary.averageStepOrchestrationMs.mean),
			meanRatio: ratio(ablaufSummary.averageStepOrchestrationMs.mean, cloudflareSummary.averageStepOrchestrationMs.mean),
		},
		throughput: {
			meanDeltaStepsPerSecond: roundMs(ablaufSummary.throughputStepsPerSecond.mean - cloudflareSummary.throughputStepsPerSecond.mean),
			meanRatio: ratio(ablaufSummary.throughputStepsPerSecond.mean, cloudflareSummary.throughputStepsPerSecond.mean),
		},
	};
}
