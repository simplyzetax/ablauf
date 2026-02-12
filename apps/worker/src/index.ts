import { Hono } from "hono";
import {
	createWorkflowRunner,
	Ablauf,
	WorkflowError,
	WorkflowTypeUnknownError,
	PayloadValidationError,
	extractZodIssues,
} from "@ablauf/workflows";
import type { WorkflowClass, WorkflowRunnerStub } from "@ablauf/workflows";
import { TestWorkflow } from "./workflows/test-workflow";
import { FailingStepWorkflow } from "./workflows/failing-step-workflow";
import { EchoWorkflow } from "./workflows/echo-workflow";

const workflows: WorkflowClass[] = [TestWorkflow, FailingStepWorkflow, EchoWorkflow];

const registry: Record<string, WorkflowClass> = {};
for (const wf of workflows) {
	registry[wf.type] = wf;
}

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

// ─── Echo demo route ───

app.post("/echo", async (c) => {
	const body = await c.req.json<{ message: string }>();
	const ablauf = new Ablauf(c.env.WORKFLOW_RUNNER);
	const id = `echo-${crypto.randomUUID()}`;
	const stub = await ablauf.create(EchoWorkflow, { id, payload: { message: body.message } });
	const status = await stub.getStatus();
	return c.json(status.result);
});

// ─── Generic workflow CRUD ───

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
		const issues = extractZodIssues(e);
		throw new PayloadValidationError("Invalid workflow input", issues);
	}

	const ablauf = new Ablauf(c.env.WORKFLOW_RUNNER);
	await ablauf.create(WorkflowClass, { id, payload: parsed });

	return c.json({ id, type, status: "running" }, 201);
});

// Get workflow status
app.get("/workflows/:id", async (c) => {
	const id = c.req.param("id");
	const ablauf = new Ablauf(c.env.WORKFLOW_RUNNER);
	const status = await ablauf.status(id);
	return c.json(status);
});

// Pause workflow
app.post("/workflows/:id/pause", async (c) => {
	const id = c.req.param("id");
	const ablauf = new Ablauf(c.env.WORKFLOW_RUNNER);
	await ablauf.pause(id);
	return c.json({ id, status: "paused" });
});

// Resume workflow
app.post("/workflows/:id/resume", async (c) => {
	const id = c.req.param("id");
	const ablauf = new Ablauf(c.env.WORKFLOW_RUNNER);
	await ablauf.resume(id);
	return c.json({ id, status: "running" });
});

// Terminate workflow
app.post("/workflows/:id/terminate", async (c) => {
	const id = c.req.param("id");
	const ablauf = new Ablauf(c.env.WORKFLOW_RUNNER);
	await ablauf.terminate(id);
	return c.json({ id, status: "terminated" });
});

// Send event to workflow
app.post("/workflows/:id/events/:event", async (c) => {
	const id = c.req.param("id");
	const event = c.req.param("event");
	const body = await c.req.json();
	const stub = new Ablauf(c.env.WORKFLOW_RUNNER) as unknown as { getStub(id: string): WorkflowRunnerStub };
	// Use raw stub for untyped event delivery
	const rawStub = c.env.WORKFLOW_RUNNER.get(c.env.WORKFLOW_RUNNER.idFromName(id)) as unknown as WorkflowRunnerStub;
	await rawStub.deliverEvent({ event, payload: body });
	return c.json({ id, event, status: "delivered" });
});

// List workflows by type (queries index shard)
app.get("/workflows", async (c) => {
	const type = c.req.query("type");
	const status = c.req.query("status");
	const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 50;
	const ablauf = new Ablauf(c.env.WORKFLOW_RUNNER);

	if (type) {
		const results = await ablauf.list(type, { status: status ?? undefined, limit });
		return c.json({ type, instances: results });
	}

	const results = await Promise.all(
		Object.keys(registry).map(async (wfType) => {
			const instances = await ablauf.list(wfType, { status: status ?? undefined, limit });
			return { type: wfType, instances };
		}),
	);

	return c.json({ workflows: results });
});

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export const WorkflowRunner = createWorkflowRunner({ workflows });
