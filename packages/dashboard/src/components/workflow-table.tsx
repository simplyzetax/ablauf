import type { WorkflowListItem } from '~/lib/types';
import { formatRelativeTime, truncateId, getStatusDotColor, getStatusBorderColor } from '~/lib/format';

interface WorkflowListProps {
	workflows: WorkflowListItem[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}

export function WorkflowList({ workflows, selectedId, onSelect }: WorkflowListProps) {
	const sorted = [...workflows].sort((a, b) => b.updatedAt - a.updatedAt);

	if (sorted.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-24 px-4">
				<svg
					aria-hidden="true"
					className="mb-3 h-8 w-8 text-zinc-700"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={1.5}
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M21.015 4.356v4.992"
					/>
				</svg>
				<p className="text-sm font-medium text-zinc-500">No workflows found</p>
				<p className="mt-1 text-xs text-zinc-600">Workflows will appear here when created</p>
			</div>
		);
	}

	return (
		<div role="listbox" aria-label="Workflow list">
			{sorted.map((wf) => {
				const isSelected = wf.id === selectedId;
				const dotColor = getStatusDotColor(wf.status);
				const borderColor = getStatusBorderColor(wf.status);

				return (
					<button
						key={wf.id}
						role="option"
						aria-selected={isSelected}
						onClick={() => onSelect(wf.id)}
						className={`flex w-full flex-col gap-0.5 border-b border-border-muted px-3 py-2.5 text-left transition-colors ${
							isSelected ? `bg-zinc-800/70 border-l-2 ${borderColor}` : 'border-l-2 border-l-transparent hover:bg-zinc-900'
						} focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500`}
					>
						<div className="flex items-center gap-2">
							<span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
							<span className="truncate text-sm font-medium text-zinc-200">{wf.type}</span>
						</div>
						<div className="flex items-center justify-between pl-4">
							<span className="font-mono text-xs text-zinc-500" title={wf.id}>
								{truncateId(wf.id)}
							</span>
							<span className="text-xs text-zinc-600">{formatRelativeTime(wf.updatedAt)}</span>
						</div>
					</button>
				);
			})}
		</div>
	);
}
