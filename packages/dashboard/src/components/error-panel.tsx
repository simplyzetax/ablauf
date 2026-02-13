import type { StepInfo } from "~/lib/types";
import { formatDuration } from "~/lib/format";

interface ErrorPanelProps {
  steps: StepInfo[];
  workflowError: string | null;
}

export function ErrorPanel({ steps, workflowError }: ErrorPanelProps) {
  const stepsWithErrors = steps.filter((s) => s.error !== null);
  const hasErrors = workflowError !== null || stepsWithErrors.length > 0;

  if (!hasErrors) {
    return null;
  }

  return (
    <div className="rounded-lg border border-red-100 bg-red-50/50 p-4">
      {/* Heading */}
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
        <h3 className="text-sm font-semibold text-zinc-800">Errors</h3>
      </div>

      {/* Workflow-level error */}
      {workflowError && (
        <div className="mb-3 rounded bg-red-100 p-3 text-sm text-red-800">
          {workflowError}
        </div>
      )}

      {/* Per-step errors */}
      <div className="space-y-3">
        {stepsWithErrors.map((step) => (
          <div key={step.name}>
            {/* Step header */}
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-bold text-zinc-800">
                {step.name}
              </span>
              <span className="inline-block rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                {step.attempts} attempt{step.attempts !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Error message */}
            <p className="font-mono text-xs text-red-700">{step.error}</p>

            {/* Stack trace */}
            {step.errorStack && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-zinc-500">
                  Stack trace
                </summary>
                <pre className="mt-1 overflow-auto rounded bg-red-50 p-2 text-[11px] text-red-800">
                  {step.errorStack}
                </pre>
              </details>
            )}

            {/* Retry history */}
            {step.retryHistory && step.retryHistory.length > 0 && (
              <div className="mt-2 space-y-1">
                {step.retryHistory.map((retry) => (
                  <div
                    key={retry.attempt}
                    className="border-l-2 border-red-200 pl-3 text-xs text-zinc-600"
                  >
                    <span className="font-medium">
                      Attempt {retry.attempt}
                    </span>
                    {" — "}
                    <span>{retry.error}</span>
                    {" — "}
                    <span>{formatDuration(retry.duration)}</span>
                    {" — "}
                    <span className="text-zinc-400">
                      {new Date(retry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
