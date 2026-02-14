# Observability & Dashboard Design

## Problem

Ablauf has no structured observability. When a workflow fails, there's no error chain, no step timeline, and no way to understand what happened without reading code. There are no aggregate metrics for understanding fleet-wide performance.

## Goals (ordered by priority)

1. **Why did it fail** — full error context with stack traces and retry history
2. **What happened** — step-by-step timeline with execution timing
3. **How is it performing** — aggregate metrics (durations, retry rates, failure rates)

## Architecture

Three layers, each building on the previous:

1. **Richer SQLite schema** in `stepsTable` — captures lifecycle data at the source
2. **Dashboard helper** in `@der-ablauf/workflows` — serves observability data via HTTP endpoints
3. **Dashboard CLI + app** in `@der-ablauf/dashboard` — standalone React app for visualization

## 1. Schema Changes

### `stepsTable` — new columns

| Column         | Type      | Purpose                                                             |
| -------------- | --------- | ------------------------------------------------------------------- |
| `startedAt`    | `integer` | Timestamp when step execution began (not replay cache hit)          |
| `duration`     | `integer` | Milliseconds of actual execution time                               |
| `errorStack`   | `text`    | Full stack trace on failure (separate from short `error` message)   |
| `retryHistory` | `text`    | JSON array of `{ attempt, error, errorStack, timestamp, duration }` |

Existing columns (`status`, `result`, `error`, `attempts`, `wakeAt`, `completedAt`) are unchanged.

`startedAt` and `duration` always reflect the **last** attempt. Full history of previous attempts lives in `retryHistory`. This keeps common queries as simple column reads while the retry chain is available for debugging.

No new tables. The `workflowTable` already has `createdAt`/`updatedAt` for workflow-level timing.

## 2. Step Execution Changes

When `step.do()` actually executes (not a cache hit):

```
1. Record startedAt = Date.now()
2. Execute fn()
3. Record duration = Date.now() - startedAt
4. On success: persist result + startedAt + duration
5. On failure: persist error + errorStack + startedAt + duration
6. On retry exhaustion: persist full retryHistory as JSON array
```

Cache hits return immediately with zero overhead — same as today.

For retry tracking: each failed attempt appends to the `retryHistory` array. On the first attempt there's no existing history. On subsequent attempts, read existing `retryHistory` from DB, parse, push new entry, write back.

## 3. Dashboard Helper

Users mount this in their worker:

```typescript
import { createDashboardHandler } from '@der-ablauf/workflows';

app.get('/__ablauf/*', createDashboardHandler({ binding: 'WORKFLOW_RUNNER' }));
```

### Endpoints

**`GET /__ablauf/workflows`**

List all workflows with status, timing, error summary. Supports query params: `?status=errored&type=order-processing&limit=50`. Uses existing index shard DOs.

**`GET /__ablauf/workflows/:id`**

Full detail for one workflow: payload, result, error, plus all steps with timeline data, retry history, and durations. Extended version of `getStatus()` with new observability columns.

**`GET /__ablauf/workflows/:id/timeline`**

Step data shaped for timeline rendering: ordered steps with `startedAt`, `duration`, `status`, and `retryHistory` flattened into visual segments.

### Design

- Returns plain `Response` objects — framework agnostic (works with Hono, itty-router, raw fetch)
- No auth by default (local dev). Accepts optional `authenticate` callback for production.

## 4. Dashboard Package (`@der-ablauf/dashboard`)

New package at `packages/dashboard`.

### CLI

```bash
npx @der-ablauf/dashboard --port 4100 --worker http://localhost:8787
```

Connects to `/__ablauf/*` endpoints on the running dev worker. No config files.

### Tech Stack

- Vite (dev server + build)
- React + TanStack Router
- Tailwind + shadcn/ui
- Polls helper endpoints (SSE upgrade path later)

### Views

**Workflow Detail** (`/workflows/:id`)

Primary debugging view. Step timeline visualization with horizontal bars showing duration, color-coded by status. Click a failed step to see error message, full stack trace, and retry history. Covers "why did it fail" + "what happened".

**Workflow List** (`/workflows`)

Table of all workflows with status badges, type, duration, created/updated times. Filterable by status and type. Errored workflows surface to the top. Click through to detail view.

**Metrics** (`/metrics`)

Aggregate stats: average step duration by name, retry rates, failure rates by workflow type, slowest steps. Derived from querying across workflows. Covers "how is it performing".

## Implementation Order

1. Schema migration + `StepContext` changes (foundation)
2. Dashboard helper endpoints in `@der-ablauf/workflows`
3. Dashboard package scaffold (Vite + TanStack Router + Tailwind + shadcn)
4. Workflow List view
5. Workflow Detail view with timeline
6. Metrics view
