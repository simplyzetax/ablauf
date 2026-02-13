import { Link } from "@tanstack/react-router";
import type { WorkflowListItem } from "~/lib/types";
import { formatTimestamp, truncateId } from "~/lib/format";
import { StatusBadge } from "~/components/status-badge";

interface WorkflowTableProps {
  workflows: WorkflowListItem[];
}

// Route "/workflows/$id" will be registered in the detail-page task;
// cast keeps this file compiling before that route exists.
const DETAIL_ROUTE = "/workflows/$id" as "/";

export function WorkflowTable({ workflows }: WorkflowTableProps) {
  const sorted = [...workflows].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-zinc-200">
          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
            Status
          </th>
          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
            ID
          </th>
          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
            Type
          </th>
          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
            Created
          </th>
          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
            Updated
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((wf) => (
          <tr key={wf.id} className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
            <td className="px-4 py-2">
              <Link to={DETAIL_ROUTE} params={{ id: wf.id } as any} className="block">
                <StatusBadge status={wf.status} />
              </Link>
            </td>
            <td className="px-4 py-2">
              <Link
                to={DETAIL_ROUTE}
                params={{ id: wf.id } as any}
                className="block font-mono text-xs"
                title={wf.id}
              >
                {truncateId(wf.id)}
              </Link>
            </td>
            <td className="px-4 py-2">
              <Link to={DETAIL_ROUTE} params={{ id: wf.id } as any} className="block">
                {wf.type}
              </Link>
            </td>
            <td className="px-4 py-2 text-zinc-500">
              <Link to={DETAIL_ROUTE} params={{ id: wf.id } as any} className="block">
                {formatTimestamp(wf.createdAt)}
              </Link>
            </td>
            <td className="px-4 py-2 text-zinc-500">
              <Link to={DETAIL_ROUTE} params={{ id: wf.id } as any} className="block">
                {formatTimestamp(wf.updatedAt)}
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
