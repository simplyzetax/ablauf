import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Ablauf, ObservabilityReadNotConfiguredError } from '@der-ablauf/workflows';
import type { ObservabilityProvider } from '@der-ablauf/workflows';
import { EchoWorkflow } from '../workflows/echo-workflow';

function createWriteOnlyProvider() {
	const events: { method: string; args: any[] }[] = [];
	const provider: ObservabilityProvider<{ events: typeof events }> = {
		createCollector(_workflowId, _type) {
			return { events };
		},
		onWorkflowStart(collector, event) {
			collector.events.push({ method: 'onWorkflowStart', args: [event] });
		},
		onWorkflowStatusChange(collector, event) {
			collector.events.push({ method: 'onWorkflowStatusChange', args: [event] });
		},
		onStepStart(collector, event) {
			collector.events.push({ method: 'onStepStart', args: [event] });
		},
		onStepComplete(collector, event) {
			collector.events.push({ method: 'onStepComplete', args: [event] });
		},
		onStepRetry(collector, event) {
			collector.events.push({ method: 'onStepRetry', args: [event] });
		},
		async flush(collector, reason) {
			collector.events.push({ method: 'flush', args: [reason] });
		},
	};
	return { provider, events };
}

describe('ObservabilityProvider', () => {
	describe('client-side provider configuration', () => {
		it('observability: true uses built-in shard provider (backwards compatible)', async () => {
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow],
				observability: true,
			});

			await ablauf.create(EchoWorkflow, {
				id: `obs-compat-${crypto.randomUUID()}`,
				payload: { message: 'default provider' },
			});

			await new Promise((r) => setTimeout(r, 200));

			const entries = await ablauf.list('echo');
			expect(entries.length).toBeGreaterThan(0);
		});

		it('observability: false throws ObservabilityReadNotConfiguredError on list()', async () => {
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow],
				observability: false,
			});

			await expect(ablauf.list('echo')).rejects.toThrow(ObservabilityReadNotConfiguredError);
		});

		it('write-only provider (no read methods) throws ObservabilityReadNotConfiguredError on list()', async () => {
			const { provider } = createWriteOnlyProvider();
			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow],
				observability: provider,
			});

			await expect(ablauf.list('echo')).rejects.toThrow(ObservabilityReadNotConfiguredError);
		});

		it('provider with listWorkflows delegates listing', async () => {
			const mockEntries = [
				{ id: 'mock-1', type: 'echo', status: 'completed', createdAt: 1000, updatedAt: 2000 },
				{ id: 'mock-2', type: 'echo', status: 'running', createdAt: 1500, updatedAt: 2500 },
			];

			const provider: ObservabilityProvider<void> = {
				createCollector() {},
				onWorkflowStart() {},
				onWorkflowStatusChange() {},
				onStepStart() {},
				onStepComplete() {},
				onStepRetry() {},
				async flush() {},
				async listWorkflows(filters) {
					if (filters.type) {
						return mockEntries.filter((e) => e.type === filters.type);
					}
					return mockEntries;
				},
			};

			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow],
				observability: provider,
			});

			const entries = await ablauf.list('echo');
			expect(entries).toHaveLength(2);
			expect(entries[0].id).toBe('mock-1');
			expect(entries[1].id).toBe('mock-2');
		});

		it('provider with listWorkflows respects status filter', async () => {
			const mockEntries = [
				{ id: 'mock-1', type: 'echo', status: 'completed', createdAt: 1000, updatedAt: 2000 },
				{ id: 'mock-2', type: 'echo', status: 'running', createdAt: 1500, updatedAt: 2500 },
			];

			const provider: ObservabilityProvider<void> = {
				createCollector() {},
				onWorkflowStart() {},
				onWorkflowStatusChange() {},
				onStepStart() {},
				onStepComplete() {},
				onStepRetry() {},
				async flush() {},
				async listWorkflows(filters) {
					let result = mockEntries;
					if (filters.type) result = result.filter((e) => e.type === filters.type);
					if (filters.status) result = result.filter((e) => e.status === filters.status);
					return result;
				},
			};

			const ablauf = new Ablauf(env.WORKFLOW_RUNNER, {
				workflows: [EchoWorkflow],
				observability: provider,
			});

			const entries = await ablauf.list('echo', { status: 'completed' });
			expect(entries).toHaveLength(1);
			expect(entries[0].id).toBe('mock-1');
		});
	});
});
