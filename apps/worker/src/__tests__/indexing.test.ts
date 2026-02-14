import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf, ObservabilityDisabledError } from '@der-ablauf/workflows';
import { EchoWorkflow } from '../workflows/echo-workflow';
import { TestWorkflow } from '../workflows/test-workflow';

describe('Indexing & Observability', () => {
	describe('index entries', () => {
		it('creates an index entry when a workflow starts', async () => {
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow],
				observability: true,
			});

			await ablauf.create(EchoWorkflow, {
				id: 'idx-created-1',
				payload: { message: 'index test' },
			});

			await new Promise((r) => setTimeout(r, 100));

			const entries = await ablauf.list('echo');
			const entry = entries.find((e) => e.id === 'idx-created-1');
			expect(entry).toBeDefined();
			expect(entry!.status).toBe('completed');
		});

		it('index entry updates when status changes', async () => {
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [TestWorkflow],
				observability: true,
			});

			const stub = await ablauf.create(TestWorkflow, {
				id: 'idx-status-change-1',
				payload: { name: 'IndexStatus' },
			});

			await new Promise((r) => setTimeout(r, 100));

			let entries = await ablauf.list('test');
			let entry = entries.find((e) => e.id === 'idx-status-change-1');
			expect(entry).toBeDefined();
			expect(['sleeping', 'running']).toContain(entry!.status);

			await stub.terminate();
			await new Promise((r) => setTimeout(r, 100));

			entries = await ablauf.list('test');
			entry = entries.find((e) => e.id === 'idx-status-change-1');
			expect(entry).toBeDefined();
			expect(entry!.status).toBe('terminated');
		});

		it('list filters by status', async () => {
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow, TestWorkflow],
				observability: true,
			});

			await ablauf.create(EchoWorkflow, {
				id: 'idx-filter-completed-1',
				payload: { message: 'done' },
			});

			await ablauf.create(TestWorkflow, {
				id: 'idx-filter-sleeping-1',
				payload: { name: 'Sleeper' },
			});

			await new Promise((r) => setTimeout(r, 100));

			const completedEntries = await ablauf.list('echo', { status: 'completed' });
			const completedIds = completedEntries.map((e) => e.id);
			expect(completedIds).toContain('idx-filter-completed-1');
		});

		it('list with limit returns capped results sorted by updatedAt', async () => {
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow],
				observability: true,
			});

			for (let i = 0; i < 5; i++) {
				await ablauf.create(EchoWorkflow, {
					id: `idx-limit-${i}`,
					payload: { message: `msg-${i}` },
				});
			}

			await new Promise((r) => setTimeout(r, 100));

			const entries = await ablauf.list('echo', { limit: 2 });
			expect(entries.length).toBeLessThanOrEqual(2);
		});
	});

	describe('observability disabled', () => {
		it('throws ObservabilityDisabledError when listing with observability off', async () => {
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow],
				observability: false,
			});

			await expect(ablauf.list('echo')).rejects.toThrow(ObservabilityDisabledError);
		});
	});
});
