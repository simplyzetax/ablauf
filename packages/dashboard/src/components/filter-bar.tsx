import { useRef, useEffect } from 'react';
import type { WorkflowListItem } from '~/lib/types';
import { getStatusDotColor } from '~/lib/format';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import { cn } from '~/lib/utils';

const FILTER_STATUSES = ['all', 'running', 'completed', 'errored', 'paused', 'sleeping', 'waiting', 'terminated'] as const;

interface StatFilterBarProps {
	activeStatus: string;
	activeType: string;
	types: string[];
	workflows: WorkflowListItem[];
	searchQuery: string;
	onStatusChange: (status: string) => void;
	onTypeChange: (type: string) => void;
	onSearchChange: (query: string) => void;
}

/** Filter bar with status pills, search input, and type selector. */
export function StatFilterBar({
	activeStatus,
	activeType,
	types,
	workflows,
	searchQuery,
	onStatusChange,
	onTypeChange,
	onSearchChange,
}: StatFilterBarProps) {
	const searchRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === '/' && !isInputFocused()) {
				e.preventDefault();
				searchRef.current?.focus();
			}
		}
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, []);

	const counts = new Map<string, number>();
	counts.set('all', workflows.length);
	for (const wf of workflows) {
		counts.set(wf.status, (counts.get(wf.status) ?? 0) + 1);
	}

	return (
		<div className="sticky top-10 z-40 flex items-center justify-between border-b border-border bg-background px-4 py-2">
			<div className="flex items-center gap-1">
				{FILTER_STATUSES.map((status) => {
					const count = counts.get(status) ?? 0;
					const isActive = (status === 'all' && !activeStatus) || activeStatus === status;
					if (status !== 'all' && count === 0 && !isActive) return null;
					const dotColor = status === 'all' ? '' : getStatusDotColor(status);

					return (
						<Button
							key={status}
							variant={isActive ? 'secondary' : 'ghost'}
							size="sm"
							className="h-7 gap-1.5 text-xs"
							onClick={() => onStatusChange(status === 'all' ? '' : status)}
						>
							{status !== 'all' && <span className={cn('inline-block h-1.5 w-1.5 rounded-full', dotColor, !isActive && 'opacity-50')} />}
							{status.charAt(0).toUpperCase() + status.slice(1)}
							{count > 0 && (
								<span className={cn('text-[10px]', isActive ? 'text-muted-foreground' : 'text-muted-foreground/50')}>{count}</span>
							)}
						</Button>
					);
				})}
			</div>

			<div className="flex items-center gap-2">
				<div className="relative">
					<Input
						ref={searchRef}
						value={searchQuery}
						onChange={(e) => onSearchChange(e.target.value)}
						placeholder="Search ID"
						className="h-7 w-44 text-xs"
						aria-label="Search workflows by ID"
					/>
					{!searchQuery && (
						<kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-sm border border-border bg-muted px-1 text-[10px] text-muted-foreground">
							/
						</kbd>
					)}
				</div>

				<Select value={activeType || '__all__'} onValueChange={(value) => onTypeChange(value === '__all__' ? '' : value)}>
					<SelectTrigger className="h-7 w-[140px] text-xs" aria-label="Filter by workflow type">
						<SelectValue placeholder="All types" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="__all__">All types</SelectItem>
						{types.map((type) => (
							<SelectItem key={type} value={type}>
								{type}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}

/** Check if any input-like element is currently focused. */
function isInputFocused(): boolean {
	const el = document.activeElement;
	if (!el) return false;
	const tag = el.tagName.toLowerCase();
	return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable;
}
