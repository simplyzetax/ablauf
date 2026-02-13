import type { TimelineEntry } from "~/lib/types";
import { formatDuration } from "~/lib/format";

interface GanttTimelineProps {
  timeline: TimelineEntry[];
}

function getBarColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-400";
    case "failed":
      return "bg-red-400";
    case "sleeping":
      return "bg-blue-300";
    case "waiting":
      return "bg-amber-300";
    default:
      return "bg-zinc-300";
  }
}

function formatTickLabel(ms: number): string {
  if (ms === 0) return "+0ms";
  if (ms < 1000) return `+${Math.round(ms)}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
  return `+${(ms / 60_000).toFixed(1)}m`;
}

function generateTicks(totalDuration: number): number[] {
  if (totalDuration <= 0) return [0];
  const count = totalDuration < 100 ? 3 : 5;
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push((totalDuration / (count - 1)) * i);
  }
  return ticks;
}

export function GanttTimeline({ timeline }: GanttTimelineProps) {
  if (timeline.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-zinc-400">No timeline data available</p>
      </div>
    );
  }

  const minStart = Math.min(...timeline.map((t) => t.startedAt));
  const maxEnd = Math.max(...timeline.map((t) => t.startedAt + t.duration));
  const totalDuration = Math.max(maxEnd - minStart, 1);
  const ticks = generateTicks(totalDuration);

  return (
    <div>
      {/* Time axis */}
      <div className="grid" style={{ gridTemplateColumns: "160px 1fr" }}>
        <div />
        <div className="relative mb-2 h-4">
          {ticks.map((tick) => {
            const left = (tick / totalDuration) * 100;
            return (
              <span
                key={tick}
                className="absolute text-[10px] text-zinc-400"
                style={{
                  left: `${left}%`,
                  transform: left > 90 ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {formatTickLabel(tick)}
              </span>
            );
          })}
        </div>
      </div>

      {/* Rows */}
      {timeline.map((entry) => {
        const barLeft = ((entry.startedAt - minStart) / totalDuration) * 100;
        const barWidth = Math.max((entry.duration / totalDuration) * 100, 0.5);
        const color = getBarColor(entry.status);

        return (
          <div
            key={entry.name}
            className="grid items-center"
            style={{
              gridTemplateColumns: "160px 1fr",
              minHeight: "28px",
            }}
          >
            {/* Step name */}
            <div className="truncate pr-3 font-mono text-xs text-zinc-600">
              {entry.name}
            </div>

            {/* Bar area */}
            <div className="relative h-5">
              {/* Retry history bars */}
              {entry.retryHistory?.map((retry) => {
                const retryLeft =
                  ((retry.timestamp - retry.duration - minStart) /
                    totalDuration) *
                  100;
                const retryWidth = Math.max(
                  (retry.duration / totalDuration) * 100,
                  0.5,
                );
                return (
                  <div
                    key={retry.attempt}
                    className={`absolute top-0 h-full rounded-sm ${color} opacity-30 transition-opacity duration-300`}
                    style={{
                      left: `${Math.max(retryLeft, 0)}%`,
                      width: `${retryWidth}%`,
                    }}
                  />
                );
              })}

              {/* Main bar with tooltip */}
              <div
                className="group absolute top-0 h-full"
                style={{
                  left: `${barLeft}%`,
                  width: `${barWidth}%`,
                }}
              >
                <div className={`h-full rounded-sm ${color} transition-shadow duration-300 hover:shadow-sm`} />

                {/* Tooltip */}
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2.5 py-1.5 text-xs text-white shadow-lg opacity-0 transition-opacity group-hover:opacity-100">
                  <p className="font-medium">{entry.name}</p>
                  <p className="text-zinc-300">
                    Duration: {formatDuration(entry.duration)}
                  </p>
                  <p className="text-zinc-300">Attempts: {entry.attempts}</p>
                  {entry.error && (
                    <p className="mt-0.5 text-red-300">{entry.error}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
