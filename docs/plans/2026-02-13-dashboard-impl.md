# Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a clean, minimal dashboard UI for the Ablauf workflow engine that visualizes all data from the dashboard API endpoints.

**Architecture:** TanStack Start (React) with file-based routing, TanStack Query for data fetching with polling, Tailwind v4 for styling. The app runs as a CLI tool — a Node/Bun script starts the Vite server with the user-provided worker URL injected as an environment variable. All API requests go directly from the browser to the worker (CORS is already enabled). A gantt-style timeline visualization is built with pure CSS (no charting library).

**Tech Stack:** TanStack Start, TanStack Router, TanStack Query, Vite, Tailwind CSS v4, Bun

---

### Task 1: Scaffold the dashboard package

**Files:**
- Create: `packages/dashboard/package.json`
- Create: `packages/dashboard/tsconfig.json`
- Create: `packages/dashboard/vite.config.ts`

**Step 1: Create package.json**

```json
{
  "name": "@der-ablauf/dashboard",
  "version": "0.0.1",
  "type": "module",
  "bin": {
    "ablauf-dashboard": "./src/cli.ts"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "start": "node .output/server/index.mjs",
    "check-types": "tsc --noEmit"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.71.10",
    "@tanstack/react-router": "^1.120.0",
    "@tanstack/react-start": "^1.120.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.5.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.5.2",
    "vite": "^6.3.0",
    "vite-tsconfig-paths": "^4.3.2"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["es2024", "dom", "dom.iterable"],
    "baseUrl": ".",
    "paths": {
      "~/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

**Step 3: Create vite.config.ts**

```typescript
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 4100,
  },
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    tanstackStart(),
    viteReact(),
  ],
});
```

**Step 4: Install dependencies**

Run: `cd packages/dashboard && bun install`
Expected: dependencies installed, node_modules created

**Step 5: Commit**

```bash
git add packages/dashboard/package.json packages/dashboard/tsconfig.json packages/dashboard/vite.config.ts
git commit -m "feat(dashboard): scaffold package with TanStack Start + Tailwind v4"
```

---

### Task 2: Create the app skeleton with root layout

**Files:**
- Create: `packages/dashboard/src/styles.css`
- Create: `packages/dashboard/src/router.tsx`
- Create: `packages/dashboard/src/routes/__root.tsx`
- Create: `packages/dashboard/src/routes/index.tsx`

**Step 1: Create Tailwind entry CSS**

```css
@import "tailwindcss";
```

**Step 2: Create router.tsx**

```tsx
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function createRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
```

**Step 3: Create __root.tsx with connection bar shell**

The root layout includes:
- HTML document shell with Tailwind styles
- Top bar: "Ablauf" text left, worker URL pill center, status dot + reconnect right
- The worker URL is read from `window.__ABLAUF_CONFIG__` (injected by the server)

```tsx
/// <reference types="vite/client" />
import type { ReactNode } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Ablauf Dashboard" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='28' font-size='28'>⚡</text></svg>" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <div className="min-h-screen bg-white text-zinc-900">
        <Outlet />
      </div>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
```

**Step 4: Create placeholder index route**

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Ablauf Dashboard</h1>
      <p className="mt-2 text-zinc-500">Workflow list will go here.</p>
    </div>
  );
}
```

**Step 5: Verify the app starts**

Run: `cd packages/dashboard && bun run dev`
Expected: Vite dev server starts on port 4100, page renders with heading

**Step 6: Commit**

```bash
git add packages/dashboard/src/
git commit -m "feat(dashboard): app skeleton with root layout and index route"
```

---

### Task 3: API layer and TypeScript types

**Files:**
- Create: `packages/dashboard/src/lib/types.ts`
- Create: `packages/dashboard/src/lib/api.ts`

**Step 1: Create types matching the API response shapes**

