import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf, WorkflowError } from '@der-ablauf/workflows';
import type { WorkflowRunnerStub, WorkflowStatus } from '@der-ablauf/workflows';
import { TestWorkflow } from '../workflows/test-workflow';
import { EchoWorkflow } from '../workflows/echo-workflow';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

async function advanceAlarm(rpcStub: WorkflowRunnerStub) {
	await rpcStub._expireTimers();
	await runDurableObjectAlarm(rpcStub as unknown as DurableObjectStub<undefined>);
}

describe('Concurrency & Error Paths', () => {
	it('event delivery to a completed workflow returns error', async () => {
		const stub = await ablauf.create(EchoWorkflow, {
			id: 'cc-completed-event-1',
			payload: { message: 'done' },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');

		const rawStub = stub._rpc;
		const error = await rawStub
			.deliverEvent({ event: 'nonexistent', payload: {} })
			.then(() => null)
			.catch((e: unknown) => e);
		expect(error).toBeTruthy();
	});

	it('event delivery with wrong event name returns EVENT_INVALID', async () => {
		const stub = await ablauf.create(TestWorkflow, {
			id: 'cc-wrong-event-1',
			payload: { name: 'WrongEvent' },
		});

		await advanceAlarm(stub._rpc);
		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('waiting');

		const rawStub = stub._rpc;
		const error = await rawStub
			.deliverEvent({ event: 'nonexistent', payload: {} })
			.then(() => null)
			.catch((e: unknown) => e);
		expect(error).toBeTruthy();
		if (error instanceof Error) {
			const restored = WorkflowError.fromSerialized(error);
			expect(restored.code).toBe('EVENT_INVALID');
		}
	});

	it('event delivery with invalid payload returns EVENT_INVALID', async () => {
		const stub = await ablauf.create(TestWorkflow, {
			id: 'cc-bad-payload-1',
			payload: { name: 'BadPayload' },
		});

		await advanceAlarm(stub._rpc);
		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('waiting');

		const rawStub = stub._rpc;
		const error = await rawStub
			.deliverEvent({ event: 'approval', payload: { approved: 'not-a-boolean' } })
			.then(() => null)
			.catch((e: unknown) => e);
		expect(error).toBeTruthy();
		if (error instanceof Error) {
			const restored = WorkflowError.fromSerialized(error);
			expect(restored.code).toBe('EVENT_INVALID');
		}
	});

	it('payload validation rejects invalid input at create time', async () => {
		await expect(
			ablauf.create(TestWorkflow, {
				id: 'cc-bad-create-1',
				payload: { name: 123 as unknown as string },
			}),
		).rejects.toThrow();
	});

	it('create with unknown workflow type errors', async () => {
		const id = env.WORKFLOW_RUNNER.idFromName('cc-unknown-type-1');
		const stub = env.WORKFLOW_RUNNER.get(id) as unknown as WorkflowRunnerStub;
		await stub.initialize({ type: 'definitely-not-registered', id: 'cc-unknown-type-1', payload: {} });

		const status = await stub.getStatus();
		expect(status.status).toBe('errored');
		expect(status.error).toContain('definitely-not-registered');
	});

	it('event to non-waiting step is buffered instead of erroring', async () => {
		const stub = await ablauf.create(TestWorkflow, {
			id: 'cc-not-waiting-1',
			payload: { name: 'NotWaiting' },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('sleeping');

		// With event buffering, this should succeed (not throw)
		await stub._rpc.deliverEvent({ event: 'approval', payload: { approved: true } });

		// Advance the sleep alarm — workflow should consume the buffered event and complete
		await advanceAlarm(stub._rpc);

		const finalStatus = await stub.getStatus();
		expect(finalStatus.status).toBe<WorkflowStatus>('completed');
	});
});
