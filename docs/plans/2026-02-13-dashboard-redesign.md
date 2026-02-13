# Dashboard Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Completely redesign the Ablauf workflow dashboard as a dark-themed developer tool with split-panel layout, compact stat/filter bar, and hybrid timeline + step list.

**Architecture:** Single-page React app with split panel (320px workflow list | detail panel). No page navigation between list and detail - selected workflow tracked via URL search params. All existing data fetching, SSE, and API code stays unchanged. Pure visual/layout rewrite.

**Tech Stack:** React 19, TanStack Router, TanStack Query, Tailwind CSS 4, Vite. No new dependencies.

---

## Task 1: Foundation - Dark Theme & Global Styles

**Files:**
- Modify: `packages/dashboard/src/styles.css`
- Modify: `packages/dashboard/src/routes/__root.tsx`

**Step 1: Update global styles**

Replace `packages/dashboard/src/styles.css` with:

```css
@import "tailwindcss";

@theme {
  --color-surface-0: #09090b;
  --color-surface-1: #18181b;
  --color-surface-2: #27272a;
  --color-border: #27272a;
  --color-border-muted: rgba(39, 39, 42, 0.5);
}

html {
  color-scheme: dark;
}

body {
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

**Step 2: Update root layout**

Replace the `RootComponent` in `packages/dashboard/src/routes/__root.tsx`. Change the wrapper div from `min-h-screen bg-white text-zinc-900` to `min-h-screen bg-surface-0 text-zinc-100`. Remove `<TopBar />` from here (it will be part of the new layout in index.tsx). The root just provides QueryClient and document shell.

```tsx
function RootComponent() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2000,
        retry: 1,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <RootDocument>
        <div className="min-h-screen bg-surface-0 text-zinc-100">
          <Outlet />
        </div>
      </RootDocument>
    </QueryClientProvider>
  );
}
```

Remove the `TopBar` import from `__root.tsx`.

**Step 3: Verify it compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 4: Commit**

```
feat(dashboard): dark theme foundation and global styles
```

---

## Task 2: Format Utilities - Add Relative Time

**Files:**
- Modify: `packages/dashboard/src/lib/format.ts`

**Step 1: Add `formatRelativeTime` function**

Add to `packages/dashboard/src/lib/format.ts`:

```ts
export function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 0) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
```

**Step 2: Add `getStatusDotColor` helper**

Add to `packages/dashboard/src/lib/format.ts`:

```ts
export function getStatusDotColor(status: string): string {
  switch (status) {
    case "running":
      return "bg-blue-400";
    case "completed":
      return "bg-emerald-400";
    case "errored":
    case "terminated":
      return "bg-red-400";
    case "paused":
      return "bg-yellow-400";
    default:
      return "bg-zinc-400";
  }
}

export function getStatusBorderColor(status: string): string {
  switch (status) {
    case "running":
      return "border-blue-400";
    case "completed":
      return "border-emerald-400";
    case "errored":
    case "terminated":
      return "border-red-400";
    case "paused":
      return "border-yellow-400";
    default:
      return "border-zinc-400";
  }
}
```

**Step 3: Commit**

```
feat(dashboard): add relative time and status color utilities
```

---

## Task 3: Top Bar - Slim Dark Header

**Files:**
- Modify: `packages/dashboard/src/components/top-bar.tsx`

**Step 1: Rewrite top bar**

Replace `packages/dashboard/src/components/top-bar.tsx`:

```tsx
import { useConnectionStatus } from "~/lib/connection";
import { useQueryClient } from "@tanstack/react-query";

