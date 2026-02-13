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

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-zinc-100" />
          ))}
        </div>
      ) : workflows.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-zinc-400">No workflows found</p>
        </div>
      ) : (
        <WorkflowTable workflows={workflows} />
      )}
    </div>
  );
}
