import { Hono } from "hono";
import { Ablauf, WorkflowError } from "@ablauf/workflows";
import { TestWorkflow } from "./workflows/test-workflow";
import { FailingStepWorkflow } from "./workflows/failing-step-workflow";
import { EchoWorkflow } from "./workflows/echo-workflow";
import { SSEWorkflow } from "./workflows/sse-workflow";
import { DuplicateStepWorkflow } from "./workflows/duplicate-step-workflow";
import { env } from "cloudflare:workers";
import type { WorkflowClass } from "@ablauf/workflows";

const workflows = [TestWorkflow, FailingStepWorkflow, EchoWorkflow, SSEWorkflow, DuplicateStepWorkflow];

const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
	workflows,
});

const app = new Hono<{ Bindings: Env }>();

// Centralized error handler
app.onError((err, c) => {
	if (err instanceof WorkflowError) {
		return c.json(
			{
				error: {
					code: err.code,
					message: err.message,
					status: err.status,
					source: err.source,
					...(err.details && { details: err.details }),
				},
			},
			err.status,
		);
	}

	return c.json(
		{
			error: {
				code: "INTERNAL_ERROR" as const,
				message: "An unexpected error occurred",
				status: 500,
				source: "api" as const,
			},
		},
		500,
	);
});

app.post("/workflows/:type", async (c) => {
	const { type } = c.req.param();
	const workflowClass = workflows.find((w) => w.type === type);
	if (!workflowClass) {
		return c.json({ error: "Workflow not found" }, 404);
	}

	const payload = await c.req.json();

	const workflow = await ablauf.create(workflowClass as WorkflowClass, {
		id: crypto.randomUUID(),
		payload,
	});

	while (true) {
		const status = await workflow.getStatus();
		switch (status.status) {
			case "created":
			case "running":
				await new Promise((resolve) => setTimeout(resolve, 1000));
				continue;
			case "completed":
				return c.json(status);
			case "sleeping":
			case "waiting":
			case "paused":
			case "errored":
			case "terminated":
				return c.json(status, 202);
			default:
				return c.json(status, 202);
		}
	}
});

const rpcHandler = ablauf.createRPCHandler();

app.use("/__ablauf/*", async (c, next) => {
	const { matched, response } = await rpcHandler.handle(c.req.raw, {
		prefix: "/__ablauf",
		context: ablauf.getDashboardContext(),
	});

	if (matched) {
		return c.newResponse(response.body, response);
	}

	await next();
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export const WorkflowRunner = ablauf.createWorkflowRunner();
