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

/**
 * Segment in the sequential timeline. Each retry attempt and final attempt
 * becomes its own segment, laid out in execution order.
 */
interface TimelineSegment {
	/** Step name. */
	stepName: string;
	/** Label for this segment (step name or "attempt N"). */
	label: string;
	/** Whether this is a retry (sub-row) or the final attempt (main row). */
	isRetry: boolean;
	/** Segment duration in ms. */
	duration: number;
	/** Start offset in ms (relative to timeline start). */
	offset: number;
	/** Status for coloring. */
	status: string;
	/** Error message if failed. */
	error: string | null;
	/** Attempt number (for retries). */
	attempt?: number;
	/** Total attempts for this step. */
	totalAttempts: number;
}

/**
 * Build a sequential timeline from entries. Steps are laid out in order,
 * with retry attempts preceding the final attempt for each step.
 */
function buildSequentialTimeline(timeline: TimelineEntry[]): { segments: TimelineSegment[]; totalDuration: number } {
	const segments: TimelineSegment[] = [];
	let cursor = 0;

	for (const entry of timeline) {
		// Retry attempts first (in order)
		for (const retry of entry.retryHistory ?? []) {
			segments.push({
				stepName: entry.name,
				label: `attempt ${retry.attempt}`,
				isRetry: true,
				duration: retry.duration,
				offset: cursor,
				status: 'failed',
				error: retry.error,
				attempt: retry.attempt,
				totalAttempts: entry.attempts,
			});
			cursor += retry.duration;
		}

		// Final/current attempt
		segments.push({
			stepName: entry.name,
			label: entry.name,
			isRetry: false,
			duration: entry.duration,
			offset: cursor,
			status: entry.status,
			error: entry.error,
			totalAttempts: entry.attempts,
		});
		cursor += entry.duration;
	}

	return { segments, totalDuration: Math.max(cursor, 1) };
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

	const { segments, totalDuration } = buildSequentialTimeline(timeline);
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
				{segments.map((seg) => {
					const barLeft = (seg.offset / totalDuration) * 100;
					const barWidth = Math.max((seg.duration / totalDuration) * 100, 0.5);

					if (seg.isRetry) {
						// Retry sub-row
						return (
							<div
								key={`${seg.stepName}-retry-${seg.attempt}`}
								className="grid items-center"
								style={{ gridTemplateColumns: `${NAME_COL} 1fr`, minHeight: '22px' }}
							>
								<div className="min-w-0 truncate border-l border-muted-foreground/25 pr-3 pl-3 ml-1 font-mono text-[10px] text-muted-foreground/60">
									{seg.label}
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
												style={{ left: `${barLeft}%`, width: `${barWidth}%`, minWidth: '2px' }}
											/>
										</TooltipTrigger>
										<TooltipContent>
											<p className="font-medium">
												{seg.stepName} — Attempt {seg.attempt}
											</p>
											<p className="text-muted-foreground">Duration: {formatDuration(seg.duration)}</p>
											{seg.error && <p className="mt-0.5 text-red-400">{seg.error}</p>}
										</TooltipContent>
									</Tooltip>

									{/* Duration label */}
									<span
										className="absolute top-0 flex h-full items-center pl-1.5 text-[10px] text-red-400/60"
										style={{ left: `${barLeft + barWidth}%` }}
									>
										{formatDuration(seg.duration)}
									</span>
								</div>
							</div>
						);
					}

					// Main step row
					const color = getBarColor(seg.status);
					const textColor = getBarTextColor(seg.status);

					return (
						<div
							key={`${seg.stepName}-main`}
							className="grid items-center"
							style={{ gridTemplateColumns: `${NAME_COL} 1fr`, minHeight: '28px' }}
						>
							<div className="min-w-0 truncate pr-3 font-mono text-xs text-muted-foreground">{seg.stepName}</div>

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
													isRunning(seg.status)
														? 'animate-[shimmer_2s_ease-in-out_infinite] bg-gradient-to-r from-blue-400 via-blue-300 to-blue-400 bg-[length:200%_100%]'
														: ''
												}`}
											/>
										</div>
									</TooltipTrigger>
									<TooltipContent>
										<p className="font-medium">{seg.stepName}</p>
										<p className="text-muted-foreground">Duration: {formatDuration(seg.duration)}</p>
										<p className="text-muted-foreground">Attempts: {seg.totalAttempts}</p>
										{seg.error && <p className="mt-0.5 text-red-400">{seg.error}</p>}
									</TooltipContent>
								</Tooltip>

								{/* Duration label */}
								<span
									className={`absolute top-0 flex h-full items-center pl-1.5 text-[10px] font-medium ${textColor}`}
									style={{ left: `${barLeft + barWidth}%` }}
								>
									{formatDuration(seg.duration)}
								</span>
							</div>
						</div>
					);
				})}
			</div>
		</TooltipProvider>
	);
}
