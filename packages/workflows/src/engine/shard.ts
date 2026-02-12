/**
 * FNV-1a hash to distribute workflow IDs across index shards.
 * Returns a shard index in [0, shardCount).
 */
export function shardIndex(workflowId: string, shardCount: number): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < workflowId.length; i++) {
		hash ^= workflowId.charCodeAt(i);
		hash = (hash * 0x01000193) >>> 0;
	}
	return hash % shardCount;
}
