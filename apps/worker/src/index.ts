import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
	Ablauf,
	WorkflowTypeUnknownError,
	asWorkflowError,
	createInternalWorkflowError,
	toHonoError,
	toWorkflowErrorResponse,
} from '@der-ablauf/workflows';
import { TestWorkflow } from './workflows/test-workflow';
import { FailingStepWorkflow } from './workflows/failing-step-workflow';
import { EchoWorkflow } from './workflows/echo-workflow';
import { SSEWorkflow } from './workflows/sse-workflow';
import { DuplicateStepWorkflow } from './workflows/duplicate-step-workflow';
import { MultiStepWorkflow } from './workflows/multi-step-workflow';
import { ReplayCounterWorkflow } from './workflows/replay-counter-workflow';
import { BackoffConfigWorkflow } from './workflows/backoff-config-workflow';
import { NoSchemaWorkflow } from './workflows/no-schema-workflow';
import { MultiEventWorkflow } from './workflows/multi-event-workflow';
import { BenchmarkAblaufWorkflow } from './workflows/benchmark-ablauf-workflow';
import { env } from 'cloudflare:workers';
import type { WorkflowClass } from '@der-ablauf/workflows';
import { benchmarkRequestSchema, toBenchmarkConfig } from './utils/benchmark-request';
import { compareSummaries, summarizeEngine } from './utils/benchmark-stats';
import { runBenchmarkRounds } from './utils/benchmark-runner';

const workflows = [
	TestWorkflow,
	FailingStepWorkflow,
	EchoWorkflow,
	SSEWorkflow,
	DuplicateStepWorkflow,
	MultiStepWorkflow,
	ReplayCounterWorkflow,
	BackoffConfigWorkflow,
	NoSchemaWorkflow,
	MultiEventWorkflow,
	BenchmarkAblaufWorkflow,
];
const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
	workflows,
	corsOrigins: ['http://localhost:3000'],
});
const { openApiHandler, rpcHandler } = ablauf.createHandlers();

const app = new Hono<{ Bindings: Env }>();

app.use('/__ablauf/*', cors({ origin: ['http://localhost:3000'] }));

app.onError((error, c) => {
	const wfError = asWorkflowError(error, { includeInternal: false });
	if (wfError) {
		const honoError = toHonoError(wfError);
		return c.json(toWorkflowErrorResponse(wfError), honoError.status);
	}

	const internalError = createInternalWorkflowError();
	const honoError = toHonoError(internalError);
	return c.json(toWorkflowErrorResponse(internalError), honoError.status);
});

app.post('/benchmarks/workflows', async (c) => {
	if (!env.BENCHMARK_TOKEN) {
		return c.json(
			{
				error: 'BENCHMARK_TOKEN is not configured. Set it with `npx wrangler secret put BENCHMARK_TOKEN`.',
			},
			503,
		);
	}

	const providedToken = c.req.header('x-benchmark-token');
	if (providedToken !== env.BENCHMARK_TOKEN) {
		return c.json({ error: 'Unauthorized benchmark request' }, 401);
	}

	const body = await c.req.json<unknown>().catch(() => ({}));
	const parsed = benchmarkRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{
				error: 'Invalid benchmark request',
				issues: parsed.error.issues.map((issue) => ({
					path: issue.path.join('.'),
					message: issue.message,
				})),
			},
			400,
		);
	}

	const config = toBenchmarkConfig(parsed.data);
	const { runs, measuredRoundOrder } = await runBenchmarkRounds({
		ablauf,
		benchmarkWorkflowClass: BenchmarkAblaufWorkflow as WorkflowClass,
		cloudflareBinding: c.env.CF_BENCH_WORKFLOW,
		config,
	});

	const ablaufSummary = summarizeEngine(runs.ablauf);
	const cloudflareSummary = summarizeEngine(runs.cloudflare);

	return c.json({
		config,
		fairness: {
			executionPattern: 'alternating-order-per-round',
			warmupsDiscarded: config.warmups,
			identicalPayload: {
				steps: config.steps,
				workIterations: config.workIterations,
			},
			pollIntervalMs: config.pollIntervalMs,
			measuredRoundOrder,
		},
		engines: {
			ablauf: {
				runs: runs.ablauf,
				summary: ablaufSummary,
			},
			cloudflare: {
				runs: runs.cloudflare,
				summary: cloudflareSummary,
			},
		},
		comparison: compareSummaries(ablaufSummary, cloudflareSummary),
	});
});

app.post('/workflows/:type', async (c) => {
	const { type } = c.req.param();
	const workflowClass = workflows.find((w) => w.type === type);
	if (!workflowClass) {
		throw new WorkflowTypeUnknownError(type);
	}

	const payload = await c.req.json();

	const workflow = await ablauf.create(workflowClass as WorkflowClass, {
		id: crypto.randomUUID(),
		payload,
	});

	while (true) {
		const status = await workflow.getStatus();
		switch (status.status) {
			case 'created':
			case 'running':
				await new Promise((resolve) => setTimeout(resolve, 1000));
				continue;
			case 'completed':
				return c.json(status);
			case 'sleeping':
			case 'waiting':
			case 'paused':
			case 'errored':
			case 'terminated':
				return c.json(status, 202);
			default:
				return c.json(status, 202);
		}
	}
});

app.get('/__ablauf/workflows/:id/ws', async (c) => {
	const upgradeHeader = c.req.header('Upgrade');
	if (upgradeHeader !== 'websocket') {
		return c.text('Expected WebSocket upgrade', 426);
	}
	const id = c.req.param('id');
	const doId = c.env.WORKFLOW_RUNNER.idFromName(id);
	const stub = c.env.WORKFLOW_RUNNER.get(doId);
	return stub.fetch(c.req.raw);
});

app.all('/__ablauf/*', async (c) => {
	const { matched: matchedOpenApi, response: responseOpenApi } = await openApiHandler.handle(c.req.raw, {
		prefix: '/__ablauf',
		context: ablauf.getDashboardContext(),
	});

	if (matchedOpenApi) {
		return c.newResponse(responseOpenApi.body, responseOpenApi);
	}

	const { matched: matchedRpc, response: responseRpc } = await rpcHandler.handle(c.req.raw, {
		prefix: '/__ablauf',
		context: ablauf.getDashboardContext(),
	});

	if (matchedRpc) {
		return c.newResponse(responseRpc.body, responseRpc);
	}

	return new Response('Not Found', { status: 404 });
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export const WorkflowRunner = ablauf.createWorkflowRunner();
export { BenchmarkCloudflareWorkflow } from './workflows/benchmark-cloudflare-workflow';