```typescript
// types.ts — matches the shapes returned by the dashboard API endpoints

export type WorkflowStatus =
  | "created"
  | "running"
  | "completed"
  | "errored"
  | "paused"
  | "sleeping"
  | "waiting"
  | "terminated";

export interface WorkflowListItem {
  id: string;
  type: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface RetryHistoryEntry {
  attempt: number;
  error: string;
  errorStack: string | null;
  timestamp: number;
  duration: number;
}

export interface StepInfo {
  name: string;
  type: string;
  status: string;
  attempts: number;
  result: unknown;
  error: string | null;
  completedAt: number | null;
  startedAt: number | null;
  duration: number | null;
  errorStack: string | null;
  retryHistory: RetryHistoryEntry[] | null;
}

export interface WorkflowDetail {
  id: string;
  type: string;
  status: WorkflowStatus;
  payload: unknown;
  result: unknown;
  error: string | null;
  steps: StepInfo[];
  createdAt: number;
  updatedAt: number;
}

export interface TimelineEntry {
  name: string;
  type: string;
  status: string;
  startedAt: number;
  duration: number;
  attempts: number;
  error: string | null;
  retryHistory: RetryHistoryEntry[] | null;
}

export interface TimelineResponse {
  id: string;
  type: string;
  status: string;
  timeline: TimelineEntry[];
}

export interface WorkflowListResponse {
  workflows: WorkflowListItem[];
}

export interface WorkflowListFilters {
  type?: string;
  status?: string;
  limit?: number;
}
```

**Step 2: Create API fetch helpers**

The base URL comes from the `ABLAUF_API_URL` environment variable, exposed to the client via Vite's `import.meta.env`. The CLI will set `VITE_ABLAUF_API_URL` before starting Vite.

