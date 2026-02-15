# shadcn Dashboard Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the Ablauf dashboard using shadcn components with a Vercel/Linear-style monochrome dark aesthetic — sharp edges, data-forward, full-width table with slide-over detail.

**Architecture:** Replace all hand-rolled UI components with shadcn equivalents. Switch from sidebar+detail split layout to full-width data table with a Sheet (slide-over) for workflow details. Add top-level nav to support future Data Studio tab. Keep all existing data fetching (oRPC + React Query) and WebSocket logic untouched.

**Tech Stack:** shadcn/ui (new-york style), Tailwind CSS v4, lucide-react icons, TanStack Router, React Query, oRPC

---

## Design Reference

### Visual Direction
Vercel/Linear-style monochrome dark developer tool. Ultra-minimal, sharp edges, data-forward. Color reserved exclusively for status semantics.

### Layout
```
┌─────────────────────────────────────────────────┐
│ Ablauf    [Workflows]  [Data ⸱ soon]    · ⟳     │
├─────────────────────────────────────────────────┤
│ [●Running] [●Completed] [●Errored] ...  [Type▾]│
├─────────────────────────────────────────────────┤
│                                                 │
│  Full-width workflow table                      │
│  Status | ID | Type | Created | Updated         │
│                                                 │
└─────────────────────────────────────────────────┘
                                    ┌─────────────┐
                                    │ Sheet (~50%) │
                                    │ ID + badges  │
                                    │ Error banner │
                                    │ Payload/Rslt │
                                    │ Timeline     │
                                    │ Steps        │
                                    └─────────────┘
```

### Status Colors (the ONLY colors used)
- Blue (`blue-400`) — running
- Emerald (`emerald-400`) — completed
- Red (`red-400`) — errored/terminated
- Amber (`amber-400`) — paused
- Zinc (`zinc-400`) — sleeping/waiting/created

### Key Rules
- `--radius: 0rem` globally. Interactive elements get `rounded-sm` (2px max)
- Status dots are the only `rounded-full` elements
- Monospace for: IDs, step names, JSON, timestamps
- `tabular-nums` on all numeric content
- Dark mode only — no light theme

---

## Tasks

### Task 1: Initialize shadcn and Install Dependencies

**Files:**
- Create: `packages/dashboard/components.json`
- Create: `packages/dashboard/src/lib/utils.ts`
- Modify: `packages/dashboard/package.json`
- Modify: `packages/dashboard/src/styles.css`

**Step 1: Install shadcn dependencies**

```bash
cd packages/dashboard && bun add lucide-react class-variance-authority clsx tailwind-merge tw-animate-css
```

**Step 2: Create `components.json`**

Uses `~/` path aliases to match the project's existing tsconfig paths. `rsc: false` (client SPA). `baseColor: "neutral"` for the zinc palette.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "~/components",
    "utils": "~/lib/utils",
    "ui": "~/components/ui",
    "lib": "~/lib",
    "hooks": "~/hooks"
  },
  "iconLibrary": "lucide"
}
```

**Step 3: Create `src/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with conflict resolution. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Step 4: Rewrite `src/styles.css`**

Replace the entire file with shadcn's CSS variable system for Tailwind v4. Key customizations:
- `--radius: 0rem` — sharp edges globally
- Dark-only (variables in `:root` directly, no `.dark` class needed since we set `dark` class on `<html>`)
- Keep existing `pulse-dot` and `shimmer` keyframes
- Keep `tabular-nums`, `antialiased`, `prefers-reduced-motion`
- Use `@theme inline` for Tailwind v4 integration
- Import `tw-animate-css` for shadcn animations

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.17 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.17 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.396 0.141 25.723);
  --destructive-foreground: oklch(0.637 0.237 25.331);
  --border: oklch(0.269 0 0);
  --input: oklch(0.269 0 0);
  --ring: oklch(0.439 0 0);
  --radius: 0rem;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) + 2px);
  --radius-md: calc(var(--radius) + 4px);
  --radius-lg: calc(var(--radius) + 6px);
  --radius-xl: calc(var(--radius) + 8px);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground antialiased;
    font-variant-numeric: tabular-nums;
  }
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

