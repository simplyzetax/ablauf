import { os } from "@orpc/server";
import { z } from "zod";
import type { WorkflowRunnerStub, WorkflowClass, WorkflowIndexListFilters, WorkflowShardConfig } from "./engine/types";
import { listIndexEntries } from "./engine/index-listing";
import { parseSSEStream } from "./engine/sse-stream";
import { ObservabilityDisabledError } from "./errors";

export interface DashboardContext {
	binding: DurableObjectNamespace;
	workflows: WorkflowClass[];
	shardConfigs: Record<string, WorkflowShardConfig>;
	observability: boolean;
}

const base = os.$context<DashboardContext>();

function getStub(binding: DurableObjectNamespace, id: string): WorkflowRunnerStub {
	return binding.get(binding.idFromName(id)) as unknown as WorkflowRunnerStub;
}

const list = base
	.input(
		z.object({
			type: z.string().optional(),
			status: z.string().optional(),
			limit: z.number().optional(),
		}),
	)
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
	.input(z.object({ id: z.string() }))
	.handler(async ({ input, context }) => {
		const stub = getStub(context.binding, input.id);
		return stub.getStatus();
	});

const timeline = base
	.input(z.object({ id: z.string() }))
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