```typescript
// api.ts
import type {
  WorkflowListResponse,
  WorkflowListFilters,
  WorkflowDetail,
  TimelineResponse,
} from "./types";

function getBaseUrl(): string {
  return import.meta.env.VITE_ABLAUF_API_URL ?? "http://localhost:8787";
}

async function fetchAPI<T>(path: string): Promise<T> {
  const url = `${getBaseUrl()}/__ablauf${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function listWorkflows(
  filters?: WorkflowListFilters,
): Promise<WorkflowListResponse> {
  const params = new URLSearchParams();
  if (filters?.type) params.set("type", filters.type);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return fetchAPI(`/workflows${qs ? `?${qs}` : ""}`);
}

export async function getWorkflow(id: string): Promise<WorkflowDetail> {
  return fetchAPI(`/workflows/${id}`);
}

export async function getTimeline(id: string): Promise<TimelineResponse> {
  return fetchAPI(`/workflows/${id}/timeline`);
}
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/lib/
git commit -m "feat(dashboard): API layer with typed fetch helpers"
```

---

### Task 4: Connection status store

**Files:**
- Create: `packages/dashboard/src/lib/connection.ts`

**Step 1: Create reactive connection store**

A simple module-level store using `useSyncExternalStore` for React integration. Tracks last success timestamp and current error state.

```typescript
// connection.ts
import { useSyncExternalStore } from "react";

interface ConnectionState {
  status: "connected" | "disconnected" | "error";
  lastSuccess: number | null;
  error: string | null;
}

let state: ConnectionState = {
  status: "disconnected",
  lastSuccess: null,
  error: null,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function reportSuccess() {
  state = { status: "connected", lastSuccess: Date.now(), error: null };
  emit();
}

export function reportError(error: string) {
  state = { ...state, status: "error", error };
  emit();
}

export function useConnectionStatus(): ConnectionState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}
```

**Step 2: Integrate with the API layer — update `api.ts`**

Wrap `fetchAPI` to call `reportSuccess()` on success and `reportError()` on failure. Add this around the existing fetch logic.

**Step 3: Commit**

```bash
git add packages/dashboard/src/lib/connection.ts packages/dashboard/src/lib/api.ts
git commit -m "feat(dashboard): connection status tracking store"
```

---

### Task 5: Top bar component with connection status

**Files:**
- Create: `packages/dashboard/src/components/top-bar.tsx`
- Modify: `packages/dashboard/src/routes/__root.tsx` — add TopBar to layout

**Step 1: Create the TopBar component**

Shows "Ablauf" on left, worker URL as a monospace pill in center, green/red dot + reconnect button on right. Uses `useConnectionStatus` hook.

```tsx
// top-bar.tsx
import { useConnectionStatus } from "~/lib/connection";
import { useQueryClient } from "@tanstack/react-query";

export function TopBar() {
  const connection = useConnectionStatus();
  const queryClient = useQueryClient();
  const apiUrl = import.meta.env.VITE_ABLAUF_API_URL ?? "http://localhost:8787";

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5">
      <span className="text-sm font-semibold tracking-tight">Ablauf</span>
      <code className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">
        {apiUrl}
      </code>
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            connection.status === "connected"
              ? "bg-emerald-500"
              : connection.status === "error"
                ? "bg-red-500"
                : "bg-zinc-300"
          }`}
        />
        <button
          onClick={() => queryClient.invalidateQueries()}
          className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
        >
          Refresh
        </button>
      </div>
    </header>
  );
}
```

**Step 2: Add TopBar to __root.tsx layout and wrap with QueryClientProvider**

Update the root to include `QueryClientProvider` and `TopBar` above the `Outlet`.

**Step 3: Verify the top bar renders**

Run: `cd packages/dashboard && bun run dev`
Expected: Slim top bar visible with "Ablauf", URL pill, and gray dot

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/top-bar.tsx packages/dashboard/src/routes/__root.tsx
git commit -m "feat(dashboard): top bar with connection status indicator"
```

---

### Task 6: Workflow list page with table and filters

**Files:**
- Create: `packages/dashboard/src/components/status-badge.tsx`
- Create: `packages/dashboard/src/components/filter-bar.tsx`
- Create: `packages/dashboard/src/components/workflow-table.tsx`
- Create: `packages/dashboard/src/lib/format.ts`
- Modify: `packages/dashboard/src/routes/index.tsx`

**Step 1: Create format utilities**

```typescript
// format.ts — date and ID formatting helpers

export function formatTimestamp(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

export function truncateId(id: string, maxLen = 12): string {
  return id.length > maxLen ? id.slice(0, maxLen) + "…" : id;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
```

**Step 2: Create StatusBadge component**

Small pill showing workflow status with color coding:
- `running`/`sleeping`/`waiting` → blue
- `completed` → green
- `errored`/`terminated` → red
- `paused` → yellow
- `created` → gray

**Step 3: Create FilterBar component**

Segmented button group for status: All, Running, Completed, Errored, Paused, Sleeping, Waiting. Each button has a subtle active state. Type filter as a simple `<select>` dropdown populated from the unique types in the data.

Uses URL search params via TanStack Router's `useSearch`/`useNavigate` so filters are reflected in the URL.

**Step 4: Create WorkflowTable component**

An HTML `<table>` with columns: Status, ID, Type, Created, Updated. Monospace font on the ID column. Rows are links (`<Link>`) to `/workflows/$id`. Subtle hover bg. Sorted by `updatedAt` descending by default.

**Step 5: Wire up the index route**

Use `useQuery` with `queryKey: ["workflows", filters]` and `refetchInterval: 5000`. Pass data to `FilterBar` + `WorkflowTable`. Show a loading skeleton (pulsing rows) while fetching.

**Step 6: Verify the list page works**

Run: `VITE_ABLAUF_API_URL=http://localhost:8787 bun run --cwd packages/dashboard dev`
Expected: Table renders with workflow data (or empty state if no workflows), filters work, clicking a row navigates

**Step 7: Commit**

```bash
git add packages/dashboard/src/components/ packages/dashboard/src/lib/format.ts packages/dashboard/src/routes/index.tsx
git commit -m "feat(dashboard): workflow list with table, filters, and polling"
```

---

### Task 7: Workflow detail page — header and JSON viewers

**Files:**
- Create: `packages/dashboard/src/components/json-viewer.tsx`
- Create: `packages/dashboard/src/routes/workflows.$id.tsx`

**Step 1: Create collapsible JSON viewer**

A `<details>` element with `<summary>` label. Content is a `<pre>` block with `JSON.stringify(data, null, 2)`. Monospace, small text, zinc-50 background. Shows "(empty)" if data is null/undefined.

**Step 2: Create the detail route with header section**

Route parameter: `$id`. Uses two queries:
- `useQuery({ queryKey: ["workflow", id], queryFn: () => getWorkflow(id), refetchInterval: 3000 })`
- `useQuery({ queryKey: ["timeline", id], queryFn: () => getTimeline(id), refetchInterval: 3000 })`

Header section shows:
- Back link to list (`←`)
- Workflow ID (full, monospace)
- Type badge + Status badge
- Created / Updated timestamps
- Payload and Result as collapsible JSON viewers side by side
- Error message (if present) in a red-tinted box

**Step 3: Verify the header renders**

Run dev server, navigate to a workflow detail page.
Expected: Header displays all workflow metadata

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/json-viewer.tsx packages/dashboard/src/routes/workflows.\$id.tsx
git commit -m "feat(dashboard): workflow detail page with header and JSON viewers"
```

---

### Task 8: Gantt timeline visualization

**Files:**
- Create: `packages/dashboard/src/components/gantt-timeline.tsx`
- Modify: `packages/dashboard/src/routes/workflows.$id.tsx` — add timeline below header

**Step 1: Create the GanttTimeline component**

Props: `timeline: TimelineEntry[]`

Layout:
- Left column (fixed ~150px): step names, vertically stacked
- Right area (fluid): horizontal bars on a shared time axis
- Time axis at top showing relative timestamps

For each step:
- Calculate bar position: `left = (step.startedAt - minStart) / totalDuration * 100%`
- Calculate bar width: `width = step.duration / totalDuration * 100%` (minimum 2px)
- Color by status: completed=emerald, failed=red, sleeping=blue, waiting=amber
- If `retryHistory` exists, render semi-transparent bars behind the main bar for each retry attempt
- Hover shows a tooltip: step name, duration, attempts count, error if present

Responsive: if the timeline has very short durations (all < 100ms), use a linear scale. For larger ranges, keep linear but ensure minimum bar visibility.

CSS-only implementation: use CSS Grid for the lane layout, percentage-based positioning for bars, Tailwind utilities for colors.

**Step 2: Add GanttTimeline to the detail page**

Below the header, render `<GanttTimeline timeline={timelineData.timeline} />` when timeline data is loaded. Show a loading skeleton while fetching.

**Step 3: Verify the timeline renders**

Navigate to a workflow with completed steps.
Expected: Horizontal bars visible, correctly sized relative to each other, tooltips work on hover

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/gantt-timeline.tsx packages/dashboard/src/routes/workflows.\$id.tsx
git commit -m "feat(dashboard): gantt timeline visualization for workflow steps"
```

---

### Task 9: Error panel with retry history

**Files:**
- Create: `packages/dashboard/src/components/error-panel.tsx`
- Modify: `packages/dashboard/src/routes/workflows.$id.tsx` — add error panel below timeline

**Step 1: Create the ErrorPanel component**

Props: `steps: StepInfo[]` (the full steps array from the workflow detail)

Renders only if any step has `error !== null` or the workflow itself has an error. Shows:
- Section heading "Errors"
- For each step with an error:
  - Step name + attempt count
  - Error message in monospace
  - Expandable stack trace (`<details>`) if `errorStack` is present
  - If `retryHistory` is present, a sub-list showing each retry: attempt number, error, duration, timestamp
  - Retry entries have a subtle left border (red) and indentation

Styling: red-50 background, red-700 text for error messages, zinc for metadata.

**Step 2: Add ErrorPanel to the detail page**

Below the gantt timeline, render `<ErrorPanel steps={workflow.steps} />`.

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/error-panel.tsx packages/dashboard/src/routes/workflows.\$id.tsx
git commit -m "feat(dashboard): error panel with stack traces and retry history"
```

---

### Task 10: SSE integration for real-time updates

**Files:**
- Create: `packages/dashboard/src/lib/sse.ts`
- Modify: `packages/dashboard/src/routes/workflows.$id.tsx` — connect SSE on mount

**Step 1: Create SSE client hook**

```typescript
// sse.ts — hook that connects to the worker's SSE endpoint
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { reportSuccess } from "./connection";

export function useWorkflowSSE(workflowId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_ABLAUF_API_URL ?? "http://localhost:8787";
    const url = `${baseUrl}/workflows/${workflowId}/sse`;
    const source = new EventSource(url);

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Update the workflow query cache with fresh data
        queryClient.setQueryData(["workflow", workflowId], data);
        reportSuccess();
      } catch {
        // ignore parse errors
      }
    };

    source.onerror = () => {
      // SSE disconnected — polling fallback is already active
      source.close();
    };

    return () => source.close();
  }, [workflowId, queryClient]);
}
```

**Step 2: Add `useWorkflowSSE(id)` call to the detail route component**

Call the hook at the top of the detail component. It runs alongside the polling queries — SSE provides faster updates, polling is the fallback.

**Step 3: Commit**

```bash
git add packages/dashboard/src/lib/sse.ts packages/dashboard/src/routes/workflows.\$id.tsx
git commit -m "feat(dashboard): SSE integration for real-time workflow updates"
```

---

### Task 11: CLI entry point

**Files:**
- Create: `packages/dashboard/src/cli.ts`
- Modify: `packages/dashboard/package.json` — verify bin field

**Step 1: Create the CLI entry**

The CLI parses `--url` and `--port` arguments, sets `VITE_ABLAUF_API_URL` as an environment variable, then spawns the Vite dev server. Uses `process.argv` directly (no dep needed for two flags).

```typescript
#!/usr/bin/env node
// cli.ts

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const url = getArg("url");
const port = getArg("port") ?? "4100";

