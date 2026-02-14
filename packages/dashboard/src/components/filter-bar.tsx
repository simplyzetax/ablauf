import type { WorkflowListItem } from '~/lib/types';
import { getStatusDotColor } from '~/lib/format';

const FILTER_STATUSES = ['all', 'running', 'completed', 'errored', 'paused', 'sleeping', 'waiting', 'terminated'] as const;

interface StatFilterBarProps {
	activeStatus: string;
	activeType: string;
	types: string[];
	workflows: WorkflowListItem[];
	onStatusChange: (status: string) => void;
	onTypeChange: (type: string) => void;
}

export function StatFilterBar({ activeStatus, activeType, types, workflows, onStatusChange, onTypeChange }: StatFilterBarProps) {
	const counts = new Map<string, number>();
	counts.set('all', workflows.length);
	for (const wf of workflows) {
		counts.set(wf.status, (counts.get(wf.status) ?? 0) + 1);
	}

	return (
		<div className="sticky top-10 z-40 flex items-center justify-between border-b border-border bg-surface-0 px-4 py-2">
			<div className="flex items-center gap-1">
				{FILTER_STATUSES.map((status) => {
					const count = counts.get(status) ?? 0;
					const isActive = (status === 'all' && !activeStatus) || activeStatus === status;
					if (status !== 'all' && count === 0 && !isActive) return null;
					const dotColor = status === 'all' ? '' : getStatusDotColor(status);

					return (
						<button
							key={status}
							onClick={() => onStatusChange(status === 'all' ? '' : status)}
							className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 ${
								isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
							}`}
						>
							{status !== 'all' && (
								<span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor} ${isActive ? 'opacity-100' : 'opacity-50'}`} />
							)}
							{status.charAt(0).toUpperCase() + status.slice(1)}
							{count > 0 && <span className={isActive ? 'text-zinc-400' : 'text-zinc-600'}>{count}</span>}
						</button>
					);
				})}
			</div>

			<select
				value={activeType}
				onChange={(e) => onTypeChange(e.target.value)}
				aria-label="Filter by workflow type"
				className="rounded-md border border-zinc-700 bg-surface-1 px-2.5 py-1 text-xs text-zinc-300 outline-none transition-colors hover:border-zinc-600 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
			>
				<option value="">All types</option>
				{types.map((type) => (
					<option key={type} value={type}>
						{type}
					</option>
				))}
			</select>
		</div>
	);
}
