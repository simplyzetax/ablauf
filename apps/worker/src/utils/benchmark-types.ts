import type { WorkflowBenchmarkOutput } from '../benchmarks/workflow-benchmark';

export type BenchmarkEngine = 'ablauf' | 'cloudflare';

export type BenchmarkConfig = {
	iterations: number;
	warmups: number;
	steps: number;
	workIterations: number;
	pollIntervalMs: number;
};

export type BenchmarkRun = {
	round: number;
	orderInRound: 'first' | 'second';
	createMs: number;
	completionMs: number;
	statusChecksMs: number;
	polls: number;
	throughputStepsPerSecond: number;
	output: WorkflowBenchmarkOutput;
};

export type MetricSummary = {
	min: number;
	p50: number;
	p95: number;
	mean: number;
	max: number;
	stddev: number;
};

export type StepMetricSummary = {
	name: string;
	wallMs: MetricSummary;
	callbackMs: MetricSummary;
	orchestrationMs: MetricSummary;
};

export type EngineSummary = {
	runCount: number;
	createMs: MetricSummary;
	startupMs: MetricSummary;
	completionMs: MetricSummary;
	runMs: MetricSummary;
	totalStepWallMs: MetricSummary;
	totalCallbackMs: MetricSummary;
	totalOrchestrationMs: MetricSummary;
	averageStepWallMs: MetricSummary;
	averageStepCallbackMs: MetricSummary;
	averageStepOrchestrationMs: MetricSummary;
	statusChecksMs: MetricSummary;
	polls: MetricSummary;
	throughputStepsPerSecond: MetricSummary;
	perStep: StepMetricSummary[];
};
