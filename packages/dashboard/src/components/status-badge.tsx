import { Badge } from '~/components/ui/badge';
import { cn } from '~/lib/utils';

interface StatusBadgeProps {
	/** Workflow or step status string. */
	status: string;
	/** Additional CSS classes. */
	className?: string;
}

/** Returns status-specific color classes for the badge. */
function getStatusClasses(status: string): string {
	switch (status) {
		case 'running':
			return 'border-blue-400/30 bg-blue-400/10 text-blue-400';
		case 'completed':
			return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400';
		case 'errored':
		case 'terminated':
			return 'border-red-400/30 bg-red-400/10 text-red-400';
		case 'paused':
			return 'border-amber-400/30 bg-amber-400/10 text-amber-400';
		default:
			return 'border-zinc-400/30 bg-zinc-400/10 text-zinc-400';
	}
}

/** Status badge using shadcn Badge with semantic status colors. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
	return (
		<Badge variant="outline" className={cn(getStatusClasses(status), className)}>
			{status.charAt(0).toUpperCase() + status.slice(1)}
		</Badge>
	);
}
