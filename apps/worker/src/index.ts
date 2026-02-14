import { Hono } from "hono";
import { cors } from "hono/cors";
import { Ablauf, WorkflowError, WorkflowTypeUnknownError } from "@ablauf/workflows";
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
	corsOrigins: ["http://localhost:3000"],
});
const { openApiHandler, rpcHandler } = ablauf.createHandlers();

const app = new Hono<{ Bindings: Env }>();

app.use("/__ablauf/*", cors({ origin: ["http://localhost:3000"] }));

app.post("/workflows/:type", async (c) => {
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

app.all("/__ablauf/*", async (c) => {
	const { matched: matchedOpenApi, response: responseOpenApi } = await openApiHandler.handle(c.req.raw, {
		prefix: "/__ablauf",
		context: ablauf.getDashboardContext(),
	});

	if (matchedOpenApi) {
		return c.newResponse(responseOpenApi.body, responseOpenApi);
	}

	const { matched: matchedRpc, response: responseRpc } = await rpcHandler.handle(c.req.raw, {
		prefix: "/__ablauf",
		context: ablauf.getDashboardContext(),
	});

	if (matchedRpc) {
		return c.newResponse(responseRpc.body, responseRpc);
	}

	return new Response("Not Found", { status: 404 });
});
export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;
export const WorkflowRunner = ablauf.createWorkflowRunner();
