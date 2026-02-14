# oRPC Output Schemas Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `.output()` Zod schemas to all dashboard routes so the OpenAPI spec includes response types, while eliminating type duplication by deriving TypeScript types from the schemas.

**Architecture:** Replace 4 TypeScript interfaces/types in `engine/types.ts` with Zod schemas + `z.infer<>`. Chain `.output()` on each dashboard route in `dashboard.ts`. Export schemas from `index.ts`.

**Tech Stack:** Zod 3.x (already used), oRPC `@orpc/server` ^1.13.5 (already used)

---

## Decisions

- **Scope**: Replace `WorkflowStatus`, `StepInfo`, `WorkflowStatusResponse`, and `WorkflowIndexEntry` in `engine/types.ts` with Zod schemas. Derive TypeScript types via `z.infer<>`.
- **Location**: Schemas live in `engine/types.ts` alongside existing non-schema types. Route-specific output schemas (list, timeline) live in `dashboard.ts`.
- **Runtime validation**: Enabled (oRPC default). Handler return values are validated against the output schema on every request.
- **SSE subscribe**: Skipped — the yielded data shape is workflow-specific and can't be statically described.

---

### Task 1: Add Zod schemas to `engine/types.ts`

**Files:**
- Modify: `packages/workflows/src/engine/types.ts:1-14,206-294`

**Step 1: Add Zod import**

Add at the top of `packages/workflows/src/engine/types.ts`:

```typescript
import { z } from "zod";
```

**Step 2: Replace `WorkflowStatus` type (line 13)**

Replace:
```typescript
export type WorkflowStatus = "created" | "running" | "completed" | "errored" | "paused" | "sleeping" | "waiting" | "terminated";
```

With:
```typescript
export const workflowStatusSchema = z.enum(["created", "running", "completed", "errored", "paused", "sleeping", "waiting", "terminated"]);
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
```

Keep the JSDoc comment block above it (lines 1-12) as-is.

**Step 3: Replace `StepInfo` interface (lines 227-251)**

Replace the `StepInfo` interface block with:

```typescript
/** Zod schema for a single step's execution details. */
export const stepInfoSchema = z.object({
	/** Unique name of the step. */
	name: z.string(),
	/** Step type: `"do"`, `"sleep"`, or `"wait_for_event"`. */
	type: z.string(),
	/** Current status (e.g., `"completed"`, `"failed"`, `"sleeping"`, `"waiting"`). */
	status: z.string(),
	/** Number of execution attempts (including retries). */
	attempts: z.number(),
	/** Persisted result, or `null` if not yet completed. */
	result: z.unknown(),
	/** Error message from the most recent failure, or `null`. */
	error: z.string().nullable(),
	/** Unix timestamp (ms) when the step completed, or `null`. */
	completedAt: z.number().nullable(),
	/** Unix timestamp (ms) when the step started, or `null`. */
	startedAt: z.number().nullable(),
	/** Execution duration in milliseconds, or `null`. */
	duration: z.number().nullable(),
	/** Error stack trace from the most recent failure, or `null`. */
	errorStack: z.string().nullable(),
	/** History of failed retry attempts, or `null` if no retries occurred. */
	retryHistory: z.array(z.object({
		attempt: z.number(),
		error: z.string(),
		errorStack: z.string().nullable(),
		timestamp: z.number(),
		duration: z.number(),
	})).nullable(),
});

/** Detailed information about a single step's execution. */
export type StepInfo = z.infer<typeof stepInfoSchema>;
```

**Step 4: Replace `WorkflowStatusResponse` interface (lines 205-225)**

Replace the `WorkflowStatusResponse` interface block with:

```typescript
/** Zod schema for a full workflow status snapshot. */
export const workflowStatusResponseSchema = z.object({
	/** Unique identifier of the workflow instance. */
	id: z.string(),
	/** Workflow type string. */
	type: z.string(),
	/** Current lifecycle status. */
	status: workflowStatusSchema,
	/** The input payload the workflow was started with. */
	payload: z.unknown(),
	/** The final result, or `null` if not yet completed. */
	result: z.unknown(),
	/** Error message if errored, otherwise `null`. */
	error: z.string().nullable(),
	/** Ordered list of step execution details. */
	steps: z.array(stepInfoSchema),
	/** Unix timestamp (ms) when the instance was created. */
	createdAt: z.number(),
	/** Unix timestamp (ms) of the last status update. */
	updatedAt: z.number(),
});

/** Full status snapshot of a workflow instance. */
export type WorkflowStatusResponse = z.infer<typeof workflowStatusResponseSchema>;
```

Note: `workflowStatusResponseSchema` references `stepInfoSchema`, so `stepInfoSchema` must appear first in the file. Reorder so that `StepInfo` schema comes before `WorkflowStatusResponse` schema.

**Step 5: Replace `WorkflowIndexEntry` interface (lines 284-294)**

Replace the `WorkflowIndexEntry` interface block with:

