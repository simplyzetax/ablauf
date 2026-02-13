import type { WorkflowRunnerStub, WorkflowIndexEntry, WorkflowIndexListFilters, WorkflowShardConfig } from "./types";

/**
 * Queries all index shards (current + previous) for a workflow type,
 * deduplicates entries by ID (keeping the most recently updated), and
 * returns the merged result set.
 */
export async function listIndexEntries(
	binding: DurableObjectNamespace,
	type: string,
	shardConfigs: Record<string, WorkflowShardConfig>,
	filters?: WorkflowIndexListFilters,
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

	// Deduplicate by workflow ID (same entry may exist in old + new shard during resize)
	const seen = new Map<string, WorkflowIndexEntry>();
	for (const entry of results.flat()) {
		const existing = seen.get(entry.id);
		if (!existing || entry.updatedAt > existing.updatedAt) {
			seen.set(entry.id, entry);
		}
	}

	return [...seen.values()];
}
