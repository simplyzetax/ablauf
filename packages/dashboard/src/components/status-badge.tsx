interface StatusBadgeProps {
  status: string;
}

function getStatusClasses(status: string): string {
  switch (status) {
    case "running":
    case "sleeping":
    case "waiting":
    case "created":
      return "bg-blue-50 text-blue-700";
    case "completed":
      return "bg-emerald-50 text-emerald-700";
    case "errored":
    case "terminated":
      return "bg-red-50 text-red-700";
    case "paused":
      return "bg-yellow-50 text-yellow-700";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${getStatusClasses(status)}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
