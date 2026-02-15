import type { TimelineEntry } from '~/lib/types';
import { formatDuration } from '~/lib/format';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip';

interface GanttTimelineProps {
	/** Timeline entries representing step execution bars. */
	timeline: TimelineEntry[];
}

/** Status color for the final/current attempt bar. */
function getBarColor(status: string): string {
	switch (status) {
		case 'completed':
			return 'bg-emerald-400';
		case 'failed':
			return 'bg-red-400';
		case 'sleeping':
			return 'bg-blue-300';
		case 'waiting':
			return 'bg-amber-300';
		case 'running':
			return 'bg-blue-400';
		default:
			return 'bg-zinc-500';
	}
}

/** Text color matching the bar status. */
function getBarTextColor(status: string): string {
	switch (status) {
		case 'completed':
			return 'text-emerald-400';
		case 'failed':
			return 'text-red-400';
		case 'sleeping':
			return 'text-blue-300';
		case 'waiting':
			return 'text-amber-300';
		case 'running':
			return 'text-blue-400';
		default:
			return 'text-zinc-400';
	}
}

function isRunning(status: string): boolean {
	return status === 'running';
}

function formatTickLabel(ms: number): string {
	if (ms === 0) return '0ms';
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60_000).toFixed(1)}m`;
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

const NAME_COL = '140px';

/** Waterfall-style timeline chart for workflow step execution. */
export function GanttTimeline({ timeline }: GanttTimelineProps) {
	if (timeline.length === 0) {
		return (
			<div className="flex items-center justify-center py-12">
				<p className="text-sm text-muted-foreground">No timeline data available</p>
			</div>
		);
	}

	// Calculate global time bounds including retry history
	let globalMin = Infinity;
	let globalMax = 0;
	for (const entry of timeline) {
		const start = entry.startedAt ?? 0;
		const end = start + entry.duration;
		if (start < globalMin) globalMin = start;
		if (end > globalMax) globalMax = end;
		for (const retry of entry.retryHistory ?? []) {
			const retryStart = retry.timestamp - retry.duration;
			if (retryStart < globalMin) globalMin = retryStart;
			if (retry.timestamp > globalMax) globalMax = retry.timestamp;
		}
	}
	const totalDuration = Math.max(globalMax - globalMin, 1);
	const ticks = generateTicks(totalDuration);

	return (
		<TooltipProvider>
			<div>
				{/* Time axis header */}
				<div className="grid" style={{ gridTemplateColumns: `${NAME_COL} 1fr` }}>
					<div className="pr-3 text-[10px] font-medium text-muted-foreground">Name</div>
					<div className="relative mb-1 h-4">
						{ticks.map((tick) => {
							const left = (tick / totalDuration) * 100;
							return (
								<span
									key={tick}
									className="absolute text-[10px] text-muted-foreground"
									style={{
										left: `${left}%`,
										transform: left > 90 ? 'translateX(-100%)' : left === 0 ? 'none' : 'translateX(-50%)',
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
					const hasRetries = entry.retryHistory && entry.retryHistory.length > 0;
					const barLeft = (((entry.startedAt ?? 0) - globalMin) / totalDuration) * 100;
					const barWidth = Math.max((entry.duration / totalDuration) * 100, 0.5);
					const color = getBarColor(entry.status);
					const textColor = getBarTextColor(entry.status);

					return (
						<div key={entry.name}>
							{/* Main step row */}
							<div className="grid items-center" style={{ gridTemplateColumns: `${NAME_COL} 1fr`, minHeight: '28px' }}>
								<div className="min-w-0 truncate pr-3 font-mono text-xs text-muted-foreground">{entry.name}</div>

								<div className="relative h-5">
									{/* Gridlines */}
									{ticks.map((tick) => {
										const left = (tick / totalDuration) * 100;
										return <div key={tick} className="absolute top-0 h-full w-px bg-border/50" style={{ left: `${left}%` }} />;
									})}

									{/* Bar */}
									<Tooltip>
										<TooltipTrigger asChild>
											<div
												className="absolute top-0 flex h-full items-center"
												style={{ left: `${barLeft}%`, width: `${barWidth}%`, minWidth: '2px' }}
											>
												<div
													className={`h-full w-full ${color} ${
														isRunning(entry.status)
															? 'animate-[shimmer_2s_ease-in-out_infinite] bg-gradient-to-r from-blue-400 via-blue-300 to-blue-400 bg-[length:200%_100%]'
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

									{/* Duration label to the right of bar */}
									<span
										className={`absolute top-0 flex h-full items-center pl-1.5 text-[10px] font-medium ${textColor}`}
										style={{ left: `${barLeft + barWidth}%` }}
									>
										{formatDuration(entry.duration)}
									</span>
								</div>
							</div>

							{/* Retry sub-rows */}
							{hasRetries &&
								entry.retryHistory!.map((retry) => {
									const retryStart = retry.timestamp - retry.duration;
									const retryLeft = ((retryStart - globalMin) / totalDuration) * 100;
									const retryWidth = Math.max((retry.duration / totalDuration) * 100, 0.5);

									return (
										<div
											key={retry.attempt}
											className="grid items-center"
											style={{ gridTemplateColumns: `${NAME_COL} 1fr`, minHeight: '22px' }}
										>
											<div className="min-w-0 truncate pr-3 pl-4 font-mono text-[10px] text-muted-foreground/60">
												attempt {retry.attempt}
											</div>

											<div className="relative h-3.5">
												{/* Gridlines */}
												{ticks.map((tick) => {
													const left = (tick / totalDuration) * 100;
													return <div key={tick} className="absolute top-0 h-full w-px bg-border/30" style={{ left: `${left}%` }} />;
												})}

												{/* Retry bar */}
												<Tooltip>
													<TooltipTrigger asChild>
														<div
															className="absolute top-0 h-full bg-red-400/60"
															style={{
																left: `${Math.max(retryLeft, 0)}%`,
																width: `${retryWidth}%`,
																minWidth: '2px',
															}}
														/>
													</TooltipTrigger>
													<TooltipContent>
														<p className="font-medium">Attempt {retry.attempt}</p>
														<p className="text-muted-foreground">Duration: {formatDuration(retry.duration)}</p>
														{retry.error && <p className="mt-0.5 text-red-400">{retry.error}</p>}
													</TooltipContent>
												</Tooltip>

												{/* Duration label */}
												<span
													className="absolute top-0 flex h-full items-center pl-1.5 text-[10px] text-red-400/60"
													style={{ left: `${Math.max(retryLeft, 0) + retryWidth}%` }}
												>
													{formatDuration(retry.duration)}
												</span>
											</div>
										</div>
									);
								})}
						</div>
					);
				})}
			</div>
		</TooltipProvider>
	);
}
