import type { StepInfo } from '~/lib/types';
import { formatDuration, formatTimestamp } from '~/lib/format';

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
		<div className="rounded-lg border border-red-800/30 bg-red-950/20 p-4">
			<div className="mb-3 flex items-center gap-2">
				<span className="inline-block h-2 w-2 rounded-full bg-red-400" />
				<h3 className="text-sm font-semibold text-zinc-200">Errors</h3>
			</div>

			{workflowError && <div className="mb-3 rounded-md bg-red-950/40 p-3 text-sm text-red-300">{workflowError}</div>}

			<div className="space-y-3">
				{stepsWithErrors.map((step) => (
					<div key={step.name}>
						<div className="mb-1 flex items-center gap-2">
							<span className="text-sm font-bold text-zinc-200">{step.name}</span>
							<span className="inline-block rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 ring-1 ring-inset ring-zinc-700">
								{step.attempts} attempt{step.attempts !== 1 ? 's' : ''}
							</span>
						</div>

						<p className="break-words font-mono text-xs text-red-400">{step.error}</p>

						{step.errorStack && (
							<details className="mt-1">
								<summary className="cursor-pointer text-xs text-zinc-500 transition-colors hover:text-zinc-400">Stack trace</summary>
								<pre className="mt-1 overflow-auto rounded-md bg-red-950/30 p-2 text-[11px] text-red-300/80">{step.errorStack}</pre>
							</details>
						)}

						{step.retryHistory && step.retryHistory.length > 0 && (
							<div className="mt-2 space-y-1">
								{step.retryHistory.map((retry) => (
									<div key={retry.attempt} className="border-l-2 border-red-800/30 pl-3 text-xs text-zinc-500">
										<span className="font-medium text-zinc-400">Attempt {retry.attempt}</span>
										{' \u2014 '}
										<span className="text-red-400">{retry.error}</span>
										{' \u2014 '}
										<span>{formatDuration(retry.duration)}</span>
										{' \u2014 '}
										<span className="text-zinc-600">{formatTimestamp(retry.timestamp)}</span>
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