if (!url) {
  console.error("Usage: ablauf-dashboard --url <worker-url> [--port <port>]");
  console.error("  --url   Worker URL (required), e.g. http://localhost:8787");
  console.error("  --port  Dashboard port (default: 4100)");
  process.exit(1);
}

process.env.VITE_ABLAUF_API_URL = url;
process.env.PORT = port;

console.log(`Starting Ablauf Dashboard`);
console.log(`  Worker: ${url}`);
console.log(`  Port:   ${port}`);
console.log();

// Dynamically import and start Vite
const { createServer } = await import("vite");
const server = await createServer({
  configFile: new URL("../vite.config.ts", import.meta.url).pathname,
  server: { port: Number(port), open: true },
});
await server.listen();
server.printUrls();
```

**Step 2: Verify CLI works**

Run: `cd packages/dashboard && bun src/cli.ts --url http://localhost:8787 --port 4100`
Expected: Dashboard starts, opens browser, shows the workflow list

**Step 3: Commit**

```bash
git add packages/dashboard/src/cli.ts packages/dashboard/package.json
git commit -m "feat(dashboard): CLI entry point with --url and --port flags"
```

---

### Task 12: Bun compile build script

**Files:**
- Create: `packages/dashboard/build.ts`
- Modify: `packages/dashboard/package.json` — add `compile` script

