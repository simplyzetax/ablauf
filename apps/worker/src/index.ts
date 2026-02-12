import { Hono } from "hono";
import {
	createWorkflowRunner,
	WorkflowError,
} from "@ablauf/workflows";
import { TestWorkflow } from "./workflows/test-workflow";
import { FailingStepWorkflow } from "./workflows/failing-step-workflow";
import { EchoWorkflow } from "./workflows/echo-workflow";

const workflows = [TestWorkflow, FailingStepWorkflow, EchoWorkflow];

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

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export const WorkflowRunner = createWorkflowRunner({ workflows });
