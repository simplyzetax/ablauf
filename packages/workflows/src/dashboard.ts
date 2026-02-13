import { os } from "@orpc/server";
import { z } from "zod";
import type { WorkflowRunnerStub, WorkflowClass, WorkflowIndexListFilters, WorkflowIndexEntry, WorkflowShardConfig } from "./engine/types";
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

async function listIndexEntries(
	binding: DurableObjectNamespace,
	type: string,
	shardConfigs: Record<string, WorkflowShardConfig>,
	filters: WorkflowIndexListFilters,
): Promise<WorkflowIndexEntry[]> {
	const config = shardConfigs[type] ?? {};
	const shardCount = config.shards ?? 1;
	const prevShards = config.previousShards;

	const shardNames = new Set<string>();
	for (let i = 0; i < shardCount; i++) {
		shardNames.add(`__index:${type}:${i}`);
	}
	if (prevShards) {
		for (let i = 0; i < prevShards; i++) {
			shardNames.add(`__index:${type}:${i}`);
		}
	}

	const results = await Promise.all(
		[...shardNames].map((name) => {
			const stub = binding.get(binding.idFromName(name)) as unknown as WorkflowRunnerStub;
			return stub.indexList(filters);
		}),
	);

	const seen = new Map<string, WorkflowIndexEntry>();
	for (const entry of results.flat()) {
		const existing = seen.get(entry.id);
		if (!existing || entry.updatedAt > existing.updatedAt) {
			seen.set(entry.id, entry);
		}
	}
	return [...seen.values()];
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
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (!signal?.aborted) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (line.startsWith("event: close")) {
						return;
					}
					if (line.startsWith("data: ")) {
						try {
							const data = JSON.parse(line.slice(6));
							yield data;
						} catch {
							// skip malformed
						}
					}
				}
			}
		} finally {
			reader.cancel().catch(() => {});
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
