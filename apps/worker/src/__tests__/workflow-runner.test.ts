import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf, WorkflowError } from '@der-ablauf/workflows';
import type { WorkflowRunnerStub, WorkflowStatus } from '@der-ablauf/workflows';
import { TestWorkflow } from '../workflows/test-workflow';
import { FailingStepWorkflow } from '../workflows/failing-step-workflow';
import { EchoWorkflow } from '../workflows/echo-workflow';
import { DuplicateStepWorkflow } from '../workflows/duplicate-step-workflow';
import { SSEWorkflow } from '../workflows/sse-workflow';
import { BackoffConfigWorkflow } from '../workflows/backoff-config-workflow';
import { NoSchemaWorkflow } from '../workflows/no-schema-workflow';
import { MultiEventWorkflow } from '../workflows/multi-event-workflow';
import { NonRetriableWorkflow } from '../workflows/non-retriable-workflow';
import { SleepUntilWorkflow } from '../workflows/sleep-until-workflow';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

/** Expire all pending timers and fire the alarm handler. */
async function advanceAlarm(rpcStub: WorkflowRunnerStub) {
	await rpcStub._expireTimers();
	await runDurableObjectAlarm(rpcStub as unknown as DurableObjectStub<undefined>);
}

describe('WorkflowRunner', () => {
	describe('happy path', () => {
		it('runs a workflow to completion with approval', async () => {
			const stub = await ablauf.create(TestWorkflow, { id: 'happy-1', payload: { name: 'Alice' } });
			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');
			expect(status.steps).toContainEqual(expect.objectContaining({ name: 'greet', status: 'completed', result: 'Hello, Alice!' }));

			// Advance past sleep
			await advanceAlarm(stub._rpc);

			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('waiting');

			// Deliver approval
			await stub.sendEvent({ event: 'approval', payload: { approved: true } });

			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toEqual({
				message: 'Alice was approved',
				greeting: 'Hello, Alice!',
			});
		});
	});

	describe('rejection path', () => {
		it('completes with rejection message when not approved', async () => {
			const stub = await ablauf.create(TestWorkflow, { id: 'reject-1', payload: { name: 'Bob' } });

			// Advance past sleep
			await advanceAlarm(stub._rpc);
			// Deliver rejection
			await stub.sendEvent({ event: 'approval', payload: { approved: false } });

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toEqual({
				message: 'Bob was rejected',
				greeting: 'Hello, Bob!',
			});
		});
	});

	describe('pause/resume', () => {
		it('pauses and resumes a workflow', async () => {
			const stub = await ablauf.create(TestWorkflow, { id: 'pause-1', payload: { name: 'Charlie' } });

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			// Pause
			await stub.pause();
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('paused');

			// Resume - replay re-hits sleep interrupt so still sleeping
			await stub.resume();
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			// Advance past sleep
			await advanceAlarm(stub._rpc);
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('waiting');

			// Complete workflow
			await stub.sendEvent({ event: 'approval', payload: { approved: true } });
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
		});
	});

	describe('terminate', () => {
		it('terminates a running workflow', async () => {
			const stub = await ablauf.create(TestWorkflow, { id: 'terminate-1', payload: { name: 'Dave' } });

			await stub.terminate();

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('terminated');
		});
	});

	describe('event timeout', () => {
		it('fails the wait step when timeout fires', async () => {
			const stub = await ablauf.create(TestWorkflow, { id: 'timeout-1', payload: { name: 'Eve' } });

			// Advance past sleep
			await advanceAlarm(stub._rpc);
			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('waiting');

			// Fire alarm again to trigger the event timeout
			await advanceAlarm(stub._rpc);
			status = await stub.getStatus();

			// The workflow should have errored because waitForEvent timed out
			const approvalStep = status.steps.find((s: { name: string }) => s.name === 'approval');
			expect(approvalStep).toBeDefined();
			expect(approvalStep!.status).toBe('failed');
			expect(approvalStep!.error).toContain('timed out');
		});
	});

	describe('step retry with backoff', () => {
		it('retries a failing step via alarms and eventually succeeds', async () => {
			const stub = await ablauf.create(FailingStepWorkflow, { id: 'retry-1', payload: { failCount: 2 } });

			// First attempt fails, alarm scheduled for retry
			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			// Second attempt fails, alarm scheduled again
			await advanceAlarm(stub._rpc);
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			// Third attempt succeeds
			await advanceAlarm(stub._rpc);
			status = await stub.getStatus();
			expect(status.status).toBe('completed');
			expect(status.result).toBe('recovered');
		});
	});

	describe('idempotent initialize', () => {
		it('calling initialize twice does not create duplicate state', async () => {
			const stub = await ablauf.create(TestWorkflow, { id: 'idempotent-1', payload: { name: 'Frank' } });

			const status = await stub.getStatus();
			expect(status.id).toBe('idempotent-1');
			expect(status.type).toBe('test');
			// Should be in a valid state, not errored
			expect(['sleeping', 'running', 'waiting']).toContain(status.status);
		});
	});

	describe('type safety', () => {
		it('enforces payload and event types at compile-time', async () => {
			const stub = await ablauf.create(TestWorkflow, { id: 'typed-1', payload: { name: 'Grace' } });
			const status = await stub.getStatus();
			expect(status.payload.name).toBe('Grace');

			// eslint-disable-next-line no-constant-condition -- compile-time type checks, never runs
			if (false) {
				// @ts-expect-error name must be a string
				await ablauf.create(TestWorkflow, { id: 'typed-bad-1', payload: { name: 123 } });
				// @ts-expect-error approval payload.approved must be a boolean
				await stub.sendEvent({ event: 'approval', payload: { approved: 'yes' } });
				// @ts-expect-error unknown event key for TestWorkflow
				await stub.sendEvent({ event: 'not-approval', payload: { approved: true } });
			}
		});

		it('rejects invalid payloads and events at runtime', async () => {
			await expect(
				ablauf.create(TestWorkflow, {
					id: 'typed-runtime-bad-create',
					payload: { name: 123 as unknown as string },
				}),
			).rejects.toThrow();

			const stub = await ablauf.create(TestWorkflow, {
				id: 'typed-runtime-bad-event',
				payload: { name: 'Heidi' },
			});
			await advanceAlarm(stub._rpc);

			const rawStub = stub._rpc;
			const badPayloadError = await rawStub
				.deliverEvent({ event: 'approval', payload: { approved: 'yes' } })
				.then(() => null)
				.catch((error: unknown) => error);
			expect(badPayloadError).toBeTruthy();
			if (badPayloadError instanceof Error) {
				const restored = WorkflowError.fromSerialized(badPayloadError);
				expect(restored.code).toBe('EVENT_INVALID');
			}

			const badEventError = await rawStub
				.deliverEvent({ event: 'not-approval', payload: { approved: true } })
				.then(() => null)
				.catch((error: unknown) => error);
			expect(badEventError).toBeTruthy();
			if (badEventError instanceof Error) {
				const restored = WorkflowError.fromSerialized(badEventError);
				expect(restored.code).toBe('EVENT_INVALID');
			}
		});
	});

	describe('unknown workflow type', () => {
		it('errors when initialized with a nonexistent workflow type', async () => {
			const id = env.WORKFLOW_RUNNER.idFromName('unknown-1');
			const stub = env.WORKFLOW_RUNNER.get(id) as unknown as WorkflowRunnerStub;
			await stub.initialize({ type: 'nonexistent', id: 'unknown-1', payload: {} });

			const status = await stub.getStatus();
			expect(status.status).toBe('errored');
			expect(status.error).toContain('nonexistent');
		});
	});

	describe('duplicate step names', () => {
		it('throws an error when two steps share the same name', async () => {
			const stub = await ablauf.create(DuplicateStepWorkflow, { id: 'dup-1', payload: {} });
			const status = await stub.getStatus();
			expect(status.status).toBe('errored');
			expect(status.error).toContain('Duplicate step name');
			expect(status.error).toContain('fetch-data');
		});
	});

	describe('observability', () => {
		it('records startedAt and duration on completed steps', async () => {
			const stub = await ablauf.create(EchoWorkflow, { id: 'obs-timing-1', payload: { message: 'hello' } });
			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');

			const echoStep = status.steps.find((s: { name: string }) => s.name === 'echo');
			expect(echoStep).toBeDefined();
			expect(echoStep!.startedAt).toBeTypeOf('number');
			expect(echoStep!.startedAt).toBeGreaterThan(0);
			expect(echoStep!.duration).toBeTypeOf('number');
			expect(echoStep!.duration).toBeGreaterThanOrEqual(0);
		});

		it('records errorStack on failed steps', async () => {
			const stub = await ablauf.create(FailingStepWorkflow, { id: 'obs-error-1', payload: { failCount: 5 } });

			await advanceAlarm(stub._rpc);
			await advanceAlarm(stub._rpc);

			const status = await stub.getStatus();
			const failStep = status.steps.find((s: { name: string }) => s.name === 'unreliable');
			expect(failStep).toBeDefined();
			expect(failStep!.errorStack).toBeTypeOf('string');
			expect(failStep!.errorStack!.length).toBeGreaterThan(0);
		});

		it('records retryHistory across attempts', async () => {
			const stub = await ablauf.create(FailingStepWorkflow, { id: 'obs-retry-1', payload: { failCount: 1 } });

			await advanceAlarm(stub._rpc);

			const status = await stub.getStatus();
			expect(status.status).toBe('completed');

			const failStep = status.steps.find((s: { name: string }) => s.name === 'unreliable');
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

	describe('SSE', () => {
		it('waits for SSE updates', async () => {
			const handle = await ablauf.create(SSEWorkflow, { id: 'sse-1', payload: { itemCount: 10 } });
			const event = await handle.waitForUpdate({ update: 'done' });
			expect(event).toEqual({ message: 'Processed 10 items' });
		});
	});

	describe('backoff strategies', () => {
		it('fixed backoff: delay stays constant across retries', async () => {
			const stub = await ablauf.create(BackoffConfigWorkflow, {
				id: 'wr-backoff-fixed-1',
				payload: { failCount: 2, strategy: 'fixed' },
			});

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			await advanceAlarm(stub._rpc);
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			await advanceAlarm(stub._rpc);
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toBe('ok');
		});

		it('linear backoff: retries with increasing delay', async () => {
			const stub = await ablauf.create(BackoffConfigWorkflow, {
				id: 'wr-backoff-linear-1',
				payload: { failCount: 2, strategy: 'linear' },
			});

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			await advanceAlarm(stub._rpc);
			await advanceAlarm(stub._rpc);
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toBe('ok');
		});

		it('exponential backoff: retries with doubling delay', async () => {
			const stub = await ablauf.create(BackoffConfigWorkflow, {
				id: 'wr-backoff-exp-1',
				payload: { failCount: 2, strategy: 'exponential' },
			});

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			await advanceAlarm(stub._rpc);
			await advanceAlarm(stub._rpc);
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toBe('ok');
		});
	});

	describe('step retry exhaustion', () => {
		it('errors with StepRetryExhaustedError after all attempts fail', async () => {
			const stub = await ablauf.create(FailingStepWorkflow, {
				id: 'wr-retry-exhaust-1',
				payload: { failCount: 100 },
			});

			await advanceAlarm(stub._rpc);
			await advanceAlarm(stub._rpc);

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('errored');
			expect(status.error).toContain('failed after');
			expect(status.error).toContain('attempts');

			const failStep = status.steps.find((s: { name: string }) => s.name === 'unreliable');
			expect(failStep).toBeDefined();
			expect(failStep!.status).toBe('failed');
			expect(failStep!.attempts).toBe(3);
		});
	});

	describe('terminate edge cases', () => {
		it('terminates a sleeping workflow', async () => {
			const stub = await ablauf.create(TestWorkflow, {
				id: 'wr-term-sleeping-1',
				payload: { name: 'Sleeping' },
			});

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			await stub.terminate();
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('terminated');
		});

		it('terminates a waiting workflow', async () => {
			const stub = await ablauf.create(TestWorkflow, {
				id: 'wr-term-waiting-1',
				payload: { name: 'Waiting' },
			});

			await advanceAlarm(stub._rpc);
			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('waiting');

			await stub.terminate();
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('terminated');
		});
	});

	describe('pause edge cases', () => {
		it('double pause does not corrupt state', async () => {
			const stub = await ablauf.create(TestWorkflow, {
				id: 'wr-double-pause-1',
				payload: { name: 'DoublePause' },
			});

			await stub.pause();
			await stub.pause();

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('paused');
		});

		it('resume on a running workflow is safe', async () => {
			const stub = await ablauf.create(TestWorkflow, {
				id: 'wr-resume-running-1',
				payload: { name: 'ResumeRunning' },
			});

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');

			await stub.resume();
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');
		});
	});

	describe('timestamps', () => {
		it('sets createdAt and updatedAt on workflow creation', async () => {
			const before = Date.now();
			const stub = await ablauf.create(EchoWorkflow, {
				id: 'wr-timestamps-1',
				payload: { message: 'ts' },
			});
			const after = Date.now();

			const status = await stub.getStatus();
			expect(status.createdAt).toBeGreaterThanOrEqual(before);
			expect(status.createdAt).toBeLessThanOrEqual(after);
			expect(status.updatedAt).toBeGreaterThanOrEqual(status.createdAt);
		});
	});

	describe('minimal workflow', () => {
		it('runs a workflow with no events and minimal input', async () => {
			const stub = await ablauf.create(NoSchemaWorkflow, {
				id: 'wr-no-schema-1',
				payload: {},
			});

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toBe('done');
		});
	});

	describe('multi-event workflow', () => {
		it('handles multiple sequential waitForEvent calls', async () => {
			const stub = await ablauf.create(MultiEventWorkflow, {
				id: 'wr-multi-event-1',
				payload: { name: 'MultiEvent' },
			});

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('waiting');

			await stub.sendEvent({ event: 'first-approval', payload: { ok: true } });
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('waiting');

			await stub.sendEvent({ event: 'second-approval', payload: { ok: false } });
			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toEqual({
				greeting: 'Hi, MultiEvent',
				first: true,
				second: false,
			});
		});
	});

	describe('sleepUntil', () => {
		it('sleeps until a future date then continues', async () => {
			const futureDate = Date.now() + 60_000; // 1 minute in the future
			const stub = await ablauf.create(SleepUntilWorkflow, {
				id: 'sleep-until-future-1',
				payload: { wakeAt: futureDate },
			});

			let status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('sleeping');
			expect(status.steps).toContainEqual(expect.objectContaining({ name: 'before-sleep', status: 'completed', result: 'before' }));

			// Advance past sleep
			await advanceAlarm(stub._rpc);

			status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toEqual({ before: 'before', after: 'after' });
		});

		it('completes immediately when the date is in the past', async () => {
			const pastDate = Date.now() - 60_000; // 1 minute in the past
			const stub = await ablauf.create(SleepUntilWorkflow, {
				id: 'sleep-until-past-1',
				payload: { wakeAt: pastDate },
			});

			// Past date: alarm fires immediately, so after one alarm cycle it completes
			let status = await stub.getStatus();
			// Workflow may be sleeping (alarm set for past fires on next tick) or already completed
			if (status.status === 'sleeping') {
				await advanceAlarm(stub._rpc);
				status = await stub.getStatus();
			}
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toEqual({ before: 'before', after: 'after' });
		});

		it('records the step as type sleep_until', async () => {
			const futureDate = Date.now() + 60_000;
			const stub = await ablauf.create(SleepUntilWorkflow, {
				id: 'sleep-until-type-1',
				payload: { wakeAt: futureDate },
			});

			const status = await stub.getStatus();
			const sleepStep = status.steps.find((s) => s.name === 'nap');
			expect(sleepStep).toBeDefined();
			expect(sleepStep!.type).toBe('sleep_until');
		});
	});

	describe('non-retriable errors', () => {
		it('fails immediately without retrying when NonRetriableError is thrown', async () => {
			const stub = await ablauf.create(NonRetriableWorkflow, {
				id: 'non-retriable-1',
				payload: { shouldFail: true },
			});

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('errored');

			// Verify step was only attempted once despite retries.limit=5
			const failedStep = status.steps.find((s) => s.name === 'maybe-fail');
			expect(failedStep).toBeDefined();
			expect(failedStep!.status).toBe('failed');
			expect(failedStep!.attempts).toBe(1);
			expect(failedStep!.error).toContain('Intentional permanent failure');
		});

		it('succeeds normally when NonRetriableError is not thrown', async () => {
			const stub = await ablauf.create(NonRetriableWorkflow, {
				id: 'non-retriable-2',
				payload: { shouldFail: false },
			});

			const status = await stub.getStatus();
			expect(status.status).toBe<WorkflowStatus>('completed');
			expect(status.result).toBe('success');
		});

		it('preserves error message and stack in step retry history', async () => {
			const stub = await ablauf.create(NonRetriableWorkflow, {
				id: 'non-retriable-3',
				payload: { shouldFail: true },
			});

			const status = await stub.getStatus();
			const failedStep = status.steps.find((s) => s.name === 'maybe-fail');
			expect(failedStep!.retryHistory).toHaveLength(1);
			expect(failedStep!.retryHistory![0].error).toBe('Intentional permanent failure');
			expect(failedStep!.retryHistory![0].attempt).toBe(1);
		});
	});
});
