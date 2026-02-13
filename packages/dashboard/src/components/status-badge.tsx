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
