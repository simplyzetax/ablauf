import { useState } from 'react';
import type { StepInfo } from '~/lib/types';
import { formatDuration, formatTimestamp, getStatusDotColor } from '~/lib/format';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible';
import { Badge } from '~/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import { cn } from '~/lib/utils';

interface StepListProps {
	/** List of step execution details. */
	steps: StepInfo[];
}

/** Collapsible list of workflow step executions with error and retry details. */
export function StepList({ steps }: StepListProps) {
	if (steps.length === 0) {
		return <p className="py-6 text-center text-sm text-muted-foreground">No steps recorded</p>;
	}

	return (
		<div className="space-y-px">
			{steps.map((step) => (
				<StepRow key={step.name} step={step} />
			))}
		</div>
	);
}

function StepRow({ step }: { step: StepInfo }) {
	const [open, setOpen] = useState(false);
	const hasError = step.error !== null;
	const dotColor = getStatusDotColor(step.status);

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<div className={cn(hasError && 'bg-red-950/20')}>
				<CollapsibleTrigger className="flex w-full items-center gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-muted/50">
					<span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', dotColor)} />
					<span className="min-w-0 flex-1 truncate text-left font-mono text-sm text-foreground">{step.name}</span>
					{step.duration != null && <span className="shrink-0 text-xs text-muted-foreground">{formatDuration(step.duration)}</span>}
					{step.attempts > 1 && (
						<Badge variant="outline" className="shrink-0 text-[10px]">
							{step.attempts} attempts
						</Badge>
					)}
					<ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
				</CollapsibleTrigger>

				<CollapsibleContent>
					<div className="px-3 pb-3 pt-1">
						{/* Step metadata */}
						<div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
							<span>Type: {step.type}</span>
							<span>Status: {step.status}</span>
							{step.startedAt && <span>Started: {formatTimestamp(step.startedAt)}</span>}
							{step.completedAt && <span>Completed: {formatTimestamp(step.completedAt)}</span>}
						</div>

						{/* Error */}
						{step.error && <StepError error={step.error} errorStack={step.errorStack} />}

						{/* Retry history */}
						{step.retryHistory && step.retryHistory.length > 0 && (
							<div className="space-y-1">
								{step.retryHistory.map((retry) => (
									<div key={retry.attempt} className="border-l-2 border-zinc-700 pl-3 text-xs text-muted-foreground">
										<span className="font-medium text-foreground">Attempt {retry.attempt}</span>
										{' \u2014 '}
										<span className="text-red-400">{retry.error}</span>
										{' \u2014 '}
										<span>{formatDuration(retry.duration)}</span>
										{' \u2014 '}
										<span className="text-muted-foreground/60">{formatTimestamp(retry.timestamp)}</span>
									</div>
								))}
							</div>
						)}

						{/* Result */}
						{step.result != null && <StepResult result={step.result} />}
					</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	);
}

function StepError({ error, errorStack }: { error: string; errorStack: string | null }) {
	const [stackOpen, setStackOpen] = useState(false);

	return (
		<div className="mb-2 rounded-sm bg-red-950/30 p-2.5">
			<p className="break-words font-mono text-xs text-red-400">{error}</p>
			{errorStack && (
				<Collapsible open={stackOpen} onOpenChange={setStackOpen}>
					<CollapsibleTrigger className="mt-2 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
						<ChevronRight className={cn('h-3 w-3 transition-transform', stackOpen && 'rotate-90')} />
						Stack trace
					</CollapsibleTrigger>
					<CollapsibleContent>
						<pre className="mt-1 overflow-auto text-[11px] leading-relaxed text-red-300/80">{errorStack}</pre>
					</CollapsibleContent>
				</Collapsible>
			)}
		</div>
	);
}

function StepResult({ result }: { result: unknown }) {
	const [open, setOpen] = useState(false);

	return (
		<Collapsible open={open} onOpenChange={setOpen} className="mt-2">
			<CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
				<ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
				Result
			</CollapsibleTrigger>
			<CollapsibleContent>
				<pre className="mt-1 overflow-auto rounded-sm bg-background p-2 text-xs text-muted-foreground">
					{JSON.stringify(result, null, 2)}
				</pre>
			</CollapsibleContent>
		</Collapsible>
	);
}
