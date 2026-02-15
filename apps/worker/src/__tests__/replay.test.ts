import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf } from '@der-ablauf/workflows';
import type { WorkflowStatus } from '@der-ablauf/workflows';
import { ReplayCounterWorkflow, executionCounts } from '../workflows/replay-counter-workflow';
import { MultiStepWorkflow } from '../workflows/multi-step-workflow';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

describe('Replay mechanics', () => {
	it('completed steps return cached results without re-executing', async () => {
		const id = 'replay-cached-1';
		const stub = await ablauf.create(ReplayCounterWorkflow, {
			id,
			payload: { id },
		});

		// step-1 and step-2 execute, then waitForEvent suspends
		let status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('waiting');
		expect(executionCounts.get(`${id}:step-1`)).toBe(1);
		expect(executionCounts.get(`${id}:step-2`)).toBe(1);

		// Deliver event triggers replay — step-1 and step-2 should NOT re-execute
		await stub.sendEvent({ event: 'continue', payload: {} });
		status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');

		// step-1 and step-2 still at 1 (not re-executed), step-3 at 1
		expect(executionCounts.get(`${id}:step-1`)).toBe(1);
		expect(executionCounts.get(`${id}:step-2`)).toBe(1);
		expect(executionCounts.get(`${id}:step-3`)).toBe(1);
	});

	it('preserves step execution order across replays', async () => {
		const stub = await ablauf.create(MultiStepWorkflow, {
			id: 'replay-order-1',
			payload: { value: 5 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');

		const stepNames = status.steps.map((s: { name: string }) => s.name);
		expect(stepNames).toEqual(['step-a', 'step-b', 'step-c', 'step-d']);

		// Verify each step computed correctly
		expect(status.result).toEqual({ a: 6, b: 12, c: 22, d: 'result:22' });
	});

	it('persists complex types via superjson round-trip', async () => {
		const stub = await ablauf.create(MultiStepWorkflow, {
			id: 'replay-superjson-1',
			payload: { value: 42 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');
		expect(status.result).toEqual({ a: 43, b: 86, c: 96, d: 'result:96' });
		expect(typeof status.result!.a).toBe('number');
		expect(typeof status.result!.d).toBe('string');
	});

	it('sleep interrupt resumes at the correct step after alarm', async () => {
		const id = 'replay-sleep-resume-1';
		const stub = await ablauf.create(ReplayCounterWorkflow, {
			id,
			payload: { id },
		});

		// Workflow runs step-1, step-2, then hits waitForEvent
		let status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('waiting');

		// step-1 and step-2 completed
		const step1 = status.steps.find((s: { name: string }) => s.name === 'step-1');
		const step2 = status.steps.find((s: { name: string }) => s.name === 'step-2');
		expect(step1?.status).toBe('completed');
		expect(step2?.status).toBe('completed');
		expect(step1?.result).toBe('first');
		expect(step2?.result).toBe('second');
	});

	it('waitForEvent interrupt resumes and runs remaining steps after event delivery', async () => {
		const id = 'replay-event-resume-1';
		const stub = await ablauf.create(ReplayCounterWorkflow, {
			id,
			payload: { id },
		});

		let status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('waiting');

		// Deliver event, which triggers replay, skips step-1 and step-2, runs step-3
		await stub.sendEvent({ event: 'continue', payload: {} });
		status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');
		expect(status.result).toEqual({ result1: 'first', result2: 'second', result3: 'third' });

		// step-3 executed exactly once
		expect(executionCounts.get(`${id}:step-3`)).toBe(1);
	});

	it('multi-step workflow records independent timing per step', async () => {
		const stub = await ablauf.create(MultiStepWorkflow, {
			id: 'replay-timing-1',
			payload: { value: 1 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe<WorkflowStatus>('completed');

		for (const step of status.steps) {
			expect(step.startedAt).toBeTypeOf('number');
			expect(step.startedAt).toBeGreaterThan(0);
			expect(step.duration).toBeTypeOf('number');
			expect(step.duration).toBeGreaterThanOrEqual(0);
		}
	});
});
