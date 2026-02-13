import { Hono } from "hono";
import { Ablauf, WorkflowError } from "@ablauf/workflows";
import { TestWorkflow } from "./workflows/test-workflow";
import { FailingStepWorkflow } from "./workflows/failing-step-workflow";
import { EchoWorkflow } from "./workflows/echo-workflow";
import { SSEWorkflow } from "./workflows/sse-workflow";
import { env } from "cloudflare:workers";
import type { WorkflowClass } from "@ablauf/workflows";

const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
	workflows: [TestWorkflow, FailingStepWorkflow, EchoWorkflow, SSEWorkflow],
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

app.post("/workflows/:name", async (c) => {
	const { name } = c.req.param();
	const workflows = [TestWorkflow, FailingStepWorkflow, EchoWorkflow, SSEWorkflow];
	const workflowClass = workflows.find((w) => w.type === name);
	if (!workflowClass) {
		return c.json({ error: "Workflow not found" }, 404);
	}

	const payload = await c.req.json<typeof workflowClass.inputSchema.shape>();

	const workflow = await ablauf.create(workflowClass as WorkflowClass, {
		id: crypto.randomUUID(),
		payload,
	});

	let status = await workflow.getStatus();
	while (status.status !== "completed") {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		status = await workflow.getStatus();
	}
	return c.json(status);
});

app.get("/workflows/:id/sse", (c) => {
	return ablauf.sseStream(c.req.param("id"));
});

app.all("/__ablauf/*", (c) => {
	return ablauf.handleDashboard(c.req.raw, "/__ablauf");
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export const WorkflowRunner = ablauf.createWorkflowRunner();
