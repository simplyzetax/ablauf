import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf } from '@der-ablauf/workflows';
import type { WorkflowRunnerStub } from '@der-ablauf/workflows';
import { SSEWorkflow } from '../workflows/sse-workflow';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

describe('SSE', () => {
	it('workflow completes and persists emit messages', async () => {
		const stub = await ablauf.create(SSEWorkflow, {
			id: 'sse-1',
			payload: { itemCount: 10 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe('completed');
		expect(status.result).toEqual({ processed: 10 });
	});

	it('connectSSE returns a readable stream with persisted messages', async () => {
		await ablauf.create(SSEWorkflow, {
			id: 'sse-stream-1',
			payload: { itemCount: 6 },
		});

		const rawStub = env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName('sse-stream-1')) as unknown as WorkflowRunnerStub;

		const stream = await rawStub.connectSSE();
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		const { value } = await reader.read();
		const text = decoder.decode(value);
		expect(text).toContain('event: done');
		expect(text).toContain('Processed 6 items');

		reader.releaseLock();
	});

	it('broadcast messages are not persisted (fire-and-forget)', async () => {
		await ablauf.create(SSEWorkflow, {
			id: 'sse-broadcast-1',
			payload: { itemCount: 4 },
		});

		const rawStub = env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName('sse-broadcast-1')) as unknown as WorkflowRunnerStub;

		const stream = await rawStub.connectSSE();
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		const { value } = await reader.read();
		const text = decoder.decode(value);
		expect(text).toContain('event: done');
		expect(text).not.toContain('event: progress');

		reader.releaseLock();
	});

	it('waitForUpdate resolves typed data for persisted emit updates', async () => {
		await ablauf.create(SSEWorkflow, {
			id: 'sse-wait-update-1',
			payload: { itemCount: 8 },
		});

		const done = await ablauf.waitForUpdate(SSEWorkflow, {
			id: 'sse-wait-update-1',
			update: 'done',
		});

		expect(done).toEqual({ message: 'Processed 8 items' });
	});

	it('persisted SSE messages are flushed on connectSSE for completed workflows', async () => {
		await ablauf.create(SSEWorkflow, {
			id: 'sse-close-1',
			payload: { itemCount: 3 },
		});

		const rawStub = env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName('sse-close-1')) as unknown as WorkflowRunnerStub;

		const stream = await rawStub.connectSSE();
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		// Read the first chunk which should contain flushed persisted messages
		const { value, done } = await reader.read();
		expect(done).toBe(false);
		const text = decoder.decode(value);
		expect(text).toContain('event: done');
		expect(text).toContain('Processed 3 items');

		reader.releaseLock();
	});

	it('connectSSE on workflow without sseUpdates returns empty stream', async () => {
		const { EchoWorkflow } = await import('../workflows/echo-workflow');

		await new Ablauf(env.WORKFLOW_RUNNER).create(EchoWorkflow, {
			id: 'sse-no-schema-1',
			payload: { message: 'no sse' },
		});

		const rawStub = env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName('sse-no-schema-1')) as unknown as WorkflowRunnerStub;
		const stream = await rawStub.connectSSE();
		const reader = stream.getReader();

		const { done } = await reader.read();
		expect(done).toBe(true);
	});
});
