import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf } from '@der-ablauf/workflows';
import type { WorkflowRunnerStub, WorkflowStatus } from '@der-ablauf/workflows';
import { SizeLimitWorkflow, SizeLimitRetryWorkflow } from '../workflows/size-limit-workflow';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

async function advanceAlarm(rpcStub: WorkflowRunnerStub) {
	await rpcStub._expireTimers();
	await runDurableObjectAlarm(rpcStub as unknown as DurableObjectStub<undefined>);
}

describe('Result size limit', () => {
	it('allows steps that fit within the budget', async () => {
		const stub = await ablauf.create(SizeLimitWorkflow, {
			id: 'size-ok-1',
			payload: { chunkSize: 100, stepCount: 2 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');
		expect(status.result).toEqual({ totalChunks: 2 });
	});

	it('fails with NonRetriableError when budget is exceeded (default onOverflow)', async () => {
		// 1kb = 1024 bytes. First step ~611 bytes fits. Second step would push to ~1222 > 1024.
		const stub = await ablauf.create(SizeLimitWorkflow, {
			id: 'size-exceed-1',
			payload: { chunkSize: 600, stepCount: 2 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('errored');
		expect(status.error).toContain('result size limit');

		// First step should have completed
		const chunk0 = status.steps.find((s: { name: string }) => s.name === 'chunk-0');
		expect(chunk0?.status).toBe('completed');

		// Second step should have failed with only 1 attempt (non-retryable)
		const chunk1 = status.steps.find((s: { name: string }) => s.name === 'chunk-1');
		expect(chunk1?.status).toBe('failed');
		expect(chunk1?.attempts).toBe(1);
	});

	it('single large step exceeding budget fails immediately', async () => {
		const stub = await ablauf.create(SizeLimitWorkflow, {
			id: 'size-single-1',
			payload: { chunkSize: 2000, stepCount: 1 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('errored');
		expect(status.error).toContain('result size limit');
	});

	it('retries when onOverflow is retry', async () => {
		// With onOverflow='retry' and limit=2, the step should be retried then exhaust
		const stub = await ablauf.create(SizeLimitRetryWorkflow, {
			id: 'size-retry-1',
			payload: { chunkSize: 600, stepCount: 2 },
		});

		// After initial run, second step should be sleeping (pending retry)
		let status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('sleeping');

		// Advance alarm — retry executes but still exceeds limit
		await advanceAlarm(stub._rpc);
		status = await stub.getStatus();

		// After 2 attempts (limit=2), retries exhausted -> workflow errors
		expect(status.status).toBe<WorkflowStatus>('errored');
		expect(status.error).toContain('failed after 2 attempts');
	});

	it('cumulative budget tracks across multiple steps', async () => {
		// 1kb limit, 5 steps of 250 bytes -> total ~1305+ bytes after serialization overhead
		// Some steps complete before the limit is reached, then one fails
		const stub = await ablauf.create(SizeLimitWorkflow, {
			id: 'size-cumulative-1',
			payload: { chunkSize: 250, stepCount: 5 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('errored');
		expect(status.error).toContain('result size limit');

		const completedSteps = status.steps.filter((s: { status: string }) => s.status === 'completed');
		expect(completedSteps.length).toBeGreaterThan(0);
		expect(completedSteps.length).toBeLessThan(5);
	});
});
