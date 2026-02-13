const STATUSES = [
  "all",
  "running",
  "completed",
  "errored",
  "paused",
  "sleeping",
  "waiting",
  "terminated",
] as const;

interface FilterBarProps {
  activeStatus: string;
  activeType: string;
  types: string[];
  onStatusChange: (status: string) => void;
  onTypeChange: (type: string) => void;
}

export function FilterBar({
  activeStatus,
  activeType,
  types,
  onStatusChange,
  onTypeChange,
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center rounded-lg bg-zinc-100 p-0.5">
        {STATUSES.map((status) => (
          <button
            key={status}
            onClick={() => onStatusChange(status === "all" ? "" : status)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              (status === "all" && !activeStatus) || activeStatus === status
                ? "bg-zinc-900 text-white shadow-sm"
                : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      <select
        value={activeType}
        onChange={(e) => onTypeChange(e.target.value)}
        className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 outline-none transition-colors hover:bg-zinc-50"
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