**Step 5: Verify build**

```bash
cd packages/dashboard && bun run check-types
```

**Step 6: Commit**

```bash
git add packages/dashboard/components.json packages/dashboard/src/lib/utils.ts packages/dashboard/src/styles.css packages/dashboard/package.json bun.lockb
git commit -m "feat(dashboard): initialize shadcn with dark theme and sharp edges"
```

---

### Task 2: Install shadcn UI Components

**Files:**
- Create: `packages/dashboard/src/components/ui/button.tsx`
- Create: `packages/dashboard/src/components/ui/badge.tsx`
- Create: `packages/dashboard/src/components/ui/table.tsx`
- Create: `packages/dashboard/src/components/ui/sheet.tsx`
- Create: `packages/dashboard/src/components/ui/collapsible.tsx`
- Create: `packages/dashboard/src/components/ui/select.tsx`
- Create: `packages/dashboard/src/components/ui/tooltip.tsx`
- Create: `packages/dashboard/src/components/ui/skeleton.tsx`
- Create: `packages/dashboard/src/components/ui/separator.tsx`
- Create: `packages/dashboard/src/components/ui/input.tsx`

**Step 1: Install components via shadcn CLI**

```bash
cd packages/dashboard && npx shadcn@canary add button badge table sheet collapsible select tooltip skeleton separator input --yes --overwrite
```

If the CLI fails due to non-standard alias config, install required Radix primitives manually and copy component source from the shadcn registry:

```bash
cd packages/dashboard && bun add @radix-ui/react-collapsible @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-tooltip
```

Then copy each component file from https://ui.shadcn.com (new-york style, Tailwind v4), adjusting `@/` imports to `~/`.

**Step 2: Verify no type errors**

```bash
cd packages/dashboard && bun run check-types
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/ui/ packages/dashboard/package.json bun.lockb
git commit -m "feat(dashboard): add shadcn ui components"
```

---

### Task 3: Update `__root.tsx`

**Files:**
- Modify: `packages/dashboard/src/routes/__root.tsx`

**Step 1: Update root layout**

Add `className="dark"` to `<html>` for shadcn dark mode. Remove old `bg-surface-0 text-zinc-100` classes — the CSS `@layer base` now handles body styling.

Key changes:
- `<html lang="en">` → `<html lang="en" className="dark">`
- Remove `<div className="min-h-screen bg-surface-0 text-zinc-100">` → `<div className="min-h-screen">`
- Remove `className="antialiased"` from `<body>` (now in CSS layer)

**Step 2: Commit**

```bash
git add packages/dashboard/src/routes/__root.tsx
git commit -m "feat(dashboard): update root layout for shadcn dark theme"
```

---

### Task 4: Rewrite `top-bar.tsx`

**Files:**
- Modify: `packages/dashboard/src/components/top-bar.tsx`

**Step 1: Rewrite the component**

New structure:
- Left: "Ablauf" wordmark (`text-sm font-semibold tracking-tight`) + nav buttons
  - "Workflows" tab: `Button` variant="secondary" size="sm" (active state)
  - "Data" tab: `Button` variant="ghost" size="sm" (disabled look) + `Badge` reading "Soon" (variant="outline", `text-muted-foreground`)
- Right: connection dot in `Tooltip` + refresh `Button` variant="ghost" size="icon"

Uses:
- `Button` from `~/components/ui/button`
- `Badge` from `~/components/ui/badge`
- `Tooltip, TooltipContent, TooltipProvider, TooltipTrigger` from `~/components/ui/tooltip`
- `Separator` from `~/components/ui/separator`
- `RefreshCw` icon from `lucide-react`

The entire top bar should be wrapped in `TooltipProvider` (needed for shadcn tooltips).

Connection dot: 8px circle, color based on status (emerald/red/zinc), wrapped in TooltipTrigger showing API URL.

Remove all inline SVGs — use lucide icons.

**Step 2: Verify types**

```bash
cd packages/dashboard && bun run check-types
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/top-bar.tsx
git commit -m "feat(dashboard): redesign top bar with nav and shadcn components"
```

---

### Task 5: Rewrite `filter-bar.tsx`

