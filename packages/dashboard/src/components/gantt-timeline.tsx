import type { TimelineEntry } from '~/lib/types';
import { formatDuration } from '~/lib/format';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip';

interface GanttTimelineProps {
	/** Timeline entries representing step execution bars. */
	timeline: TimelineEntry[];
}

function getBarColor(status: string): string {
	switch (status) {
		case 'completed':
			return 'bg-emerald-400/80';
		case 'failed':
			return 'bg-red-400/80';
		case 'sleeping':
			return 'bg-blue-300/80';
		case 'waiting':
			return 'bg-amber-300/80';
		case 'running':
			return 'bg-blue-400/80';
		default:
			return 'bg-zinc-500/80';
	}
}

/** Retry bars use a uniform muted style — they're past failed attempts. */
const RETRY_BAR_CLASS = 'bg-zinc-500/25 border-r border-zinc-500/40';

function isRunning(status: string): boolean {
	return status === 'running';
}

function formatTickLabel(ms: number): string {
	if (ms === 0) return '+0ms';
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

/** Gantt-style timeline chart for workflow step execution. */
export function GanttTimeline({ timeline }: GanttTimelineProps) {
	if (timeline.length === 0) {
		return (
			<div className="flex items-center justify-center py-12">
				<p className="text-sm text-muted-foreground">No timeline data available</p>
			</div>
		);
	}

	const minStart = Math.min(...timeline.map((t) => t.startedAt ?? 0));
	const maxEnd = Math.max(...timeline.map((t) => (t.startedAt ?? 0) + t.duration));
	const totalDuration = Math.max(maxEnd - minStart, 1);
	const ticks = generateTicks(totalDuration);

	return (
		<TooltipProvider>
			<div>
				{/* Time axis */}
				<div className="grid" style={{ gridTemplateColumns: '140px 1fr' }}>
					<div />
					<div className="relative mb-2 h-4">
						{ticks.map((tick) => {
							const left = (tick / totalDuration) * 100;
							return (
								<span
									key={tick}
									className="absolute text-[10px] text-muted-foreground"
									style={{
										left: `${left}%`,
										transform: left > 90 ? 'translateX(-100%)' : 'translateX(-50%)',
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
					const barLeft = (((entry.startedAt ?? 0) - minStart) / totalDuration) * 100;
					const barWidth = Math.max((entry.duration / totalDuration) * 100, 0.5);
					const color = getBarColor(entry.status);

					return (
						<div key={entry.name} className="grid items-center" style={{ gridTemplateColumns: '140px 1fr', minHeight: '28px' }}>
							<div className="truncate pr-3 font-mono text-xs text-muted-foreground">{entry.name}</div>

							<div className="relative h-5 bg-muted">
								{/* Retry history bars */}
								{entry.retryHistory?.map((retry) => {
									const retryLeft = ((retry.timestamp - retry.duration - minStart) / totalDuration) * 100;
									const retryWidth = Math.max((retry.duration / totalDuration) * 100, 0.5);
									return (
										<Tooltip key={retry.attempt}>
											<TooltipTrigger asChild>
												<div
													className={`absolute top-0 h-full ${RETRY_BAR_CLASS}`}
													style={{
														left: `${Math.max(retryLeft, 0)}%`,
														width: `${retryWidth}%`,
													}}
												/>
											</TooltipTrigger>
											<TooltipContent>
												<p className="font-medium">Attempt {retry.attempt}</p>
												<p className="text-muted-foreground">Duration: {formatDuration(retry.duration)}</p>
												{retry.error && <p className="mt-0.5 text-red-400">{retry.error}</p>}
											</TooltipContent>
										</Tooltip>
									);
								})}

								{/* Main bar with tooltip */}
								<Tooltip>
									<TooltipTrigger asChild>
										<div
											className="absolute top-0 h-full"
											style={{
												left: `${barLeft}%`,
												width: `${barWidth}%`,
											}}
										>
											<div
												className={`h-full ${color} ${
													isRunning(entry.status)
														? 'animate-[shimmer_2s_ease-in-out_infinite] bg-gradient-to-r from-blue-400/80 via-blue-300/90 to-blue-400/80 bg-[length:200%_100%]'
														: ''
												}`}
											/>
										</div>
									</TooltipTrigger>
									<TooltipContent>
										<p className="font-medium">{entry.name}</p>
										<p className="text-muted-foreground">Duration: {formatDuration(entry.duration)}</p>
										<p className="text-muted-foreground">Attempts: {entry.attempts}</p>
										{entry.error && <p className="mt-0.5 text-red-400">{entry.error}</p>}
									</TooltipContent>
								</Tooltip>
							</div>
						</div>
					);
				})}
			</div>
		</TooltipProvider>
	);
}
