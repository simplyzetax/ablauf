import { useState } from 'react';
import type { StepInfo } from '~/lib/types';
import { formatDuration, formatTimestamp } from '~/lib/format';
import { Badge } from '~/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible';
import { Separator } from '~/components/ui/separator';
import { ChevronRight } from 'lucide-react';
import { cn } from '~/lib/utils';

interface ErrorPanelProps {
	/** All steps for the workflow. */
	steps: StepInfo[];
	/** Top-level workflow error message, if any. */
	workflowError: string | null;
}

/** Aggregated error panel showing workflow-level and per-step errors. */
export function ErrorPanel({ steps, workflowError }: ErrorPanelProps) {
	const stepsWithErrors = steps.filter((s) => s.error !== null);
	const hasErrors = workflowError !== null || stepsWithErrors.length > 0;

	if (!hasErrors) return null;

	return (
		<div className="rounded-sm border border-red-800/30 bg-red-950/20 p-4">
			<div className="mb-3 flex items-center gap-2">
				<span className="inline-block h-2 w-2 rounded-full bg-red-400" />
				<h3 className="text-sm font-semibold text-foreground">Errors</h3>
			</div>

			{workflowError && <div className="mb-3 rounded-sm bg-red-950/40 p-3 text-sm text-red-300">{workflowError}</div>}

			<div className="space-y-3">
				{stepsWithErrors.map((step, i) => (
					<div key={step.name}>
						{i > 0 && <Separator className="mb-3 bg-red-800/20" />}
						<StepError step={step} />
					</div>
				))}
			</div>
		</div>
	);
}

function StepError({ step }: { step: StepInfo }) {
	const [stackOpen, setStackOpen] = useState(false);

	return (
		<div>
			<div className="mb-1 flex items-center gap-2">
				<span className="text-sm font-bold text-foreground">{step.name}</span>
				<Badge variant="outline" className="text-[10px]">
					{step.attempts} attempt{step.attempts !== 1 ? 's' : ''}
				</Badge>
			</div>

			<p className="break-words font-mono text-xs text-red-400">{step.error}</p>

			{step.errorStack && (
				<Collapsible open={stackOpen} onOpenChange={setStackOpen} className="mt-1">
					<CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
						<ChevronRight className={cn('h-3 w-3 transition-transform', stackOpen && 'rotate-90')} />
						Stack trace
					</CollapsibleTrigger>
					<CollapsibleContent>
						<pre className="mt-1 overflow-auto rounded-sm bg-red-950/30 p-2 text-[11px] text-red-300/80">{step.errorStack}</pre>
					</CollapsibleContent>
				</Collapsible>
			)}

			{step.retryHistory && step.retryHistory.length > 0 && (
				<div className="mt-2 space-y-1">
					{step.retryHistory.map((retry) => (
						<div key={retry.attempt} className="border-l-2 border-red-800/30 pl-3 text-xs text-muted-foreground">
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
		</div>
	);
}