**Files:**
- Modify: `packages/dashboard/src/components/filter-bar.tsx`

**Step 1: Rewrite the component**

New props interface:
```ts
interface StatFilterBarProps {
  activeStatus: string;
  activeType: string;
  types: string[];
  workflows: WorkflowListItem[];
  searchQuery: string;
  onStatusChange: (status: string) => void;
  onTypeChange: (type: string) => void;
  onSearchChange: (query: string) => void;
}
```

Structure:
- Left: status filter buttons using `Button` variant="ghost" (inactive) or variant="secondary" (active), size="sm"
- Center: `Input` for search (placeholder "Search ID\u2026", small size), with a `useEffect` for `/` keyboard shortcut focus
- Right: `Select` for type filter (replacing `<select>`)

Each status button shows: colored dot `<span>` + capitalized label + count (muted when inactive).

`/` keyboard shortcut: add `useEffect` with `keydown` listener on `document`. When `/` is pressed and no input is focused, call `inputRef.current?.focus()` and `preventDefault()`.

Uses:
- `Button` from `~/components/ui/button`
- `Input` from `~/components/ui/input`
- `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` from `~/components/ui/select`
- `Search` icon from `lucide-react` (optional, inside input)

**Step 2: Verify types**

```bash
cd packages/dashboard && bun run check-types
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/filter-bar.tsx
git commit -m "feat(dashboard): redesign filter bar with shadcn and search"
```

---

### Task 6: Rewrite `status-badge.tsx`

**Files:**
- Modify: `packages/dashboard/src/components/status-badge.tsx`

**Step 1: Rewrite with shadcn Badge**

```tsx
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

function getStatusClasses(status: string): string {
  switch (status) {
    case "running":
      return "border-blue-400/30 bg-blue-400/10 text-blue-400";
    case "completed":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-400";
    case "errored":
    case "terminated":
      return "border-red-400/30 bg-red-400/10 text-red-400";
    case "paused":
      return "border-amber-400/30 bg-amber-400/10 text-amber-400";
    default:
      return "border-zinc-400/30 bg-zinc-400/10 text-zinc-400";
  }
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn(getStatusClasses(status), className)}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}
```

**Step 2: Commit**

```bash
git add packages/dashboard/src/components/status-badge.tsx
git commit -m "feat(dashboard): rewrite status badge with shadcn Badge"
```

---

### Task 7: Rewrite `workflow-table.tsx` — Full-Width Data Table

**Files:**
- Modify: `packages/dashboard/src/components/workflow-table.tsx`

**Step 1: Rewrite as a full-width table**

Rename the component from `WorkflowList` to `WorkflowTable`. New props:

```ts
interface WorkflowTableProps {
  workflows: WorkflowListItem[];
  selectedId: string | null;
  isLoading: boolean;
  onSelect: (id: string) => void;
}
```

Uses:
- `Table, TableBody, TableCell, TableHead, TableHeader, TableRow` from `~/components/ui/table`
- `Tooltip, TooltipContent, TooltipTrigger` from `~/components/ui/tooltip`
- `Skeleton` from `~/components/ui/skeleton`
- `formatRelativeTime, formatTimestamp, truncateId, getStatusDotColor, getStatusBorderColor` from `~/lib/format`

Columns:
1. Status — 40px, colored dot only
2. ID — monospace, truncated to 12 chars, full ID in Tooltip
3. Type — muted foreground color
4. Created — relative time, exact in Tooltip
5. Updated — relative time, exact in Tooltip

Row styling:
- Base: `cursor-pointer transition-colors`
- Hover: `hover:bg-muted/50`
- Selected: `bg-muted border-l-2 ${getStatusBorderColor(wf.status)}`
- Not selected: `border-l-2 border-l-transparent`

Keyboard navigation:
- Each row is a `<TableRow>` with `tabIndex={0}` and `role="button"`
- `onKeyDown`: Enter triggers `onSelect`

Loading state: when `isLoading`, render 8 skeleton rows:
```tsx
{Array.from({ length: 8 }).map((_, i) => (
  <TableRow key={i}>
    <TableCell><Skeleton className="h-2 w-2" /></TableCell>
    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
  </TableRow>
))}
```

