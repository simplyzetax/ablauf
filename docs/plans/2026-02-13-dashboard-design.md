# Dashboard Design

## Overview

A standalone TanStack Start dashboard for the Ablauf workflow engine. Clean minimal aesthetic (Linear/Vercel style). Bundled as a bun CLI executable — users provide a worker URL on startup.

## Tech Stack

- TanStack Start + TanStack Router + TanStack Query
- Vite
- Tailwind CSS v4
- Bun (compile to single binary)

## CLI

```bash
npx @der-ablauf/dashboard --url http://localhost:8787 --port 4100
```

- `--url` (required): Worker URL to fetch API data from
- `--port` (default 4100): Dashboard server port

## Package Structure

```
packages/dashboard/
├── src/
│   ├── cli.ts                    # CLI entry — parses args, starts server
│   ├── app/
│   │   ├── routes/
│   │   │   ├── __root.tsx        # Shell layout + connection status bar
│   │   │   ├── index.tsx         # Workflow list table
│   │   │   └── workflows.$id.tsx # Workflow detail with gantt timeline
│   │   ├── components/           # Shared UI components
│   │   ├── lib/
│   │   │   ├── api.ts            # Fetch helpers for all 3 endpoints
│   │   │   └── sse.ts            # SSE client for detail page
│   │   └── router.tsx
│   └── entry-server.tsx
├── app.config.ts
├── package.json
└── build.ts                      # Bun compile script
```

## Views

### Top Bar (persistent)

Slim bar: Ablauf logo left, connected worker URL as pill badge center, connection status dot (green/red) + reconnect button right. Subtle bottom border.

### Workflow List (`/`)

Full-width compact table. Columns: Status (color badge), ID (monospace truncated), Type, Created, Updated. Filter bar above: segmented status control (All/Running/Completed/Errored/Paused) + type dropdown. Clickable rows navigate to detail. Polls every 5s.

### Workflow Detail (`/workflows/:id`)

1. **Header** — ID, type badge, status badge, timestamps, payload/result as collapsible JSON viewers
2. **Gantt Timeline** — horizontal bars on time axis, color-coded by status. Bar width = duration. Retries as stacked semi-transparent bars. Hover tooltip with exact timing. Only steps with `startedAt` shown.
3. **Error Panel** (conditional) — error message + expandable stack trace. Retry history as collapsible timeline per failed step.

## Data Flow

### API Layer

Three fetch functions via shared `fetchAPI` wrapper (base URL from CLI env var):

- `listWorkflows(filters?)` → `GET /__ablauf/workflows?type=&status=&limit=`
- `getWorkflow(id)` → `GET /__ablauf/workflows/:id`
- `getTimeline(id)` → `GET /__ablauf/workflows/:id/timeline`

### Polling

List page: TanStack Query with 5s refetchInterval. Detail page: polls `getWorkflow` every 3s as SSE fallback.

### SSE

Detail page connects to `/workflows/:id/sse`. Parses messages and updates TanStack Query cache directly. On disconnect, polling fallback activates.

### Connection Status

Reactive store tracking last successful call timestamp + errors. Top bar reads from this. Dot goes red after 15s without success. Reconnect button forces immediate refetch.

## Data Schema (all fields used)

### Workflow List Item

- id, type, status, createdAt, updatedAt

### Workflow Detail (WorkflowStatusResponse)

- id, type, status, payload, result, error, createdAt, updatedAt
- steps[]: name, type, status, attempts, result, error, completedAt, startedAt, duration, errorStack, retryHistory

### Timeline

- id, type, status
- timeline[]: name, type, status, startedAt, duration, attempts, error, retryHistory

### Retry History Entry

- attempt, error, errorStack, timestamp, duration
