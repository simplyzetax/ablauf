import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listWorkflows } from "~/lib/api";
import { FilterBar } from "~/components/filter-bar";
import { WorkflowTable } from "~/components/workflow-table";

interface WorkflowSearchParams {
  status?: string;
  type?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): WorkflowSearchParams => ({
    status: typeof search.status === "string" ? search.status : undefined,
    type: typeof search.type === "string" ? search.type : undefined,
  }),
  component: HomePage,
});

function HomePage() {
  const { status, type } = Route.useSearch();
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

  return (
    <div className="p-6">
      <div className="mb-4">
        <FilterBar
          activeStatus={status ?? ""}
          activeType={type ?? ""}
          types={uniqueTypes}
          onStatusChange={handleStatusChange}
          onTypeChange={handleTypeChange}
        />
      </div>

      <div aria-live="polite">
      {isLoading ? (
        <div className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-2">
              <div className="h-4 w-4 animate-pulse rounded-full bg-zinc-100" />
              <div className="h-4 w-28 animate-pulse rounded bg-zinc-100" />
              <div className="h-4 w-20 animate-pulse rounded bg-zinc-100" />
              <div className="h-4 w-32 animate-pulse rounded bg-zinc-100" />
              <div className="h-4 w-32 animate-pulse rounded bg-zinc-100" />
            </div>
          ))}
        </div>
      ) : workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <svg
            aria-hidden="true"
            className="mb-4 h-10 w-10 text-zinc-300"
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
          <p className="text-lg font-medium text-zinc-400">No workflows found</p>
          <p className="mt-1 text-sm text-zinc-300">
            Workflows will appear here when created via the API
          </p>
        </div>
      ) : (
        <WorkflowTable workflows={workflows} />
      )}
      </div>
    </div>
  );
}
