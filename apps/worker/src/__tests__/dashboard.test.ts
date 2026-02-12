import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { Ablauf, createDashboardHandler } from "@ablauf/workflows";
import { EchoWorkflow } from "../workflows/echo-workflow";

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);
const handler = createDashboardHandler({ binding: env.WORKFLOW_RUNNER, workflows: [EchoWorkflow] });

async function request(path: string): Promise<Response> {
	return handler(new Request(`http://localhost/__ablauf${path}`), "/__ablauf");
}

describe("Dashboard Handler", () => {
	beforeAll(async () => {
		await ablauf.create(EchoWorkflow, { id: "dash-echo-1", payload: { message: "hi" } });
		await ablauf.create(EchoWorkflow, { id: "dash-echo-2", payload: { message: "bye" } });
	});

	it("GET /workflows returns workflow list", async () => {
		const res = await request("/workflows?type=echo");
		expect(res.status).toBe(200);

		const body = await res.json() as { workflows: Array<{ id: string; status: string }> };
		expect(body.workflows.length).toBeGreaterThanOrEqual(2);
	});

	it("GET /workflows/:id returns full workflow detail with observability", async () => {
		const res = await request("/workflows/dash-echo-1");
		expect(res.status).toBe(200);

		const body = await res.json() as { id: string; steps: Array<{ name: string; startedAt: number | null; duration: number | null }> };
		expect(body.id).toBe("dash-echo-1");
		expect(body.steps.length).toBeGreaterThan(0);

		const echoStep = body.steps.find((s) => s.name === "echo");
		expect(echoStep).toBeDefined();
		expect(echoStep!.startedAt).toBeTypeOf("number");
		expect(echoStep!.duration).toBeTypeOf("number");
	});

	it("GET /workflows/:id/timeline returns timeline-shaped data", async () => {
		const res = await request("/workflows/dash-echo-1/timeline");
		expect(res.status).toBe(200);

		const body = await res.json() as { id: string; timeline: Array<{ name: string; startedAt: number; duration: number; status: string }> };
		expect(body.id).toBe("dash-echo-1");
		expect(body.timeline.length).toBeGreaterThan(0);
		expect(body.timeline[0]).toHaveProperty("name");
		expect(body.timeline[0]).toHaveProperty("startedAt");
		expect(body.timeline[0]).toHaveProperty("duration");
		expect(body.timeline[0]).toHaveProperty("status");
	});

	it("GET /workflows/:id returns 404 for unknown workflow", async () => {
		const res = await request("/workflows/nonexistent");
		expect(res.status).toBe(404);
	});
});