export function TopBar() {
  const connection = useConnectionStatus();
  const queryClient = useQueryClient();
  const apiUrl = import.meta.env.VITE_ABLAUF_API_URL ?? "http://localhost:8787";

  return (
    <header className="sticky top-0 z-50 flex h-10 items-center justify-between border-b border-border bg-surface-0/80 px-4 backdrop-blur-sm">
      <span className="text-sm font-semibold tracking-tight text-zinc-100">
        Ablauf
      </span>

      <div className="flex items-center gap-3">
        {/* Connection indicator with API URL tooltip */}
        <div className="group relative" aria-live="polite">
          <span
            role="status"
            className={`inline-block h-2 w-2 rounded-full transition-colors ${
              connection.status === "connected"
                ? "bg-emerald-400"
                : connection.status === "error"
                  ? "bg-red-400"
                  : "bg-zinc-600"
            } ${connection.status === "connected" ? "animate-[pulse-dot_2s_ease-in-out_infinite]" : ""}`}
          />
          <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 whitespace-nowrap rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            {apiUrl}
            {connection.error && (
              <p className="mt-1 text-red-400">{connection.error}</p>
            )}
          </div>
        </div>

        {/* Refresh button */}
        <button
          onClick={() => queryClient.invalidateQueries()}
          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
          aria-label="Refresh data"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M21.015 4.356v4.992"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
```

**Step 2: Commit**

```
feat(dashboard): redesign top bar as slim dark header
```

---

## Task 4: Status Badge - Dark Theme

**Files:**
- Modify: `packages/dashboard/src/components/status-badge.tsx`

**Step 1: Rewrite status badge for dark theme**

Replace `packages/dashboard/src/components/status-badge.tsx`:

```tsx
interface StatusBadgeProps {
  status: string;
  className?: string;
}

function getStatusClasses(status: string): string {
  switch (status) {
    case "running":
      return "bg-blue-400/10 text-blue-400 ring-blue-400/20";
    case "sleeping":
    case "waiting":
    case "created":
      return "bg-zinc-400/10 text-zinc-400 ring-zinc-400/20";
    case "completed":
      return "bg-emerald-400/10 text-emerald-400 ring-emerald-400/20";
    case "errored":
    case "terminated":
      return "bg-red-400/10 text-red-400 ring-red-400/20";
    case "paused":
      return "bg-yellow-400/10 text-yellow-400 ring-yellow-400/20";
    default:
      return "bg-zinc-400/10 text-zinc-400 ring-zinc-400/20";
  }
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors ${getStatusClasses(status)}${className ? ` ${className}` : ""}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
```

**Step 2: Commit**

```
feat(dashboard): dark theme status badges with ring styling
```

---

## Task 5: Stat/Filter Bar - Combined Summary + Filters

**Files:**
- Modify: `packages/dashboard/src/components/filter-bar.tsx`

**Step 1: Rewrite filter bar as stat/filter bar**

Replace `packages/dashboard/src/components/filter-bar.tsx`:

```tsx
import type { WorkflowListItem } from "~/lib/types";
import { getStatusDotColor } from "~/lib/format";

const FILTER_STATUSES = [
  "all",
  "running",
  "completed",
  "errored",
  "paused",
  "sleeping",
  "waiting",
  "terminated",
] as const;

interface StatFilterBarProps {
  activeStatus: string;
  activeType: string;
  types: string[];
  workflows: WorkflowListItem[];
  onStatusChange: (status: string) => void;
  onTypeChange: (type: string) => void;
}

export function StatFilterBar({
  activeStatus,
  activeType,
  types,
  workflows,
  onStatusChange,
  onTypeChange,
}: StatFilterBarProps) {
  const counts = new Map<string, number>();
  counts.set("all", workflows.length);
  for (const wf of workflows) {
    counts.set(wf.status, (counts.get(wf.status) ?? 0) + 1);
  }

  return (
    <div className="sticky top-10 z-40 flex items-center justify-between border-b border-border bg-surface-0 px-4 py-2">
      <div className="flex items-center gap-1">
        {FILTER_STATUSES.map((status) => {
          const count = counts.get(status) ?? 0;
          const isActive = (status === "all" && !activeStatus) || activeStatus === status;
          if (status !== "all" && count === 0 && !isActive) return null;
          const dotColor = status === "all" ? "" : getStatusDotColor(status);

          return (
            <button
              key={status}
              onClick={() => onStatusChange(status === "all" ? "" : status)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 ${
                isActive
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {status !== "all" && (
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor} ${
                    isActive ? "opacity-100" : "opacity-50"
                  }`}
                />
              )}
              {status.charAt(0).toUpperCase() + status.slice(1)}
              {count > 0 && (
                <span className={isActive ? "text-zinc-400" : "text-zinc-600"}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <select
        value={activeType}
        onChange={(e) => onTypeChange(e.target.value)}
        aria-label="Filter by workflow type"
        className="rounded-md border border-zinc-700 bg-surface-1 px-2.5 py-1 text-xs text-zinc-300 outline-none transition-colors hover:border-zinc-600 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
      >
        <option value="">All types</option>
        {types.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
    </div>
  );
}
```

**Step 2: Commit**

```
feat(dashboard): stat/filter bar with live counts and dark theme
```

---

## Task 6: Workflow List - Left Panel Component

**Files:**
- Modify: `packages/dashboard/src/components/workflow-table.tsx`

**Step 1: Rewrite as compact list for split panel**

Replace `packages/dashboard/src/components/workflow-table.tsx` with a new `WorkflowList` component. Rename the file conceptually but keep the path for simplicity (or create new file - keeping existing path is fine since we're replacing the entire component).

Replace `packages/dashboard/src/components/workflow-table.tsx`:

```tsx
import type { WorkflowListItem } from "~/lib/types";
import { formatRelativeTime, truncateId, getStatusDotColor, getStatusBorderColor } from "~/lib/format";

interface WorkflowListProps {
  workflows: WorkflowListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function WorkflowList({ workflows, selectedId, onSelect }: WorkflowListProps) {
  const sorted = [...workflows].sort((a, b) => b.updatedAt - a.updatedAt);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4">
        <svg
          aria-hidden="true"
          className="mb-3 h-8 w-8 text-zinc-700"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M21.015 4.356v4.992"
          />
        </svg>
        <p className="text-sm font-medium text-zinc-500">No workflows found</p>
        <p className="mt-1 text-xs text-zinc-600">
          Workflows will appear here when created
        </p>
      </div>
    );
  }

  return (
    <div role="listbox" aria-label="Workflow list">
      {sorted.map((wf) => {
        const isSelected = wf.id === selectedId;
        const dotColor = getStatusDotColor(wf.status);
        const borderColor = getStatusBorderColor(wf.status);

        return (
          <button
            key={wf.id}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(wf.id)}
            className={`flex w-full flex-col gap-0.5 border-b border-border-muted px-3 py-2.5 text-left transition-colors ${
              isSelected
                ? `bg-zinc-800/70 border-l-2 ${borderColor}`
                : "border-l-2 border-l-transparent hover:bg-zinc-900"
            } focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500`}
          >
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
              <span className="truncate text-sm font-medium text-zinc-200">
                {wf.type}
              </span>
            </div>
            <div className="flex items-center justify-between pl-4">
              <span className="font-mono text-xs text-zinc-500" title={wf.id}>
                {truncateId(wf.id)}
              </span>
              <span className="text-xs text-zinc-600">
                {formatRelativeTime(wf.updatedAt)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

**Step 2: Commit**

```
feat(dashboard): compact workflow list for split panel
```

---

## Task 7: JSON Viewer - Dark Theme with Color-Coded Values

**Files:**
- Modify: `packages/dashboard/src/components/json-viewer.tsx`

**Step 1: Rewrite with dark styling and colored values**

Replace `packages/dashboard/src/components/json-viewer.tsx`:

```tsx
interface JsonViewerProps {
  label: string;
  data: unknown;
}

function colorizeJson(json: string): (string | { text: string; className: string })[] {
  const parts: (string | { text: string; className: string })[] = [];
  const regex = /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(null|undefined)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(json)) !== null) {
    if (match.index > lastIndex) {
      parts.push(json.slice(lastIndex, match.index));
    }
    if (match[1]) {
      // Key
      parts.push({ text: match[1], className: "text-zinc-200" });
      parts.push(":");
    } else if (match[2]) {
      // String value
      parts.push({ text: match[2], className: "text-emerald-400" });
    } else if (match[3]) {
      // null/undefined
      parts.push({ text: match[3], className: "text-zinc-500" });
    } else if (match[4]) {
      // Number
      parts.push({ text: match[4], className: "text-blue-400" });
    } else if (match[5]) {
      // Boolean
      parts.push({ text: match[5], className: "text-yellow-400" });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < json.length) {
    parts.push(json.slice(lastIndex));
  }
  return parts;
}

export function JsonViewer({ label, data }: JsonViewerProps) {
  return (
    <details>
      <summary className="cursor-pointer text-sm text-zinc-400 transition-colors hover:text-zinc-300">
        {label}
      </summary>
      {data == null ? (
        <p className="mt-2 text-xs italic text-zinc-600">(empty)</p>
      ) : (
        <pre className="mt-2 overflow-auto rounded-lg bg-surface-0 p-3 text-xs leading-relaxed">
          <code>
            {colorizeJson(JSON.stringify(data, null, 2)).map((part, i) =>
              typeof part === "string" ? (
                <span key={i} className="text-zinc-500">{part}</span>
              ) : (
                <span key={i} className={part.className}>{part.text}</span>
              )
            )}
          </code>
        </pre>
      )}
    </details>
  );
}
```

**Step 2: Commit**

```
feat(dashboard): dark JSON viewer with color-coded syntax
```

---

## Task 8: Gantt Timeline - Dark Theme with Shimmer

**Files:**
- Modify: `packages/dashboard/src/components/gantt-timeline.tsx`

**Step 1: Rewrite gantt timeline for dark theme**

Replace `packages/dashboard/src/components/gantt-timeline.tsx`:

```tsx
import type { TimelineEntry } from "~/lib/types";
import { formatDuration } from "~/lib/format";

interface GanttTimelineProps {
  timeline: TimelineEntry[];
}

function getBarColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-400/80";
    case "failed":
      return "bg-red-400/80";
    case "sleeping":
      return "bg-blue-300/80";
    case "waiting":
      return "bg-amber-300/80";
    case "running":
      return "bg-blue-400/80";
    default:
      return "bg-zinc-500/80";
  }
}

function getRetryBarColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-400/20";
    case "failed":
      return "bg-red-400/20";
    default:
      return "bg-zinc-500/20";
  }
}

function isRunning(status: string): boolean {
  return status === "running";
}

function formatTickLabel(ms: number): string {
  if (ms === 0) return "+0ms";
  if (ms < 1000) return `+${Math.round(ms)}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
  return `+${(ms / 60_000).toFixed(1)}m`;
}

function generateTicks(totalDuration: number): number[] {
  if (totalDuration <= 0) return [0];
  const count = totalDuration < 100 ? 3 : 5;
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push((totalDuration / (count - 1)) * i);
  }
  return ticks;
}

export function GanttTimeline({ timeline }: GanttTimelineProps) {
  if (timeline.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-zinc-600">No timeline data available</p>
      </div>
    );
  }

  const minStart = Math.min(...timeline.map((t) => t.startedAt));
  const maxEnd = Math.max(...timeline.map((t) => t.startedAt + t.duration));
  const totalDuration = Math.max(maxEnd - minStart, 1);
  const ticks = generateTicks(totalDuration);

  return (
    <div>
      {/* Time axis */}
      <div className="grid" style={{ gridTemplateColumns: "140px 1fr" }}>
        <div />
        <div className="relative mb-2 h-4">
          {ticks.map((tick) => {
            const left = (tick / totalDuration) * 100;
            return (
              <span
                key={tick}
                className="absolute text-[10px] text-zinc-500"
                style={{
                  left: `${left}%`,
                  transform: left > 90 ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {formatTickLabel(tick)}
              </span>
            );
          })}
        </div>
      </div>

      {/* Rows */}
      {timeline.map((entry) => {
        const barLeft = ((entry.startedAt - minStart) / totalDuration) * 100;
        const barWidth = Math.max((entry.duration / totalDuration) * 100, 0.5);
        const color = getBarColor(entry.status);
        const retryColor = getRetryBarColor(entry.status);

        return (
          <div
            key={entry.name}
            className="grid items-center"
            style={{
              gridTemplateColumns: "140px 1fr",
              minHeight: "28px",
            }}
          >
            {/* Step name */}
            <div className="truncate pr-3 font-mono text-xs text-zinc-400">
              {entry.name}
            </div>

            {/* Bar area */}
            <div className="relative h-5 rounded-sm bg-zinc-800/50">
              {/* Retry history bars */}
              {entry.retryHistory?.map((retry) => {
                const retryLeft =
                  ((retry.timestamp - retry.duration - minStart) /
                    totalDuration) *
                  100;
                const retryWidth = Math.max(
                  (retry.duration / totalDuration) * 100,
                  0.5,
                );
                return (
                  <div
                    key={retry.attempt}
                    className={`absolute top-0 h-full rounded-sm ${retryColor}`}
                    style={{
                      left: `${Math.max(retryLeft, 0)}%`,
                      width: `${retryWidth}%`,
                    }}
                  />
                );
              })}

              {/* Main bar with tooltip */}
              <div
                className="group absolute top-0 h-full"
                style={{
                  left: `${barLeft}%`,
                  width: `${barWidth}%`,
                }}
              >
                <div
                  className={`h-full rounded-sm ${color} ${
                    isRunning(entry.status)
                      ? "animate-[shimmer_2s_ease-in-out_infinite] bg-gradient-to-r from-blue-400/80 via-blue-300/90 to-blue-400/80 bg-[length:200%_100%]"
                      : ""
                  }`}
                />

                {/* Tooltip */}
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 shadow-lg opacity-0 transition-opacity group-hover:opacity-100">
                  <p className="font-medium">{entry.name}</p>
                  <p className="text-zinc-400">
                    Duration: {formatDuration(entry.duration)}
                  </p>
                  <p className="text-zinc-400">Attempts: {entry.attempts}</p>
                  {entry.error && (
                    <p className="mt-0.5 text-red-400">{entry.error}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: Commit**

```
feat(dashboard): dark gantt timeline with shimmer on running steps
```

---

## Task 9: Step List - New Expandable Component

**Files:**
- Create: `packages/dashboard/src/components/step-list.tsx`

**Step 1: Create step list component**

Create `packages/dashboard/src/components/step-list.tsx`:

```tsx
import type { StepInfo } from "~/lib/types";
import { formatDuration, formatTimestamp, getStatusDotColor } from "~/lib/format";

interface StepListProps {
  steps: StepInfo[];
}

export function StepList({ steps }: StepListProps) {
  if (steps.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-600">No steps recorded</p>
    );
  }

  return (
    <div className="space-y-px">
      {steps.map((step) => {
        const hasError = step.error !== null;
        const dotColor = getStatusDotColor(step.status);

        return (
          <details
            key={step.name}
            className={`group rounded-lg ${hasError ? "bg-red-950/20" : ""}`}
          >
            <summary className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-zinc-800/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500">
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-200">
                {step.name}
              </span>
              {step.duration != null && (
                <span className="shrink-0 text-xs text-zinc-500">
                  {formatDuration(step.duration)}
                </span>
              )}
              {step.attempts > 1 && (
                <span className="shrink-0 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 ring-1 ring-inset ring-zinc-700">
                  {step.attempts} attempts
                </span>
              )}
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-zinc-600 transition-transform group-open:rotate-90"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </summary>

            <div className="px-3 pb-3 pt-1">
              {/* Step metadata */}
              <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                <span>Type: {step.type}</span>
                <span>Status: {step.status}</span>
                {step.startedAt && <span>Started: {formatTimestamp(step.startedAt)}</span>}
                {step.completedAt && <span>Completed: {formatTimestamp(step.completedAt)}</span>}
              </div>

              {/* Error */}
              {step.error && (
                <div className="mb-2 rounded-md bg-red-950/30 p-2.5">
                  <p className="break-words font-mono text-xs text-red-400">
                    {step.error}
                  </p>
                  {step.errorStack && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-zinc-500 transition-colors hover:text-zinc-400">
                        Stack trace
                      </summary>
                      <pre className="mt-1 overflow-auto text-[11px] leading-relaxed text-red-300/80">
                        {step.errorStack}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              {/* Retry history */}
              {step.retryHistory && step.retryHistory.length > 0 && (
                <div className="space-y-1">
                  {step.retryHistory.map((retry) => (
                    <div
                      key={retry.attempt}
                      className="border-l-2 border-zinc-700 pl-3 text-xs text-zinc-500"
                    >
                      <span className="font-medium text-zinc-400">
                        Attempt {retry.attempt}
                      </span>
                      {" \u2014 "}
                      <span className="text-red-400">{retry.error}</span>
                      {" \u2014 "}
                      <span>{formatDuration(retry.duration)}</span>
                      {" \u2014 "}
                      <span className="text-zinc-600">
                        {formatTimestamp(retry.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Result */}
              {step.result != null && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-zinc-500 transition-colors hover:text-zinc-400">
                    Result
                  </summary>
                  <pre className="mt-1 overflow-auto rounded-md bg-surface-0 p-2 text-xs text-zinc-400">
                    {JSON.stringify(step.result, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
```

**Step 2: Commit**

```
feat(dashboard): expandable step list component
```

---

## Task 10: Error Panel - Dark Theme

**Files:**
- Modify: `packages/dashboard/src/components/error-panel.tsx`

**Step 1: Rewrite error panel for dark theme**

Replace `packages/dashboard/src/components/error-panel.tsx`:

```tsx
import type { StepInfo } from "~/lib/types";
import { formatDuration, formatTimestamp } from "~/lib/format";

interface ErrorPanelProps {
  steps: StepInfo[];
  workflowError: string | null;
}

export function ErrorPanel({ steps, workflowError }: ErrorPanelProps) {
  const stepsWithErrors = steps.filter((s) => s.error !== null);
  const hasErrors = workflowError !== null || stepsWithErrors.length > 0;

  if (!hasErrors) {
    return null;
  }

  return (
    <div className="rounded-lg border border-red-800/30 bg-red-950/20 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
        <h3 className="text-sm font-semibold text-zinc-200">Errors</h3>
      </div>

      {workflowError && (
        <div className="mb-3 rounded-md bg-red-950/40 p-3 text-sm text-red-300">
          {workflowError}
        </div>
      )}

      <div className="space-y-3">
        {stepsWithErrors.map((step) => (
          <div key={step.name}>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-bold text-zinc-200">
                {step.name}
              </span>
              <span className="inline-block rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 ring-1 ring-inset ring-zinc-700">
                {step.attempts} attempt{step.attempts !== 1 ? "s" : ""}
              </span>
            </div>

            <p className="break-words font-mono text-xs text-red-400">{step.error}</p>

            {step.errorStack && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-zinc-500 transition-colors hover:text-zinc-400">
                  Stack trace
                </summary>
                <pre className="mt-1 overflow-auto rounded-md bg-red-950/30 p-2 text-[11px] text-red-300/80">
                  {step.errorStack}
                </pre>
              </details>
            )}

            {step.retryHistory && step.retryHistory.length > 0 && (
              <div className="mt-2 space-y-1">
                {step.retryHistory.map((retry) => (
                  <div
                    key={retry.attempt}
                    className="border-l-2 border-red-800/30 pl-3 text-xs text-zinc-500"
                  >
                    <span className="font-medium text-zinc-400">
                      Attempt {retry.attempt}
                    </span>
                    {" \u2014 "}
                    <span className="text-red-400">{retry.error}</span>
                    {" \u2014 "}
                    <span>{formatDuration(retry.duration)}</span>
                    {" \u2014 "}
                    <span className="text-zinc-600">
                      {formatTimestamp(retry.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```
feat(dashboard): dark theme error panel
```

---

## Task 11: Detail Panel - Right Side Component

**Files:**
- Create: `packages/dashboard/src/components/detail-panel.tsx`

**Step 1: Create the detail panel component**

Create `packages/dashboard/src/components/detail-panel.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { getWorkflow, getTimeline } from "~/lib/api";
import { useWorkflowSSE } from "~/lib/sse";
import { StatusBadge } from "~/components/status-badge";
import { JsonViewer } from "~/components/json-viewer";
import { GanttTimeline } from "~/components/gantt-timeline";
import { StepList } from "~/components/step-list";
import { ErrorPanel } from "~/components/error-panel";
import { formatTimestamp } from "~/lib/format";
import { useState } from "react";

interface DetailPanelProps {
  workflowId: string | null;
}

export function DetailPanel({ workflowId }: DetailPanelProps) {
  if (!workflowId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-surface-1">
        <svg
          aria-hidden="true"
          className="mb-3 h-10 w-10 text-zinc-800"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
          />
        </svg>
        <p className="text-sm text-zinc-600">Select a workflow</p>
      </div>
    );
  }

  return <DetailPanelContent workflowId={workflowId} />;
}

function DetailPanelContent({ workflowId }: { workflowId: string }) {
  const [copied, setCopied] = useState(false);

  useWorkflowSSE(workflowId);

  const { data: workflow, isLoading: workflowLoading } = useQuery({
    queryKey: ["workflow", workflowId],
    queryFn: () => getWorkflow(workflowId),
    refetchInterval: 3000,
  });

  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: ["timeline", workflowId],
    queryFn: () => getTimeline(workflowId),
    refetchInterval: 3000,
  });

  const isLoading = workflowLoading || timelineLoading;

  function handleCopyId() {
    navigator.clipboard.writeText(workflowId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (isLoading || !workflow) {
    return (
      <div className="flex-1 overflow-y-auto bg-surface-1 p-6">
        <DetailSkeleton />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-surface-1 p-6">
      <div className="space-y-5">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg text-zinc-100">
              {workflow.id}
            </span>
            <button
              onClick={handleCopyId}
              className="rounded-md p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-500"
              aria-label="Copy workflow ID"
            >
              {copied ? (
                <svg aria-hidden="true" className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : (
                <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                </svg>
              )}
            </button>
            <StatusBadge status={workflow.status} />
            <span className="inline-block rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400 ring-1 ring-inset ring-zinc-700">
              {workflow.type}
            </span>
          </div>

          <div className="mt-2 flex gap-4 text-xs text-zinc-500">
            <span>Created: {formatTimestamp(workflow.createdAt)}</span>
            <span>Updated: {formatTimestamp(workflow.updatedAt)}</span>
          </div>
        </div>

        {/* Error banner */}
        {workflow.error && (
          <div className="rounded-lg border border-red-800/50 bg-red-950/50 p-3 text-sm text-red-300">
            {workflow.error}
          </div>
        )}

        {/* Payload & Result */}
        <div className="grid grid-cols-2 gap-4">
          <JsonViewer label="Payload" data={workflow.payload} />
          <JsonViewer label="Result" data={workflow.result} />
        </div>

        {/* Timeline */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">Timeline</h2>
          <GanttTimeline timeline={timelineData?.timeline ?? []} />
        </div>

        {/* Steps */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">Steps</h2>
          <StepList steps={workflow.steps} />
        </div>

        {/* Error panel */}
        <ErrorPanel steps={workflow.steps} workflowError={workflow.error} />
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-3">
          <div className="h-6 w-48 animate-pulse rounded bg-zinc-800" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-zinc-800" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-zinc-800" />
        </div>
        <div className="mt-2 flex gap-4">
          <div className="h-4 w-36 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-36 animate-pulse rounded bg-zinc-800" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="h-16 animate-pulse rounded-lg bg-zinc-800/50" />
        <div className="h-16 animate-pulse rounded-lg bg-zinc-800/50" />
      </div>
      <div>
        <div className="mb-3 h-4 w-20 animate-pulse rounded bg-zinc-800" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="grid items-center" style={{ gridTemplateColumns: "140px 1fr" }}>
              <div className="h-3 w-24 animate-pulse rounded bg-zinc-800" />
              <div className="h-5 animate-pulse rounded bg-zinc-800/50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```
feat(dashboard): detail panel with header, timeline, steps, and errors
```

---

## Task 12: Split Panel Layout - Wire It All Together

**Files:**
- Modify: `packages/dashboard/src/routes/index.tsx`
- Delete: `packages/dashboard/src/routes/workflows.$id.tsx` (no longer needed)

**Step 1: Rewrite index route as split panel**

Replace `packages/dashboard/src/routes/index.tsx`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listWorkflows } from "~/lib/api";
import { TopBar } from "~/components/top-bar";
import { StatFilterBar } from "~/components/filter-bar";
import { WorkflowList } from "~/components/workflow-table";
import { DetailPanel } from "~/components/detail-panel";

interface WorkflowSearchParams {
  status?: string;
  type?: string;
  selected?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): WorkflowSearchParams => ({
    status: typeof search.status === "string" ? search.status : undefined,
    type: typeof search.type === "string" ? search.type : undefined,
    selected: typeof search.selected === "string" ? search.selected : undefined,
  }),
  component: HomePage,
});

function HomePage() {
  const { status, type, selected } = Route.useSearch();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["workflows", { status, type }],
    queryFn: () =>
      listWorkflows({
        status: status || undefined,
        type: type || undefined,
      }),
    refetchInterval: 5000,
  });

  const workflows = data?.workflows ?? [];
  const uniqueTypes = [...new Set(workflows.map((wf) => wf.type))].sort();

  function handleStatusChange(newStatus: string) {
    navigate({
      to: "/",
      search: (prev: WorkflowSearchParams) => ({
        ...prev,
        status: newStatus || undefined,
      }),
      replace: true,
    });
  }

  function handleTypeChange(newType: string) {
    navigate({
      to: "/",
      search: (prev: WorkflowSearchParams) => ({
        ...prev,
        type: newType || undefined,
      }),
      replace: true,
    });
  }

  function handleSelectWorkflow(id: string) {
    navigate({
      to: "/",
      search: (prev: WorkflowSearchParams) => ({
        ...prev,
        selected: id,
      }),
      replace: true,
    });
  }

  return (
    <div className="flex h-screen flex-col">
      <TopBar />

      <StatFilterBar
        activeStatus={status ?? ""}
        activeType={type ?? ""}
        types={uniqueTypes}
        workflows={workflows}
        onStatusChange={handleStatusChange}
        onTypeChange={handleTypeChange}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel - workflow list */}
        <div className="w-80 shrink-0 overflow-y-auto border-r border-border bg-surface-0">
          <div aria-live="polite">
            {isLoading ? (
              <div className="space-y-px">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex flex-col gap-1 border-b border-border-muted px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-zinc-800" />
                      <div className="h-4 w-24 animate-pulse rounded bg-zinc-800" />
                    </div>
                    <div className="flex items-center justify-between pl-4">
                      <div className="h-3 w-20 animate-pulse rounded bg-zinc-800" />
                      <div className="h-3 w-12 animate-pulse rounded bg-zinc-800" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <WorkflowList
                workflows={workflows}
                selectedId={selected ?? null}
                onSelect={handleSelectWorkflow}
              />
            )}
          </div>
        </div>

        {/* Right panel - detail */}
        <DetailPanel workflowId={selected ?? null} />
      </div>
    </div>
  );
}
```

**Step 2: Delete the old detail route**

Delete `packages/dashboard/src/routes/workflows.$id.tsx` since the detail view is now inline in the split panel.

**Step 3: Verify it compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 4: Commit**

```
feat(dashboard): split panel layout with integrated detail view
```

---

## Task 13: Cleanup & Final Verification

**Files:**
- Verify: all files compile
- Verify: route tree regenerates correctly

**Step 1: Regenerate route tree**

The TanStack Router file-based routing will auto-regenerate `routeTree.gen.ts` when the dev server runs. Run: `cd packages/dashboard && npx vite --port 4100` briefly to trigger regeneration, or manually delete and let it rebuild.

**Step 2: Run type check**

Run: `cd packages/dashboard && npx tsc --noEmit`

Fix any type errors.

**Step 3: Commit**

```
chore(dashboard): cleanup route tree after removing detail route
```
