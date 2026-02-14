# Index Sharding Design

## Problem

The current index system uses a single Durable Object per workflow type (`__index:payment`). This creates two bottlenecks:

1. **Write throughput** — All workflow creates/updates for a type funnel through one DO (single-writer constraint)
2. **Read throughput** — One shard holds all rows for a type, making filtered queries slow at scale

Additionally, `updateIndex()` currently awaits the index write, adding cross-region latency to workflow creation when the index shard lives in a different region.

## Design

### Shard Naming

Change from `__index:{type}` to `__index:{type}:{shardIndex}`.

```
__index:payment:0
__index:payment:1
__index:payment:2
__index:payment:3
```

### Shard Routing

FNV-1a hash of the workflow ID, mod shard count:

```typescript
function shardIndex(workflowId: string, shardCount: number): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < workflowId.length; i++) {
		hash ^= workflowId.charCodeAt(i);
		hash = (hash * 0x01000193) >>> 0;
	}
	return hash % shardCount;
}
```

### Configuration

Per-type in the registry, defaulting to 1:

```typescript
registry.register('payment', paymentWorkflow, { shards: 4 });
registry.register('notification', notificationWorkflow); // defaults to 1
```

### Write Path

Writes go to a single deterministic shard. Uses `ctx.waitUntil()` instead of `await` so workflow execution is never blocked by index writes:

```typescript
private updateIndex(type: string, id: string, status: string, now: number): void {
  try {
    const config = this.registry.get(type);
    const shard = shardIndex(id, config.shards ?? 1);
    const indexId = this.getBinding().idFromName(`__index:${type}:${shard}`);
    const stub = this.getBinding().get(indexId);
    this.ctx.waitUntil(stub.indexWrite({ id, status, createdAt: now, updatedAt: now }));
  } catch {
    // best-effort
  }
}
```

### Read Path

Fan out to all shards in parallel, merge and deduplicate:

```typescript
async list(type: string, filters?: WorkflowIndexListFilters): Promise<WorkflowIndexEntry[]> {
  const config = this.registry.get(type);
  const shardCount = config.shards ?? 1;
  const prevShards = config.previousShards;

  // Collect all shard names (current + previous if resizing)
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
    [...shardNames].map(name => {
      const stub = this.binding.get(this.binding.idFromName(name));
      return stub.indexList(filters);
    })
  );

  // Deduplicate by workflow ID (same entry may exist in old + new shard during resize)
  const seen = new Map<string, WorkflowIndexEntry>();
  for (const entry of results.flat()) {
    const existing = seen.get(entry.id);
    if (!existing || entry.updatedAt > existing.updatedAt) {
      seen.set(entry.id, entry);
    }
  }

  let merged = [...seen.values()];
  if (filters?.limit) {
    merged.sort((a, b) => b.updatedAt - a.updatedAt);
    merged = merged.slice(0, filters.limit);
  }
  return merged;
}
```

### Shard Resizing

To increase shards (e.g., 4 to 8), set `previousShards` temporarily:

```typescript
registry.register('payment', paymentWorkflow, { shards: 8, previousShards: 4 });
```

- **Writes** always use the current shard count
- **Reads** fan out to the union of current and previous shards, deduplicating by workflow ID
- Once all active workflows have had a status update under the new count, `previousShards` can be removed

### Files Changed

- `packages/workflows/src/engine/types.ts` — Add `shards` and `previousShards` to registry config type
- `packages/workflows/src/engine/workflow-runner.ts` — Update `updateIndex()` to use sharding + `waitUntil()`
- `packages/workflows/src/client.ts` — Update `list()` with fan-out and merge
- New `packages/workflows/src/engine/shard.ts` — `shardIndex()` hash function

No schema changes. No new DO classes. No wrangler config changes.
