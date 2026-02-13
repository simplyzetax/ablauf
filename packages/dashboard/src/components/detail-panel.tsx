import { useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc, client } from "~/lib/orpc";
import { StatusBadge } from "~/components/status-badge";
import { JsonViewer } from "~/components/json-viewer";
import { GanttTimeline } from "~/components/gantt-timeline";
import { StepList } from "~/components/step-list";
import { ErrorPanel } from "~/components/error-panel";
import { formatTimestamp } from "~/lib/format";
import { useState, useEffect } from "react";

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
  const queryClient = useQueryClient();

  useEffect(() => {
    const abortController = new AbortController();
    (async () => {
      try {
        const iterator = await client.workflows.subscribe(
          { id: workflowId },
          { signal: abortController.signal },
        );
        for await (const event of iterator) {
          queryClient.setQueryData(
            orpc.workflows.get.queryOptions({ input: { id: workflowId } }).queryKey,
            event,
          );
        }
      } catch {
        // Connection closed or aborted
      }
    })();
    return () => abortController.abort();
  }, [workflowId, queryClient]);

  const { data: workflow, isLoading: workflowLoading } = useQuery(
    orpc.workflows.get.queryOptions({
      input: { id: workflowId },
      refetchInterval: 3000,
    }),
  );

  const { data: timelineData, isLoading: timelineLoading } = useQuery(
    orpc.workflows.timeline.queryOptions({
      input: { id: workflowId },
      refetchInterval: 3000,
    }),
  );

  const isLoading = workflowLoading || timelineLoading;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  function handleCopyId() {
    navigator.clipboard.writeText(workflowId).catch(() => {});
    setCopied(true);
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
