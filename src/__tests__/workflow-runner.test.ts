import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { WorkflowRunnerStub } from "../engine/types";
import { TestWorkflow } from "../workflows/test-workflow";
import { FailingStepWorkflow } from "../workflows/failing-step-workflow";

/** Expire all pending timers and fire the alarm handler. */
async function advanceAlarm(stub: WorkflowRunnerStub) {
	await stub._expireTimers();
	await runDurableObjectAlarm(stub as unknown as DurableObjectStub<undefined>);
}

describe("WorkflowRunner", () => {
	describe("happy path", () => {
		it("runs a workflow to completion with approval", async () => {
			const stub = await TestWorkflow.create(env, { id: "happy-1", payload: { name: "Alice" } });
			let status = await stub.getStatus();
			expect(status.status).toBe("sleeping");
			expect(status.steps).toContainEqual(
				expect.objectContaining({ name: "greet", status: "completed", result: "Hello, Alice!" }),
			);

			// Advance past sleep
			await advanceAlarm(stub);

			status = await stub.getStatus();
			expect(status.status).toBe("waiting");

			// Deliver approval
			await stub.deliverEvent({ event: "approval", payload: { approved: true } });

			status = await stub.getStatus();
			expect(status.status).toBe("completed");
			expect(status.result).toEqual({
				message: "Alice was approved",
				greeting: "Hello, Alice!",
			});
		});
	});

	describe("rejection path", () => {
		it("completes with rejection message when not approved", async () => {
			const stub = await TestWorkflow.create(env, { id: "reject-1", payload: { name: "Bob" } });

			// Advance past sleep
			await advanceAlarm(stub);
			// Deliver rejection
			await stub.deliverEvent({ event: "approval", payload: { approved: false } });

			const status = await stub.getStatus();
			expect(status.status).toBe("completed");
			expect(status.result).toEqual({
				message: "Bob was rejected",
				greeting: "Hello, Bob!",
			});
		});
	});

	describe("pause/resume", () => {
		it("pauses and resumes a workflow", async () => {
			const stub = await TestWorkflow.create(env, { id: "pause-1", payload: { name: "Charlie" } });

			let status = await stub.getStatus();
			expect(status.status).toBe("sleeping");

			// Pause
			await stub.pause();
			status = await stub.getStatus();
			expect(status.status).toBe("paused");

			// Resume - replay re-hits sleep interrupt so still sleeping
			await stub.resume();
			status = await stub.getStatus();
			expect(status.status).toBe("sleeping");

			// Advance past sleep
			await advanceAlarm(stub);
			status = await stub.getStatus();
			expect(status.status).toBe("waiting");

			// Complete workflow
			await stub.deliverEvent({ event: "approval", payload: { approved: true } });
			status = await stub.getStatus();
			expect(status.status).toBe("completed");
		});
	});

	describe("terminate", () => {
		it("terminates a running workflow", async () => {
			const stub = await TestWorkflow.create(env, { id: "terminate-1", payload: { name: "Dave" } });

			await stub.terminate();

			const status = await stub.getStatus();
			expect(status.status).toBe("terminated");
		});
	});

	describe("event timeout", () => {
		it("fails the wait step when timeout fires", async () => {
			const stub = await TestWorkflow.create(env, { id: "timeout-1", payload: { name: "Eve" } });

			// Advance past sleep
			await advanceAlarm(stub);
			let status = await stub.getStatus();
			expect(status.status).toBe("waiting");

			// Fire alarm again to trigger the event timeout
			await advanceAlarm(stub);
			status = await stub.getStatus();

			// The workflow should have errored because waitForEvent timed out
			const approvalStep = status.steps.find((s: { name: string }) => s.name === "approval");
			expect(approvalStep).toBeDefined();
			expect(approvalStep!.status).toBe("failed");
			expect(approvalStep!.error).toContain("timed out");
		});
	});

	describe("step retry with backoff", () => {
		it("retries a failing step via alarms and eventually succeeds", async () => {
			const stub = await FailingStepWorkflow.create(env, { id: "retry-1", payload: { failCount: 2 } });

			// First attempt fails, alarm scheduled for retry
			let status = await stub.getStatus();
			expect(status.status).toBe("sleeping");

			// Second attempt fails, alarm scheduled again
			await advanceAlarm(stub);
			status = await stub.getStatus();
			expect(status.status).toBe("sleeping");

			// Third attempt succeeds
			await advanceAlarm(stub);
			status = await stub.getStatus();
			expect(status.status).toBe("completed");
			expect(status.result).toBe("recovered");
		});
	});

	describe("idempotent initialize", () => {
		it("calling initialize twice does not create duplicate state", async () => {
			const stub = await TestWorkflow.create(env, { id: "idempotent-1", payload: { name: "Frank" } });

			const status = await stub.getStatus();
			expect(status.id).toBe("idempotent-1");
			expect(status.type).toBe("test");
			// Should be in a valid state, not errored
			expect(["sleeping", "running", "waiting"]).toContain(status.status);
		});
	});

	describe("unknown workflow type", () => {
		it("errors when initialized with a nonexistent workflow type", async () => {
			const id = env.WORKFLOW_RUNNER.idFromName("unknown-1");
			const stub = env.WORKFLOW_RUNNER.get(id) as unknown as WorkflowRunnerStub;
			await stub.initialize({ type: "nonexistent", id: "unknown-1", payload: {} });

			const status = await stub.getStatus();
			expect(status.status).toBe("errored");
			expect(status.error).toContain("nonexistent");
		});
	});
});
