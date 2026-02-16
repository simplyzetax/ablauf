import { useConnectionStatus } from '~/lib/connection';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip';
import { Separator } from '~/components/ui/separator';
import { RefreshCw } from 'lucide-react';
import { cn } from '~/lib/utils';
import { getApiUrl } from '~/lib/config';

/** Top navigation bar with app nav, connection status, and refresh control. */
export function TopBar() {
	const connection = useConnectionStatus();
	const queryClient = useQueryClient();
	const apiUrl = getApiUrl();

	return (
		<TooltipProvider>
			<header className="sticky top-0 z-50 flex h-10 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-sm">
				<div className="flex items-center gap-4">
					<span className="text-sm font-semibold tracking-tight text-foreground">Ablauf</span>
					<Separator orientation="vertical" className="h-4" />
					<nav className="flex items-center gap-1">
						<Button variant="secondary" size="sm" className="h-7 text-xs">
							Workflows
						</Button>
						<Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground" disabled>
							Data
							<Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">
								Soon
							</Badge>
						</Button>
					</nav>
				</div>

				<div className="flex items-center gap-3">
					<Tooltip>
						<TooltipTrigger asChild>
							<span
								role="status"
								aria-label={
									connection.status === 'connected' ? 'Connected' : connection.status === 'error' ? 'Connection error' : 'Disconnected'
								}
								className={cn(
									'inline-block h-2 w-2 rounded-full transition-colors',
									connection.status === 'connected' && 'bg-emerald-400 animate-[pulse-dot_2s_ease-in-out_infinite]',
									connection.status === 'error' && 'bg-red-400',
									connection.status === 'disconnected' && 'bg-zinc-600',
								)}
							/>
						</TooltipTrigger>
						<TooltipContent side="bottom" className="text-xs">
							<p>{apiUrl}</p>
							{connection.error && <p className="mt-1 text-red-400">{connection.error}</p>}
						</TooltipContent>
					</Tooltip>

					<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => queryClient.invalidateQueries()} aria-label="Refresh data">
						<RefreshCw className="h-3.5 w-3.5" />
					</Button>
				</div>
			</header>
		</TooltipProvider>
	);
}
