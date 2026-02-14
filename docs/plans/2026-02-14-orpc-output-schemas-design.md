# oRPC Output Schemas

Add `.output()` Zod schemas to the dashboard router so the generated OpenAPI spec includes response types. Replace existing TypeScript interfaces with Zod-inferred types to avoid duplication.

## Decisions

- **Scope**: Replace `WorkflowStatus`, `StepInfo`, `WorkflowStatusResponse`, and `WorkflowIndexEntry` in `engine/types.ts` with Zod schemas. Derive TypeScript types via `z.infer<>`.
- **Location**: Schemas live in `engine/types.ts` alongside existing non-schema types. Route-specific output schemas (list, timeline) live in `dashboard.ts`.
- **Runtime validation**: Enabled (oRPC default). Handler return values are validated against the output schema on every request.
- **SSE subscribe**: Skipped — the yielded data shape is workflow-specific and can't be statically described.

## Changes

### `engine/types.ts`

Remove these interfaces/types:
- `WorkflowStatus` (type alias)
- `StepInfo` (interface)
- `WorkflowStatusResponse` (interface)
- `WorkflowIndexEntry` (interface)

Replace with Zod schemas:
- `workflowStatusSchema` → `z.enum([...])`, export `type WorkflowStatus = z.infer<...>`
- `stepInfoSchema` → `z.object({...})`, export `type StepInfo = z.infer<...>`
- `workflowStatusResponseSchema` → `z.object({...})`, export `type WorkflowStatusResponse = z.infer<...>`
- `workflowIndexEntrySchema` → `z.object({...})`, export `type WorkflowIndexEntry = z.infer<...>`

All downstream code importing these types sees no change.

### `dashboard.ts`

Import schemas from `./engine/types`. Define route-specific schemas locally:

- `listOutputSchema` — `{ workflows: (WorkflowIndexEntry & { type: string })[] }`
- `timelineEntrySchema` — subset of StepInfo fields + retryHistory
- `timelineOutputSchema` — `{ id, type, status, timeline[] }`

Chain `.output()` on `list`, `get`, `timeline`. Leave `subscribe` as-is.

### `index.ts`

Export the four new schemas alongside the existing type exports.

### No changes needed

- `workflow-runner.ts` — return type inferred from unchanged `WorkflowStatusResponse`
- `packages/client/` — types flow through `RouterClient<typeof dashboardRouter>`
- `packages/dashboard/` — React Query hooks infer from client
- `apps/worker/` — no direct dependency
- `db/schema.ts` — independent Drizzle schema
