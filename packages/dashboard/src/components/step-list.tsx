import type { StepInfo } from '~/lib/types';
import { formatDuration, formatTimestamp, getStatusDotColor } from '~/lib/format';

interface StepListProps {
	steps: StepInfo[];
}

export function StepList({ steps }: StepListProps) {
	if (steps.length === 0) {
		return <p className="py-6 text-center text-sm text-zinc-600">No steps recorded</p>;
	}

	return (
		<div className="space-y-px">
			{steps.map((step) => {
				const hasError = step.error !== null;
				const dotColor = getStatusDotColor(step.status);

				return (
					<details key={step.name} className={`group rounded-lg ${hasError ? 'bg-red-950/20' : ''}`}>
						<summary className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-zinc-800/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500">
							<span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
							<span className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-200">{step.name}</span>
							{step.duration != null && <span className="shrink-0 text-xs text-zinc-500">{formatDuration(step.duration)}</span>}
							{step.attempts > 1 && (
								<span className="shrink-0 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 ring-1 ring-inset ring-zinc-700">
									{step.attempts} attempts
								</span>
							)}
							<svg
								aria-hidden="true"
								className="h-3.5 w-3.5 shrink-0 text-zinc-600 transition-transform group-open:rotate-90"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								strokeWidth={2}
							>
								<path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
							</svg>
						</summary>

						<div className="px-3 pb-3 pt-1">
							{/* Step metadata */}
							<div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
								<span>Type: {step.type}</span>
								<span>Status: {step.status}</span>
								{step.startedAt && <span>Started: {formatTimestamp(step.startedAt)}</span>}
								{step.completedAt && <span>Completed: {formatTimestamp(step.completedAt)}</span>}
							</div>

							{/* Error */}
							{step.error && (
								<div className="mb-2 rounded-md bg-red-950/30 p-2.5">
									<p className="break-words font-mono text-xs text-red-400">{step.error}</p>
									{step.errorStack && (
										<details className="mt-2">
											<summary className="cursor-pointer text-xs text-zinc-500 transition-colors hover:text-zinc-400">Stack trace</summary>
											<pre className="mt-1 overflow-auto text-[11px] leading-relaxed text-red-300/80">{step.errorStack}</pre>
										</details>
									)}
								</div>
							)}

							{/* Retry history */}
							{step.retryHistory && step.retryHistory.length > 0 && (
								<div className="space-y-1">
									{step.retryHistory.map((retry) => (
										<div key={retry.attempt} className="border-l-2 border-zinc-700 pl-3 text-xs text-zinc-500">
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

							{/* Result */}
							{step.result != null && (
								<details className="mt-2">
									<summary className="cursor-pointer text-xs text-zinc-500 transition-colors hover:text-zinc-400">Result</summary>
									<pre className="mt-1 overflow-auto rounded-md bg-surface-0 p-2 text-xs text-zinc-400">
										{JSON.stringify(step.result, null, 2)}
									</pre>
								</details>
							)}
						</div>
					</details>
				);
			})}
		</div>
	);
}