Empty state (not loading, zero workflows):
```tsx
<TableRow>
  <TableCell colSpan={5} className="h-48 text-center">
    <div className="flex flex-col items-center gap-2">
      <Inbox className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm font-medium text-muted-foreground">No workflows found</p>
      <p className="text-xs text-muted-foreground/70">Workflows will appear here when created</p>
    </div>
  </TableCell>
</TableRow>
```

Sort by `updatedAt` descending (current behavior, preserve it).

**Step 2: Update exports**

The component export name changes from `WorkflowList` to `WorkflowTable`. Update the import in `routes/index.tsx` accordingly (done in Task 13).

**Step 3: Verify types**

```bash
cd packages/dashboard && bun run check-types
```

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/workflow-table.tsx
git commit -m "feat(dashboard): rewrite workflow list as full-width data table"
```

---

### Task 8: Rewrite `json-viewer.tsx`

**Files:**
- Modify: `packages/dashboard/src/components/json-viewer.tsx`

**Step 1: Rewrite with Collapsible**

Replace `<details>/<summary>` with shadcn `Collapsible`. Keep the `colorizeJson` function as-is.

Uses:
- `Collapsible, CollapsibleContent, CollapsibleTrigger` from `~/components/ui/collapsible`
- `ChevronRight` from `lucide-react`
- `cn` from `~/lib/utils`

The trigger is a button-like element with the label + chevron that rotates on open:
```tsx
<CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground [&[data-state=open]>svg]:rotate-90">
  <ChevronRight className="h-3.5 w-3.5 transition-transform" />
  {label}
</CollapsibleTrigger>
```

The `<pre>` block uses `bg-background` with no rounding (or `rounded-sm` at most).

**Step 2: Commit**

```bash
git add packages/dashboard/src/components/json-viewer.tsx
git commit -m "feat(dashboard): rewrite json viewer with shadcn Collapsible"
```

---

### Task 9: Rewrite `gantt-timeline.tsx`

**Files:**
- Modify: `packages/dashboard/src/components/gantt-timeline.tsx`

**Step 1: Restyle with sharp edges and shadcn Tooltips**

Keep all calculation/positioning logic. Only change styling:

- Track background: `bg-zinc-800/50` → `bg-muted`
- Bars: `rounded-sm` → remove (no rounding)
- Retry bars: same, no rounding
- Replace the hand-rolled tooltip `<div>` with shadcn `Tooltip`:

```tsx
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <div className={`h-full ${color} ${isRunning(entry.status) ? 'animate-[shimmer_2s_ease-in-out_infinite] ...' : ''}`} />
    </TooltipTrigger>
    <TooltipContent>
      <p className="font-medium">{entry.name}</p>
      <p className="text-muted-foreground">Duration: {formatDuration(entry.duration)}</p>
      <p className="text-muted-foreground">Attempts: {entry.attempts}</p>
      {entry.error && <p className="text-red-400">{entry.error}</p>}
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

Uses:
- `Tooltip, TooltipContent, TooltipProvider, TooltipTrigger` from `~/components/ui/tooltip`

**Step 2: Commit**

```bash
git add packages/dashboard/src/components/gantt-timeline.tsx
git commit -m "feat(dashboard): restyle gantt timeline with sharp edges and shadcn tooltips"
```

---

### Task 10: Rewrite `step-list.tsx`

**Files:**
- Modify: `packages/dashboard/src/components/step-list.tsx`

**Step 1: Rewrite with Collapsible**

Replace all `<details>/<summary>` with shadcn `Collapsible`.

Uses:
- `Collapsible, CollapsibleContent, CollapsibleTrigger` from `~/components/ui/collapsible`
- `Badge` from `~/components/ui/badge`
- `ChevronRight` from `lucide-react`
- `cn` from `~/lib/utils`

Each step is a `Collapsible`:

Trigger row:
```tsx
<CollapsibleTrigger className="flex w-full items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 [&[data-state=open]>svg:last-child]:rotate-90">
  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
  <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{step.name}</span>
  {step.duration != null && <span className="shrink-0 text-xs text-muted-foreground">{formatDuration(step.duration)}</span>}
  {step.attempts > 1 && <Badge variant="outline" className="text-[10px]">{step.attempts} attempts</Badge>}
  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform" />
</CollapsibleTrigger>
```