```typescript
/** Zod schema for a compact workflow index entry. */
export const workflowIndexEntrySchema = z.object({
	/** Unique identifier of the workflow instance. */
	id: z.string(),
	/** Current lifecycle status. */
	status: z.string(),
	/** Unix timestamp (ms) when the instance was created. */
	createdAt: z.number(),
	/** Unix timestamp (ms) of the last index update. */
	updatedAt: z.number(),
});

/** Compact index entry for listing workflow instances without loading full status. */
export type WorkflowIndexEntry = z.infer<typeof workflowIndexEntrySchema>;
```

**Step 6: Run type-check**

Run: `bun run check-types`
Expected: PASS — all type exports are unchanged, just backed by Zod now.

**Step 7: Run tests**

Run: `bun run test`
Expected: All existing tests pass.

**Step 8: Commit**

```bash
git add packages/workflows/src/engine/types.ts
git commit -m "refactor: replace type interfaces with Zod schemas in engine/types.ts"
```

---

### Task 2: Add `.output()` to dashboard routes

**Files:**
- Modify: `packages/workflows/src/dashboard.ts`

**Step 1: Update imports**

Change the import from `./engine/types` to include the schemas:

```typescript
import type { WorkflowRunnerStub, WorkflowClass, WorkflowIndexListFilters, WorkflowShardConfig } from "./engine/types";
import { workflowStatusSchema, workflowStatusResponseSchema, workflowIndexEntrySchema, stepInfoSchema } from "./engine/types";
```

**Step 2: Define route-specific output schemas**

After the `getStub` function (after line 19), add:

```typescript
const listOutputSchema = z.object({
	workflows: z.array(workflowIndexEntrySchema.extend({ type: z.string() })),
});

const timelineEntrySchema = z.object({
	name: z.string(),
	type: z.string(),
	status: z.string(),
	startedAt: z.number().nullable(),
	duration: z.number(),
	attempts: z.number(),
	error: z.string().nullable(),
	retryHistory: stepInfoSchema.shape.retryHistory,
});

const timelineOutputSchema = z.object({
	id: z.string(),
	type: z.string(),
	status: workflowStatusSchema,
	timeline: z.array(timelineEntrySchema),
});
```

**Step 3: Chain `.output()` on the `list` route**

Insert `.output(listOutputSchema)` between `.input(...)` and `.handler(...)` on the `list` route (between lines 35 and 36):

```typescript
const list = base
	.route({ ... })
	.input(...)
	.output(listOutputSchema)
	.handler(async ({ input, context }) => { ... });
```

**Step 4: Chain `.output()` on the `get` route**

Insert `.output(workflowStatusResponseSchema)` between `.input(...)` and `.handler(...)` on the `get` route (between lines 72 and 73):

```typescript
const get = base
	.route({ ... })
	.input(z.object({ id: z.string() }))
	.output(workflowStatusResponseSchema)
	.handler(async ({ input, context }) => { ... });
```

**Step 5: Chain `.output()` on the `timeline` route**

Insert `.output(timelineOutputSchema)` between `.input(...)` and `.handler(...)` on the `timeline` route (between lines 86 and 87):

```typescript
const timeline = base
	.route({ ... })
	.input(z.object({ id: z.string() }))
	.output(timelineOutputSchema)
	.handler(async ({ input, context }) => { ... });
```

**Step 6: Leave `subscribe` unchanged**

No `.output()` — SSE data is workflow-specific.

**Step 7: Run type-check**

Run: `bun run check-types`
Expected: PASS. If there are type mismatches between the handler return type and the output schema, fix them (the schema is the source of truth).

**Step 8: Run tests**

Run: `bun run test`
Expected: All tests pass. The output validation now runs on every handler response. If any test fails, the handler is returning data that doesn't match the schema — fix the schema to match reality.

**Step 9: Commit**

```bash
git add packages/workflows/src/dashboard.ts
git commit -m "feat: add .output() schemas to dashboard routes"
```

---

### Task 3: Export schemas from `index.ts`

**Files:**
- Modify: `packages/workflows/src/index.ts:36`

**Step 1: Add schema exports**

After the existing `export { DEFAULT_RETRY_CONFIG } from "./engine/types";` line (line 36), add:

```typescript
export { workflowStatusSchema, stepInfoSchema, workflowStatusResponseSchema, workflowIndexEntrySchema } from "./engine/types";
```

**Step 2: Run type-check**

Run: `bun run check-types`
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/workflows/src/index.ts
git commit -m "feat: export Zod output schemas from public API"
```

---

### Task 4: Verify OpenAPI spec generation

**Files:**
- Run: `apps/docs/scripts/generate-openapi.ts`

**Step 1: Generate the OpenAPI spec**

Run from the repo root:
```bash
cd apps/docs && bun run generate-openapi
```

(Check `apps/docs/package.json` for the exact script name if this doesn't work.)

**Step 2: Verify response schemas are present**

Check that `apps/docs/openapi.json` now contains response schemas for the three routes. Look for `"responses"` → `"200"` → `"content"` → `"application/json"` → `"schema"` in each path.

Run: `grep -c '"schema"' apps/docs/openapi.json`
Expected: More matches than before (should include response schemas, not just input parameters).

**Step 3: Commit (if openapi.json is tracked)**

If `openapi.json` is gitignored (likely), no commit needed. Otherwise:
```bash
git add apps/docs/openapi.json
git commit -m "docs: regenerate OpenAPI spec with response schemas"
```
