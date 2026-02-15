import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf } from '@der-ablauf/workflows';
import type { WorkflowRunnerStub, WorkflowStatus } from '@der-ablauf/workflows';
import { TestWorkflow } from '../workflows/test-workflow';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

async function advanceAlarm(rpcStub: WorkflowRunnerStub) {
	await rpcStub._expireTimers();
	await runDurableObjectAlarm(rpcStub as unknown as DurableObjectStub<undefined>);
}

describe('Event Buffering', () => {
	it('buffers an event sent before waitForEvent and delivers it when reached', async () => {
		// Create workflow — it will be sleeping (step.sleep before waitForEvent)
		const stub = await ablauf.create(TestWorkflow, {
			id: 'eb-buffer-deliver-1',
			payload: { name: 'BufferTest' },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('sleeping');

		// Send event BEFORE the workflow reaches waitForEvent — should NOT throw
		await stub.sendEvent({ event: 'approval', payload: { approved: true } });

		// Advance the sleep alarm so the workflow replays and hits waitForEvent
		await advanceAlarm(stub._rpc);

		// Workflow should complete (buffered event consumed by waitForEvent)
		const finalStatus = await stub.getStatus();
		expect(finalStatus.status).toBe<WorkflowStatus>('completed');
		expect(finalStatus.result).toEqual({
			message: 'BufferTest was approved',
			greeting: 'Hello, BufferTest!',
		});
	});

	it('last-write-wins: later event overwrites earlier one', async () => {
		const stub = await ablauf.create(TestWorkflow, {
			id: 'eb-last-write-wins-1',
			payload: { name: 'LastWrite' },
		});

		// Send two events before workflow reaches waitForEvent
		await stub.sendEvent({ event: 'approval', payload: { approved: false } });
		await stub.sendEvent({ event: 'approval', payload: { approved: true } });

		// Advance sleep alarm
		await advanceAlarm(stub._rpc);

		// Workflow should use the LAST event (approved: true)
		const finalStatus = await stub.getStatus();
		expect(finalStatus.status).toBe<WorkflowStatus>('completed');
		expect(finalStatus.result).toEqual({
			message: 'LastWrite was approved',
			greeting: 'Hello, LastWrite!',
		});
	});

	it('rejects buffered event for completed workflow', async () => {
		// EchoWorkflow completes immediately
		const { EchoWorkflow } = await import('../workflows/echo-workflow');
		const stub = await ablauf.create(EchoWorkflow, {
			id: 'eb-completed-reject-1',
			payload: { message: 'done' },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');

		// Sending event to completed workflow should still throw
		const error = await stub._rpc
			.deliverEvent({ event: 'nonexistent', payload: {} })
			.then(() => null)
			.catch((e: unknown) => e);
		expect(error).toBeTruthy();
	});

	it('rejects buffered event for terminated workflow', async () => {
		const stub = await ablauf.create(TestWorkflow, {
			id: 'eb-terminated-reject-1',
			payload: { name: 'Terminated' },
		});

		await stub.terminate();

		const error = await stub._rpc
			.deliverEvent({ event: 'approval', payload: { approved: true } })
			.then(() => null)
			.catch((e: unknown) => e);
		expect(error).toBeTruthy();
	});

	it('still validates event schema when buffering', async () => {
		const stub = await ablauf.create(TestWorkflow, {
			id: 'eb-validation-1',
			payload: { name: 'Validate' },
		});

		// Invalid payload should still throw EVENT_INVALID even when buffering
		const { WorkflowError } = await import('@der-ablauf/workflows');
		const error = await stub._rpc
			.deliverEvent({ event: 'approval', payload: { approved: 'not-a-boolean' } })
			.then(() => null)
			.catch((e: unknown) => e);
		expect(error).toBeTruthy();
		if (error instanceof Error) {
			const restored = WorkflowError.fromSerialized(error);
			expect(restored.code).toBe('EVENT_INVALID');
		}
	});

	it('direct delivery still works when step is already waiting', async () => {
		const stub = await ablauf.create(TestWorkflow, {
			id: 'eb-direct-delivery-1',
			payload: { name: 'Direct' },
		});

		// Advance past sleep so workflow reaches waitForEvent
		await advanceAlarm(stub._rpc);
		const waitingStatus = await stub.getStatus();
		expect(waitingStatus.status).toBe<WorkflowStatus>('waiting');

		// Send event — should deliver directly (not buffer)
		await stub.sendEvent({ event: 'approval', payload: { approved: true } });

		const finalStatus = await stub.getStatus();
		expect(finalStatus.status).toBe<WorkflowStatus>('completed');
		expect(finalStatus.result).toEqual({
			message: 'Direct was approved',
			greeting: 'Hello, Direct!',
		});
	});
});
