import { Hono } from "hono";
import { registry } from "./workflows/registry";
import type { WorkflowRunnerStub } from "./engine/types";

const app = new Hono<{ Bindings: Env }>();

function getWorkflowRunnerStub(env: Env, id: string): WorkflowRunnerStub {
	return env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName(id)) as unknown as WorkflowRunnerStub;
}

// Error handling
app.onError((err, c) => {
	const message = err instanceof Error ? err.message : String(err);
	return c.json({ error: message }, 500);
});

app.get("/", (c) => {
	return c.json({ status: "ok", workflows: Object.keys(registry) });
});

// Create a workflow instance
app.post("/workflows", async (c) => {
	const body = await c.req.json<{ type: string; id: string; payload: unknown }>();
	const { type, id, payload } = body;

	if (!registry[type]) {
		return c.json({ error: `Unknown workflow type: "${type}"` }, 400);
	}

	const stub = getWorkflowRunnerStub(c.env, id);
	await stub.initialize({ type, id, payload });

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
