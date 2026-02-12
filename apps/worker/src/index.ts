import { Hono } from "hono";
import {
	Ablauf,
	createWorkflowRunner,
	WorkflowError,
} from "@ablauf/workflows";
import { TestWorkflow } from "./workflows/test-workflow";
import { FailingStepWorkflow } from "./workflows/failing-step-workflow";
import { EchoWorkflow } from "./workflows/echo-workflow";
import { SSEWorkflow } from "./workflows/sse-workflow";
import { env } from "cloudflare:workers";

const workflows = [TestWorkflow, FailingStepWorkflow, EchoWorkflow, SSEWorkflow];

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

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

app.post("/echo", async (c) => {
	const { message } = await c.req.json<{ message: string }>();
	const workflow = await ablauf.create(EchoWorkflow, { id: "echo-1", payload: { message } });

	let status = await workflow.getStatus();
	while (status.status !== "completed") {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		status = await workflow.getStatus();
	}
	return c.json(status.result);
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export const WorkflowRunner = createWorkflowRunner({ workflows });
