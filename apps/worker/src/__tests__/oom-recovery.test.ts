import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf } from '@der-ablauf/workflows';
import type { WorkflowRunnerStub, WorkflowStatus } from '@der-ablauf/workflows';
import { OOMRecoveryWorkflow } from '../workflows/oom-recovery-workflow';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

async function advanceAlarm(rpcStub: WorkflowRunnerStub) {
	await rpcStub._expireTimers();
	await runDurableObjectAlarm(rpcStub as unknown as DurableObjectStub<undefined>);
}

describe('OOM crash recovery', () => {
	it('detects crashed step and retries via backoff', async () => {
		const stub = await ablauf.create(OOMRecoveryWorkflow, {
			id: 'oom-retry-1',
			payload: {},
		});

		// Workflow completes 'first', then sleeps at 'gap'
		let status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('sleeping');
		expect(status.steps).toContainEqual(expect.objectContaining({ name: 'first', status: 'completed' }));

		// Simulate OOM crash on 'second' step (as if write-ahead ran but isolate died)
		await stub._rpc._simulateOOMCrash('second', 1);

		// Fire alarm — replay detects 'running' step, schedules retry with backoff
		await advanceAlarm(stub._rpc);
		status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('sleeping');

		// Fire alarm again — retry executes, step succeeds
		await advanceAlarm(stub._rpc);
		status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');
		expect(status.result).toEqual({ a: 'safe', b: 'recovered' });
	});

	it('exhausts retries after repeated crashes and errors the workflow', async () => {
		const stub = await ablauf.create(OOMRecoveryWorkflow, {
			id: 'oom-exhaust-1',
			payload: {},
		});

		let status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('sleeping');

		// Simulate OOM with attempts already at the limit (3)
		await stub._rpc._simulateOOMCrash('second', 3);

		// Fire alarm — crash recovery detects exhausted retries → workflow errors
		await advanceAlarm(stub._rpc);
		status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('errored');
		expect(status.error).toContain('failed after');
		expect(status.error).toContain('3 attempts');

		// The crashed step should be marked as failed
		const secondStep = status.steps.find((s: { name: string }) => s.name === 'second');
		expect(secondStep).toBeDefined();
		expect(secondStep!.status).toBe('failed');
		expect(secondStep!.error).toContain('Loss of isolate');
	});

	it('records crash in retry history with descriptive message', async () => {
		const stub = await ablauf.create(OOMRecoveryWorkflow, {
			id: 'oom-history-1',
			payload: {},
		});

		let status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('sleeping');

		// Simulate OOM crash (1 attempt)
		await stub._rpc._simulateOOMCrash('second', 1);

		// Fire alarm — crash recovery schedules retry
		await advanceAlarm(stub._rpc);

		// Fire alarm — step retries and succeeds
		await advanceAlarm(stub._rpc);
		status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');

		// Check retry history contains the crash entry
		const secondStep = status.steps.find((s: { name: string }) => s.name === 'second');
		expect(secondStep).toBeDefined();
		expect(secondStep!.retryHistory).toBeDefined();

		const history = secondStep!.retryHistory as Array<{
			attempt: number;
			error: string;
			errorStack: string | null;
			timestamp: number;
			duration: number;
		}>;
		expect(history.length).toBeGreaterThanOrEqual(1);
		expect(history[0].error).toContain('Loss of isolate');
		expect(history[0].errorStack).toBeNull();
	});

	it('preserves completed steps after crash recovery', async () => {
		const stub = await ablauf.create(OOMRecoveryWorkflow, {
			id: 'oom-preserve-1',
			payload: {},
		});

		let status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('sleeping');

		const firstStep = status.steps.find((s: { name: string }) => s.name === 'first');
		expect(firstStep).toBeDefined();
		expect(firstStep!.status).toBe('completed');
		expect(firstStep!.result).toBe('safe');

		// Simulate crash and recover
		await stub._rpc._simulateOOMCrash('second', 1);
		await advanceAlarm(stub._rpc);
		await advanceAlarm(stub._rpc);

		status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');

		// First step's cached result must survive the crash recovery cycle
		const firstStepAfter = status.steps.find((s: { name: string }) => s.name === 'first');
		expect(firstStepAfter!.status).toBe('completed');
		expect(firstStepAfter!.result).toBe('safe');
		expect(status.result).toEqual({ a: 'safe', b: 'recovered' });
	});

	it('handles multiple consecutive crashes before succeeding', async () => {
		const stub = await ablauf.create(OOMRecoveryWorkflow, {
			id: 'oom-multi-crash-1',
			payload: {},
		});

		let status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('sleeping');

		// First crash (attempt 1)
		await stub._rpc._simulateOOMCrash('second', 1);
		await advanceAlarm(stub._rpc);
		status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('sleeping');

		// Second crash (attempt 2) — simulate crashing again during the retry
		await stub._rpc._simulateOOMCrash('second', 2);
		await advanceAlarm(stub._rpc);
		status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('sleeping');

		// Third attempt succeeds
		await advanceAlarm(stub._rpc);
		status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');
		expect(status.result).toEqual({ a: 'safe', b: 'recovered' });

		// Retry history should show both crashes
		const secondStep = status.steps.find((s: { name: string }) => s.name === 'second');
		const history = secondStep!.retryHistory as Array<{ attempt: number; error: string }>;
		expect(history.length).toBeGreaterThanOrEqual(2);
		expect(history[0].error).toContain('Loss of isolate');
		expect(history[1].error).toContain('Loss of isolate');
	});
});
