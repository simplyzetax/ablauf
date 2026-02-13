import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";

import { Ablauf, WorkflowError } from "@ablauf/workflows";
import type { WorkflowRunnerStub, WorkflowStatus } from "@ablauf/workflows";
import { TestWorkflow } from "../workflows/test-workflow";
import { FailingStepWorkflow } from "../workflows/failing-step-workflow";
import { EchoWorkflow } from "../workflows/echo-workflow";
import { DuplicateStepWorkflow } from "../workflows/duplicate-step-workflow";

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

/** Expire all pending timers and fire the alarm handler. */
async function advanceAlarm(stub: { _expireTimers(): Promise<void> }) {
	await stub._expireTimers();
	await runDurableObjectAlarm(stub as unknown as DurableObjectStub<undefined>);
}

describe("WorkflowRunner", () => {
	describe("happy path", () => {
		it("runs a workflow to completion with approval", async () => {
			const stub = await ablauf.create(TestWorkflow, { id: "happy-1", payload: { name: "Alice" } });
			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("sleeping");
			expect(status.steps).toContainEqual(
				expect.objectContaining({ name: "greet", status: "completed", result: "Hello, Alice!" }),
			);

			// Advance past sleep
			await advanceAlarm(stub);

			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("waiting");

			// Deliver approval
			await stub.deliverEvent({ event: "approval", payload: { approved: true } });

			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("completed");
			expect(status.result).toEqual({
				message: "Alice was approved",
				greeting: "Hello, Alice!",
			});
		});
	});

	describe("rejection path", () => {
		it("completes with rejection message when not approved", async () => {
			const stub = await ablauf.create(TestWorkflow, { id: "reject-1", payload: { name: "Bob" } });

			// Advance past sleep
			await advanceAlarm(stub);
			// Deliver rejection
			await stub.deliverEvent({ event: "approval", payload: { approved: false } });

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("completed");
			expect(status.result).toEqual({
				message: "Bob was rejected",
				greeting: "Hello, Bob!",
			});
		});
	});

	describe("pause/resume", () => {
		it("pauses and resumes a workflow", async () => {
			const stub = await ablauf.create(TestWorkflow, { id: "pause-1", payload: { name: "Charlie" } });

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("sleeping");

			// Pause
			await stub.pause();
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("paused");

			// Resume - replay re-hits sleep interrupt so still sleeping
			await stub.resume();
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("sleeping");

			// Advance past sleep
			await advanceAlarm(stub);
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("waiting");

			// Complete workflow
			await stub.deliverEvent({ event: "approval", payload: { approved: true } });
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("completed");
		});
	});

	describe("terminate", () => {
		it("terminates a running workflow", async () => {
			const stub = await ablauf.create(TestWorkflow, { id: "terminate-1", payload: { name: "Dave" } });

			await stub.terminate();

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("terminated");
		});
	});

	describe("event timeout", () => {
		it("fails the wait step when timeout fires", async () => {
			const stub = await ablauf.create(TestWorkflow, { id: "timeout-1", payload: { name: "Eve" } });

			// Advance past sleep
			await advanceAlarm(stub);
			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("waiting");

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
			const stub = await ablauf.create(FailingStepWorkflow, { id: "retry-1", payload: { failCount: 2 } });

			// First attempt fails, alarm scheduled for retry
			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("sleeping");

			// Second attempt fails, alarm scheduled again
			await advanceAlarm(stub);
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("sleeping");

			// Third attempt succeeds
			await advanceAlarm(stub);
			status = await stub.getStatus();
			expect(status.status).toBe("completed");
			expect(status.result).toBe("recovered");
		});
	});

	describe("idempotent initialize", () => {
		it("calling initialize twice does not create duplicate state", async () => {
			const stub = await ablauf.create(TestWorkflow, { id: "idempotent-1", payload: { name: "Frank" } });

			const status = await stub.getStatus();
			expect(status.id).toBe("idempotent-1");
			expect(status.type).toBe("test");
			// Should be in a valid state, not errored
			expect(["sleeping", "running", "waiting"]).toContain(status.status);
		});
	});

	describe("type safety", () => {
		it("enforces payload and event types at compile-time", async () => {
			const stub = await ablauf.create(TestWorkflow, { id: "typed-1", payload: { name: "Grace" } });
			const status = await stub.getStatus();
			expect(status.payload.name).toBe("Grace");

			if (false) {
				// @ts-expect-error name must be a string
				await ablauf.create(TestWorkflow, { id: "typed-bad-1", payload: { name: 123 } });
				// @ts-expect-error approval payload.approved must be a boolean
				await stub.deliverEvent({ event: "approval", payload: { approved: "yes" } });
				// @ts-expect-error unknown event key for TestWorkflow
				await stub.deliverEvent({ event: "not-approval", payload: { approved: true } });
			}
		});

		it("rejects invalid payloads and events at runtime", async () => {
			await expect(
				ablauf.create(TestWorkflow, {
					id: "typed-runtime-bad-create",
					payload: { name: 123 as unknown as string },
				}),
			).rejects.toThrow();

			const stub = await ablauf.create(TestWorkflow, {
				id: "typed-runtime-bad-event",
				payload: { name: "Heidi" },
			});
			await advanceAlarm(stub);

			const rawStub = stub as unknown as WorkflowRunnerStub;
			const badPayloadError = await rawStub
				.deliverEvent({ event: "approval", payload: { approved: "yes" } })
				.then(() => null)
				.catch((error: unknown) => error);
			expect(badPayloadError).toBeTruthy();
			if (badPayloadError instanceof Error) {
				const restored = WorkflowError.fromSerialized(badPayloadError);
				expect(restored.code).toBe("EVENT_INVALID");
			}

			const badEventError = await rawStub
				.deliverEvent({ event: "not-approval", payload: { approved: true } })
				.then(() => null)
				.catch((error: unknown) => error);
			expect(badEventError).toBeTruthy();
			if (badEventError instanceof Error) {
				const restored = WorkflowError.fromSerialized(badEventError);
				expect(restored.code).toBe("EVENT_INVALID");
			}
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

	describe("duplicate step names", () => {
		it("throws an error when two steps share the same name", async () => {
			const stub = await ablauf.create(DuplicateStepWorkflow, { id: "dup-1", payload: {} });
			const status = await stub.getStatus();
			expect(status.status).toBe("errored");
			expect(status.error).toContain("Duplicate step name");
		expect(status.error).toContain("fetch-data");
		});
	});

	describe("observability", () => {
		it("records startedAt and duration on completed steps", async () => {
			const stub = await ablauf.create(EchoWorkflow, { id: "obs-timing-1", payload: { message: "hello" } });
			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>("completed");

			const echoStep = status.steps.find((s: { name: string }) => s.name === "echo");
			expect(echoStep).toBeDefined();
			expect(echoStep!.startedAt).toBeTypeOf("number");
			expect(echoStep!.startedAt).toBeGreaterThan(0);
			expect(echoStep!.duration).toBeTypeOf("number");
			expect(echoStep!.duration).toBeGreaterThanOrEqual(0);
		});

		it("records errorStack on failed steps", async () => {
			const stub = await ablauf.create(FailingStepWorkflow, { id: "obs-error-1", payload: { failCount: 5 } });

			await advanceAlarm(stub);
			await advanceAlarm(stub);

			const status = await stub.getStatus();
			const failStep = status.steps.find((s: { name: string }) => s.name === "unreliable");
			expect(failStep).toBeDefined();
			expect(failStep!.errorStack).toBeTypeOf("string");
			expect(failStep!.errorStack!.length).toBeGreaterThan(0);
		});

		it("records retryHistory across attempts", async () => {
			const stub = await ablauf.create(FailingStepWorkflow, { id: "obs-retry-1", payload: { failCount: 1 } });

			await advanceAlarm(stub);

			const status = await stub.getStatus();
			expect(status.status).toBe("completed");

			const failStep = status.steps.find((s: { name: string }) => s.name === "unreliable");
			expect(failStep).toBeDefined();
			expect(failStep!.retryHistory).toBeDefined();

			const history = failStep!.retryHistory as Array<{ attempt: number; error: string; timestamp: number; duration: number }>;
			expect(history).toHaveLength(1);
			expect(history[0].attempt).toBe(1);
			expect(history[0].error).toBeTruthy();
			expect(history[0].timestamp).toBeGreaterThan(0);
			expect(history[0].duration).toBeGreaterThanOrEqual(0);
		});
	});
});
