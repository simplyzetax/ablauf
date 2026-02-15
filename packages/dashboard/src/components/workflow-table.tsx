import type { WorkflowListItem } from '~/lib/types';
import { formatRelativeTime, formatTimestamp, truncateId, getStatusDotColor, getStatusBorderColor } from '~/lib/format';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip';
import { Skeleton } from '~/components/ui/skeleton';
import { Inbox } from 'lucide-react';
import { cn } from '~/lib/utils';

interface WorkflowTableProps {
	/** List of workflows to display. */
	workflows: WorkflowListItem[];
	/** Currently selected workflow ID. */
	selectedId: string | null;
	/** Whether data is still loading. */
	isLoading: boolean;
	/** Callback when a workflow row is clicked. */
	onSelect: (id: string) => void;
}

/** Full-width workflow data table with status, ID, type, and timestamps. */
export function WorkflowTable({ workflows, selectedId, isLoading, onSelect }: WorkflowTableProps) {
	const sorted = [...workflows].sort((a, b) => b.updatedAt - a.updatedAt);

	return (
		<TooltipProvider>
			<Table>
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="w-10" />
						<TableHead className="font-mono">ID</TableHead>
						<TableHead>Type</TableHead>
						<TableHead className="w-28">Created</TableHead>
						<TableHead className="w-28">Updated</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody aria-live="polite">
					{isLoading ? (
						<LoadingRows />
					) : sorted.length === 0 ? (
						<EmptyRow />
					) : (
						sorted.map((wf) => {
							const isSelected = wf.id === selectedId;
							return (
								<TableRow
									key={wf.id}
									className={cn(
										'cursor-pointer border-l-2 transition-colors',
										isSelected ? `bg-muted ${getStatusBorderColor(wf.status)}` : 'border-l-transparent hover:bg-muted/50',
									)}
									tabIndex={0}
									role="button"
									onClick={() => onSelect(wf.id)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') onSelect(wf.id);
									}}
								>
									<TableCell className="w-10 pl-4">
										<span className={cn('inline-block h-2 w-2 rounded-full', getStatusDotColor(wf.status))} />
									</TableCell>
									<TableCell className="font-mono text-sm">
										<Tooltip>
											<TooltipTrigger asChild>
												<span>{truncateId(wf.id)}</span>
											</TooltipTrigger>
											<TooltipContent side="top" className="font-mono text-xs">
												{wf.id}
											</TooltipContent>
										</Tooltip>
									</TableCell>
									<TableCell className="text-muted-foreground">{wf.type}</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										<Tooltip>
											<TooltipTrigger asChild>
												<span>{formatRelativeTime(wf.createdAt)}</span>
											</TooltipTrigger>
											<TooltipContent side="top" className="text-xs">
												{formatTimestamp(wf.createdAt)}
											</TooltipContent>
										</Tooltip>
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										<Tooltip>
											<TooltipTrigger asChild>
												<span>{formatRelativeTime(wf.updatedAt)}</span>
											</TooltipTrigger>
											<TooltipContent side="top" className="text-xs">
												{formatTimestamp(wf.updatedAt)}
											</TooltipContent>
										</Tooltip>
									</TableCell>
								</TableRow>
							);
						})
					)}
				</TableBody>
			</Table>
		</TooltipProvider>
	);
}

function LoadingRows() {
	return (
		<>
			{Array.from({ length: 8 }).map((_, i) => (
				<TableRow key={i} className="border-l-2 border-l-transparent">
					<TableCell className="w-10 pl-4">
						<Skeleton className="h-2 w-2 rounded-full" />
					</TableCell>
					<TableCell>
						<Skeleton className="h-4 w-24" />
					</TableCell>
					<TableCell>
						<Skeleton className="h-4 w-20" />
					</TableCell>
					<TableCell>
						<Skeleton className="h-4 w-16" />
					</TableCell>
					<TableCell>
						<Skeleton className="h-4 w-16" />
					</TableCell>
				</TableRow>
			))}
		</>
	);
}

function EmptyRow() {
	return (
		<TableRow className="hover:bg-transparent">
			<TableCell colSpan={5} className="h-48 text-center">
				<div className="flex flex-col items-center gap-2">
					<Inbox className="h-8 w-8 text-muted-foreground/50" />
					<p className="text-sm font-medium text-muted-foreground">No workflows found</p>
					<p className="text-xs text-muted-foreground/70">Workflows will appear here when created</p>
				</div>
			</TableCell>
		</TableRow>
	);
}