**Step 1: Create build.ts**

This script builds the Vite app for production, then uses `bun build --compile` to produce a standalone binary. The binary embeds the built output and serves it with a minimal server.

Note: Due to TanStack Start's server-side requirements, the compiled binary approach may need to bundle the Vite config and source. A practical alternative is to make the package installable via `bunx` / `npx` which runs the CLI directly. Document both approaches.

Add a `"compile": "bun build --compile src/cli.ts --outfile ablauf-dashboard"` script to package.json as a starting point.

**Step 2: Test `bunx` execution**

Run from the monorepo root: `bunx --bun ./packages/dashboard/src/cli.ts --url http://localhost:8787`
Expected: Dashboard starts

**Step 3: Commit**

```bash
git add packages/dashboard/build.ts packages/dashboard/package.json
git commit -m "feat(dashboard): bun compile build script"
```

---

### Task 13: Visual polish and empty states

**Files:**
- Modify: `packages/dashboard/src/routes/index.tsx` — add empty state
- Modify: `packages/dashboard/src/routes/workflows.$id.tsx` — add loading skeletons
- Modify: `packages/dashboard/src/components/gantt-timeline.tsx` — add hover animations

**Step 1: Add empty state to list page**

When no workflows exist, show a centered message: "No workflows found" with a subtle icon and a hint to create workflows via the API.

**Step 2: Add loading skeletons**

List page: pulsing gray rows matching the table structure.
Detail page: pulsing blocks for header fields and timeline area.

**Step 3: Add subtle transitions**

- Table rows: `transition-colors` on hover
- Status dots: `transition-colors` for connection changes
- Gantt bars: `transition-all` for width changes during live updates
- Page transitions: fade via TanStack Router's built-in support

**Step 4: Verify visual polish**

Check all states: loading, empty, populated, error. Verify the clean minimal aesthetic is consistent.

**Step 5: Commit**

```bash
git add packages/dashboard/src/
git commit -m "feat(dashboard): empty states, loading skeletons, and transitions"
```
