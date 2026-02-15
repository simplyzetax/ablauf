import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { call } from '@orpc/server';

import { Ablauf, dashboardRouter, ShardObservabilityProvider } from '@der-ablauf/workflows';
import type { DashboardContext } from '@der-ablauf/workflows';
import { EchoWorkflow } from '../workflows/echo-workflow';
import { TestWorkflow } from '../workflows/test-workflow';
import { MultiStepWorkflow } from '../workflows/multi-step-workflow';

const workflows = [EchoWorkflow, TestWorkflow, MultiStepWorkflow];

const context: DashboardContext = {
	binding: env.WORKFLOW_RUNNER,
	workflows,
	provider: new ShardObservabilityProvider(env.WORKFLOW_RUNNER, {
		workflowTypes: workflows.map((w) => w.type),
	}),
};

const ablauf = new Ablauf(env.WORKFLOW_RUNNER, { workflows, observability: true });

describe('Dashboard API', () => {
	describe('GET /workflows (list)', () => {
		it('lists workflows across types', async () => {
			await ablauf.create(EchoWorkflow, {
				id: 'dash-list-echo-1',
				payload: { message: 'list test' },
			});
			await ablauf.create(TestWorkflow, {
				id: 'dash-list-test-1',
				payload: { name: 'ListTest' },
			});

			await new Promise((r) => setTimeout(r, 100));

			const result = await call(dashboardRouter.workflows.list, {}, { context });
			expect(result.workflows).toBeDefined();
			expect(Array.isArray(result.workflows)).toBe(true);

			const ids = result.workflows.map((w) => w.id);
			expect(ids).toContain('dash-list-echo-1');
			expect(ids).toContain('dash-list-test-1');
		});

		it('filters by type', async () => {
			await ablauf.create(EchoWorkflow, {
				id: 'dash-filter-type-1',
				payload: { message: 'echo' },
			});

			await new Promise((r) => setTimeout(r, 100));

			const result = await call(dashboardRouter.workflows.list, { type: 'echo' }, { context });
			const types = result.workflows.map((w) => w.type);
			for (const t of types) {
				expect(t).toBe('echo');
			}
		});

		it('applies limit', async () => {
			for (let i = 0; i < 5; i++) {
				await ablauf.create(EchoWorkflow, {
					id: `dash-limit-${i}`,
					payload: { message: `msg ${i}` },
				});
			}

			await new Promise((r) => setTimeout(r, 100));

			const result = await call(dashboardRouter.workflows.list, { limit: 2 }, { context });
			expect(result.workflows.length).toBeLessThanOrEqual(2);
		});
	});

	describe('GET /workflows/{id} (get)', () => {
		it('returns full workflow status', async () => {
			await ablauf.create(EchoWorkflow, {
				id: 'dash-get-1',
				payload: { message: 'get test' },
			});

			const result = await call(dashboardRouter.workflows.get, { id: 'dash-get-1' }, { context });
			expect(result.id).toBe('dash-get-1');
			expect(result.type).toBe('echo');
			expect(result.status).toBe('completed');
			expect(result.steps).toBeDefined();
			expect(result.steps.length).toBeGreaterThan(0);
		});

		it('returns error for nonexistent workflow', async () => {
			await expect(call(dashboardRouter.workflows.get, { id: 'dash-nonexistent-1' }, { context })).rejects.toThrow();
		});
	});

	describe('GET /workflows/{id}/timeline', () => {
		it('returns timeline entries sorted by startedAt', async () => {
			await ablauf.create(MultiStepWorkflow, {
				id: 'dash-timeline-1',
				payload: { value: 10 },
			});

			const result = await call(dashboardRouter.workflows.timeline, { id: 'dash-timeline-1' }, { context });
			expect(result.id).toBe('dash-timeline-1');
			expect(result.type).toBe('multi-step');
			expect(result.status).toBe('completed');
			expect(result.timeline.length).toBe(4);

			for (let i = 1; i < result.timeline.length; i++) {
				expect(result.timeline[i].startedAt).toBeGreaterThanOrEqual(result.timeline[i - 1].startedAt!);
			}

			for (const entry of result.timeline) {
				expect(entry.name).toBeTypeOf('string');
				expect(entry.type).toBe('do');
				expect(entry.status).toBe('completed');
				expect(entry.duration).toBeTypeOf('number');
			}
		});

		it('excludes steps that have not started', async () => {
			await ablauf.create(TestWorkflow, {
				id: 'dash-timeline-nostart-1',
				payload: { name: 'TimelineNoStart' },
			});

			const result = await call(dashboardRouter.workflows.timeline, { id: 'dash-timeline-nostart-1' }, { context });

			const stepNames = result.timeline.map((e) => e.name);
			expect(stepNames).toContain('greet');
			expect(stepNames).not.toContain('pause');
			expect(stepNames).not.toContain('approval');
		});
	});

	describe('observability disabled', () => {
		it('list throws ObservabilityDisabledError via Ablauf client when observability is off', async () => {
			const disabledAblauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows,
				observability: false,
			});

			await expect(disabledAblauf.list('echo')).rejects.toThrow();
		});
	});
});