Content: same sections (metadata, error, retry history, result) but using `Collapsible` for inner expandables too.

Error steps: wrap the outer `Collapsible` in a `div` with `bg-red-950/20` when `step.error !== null`.

**Step 2: Commit**

```bash
git add packages/dashboard/src/components/step-list.tsx
git commit -m "feat(dashboard): rewrite step list with shadcn Collapsible"
```

---

### Task 11: Rewrite `error-panel.tsx`

**Files:**
- Modify: `packages/dashboard/src/components/error-panel.tsx`

**Step 1: Restyle with shadcn components**

Uses:
- `Badge` from `~/components/ui/badge`
- `Collapsible, CollapsibleContent, CollapsibleTrigger` from `~/components/ui/collapsible`
- `Separator` from `~/components/ui/separator`

Changes:
- Outer container: `rounded-lg` → `rounded-sm`
- Attempt count: use `Badge variant="outline"`
- Stack trace: `Collapsible` instead of `<details>`
- Between step errors: `Separator`
- Remove `rounded-full` from error dot (use `rounded-full` — dots stay round as an exception)

**Step 2: Commit**

```bash
git add packages/dashboard/src/components/error-panel.tsx
git commit -m "feat(dashboard): restyle error panel with shadcn components"
```

---

### Task 12: Rewrite `detail-panel.tsx` — Sheet Slide-Over

**Files:**
- Modify: `packages/dashboard/src/components/detail-panel.tsx`

**Step 1: Rewrite as a Sheet**

The component now exports `DetailPanel` which wraps `Sheet`. Props change:

```ts
interface DetailPanelProps {
  workflowId: string | null;
  onClose: () => void;
}
```

Uses:
- `Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription` from `~/components/ui/sheet`
- `Button` from `~/components/ui/button`
- `Badge` from `~/components/ui/badge`
- `Tooltip, TooltipContent, TooltipProvider, TooltipTrigger` from `~/components/ui/tooltip`
- `Skeleton` from `~/components/ui/skeleton`
- `Separator` from `~/components/ui/separator`
- `Copy, Check` from `lucide-react`

Structure:
```tsx
<Sheet open={!!workflowId} onOpenChange={(open) => { if (!open) onClose(); }}>
  <SheetContent className="sm:max-w-[50vw] overflow-y-auto">
    {workflowId && <DetailPanelContent workflowId={workflowId} />}
  </SheetContent>
</Sheet>
```

`DetailPanelContent` keeps the same query logic and WebSocket effect. Layout changes:

1. **Header**: `SheetHeader` with `SheetTitle` (workflow ID in mono), badges row (StatusBadge + type Badge + copy Button), `SheetDescription` (timestamps)
2. **Error banner**: always expanded, `bg-destructive/10 border border-destructive/30 text-red-400 rounded-sm p-3`
3. **Payload & Result**: side-by-side grid of `JsonViewer` components
4. **Timeline section**: labeled with `<h2>` + `Separator` + `GanttTimeline`
5. **Steps section**: labeled with `<h2>` + `Separator` + `StepList`
6. **Error panel**: `ErrorPanel` at the bottom

Copy button: `Button variant="ghost" size="icon"` with `Copy`/`Check` lucide icons, wrapped in `Tooltip`.

Loading skeleton: matches the section layout with `Skeleton` components.

Remove the old empty state (the "Select a workflow" placeholder). The Sheet simply doesn't open when no workflow is selected.

**Step 2: Verify types**

```bash
cd packages/dashboard && bun run check-types
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/detail-panel.tsx
git commit -m "feat(dashboard): rewrite detail panel as slide-over Sheet"
```

---

### Task 13: Rewrite `index.tsx` Route — New Layout

**Files:**
- Modify: `packages/dashboard/src/routes/index.tsx`

**Step 1: Update imports and layout**

Key changes:
- Import `WorkflowTable` (renamed from `WorkflowList`)
- Import `DetailPanel` (now a Sheet)
- Add `q` search param for ID search
- New layout: TopBar → FilterBar → WorkflowTable (full width) → DetailPanel (Sheet overlay)
- Add `handleCloseDetail` that navigates to clear `?selected`
- Add client-side ID search filtering

