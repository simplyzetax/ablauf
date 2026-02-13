import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getWorkflow, getTimeline } from "~/lib/api";
import { useWorkflowSSE } from "~/lib/sse";
import { StatusBadge } from "~/components/status-badge";
import { JsonViewer } from "~/components/json-viewer";
import { GanttTimeline } from "~/components/gantt-timeline";
import { ErrorPanel } from "~/components/error-panel";
import { formatTimestamp } from "~/lib/format";

export const Route = createFileRoute("/workflows/$id")({
  component: WorkflowDetailPage,
});

function WorkflowDetailPage() {
  const { id } = Route.useParams();

  useWorkflowSSE(id);

  const { data: workflow, isLoading: workflowLoading } = useQuery({
    queryKey: ["workflow", id],
    queryFn: () => getWorkflow(id),
    refetchInterval: 3000,
  });

  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: ["timeline", id],
    queryFn: () => getTimeline(id),
    refetchInterval: 3000,
  });

  const isLoading = workflowLoading || timelineLoading;

  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* Back link */}
      <Link to="/" className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-1 rounded">
        <span aria-hidden="true">&larr;</span> Workflows
      </Link>

      {isLoading || !workflow ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-4">
          {/* Header section */}
          <div className="rounded-lg border border-zinc-200 bg-white p-5 transition-shadow hover:shadow-sm">
            {/* Top row: ID + badges */}
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg text-zinc-800">
                {workflow.id}
              </span>
              <StatusBadge status={workflow.status} />
              <span className="inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 transition-colors">
                {workflow.type}
              </span>
            </div>

            {/* Timestamps */}
            <div className="mt-3 flex gap-6 text-xs text-zinc-500">
              <span>Created: {formatTimestamp(workflow.createdAt)}</span>
              <span>Updated: {formatTimestamp(workflow.updatedAt)}</span>
            </div>

            {/* Payload + Result */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <JsonViewer label="Payload" data={workflow.payload} />
              <JsonViewer label="Result" data={workflow.result} />
            </div>

            {/* Workflow error banner */}
            {workflow.error && (
              <div className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">
                {workflow.error}
              </div>
            )}
          </div>

          {/* Timeline section */}
          <div className="rounded-lg border border-zinc-200 bg-white p-5 transition-shadow hover:shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-zinc-700">
              Timeline
            </h2>
            <GanttTimeline timeline={timelineData?.timeline ?? []} />
          </div>

          {/* Error panel */}
          <ErrorPanel
            steps={workflow.steps}
            workflowError={workflow.error}
          />
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {/* Header skeleton */}
      <div className="rounded-lg border border-zinc-200 bg-white p-5">
        <div className="flex items-center gap-3">
          <div className="h-6 w-48 animate-pulse rounded bg-zinc-100" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-zinc-100" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-zinc-100" />
        </div>
        <div className="mt-3 flex gap-6">
          <div className="h-4 w-36 animate-pulse rounded bg-zinc-100" />
          <div className="h-4 w-36 animate-pulse rounded bg-zinc-100" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="h-20 animate-pulse rounded bg-zinc-50" />
          <div className="h-20 animate-pulse rounded bg-zinc-50" />
        </div>
      </div>

      {/* Timeline skeleton */}
      <div className="rounded-lg border border-zinc-200 bg-white p-5">
        <div className="mb-4 h-4 w-20 animate-pulse rounded bg-zinc-100" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="grid items-center"
              style={{ gridTemplateColumns: "160px 1fr" }}
            >
              <div className="h-3 w-24 animate-pulse rounded bg-zinc-100" />
              <div className="h-5 animate-pulse rounded bg-zinc-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
