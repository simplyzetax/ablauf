import { useConnectionStatus } from "~/lib/connection";
import { useQueryClient } from "@tanstack/react-query";

export function TopBar() {
  const connection = useConnectionStatus();
  const queryClient = useQueryClient();
  const apiUrl = import.meta.env.VITE_ABLAUF_API_URL ?? "http://localhost:8787";

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-zinc-200 bg-white/80 px-4 py-2.5 backdrop-blur-sm">
      <span className="text-sm font-semibold tracking-tight">Ablauf</span>
      <code className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">
        {apiUrl}
      </code>
      <div className="flex items-center gap-2">
        <div aria-live="polite">
          <span
            role="status"
            aria-label={`Connection: ${connection.status}`}
            className={`inline-block h-2 w-2 rounded-full transition-colors ${
              connection.status === "connected"
                ? "bg-emerald-500"
                : connection.status === "error"
                  ? "bg-red-500"
                  : "bg-zinc-300"
            }`}
          />
        </div>
        <button
          onClick={() => queryClient.invalidateQueries()}
          className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 transition-colors focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-1"
        >
          Refresh
        </button>
      </div>
    </header>
  );
}
