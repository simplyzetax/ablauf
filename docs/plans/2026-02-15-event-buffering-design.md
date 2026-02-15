# Event Buffering Design

Buffer events sent before a workflow reaches `waitForEvent()`, matching Cloudflare Workflows semantics.

## Problem

Currently, calling `sendEvent()` before the workflow reaches the corresponding `waitForEvent()` throws `WORKFLOW_NOT_RUNNING`. Callers must poll/retry until the workflow is ready, which is error-prone and creates a race condition.

Cloudflare Workflows handles this differently: "You can send an event to a Workflow instance before it reaches the corresponding waitForEvent call, as long as the instance has been created. The event will be buffered and delivered when the Workflow reaches the waitForEvent step with the matching type."

## Design Decisions

- **Last-write-wins**: Only one buffered event per type is kept. If multiple events of the same type are sent before consumption, the latest overwrites the previous.
- **Separate table**: Buffered events are stored in a new `event_buffer` SQLite table, not in the `stepsTable`. The buffer is conceptually different from a workflow step.
- **Any non-terminal state**: Events are buffered when the workflow is `running`, `sleeping`, `waiting` (for a different event), or `paused`. Terminal states (`completed`, `errored`, `terminated`) reject as before.
- **No SSE**: The engine does not emit SSE events for buffered events. SSE is a user-land concern.

## Schema

New `event_buffer` table in the DO's SQLite:

```typescript
export const eventBufferTable = sqliteTable('event_buffer', {
  eventName:   text('event_name').primaryKey(),
  payload:     text('payload').notNull(),         // superjson-serialized
  receivedAt:  integer('received_at').notNull(),
});
```

- `eventName` as primary key enforces last-write-wins via upsert.
- `payload` is superjson-serialized, consistent with step results.

## Changes to `deliverEvent()`

In `workflow-runner.ts`, `_deliverEventInner()` currently throws when no waiting step exists. New behavior:

1. Validation (event name, Zod schema) still happens first — invalid events are never buffered.
2. If a step with matching name is in `waiting` status → deliver immediately (unchanged).
3. If no matching waiting step and workflow is in a non-terminal state → upsert into `event_buffer`.
4. If workflow is in a terminal state → throw `WorkflowNotRunningError` (unchanged).

No replay is triggered when buffering — the workflow hasn't asked for the event yet.

## Changes to `waitForEvent()`

In `step.ts`, after checking for existing steps (replay path) but before inserting a new `waiting` step:

1. Query `event_buffer` for the event name.
2. If found: delete from buffer, insert a `completed` step with the buffered payload, return the payload inline. No `WaitInterrupt` thrown, no alarm set.
3. If not found: insert `waiting` step and throw `WaitInterrupt` (unchanged).

This means the workflow never suspends if the event was already buffered.

## Cleanup

- **On consumption**: buffered event is deleted from `event_buffer` when `waitForEvent()` consumes it.
- **On terminal state**: all remaining buffered events are deleted when the workflow reaches `completed`, `errored`, or `terminated`.

## Tradeoffs

**Benefits:**
- Matches Cloudflare Workflows semantics
- Eliminates race condition for callers
- Zero overhead when not used (buffer table is never touched if events arrive after `waitForEvent`)
- Simple implementation (~30 lines of new logic)

**Costs:**
- Silent event replacement with last-write-wins (no trace of overwritten events)
- New DB table (schema change, handled by Drizzle)
- **Breaking change**: `deliverEvent()` no longer throws `WORKFLOW_NOT_RUNNING` for early events — it silently succeeds

**Not included (YAGNI):**
- No SSE for buffered events
- No API to list/inspect the buffer
- No event queue (single slot per type)
- No TTL/expiry on buffered events

## Files to Change

- `packages/workflows/src/db/schema.ts` — add `eventBufferTable`
- `packages/workflows/src/engine/workflow-runner.ts` — modify `_deliverEventInner()`, add cleanup on terminal state
- `packages/workflows/src/engine/step.ts` — modify `waitForEvent()` to check buffer
- `apps/worker/src/__tests__/` — add tests for buffering, consumption, cleanup, last-write-wins
- `apps/docs/` — update event documentation
