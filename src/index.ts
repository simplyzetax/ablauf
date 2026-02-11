import { Hono } from "hono";
import { registry } from "./workflows/registry";
import type { WorkflowRunnerStub } from "./engine/types";
import { WorkflowError, WorkflowTypeUnknownError, PayloadValidationError } from "./engine/errors";

const app = new Hono<{ Bindings: Env }>();

function getWorkflowRunnerStub(env: Env, id: string): WorkflowRunnerStub {
	return env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName(id)) as unknown as WorkflowRunnerStub;
}

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

// Middleware: re-hydrate WorkflowErrors from DO RPC calls
app.use("/workflows/*", async (c, next) => {
	try {
		await next();
	} catch (e) {
		throw WorkflowError.fromSerialized(e);
	}
});

app.get("/", (c) => {
	return c.json({ status: "ok", workflows: Object.keys(registry) });
});

// Create a workflow instance
app.post("/workflows", async (c) => {
	const body = await c.req.json<{ type: string; id: string; payload: unknown }>();
	const { type, id, payload } = body;

	if (!registry[type]) {
		throw new WorkflowTypeUnknownError(type);
	}

	const WorkflowClass = registry[type];
	let parsed: unknown;
	try {
		parsed = WorkflowClass.inputSchema?.parse(payload) ?? payload;
	} catch (e) {
		const issues = e instanceof Error && "issues" in e ? (e as { issues: unknown[] }).issues : [{ message: String(e) }];
		throw new PayloadValidationError("Invalid workflow input", issues);
	}

	const stub = getWorkflowRunnerStub(c.env, id);
	await stub.initialize({ type, id, payload: parsed });

	return c.json({ id, type, status: "running" }, 201);
});

// Get workflow status
app.get("/workflows/:id", async (c) => {
	const id = c.req.param("id");
	const stub = getWorkflowRunnerStub(c.env, id);
	const status = await stub.getStatus();
	return c.json(status);
});

// Pause workflow
app.post("/workflows/:id/pause", async (c) => {
	const id = c.req.param("id");
	const stub = getWorkflowRunnerStub(c.env, id);
	await stub.pause();
	return c.json({ id, status: "paused" });
});

// Resume workflow
app.post("/workflows/:id/resume", async (c) => {
	const id = c.req.param("id");
	const stub = getWorkflowRunnerStub(c.env, id);
	await stub.resume();
	return c.json({ id, status: "running" });
});

// Terminate workflow
app.post("/workflows/:id/terminate", async (c) => {
	const id = c.req.param("id");
	const stub = getWorkflowRunnerStub(c.env, id);
	await stub.terminate();
	return c.json({ id, status: "terminated" });
});

// Send event to workflow
app.post("/workflows/:id/events/:event", async (c) => {
	const id = c.req.param("id");
	const event = c.req.param("event");
	const body = await c.req.json();
	const stub = getWorkflowRunnerStub(c.env, id);
	await stub.deliverEvent({ event, payload: body });
	return c.json({ id, event, status: "delivered" });
});

// List workflows by type (queries index shard)
app.get("/workflows", async (c) => {
	const type = c.req.query("type");
	const status = c.req.query("status");
	const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 50;

	if (type) {
		const indexId = c.env.WORKFLOW_RUNNER.idFromName(`__index:${type}`);
		const indexStub = c.env.WORKFLOW_RUNNER.get(indexId) as unknown as WorkflowRunnerStub;
		const results = await indexStub.indexList({ status: status ?? undefined, limit });
		return c.json({ type, instances: results });
	}

	const results = await Promise.all(
		Object.keys(registry).map(async (wfType) => {
			const indexId = c.env.WORKFLOW_RUNNER.idFromName(`__index:${wfType}`);
			const indexStub = c.env.WORKFLOW_RUNNER.get(indexId) as unknown as WorkflowRunnerStub;
			const instances = await indexStub.indexList({ status: status ?? undefined, limit });
			return { type: wfType, instances };
		}),
	);

	return c.json({ workflows: results });
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { WorkflowRunner } from "./engine/workflow-runner";