Updated `WorkflowSearchParams`:
```ts
interface WorkflowSearchParams {
  status?: string;
  type?: string;
  selected?: string;
  q?: string;
}
```

Updated `validateSearch`:
```ts
validateSearch: (search: Record<string, unknown>): WorkflowSearchParams => ({
  status: typeof search.status === 'string' ? search.status : undefined,
  type: typeof search.type === 'string' ? search.type : undefined,
  selected: typeof search.selected === 'string' ? search.selected : undefined,
  q: typeof search.q === 'string' ? search.q : undefined,
}),
```

New handlers:
```ts
function handleSearchChange(query: string) {
  navigate({
    to: '/',
    search: (prev: WorkflowSearchParams) => ({
      ...prev,
      q: query || undefined,
    }),
    replace: true,
  });
}

function handleCloseDetail() {
  navigate({
    to: '/',
    search: (prev: WorkflowSearchParams) => ({
      ...prev,
      selected: undefined,
    }),
    replace: true,
  });
}
```

Filtering:
```ts
const searchQuery = q ?? '';
const filtered = workflows.filter((wf) => {
  if (searchQuery && !wf.id.toLowerCase().includes(searchQuery.toLowerCase())) return false;
  return true;
});
```

New JSX layout:
```tsx
<div className="flex h-screen flex-col">
  <TopBar />
  <StatFilterBar
    activeStatus={status ?? ''}
    activeType={type ?? ''}
    types={uniqueTypes}
    workflows={workflows}
    searchQuery={searchQuery}
    onStatusChange={handleStatusChange}
    onTypeChange={handleTypeChange}
    onSearchChange={handleSearchChange}
  />
  <div className="flex-1 overflow-auto">
    <WorkflowTable
      workflows={filtered}
      selectedId={selected ?? null}
      isLoading={isLoading}
      onSelect={handleSelectWorkflow}
    />
  </div>
  <DetailPanel workflowId={selected ?? null} onClose={handleCloseDetail} />
</div>
```

Remove the old split-panel layout entirely. No sidebar, no border-r, no w-80.

**Step 2: Verify types**

```bash
cd packages/dashboard && bun run check-types
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/routes/index.tsx
git commit -m "feat(dashboard): rewrite main route with table layout and sheet detail"
```

---

### Task 14: Final Polish and Type Check

**Files:**
- Possibly tweak: any component needing minor fixes after integration

**Step 1: Run full type check**

```bash
bun run check-types
```

Fix any type errors across the dashboard package.

**Step 2: Run full test suite**

```bash
bun run test
```

Ensure no regressions in the workflow engine tests (dashboard has no tests of its own).

**Step 3: Visual inspection notes**

After all components are in place, verify:
- [ ] No `rounded-lg` or `rounded-full` (except status dots) anywhere
- [ ] All old `surface-0`, `surface-1`, `surface-2` classes are gone
- [ ] All old inline SVGs replaced with lucide-react icons
- [ ] Sheet opens/closes with URL sync
- [ ] Keyboard `/` focuses search
- [ ] Status colors consistent across table, badges, timeline, steps

**Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix(dashboard): resolve type and integration issues"
```

---

### Task 15: Update Documentation

**Files:**
- Modify: `apps/docs/content/docs/dashboard/index.mdx`

**Step 1: Update the "What You Get" section**

```markdown
- **Workflow Table** — Full-width data table showing status, ID, type, and timestamps at a glance
- **Detail Slide-Over** — Click any row to inspect payload, result, timeline, and errors in a side panel
- **Step Timeline** — Gantt chart visualization of step execution with retry history
- **Search & Filter** — Filter by status or type, search by workflow ID with keyboard shortcut
- **Live Updates** — Real-time WebSocket updates as workflows execute
```

No changes needed to setup, API, shard configuration, or production sections.

**Step 2: Commit**

```bash
git add apps/docs/content/docs/dashboard/index.mdx
git commit -m "docs(dashboard): update docs to reflect redesigned UI"
```
