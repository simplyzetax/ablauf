import { os } from "@orpc/server";
import { z } from "zod";
import type { WorkflowRunnerStub, WorkflowClass, WorkflowIndexListFilters, WorkflowShardConfig } from "./engine/types";
import { workflowStatusSchema, workflowStatusResponseSchema, workflowIndexEntrySchema, stepInfoSchema } from "./engine/types";
import { listIndexEntries } from "./engine/index-listing";
import { parseSSEStream } from "./engine/sse-stream";
import { ObservabilityDisabledError, WorkflowError } from "./errors";

export interface DashboardContext {
	binding: DurableObjectNamespace;
	workflows: WorkflowClass[];
	shardConfigs: Record<string, WorkflowShardConfig>;
	observability: boolean;
}

const base = os
	.$context<DashboardContext>()
	.errors({
		WORKFLOW_NOT_FOUND: { status: 404, message: "Workflow not found" },
		OBSERVABILITY_DISABLED: { status: 400, message: "Observability is disabled" },
		WORKFLOW_NOT_RUNNING: { status: 409, message: "Workflow is not running" },
		INTERNAL_ERROR: { status: 500, message: "Internal error" },
	})
	.use(async ({ next, errors }) => {
		try {
			return await next();
		} catch (error) {
			let wfError: WorkflowError | null = null;

			if (error instanceof WorkflowError) {
				wfError = error;
			} else if (error instanceof Error) {
				const deserialized = WorkflowError.fromSerialized(error);
				if (deserialized.code !== "INTERNAL_ERROR") {
					wfError = deserialized;
				}
			}

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
		method: "GET",
		path: "/workflows",
		summary: "List workflow instances",
		description: "List workflow instances, optionally filtered by type, status, or limited to the most recent entries.",
		tags: ["workflows"],
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
		if (!context.observability) {
			throw new ObservabilityDisabledError();
		}
		const { binding, workflows, shardConfigs } = context;
		const workflowTypes = workflows.map((w) => w.type);
		const types = input.type ? [input.type] : workflowTypes;
		const filters: WorkflowIndexListFilters = { status: input.status, limit: input.limit };

		const all = await Promise.all(
			types.map(async (type) => {
				try {
					const entries = await listIndexEntries(binding, type, shardConfigs, filters);
					return entries.map((e) => ({ ...e, type }));
				} catch {
					return [];
				}
			}),
		);

		let workflows_ = all.flat();
		if (input.limit) {
			workflows_.sort((a, b) => b.updatedAt - a.updatedAt);
			workflows_ = workflows_.slice(0, input.limit);
		}
		return { workflows: workflows_ };
	});

const get = base
	.route({
		method: "GET",
		path: "/workflows/{id}",
		summary: "Get workflow status",
		description: "Get the current status of a workflow instance including its steps, payload, and result.",
		tags: ["workflows"],
	})
	.input(z.object({ id: z.string() }))
	.output(workflowStatusResponseSchema)
	.handler(async ({ input, context }) => {
		const stub = getStub(context.binding, input.id);
		return stub.getStatus();
	});

const timeline = base
	.route({
		method: "GET",
		path: "/workflows/{id}/timeline",
		summary: "Get workflow timeline",
		description: "Get a chronological timeline of all executed steps for a workflow instance, including durations and retry history.",
		tags: ["workflows"],
	})
	.input(z.object({ id: z.string() }))
	.output(timelineOutputSchema)
	.handler(async ({ input, context }) => {
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

const subscribe = base
	.route({
		method: "GET",
		path: "/workflows/{id}/subscribe",
		summary: "Subscribe to workflow updates",
		description: "Open an SSE stream to receive real-time updates from a running workflow instance.",
		tags: ["workflows"],
	})
	.input(z.object({ id: z.string() }))
	.handler(async function* ({ input, context, signal }) {
		const stub = getStub(context.binding, input.id);
		const stream = await stub.connectSSE();
		for await (const update of parseSSEStream(stream, { signal })) {
			if (update.event === "close") {
				return;
			}
			yield update;
		}
	});

export const dashboardRouter = {
	workflows: {
		list,
		get,
		timeline,
		subscribe,
	},
};
