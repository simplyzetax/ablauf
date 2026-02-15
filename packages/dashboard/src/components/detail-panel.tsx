import { useQuery, useQueryClient } from '@tanstack/react-query';
import { orpc, getWsUrl } from '~/lib/orpc';
import { StatusBadge } from '~/components/status-badge';
import { JsonViewer } from '~/components/json-viewer';
import { GanttTimeline } from '~/components/gantt-timeline';
import { StepList } from '~/components/step-list';
import { ErrorPanel } from '~/components/error-panel';
import { formatTimestamp } from '~/lib/format';
import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '~/components/ui/sheet';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip';
import { Skeleton } from '~/components/ui/skeleton';
import { Separator } from '~/components/ui/separator';
import { Copy, Check } from 'lucide-react';

interface DetailPanelProps {
	/** Workflow ID to display, or null to close the sheet. */
	workflowId: string | null;
	/** Callback to close the sheet. */
	onClose: () => void;
}

/** Slide-over detail panel for inspecting a single workflow. */
export function DetailPanel({ workflowId, onClose }: DetailPanelProps) {
	return (
		<Sheet
			open={!!workflowId}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<SheetContent className="w-full overflow-y-auto sm:max-w-[50vw]">
				{workflowId && <DetailPanelContent workflowId={workflowId} />}
			</SheetContent>
		</Sheet>
	);
}

function DetailPanelContent({ workflowId }: { workflowId: string }) {
	const [copied, setCopied] = useState(false);
	const queryClient = useQueryClient();

	useEffect(() => {
		const baseWsUrl = getWsUrl();
		const ws = new WebSocket(`${baseWsUrl}/__ablauf/workflows/${workflowId}/ws`);

		ws.addEventListener('message', () => {
			queryClient.invalidateQueries({
				queryKey: orpc.workflows.get.queryOptions({ input: { id: workflowId } }).queryKey,
			});
		});

		ws.addEventListener('error', () => {
			// Connection failed — polling fallback handles it
		});

		return () => ws.close();
	}, [workflowId, queryClient]);

	const { data: workflow, isLoading: workflowLoading } = useQuery(
		orpc.workflows.get.queryOptions({
			input: { id: workflowId },
			refetchInterval: 3000,
		}),
	);

	const { data: timelineData, isLoading: timelineLoading } = useQuery(
		orpc.workflows.timeline.queryOptions({
			input: { id: workflowId },
			refetchInterval: 3000,
		}),
	);

	const isLoading = workflowLoading || timelineLoading;

	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);

	function handleCopyId() {
		navigator.clipboard.writeText(workflowId).catch(() => {});
		setCopied(true);
	}

	if (isLoading || !workflow) {
		return <DetailSkeleton />;
	}

	return (
		<TooltipProvider>
			<SheetHeader className="space-y-3 pb-4">
				<div className="flex items-center gap-3">
					<SheetTitle className="font-mono text-lg">{workflow.id}</SheetTitle>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopyId} aria-label="Copy workflow ID">
								{copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
							</Button>
						</TooltipTrigger>
						<TooltipContent>{copied ? 'Copied' : 'Copy ID'}</TooltipContent>
					</Tooltip>
				</div>
				<div className="flex items-center gap-2">
					<StatusBadge status={workflow.status} />
					<Badge variant="outline" className="text-muted-foreground">
						{workflow.type}
					</Badge>
				</div>
				<SheetDescription className="flex gap-4 text-xs">
					<span>Created: {formatTimestamp(workflow.createdAt)}</span>
					<span>Updated: {formatTimestamp(workflow.updatedAt)}</span>
				</SheetDescription>
			</SheetHeader>

			<div className="space-y-5 px-4">
				{/* Error banner — always expanded, not collapsible */}
				{workflow.error && (
					<div className="rounded-sm border border-red-800/50 bg-red-950/50 p-3 text-sm text-red-300">{workflow.error}</div>
				)}

				{/* Payload & Result */}
				<div className="grid grid-cols-2 gap-4">
					<JsonViewer label="Payload" data={workflow.payload} />
					<JsonViewer label="Result" data={workflow.result} />
				</div>

				<Separator />

				{/* Timeline */}
				<div>
					<h2 className="mb-3 text-sm font-semibold text-foreground">Timeline</h2>
					<GanttTimeline timeline={timelineData?.timeline ?? []} />
				</div>

				<Separator />

				{/* Steps */}
				<div>
					<h2 className="mb-3 text-sm font-semibold text-foreground">
						Steps
						{workflow.steps.length > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{workflow.steps.length}</span>}
					</h2>
					<StepList steps={workflow.steps} />
				</div>

				{/* Error panel */}
				<ErrorPanel steps={workflow.steps} workflowError={workflow.error} />
			</div>
		</TooltipProvider>
	);
}

function DetailSkeleton() {
	return (
		<div className="space-y-5 px-4 pt-6">
			<div>
				<div className="flex items-center gap-3">
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-5 w-16" />
					<Skeleton className="h-5 w-20" />
				</div>
				<div className="mt-2 flex gap-4">
					<Skeleton className="h-4 w-36" />
					<Skeleton className="h-4 w-36" />
				</div>
			</div>
			<Separator />
			<div className="grid grid-cols-2 gap-4">
				<Skeleton className="h-16" />
				<Skeleton className="h-16" />
			</div>
			<Separator />
			<div>
				<Skeleton className="mb-3 h-4 w-20" />
				<div className="space-y-2">
					{Array.from({ length: 4 }).map((_, i) => (
						<div key={i} className="grid items-center" style={{ gridTemplateColumns: '140px 1fr' }}>
							<Skeleton className="h-3 w-24" />
							<Skeleton className="h-5" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
