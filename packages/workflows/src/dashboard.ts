import { os } from '@orpc/server';
import { z } from 'zod';
import type { WorkflowRunnerStub, WorkflowClass, WorkflowStatus } from './engine/types';
import { workflowStatusSchema, workflowStatusResponseSchema, workflowIndexEntrySchema, stepInfoSchema } from './engine/types';
import type { ObservabilityProvider } from './engine/observability';
import { ObservabilityReadNotConfiguredError, asWorkflowError, pickORPCErrors } from './errors';

/** Context provided to all dashboard oRPC handlers. */
export interface DashboardContext {
	/** Durable Object namespace binding for communicating with workflow runner DOs. */
	binding: DurableObjectNamespace;
	/** List of all registered workflow classes. */
	workflows: WorkflowClass[];
	/** Resolved observability provider, or `null` when observability is disabled. */
	provider: ObservabilityProvider<any> | null;
}

const base = os
	.$context<DashboardContext>()
	.errors(
		pickORPCErrors([
			'WORKFLOW_NOT_FOUND',
			'OBSERVABILITY_DISABLED',
			'OBSERVABILITY_READ_NOT_CONFIGURED',
			'WORKFLOW_NOT_RUNNING',
			'INTERNAL_ERROR',
		] as const),
	)
	.use(async ({ next, errors }) => {
		try {
			return await next();
		} catch (error) {
			const wfError = asWorkflowError(error, { includeInternal: false });

			if (wfError && wfError.code in errors) {
				const factory = errors[wfError.code as keyof typeof errors];
				throw factory({ message: wfError.message });
			}

			throw error;
		}
	});

function getStub(binding: DurableObjectNamespace, id: string): WorkflowRunnerStub {
	return binding.get(binding.idFromName(id)) as unknown as WorkflowRunnerStub;
}

const listOutputSchema = z.object({
	workflows: z.array(workflowIndexEntrySchema.extend({ type: z.string() })),
});

export const timelineEntrySchema = z.object({
	name: z.string(),
	type: z.string(),
	status: z.string(),
	startedAt: z.number().nullable(),
	duration: z.number(),
	attempts: z.number(),
	error: z.string().nullable(),
	retryHistory: stepInfoSchema.shape.retryHistory,
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

const timelineOutputSchema = z.object({
	id: z.string(),
	type: z.string(),
	status: workflowStatusSchema,
	timeline: z.array(timelineEntrySchema),
});

const list = base
	.route({
		method: 'GET',
		path: '/workflows',
		summary: 'List workflow instances',
		description: 'List workflow instances, optionally filtered by type, status, or limited to the most recent entries.',
		tags: ['workflows'],
	})
	.input(
		z.object({
			type: z.string().optional(),
			status: z.string().optional(),
			limit: z.number().optional(),
		}),
	)
	.output(listOutputSchema)
	.handler(async ({ input, context }) => {
		if (!context.provider?.listWorkflows) {
			throw new ObservabilityReadNotConfiguredError();
		}
		const workflows = await context.provider.listWorkflows({
			type: input.type,
			status: input.status as WorkflowStatus | undefined,
			limit: input.limit,
		});
		return { workflows };
	});

const get = base
	.route({
		method: 'GET',
		path: '/workflows/{id}',
		summary: 'Get workflow status',
		description: 'Get the current status of a workflow instance including its steps, payload, and result.',
		tags: ['workflows'],
	})
	.input(z.object({ id: z.string() }))
	.output(workflowStatusResponseSchema)
	.handler(async ({ input, context }) => {
		if (context.provider?.getWorkflowStatus) {
			return context.provider.getWorkflowStatus(input.id);
		}
		// Fallback to direct DO RPC when provider doesn't implement getWorkflowStatus
		const stub = getStub(context.binding, input.id);
		return stub.getStatus();
	});

const timeline = base
	.route({
		method: 'GET',
		path: '/workflows/{id}/timeline',
		summary: 'Get workflow timeline',
		description: 'Get a chronological timeline of all executed steps for a workflow instance, including durations and retry history.',
		tags: ['workflows'],
	})
	.input(z.object({ id: z.string() }))
	.output(timelineOutputSchema)
	.handler(async ({ input, context }) => {
		if (context.provider?.getWorkflowTimeline) {
			return context.provider.getWorkflowTimeline(input.id);
		}
		// Fallback to direct DO RPC when provider doesn't implement getWorkflowTimeline
		const stub = getStub(context.binding, input.id);
		const status = await stub.getStatus();
		const timelineEntries = status.steps
			.filter((s) => s.startedAt != null)
			.map((s) => ({
				name: s.name,
				type: s.type,
				status: s.status,
				startedAt: s.startedAt,
				duration: s.duration ?? 0,
				attempts: s.attempts,
				error: s.error,
				retryHistory: s.retryHistory,
			}))
			.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
		return { id: status.id, type: status.type, status: status.status, timeline: timelineEntries };
	});

export const dashboardRouter = {
	workflows: {
		list,
		get,
		timeline,
	},
};
