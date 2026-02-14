import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { orpc } from '~/lib/orpc';
import { TopBar } from '~/components/top-bar';
import { StatFilterBar } from '~/components/filter-bar';
import { WorkflowList } from '~/components/workflow-table';
import { DetailPanel } from '~/components/detail-panel';

interface WorkflowSearchParams {
	status?: string;
	type?: string;
	selected?: string;
}

export const Route = createFileRoute('/')({
	validateSearch: (search: Record<string, unknown>): WorkflowSearchParams => ({
		status: typeof search.status === 'string' ? search.status : undefined,
		type: typeof search.type === 'string' ? search.type : undefined,
		selected: typeof search.selected === 'string' ? search.selected : undefined,
	}),
	component: HomePage,
});

function HomePage() {
	const { status, type, selected } = Route.useSearch();
	const navigate = useNavigate();

	const { data, isLoading } = useQuery(
		orpc.workflows.list.queryOptions({
			input: { status: status || undefined, type: type || undefined },
			refetchInterval: 5000,
		}),
	);

	const workflows = data?.workflows ?? [];
	const uniqueTypes = [...new Set(workflows.map((wf) => wf.type))].sort();

	function handleStatusChange(newStatus: string) {
		navigate({
			to: '/',
			search: (prev: WorkflowSearchParams) => ({
				...prev,
				status: newStatus || undefined,
			}),
			replace: true,
		});
	}

	function handleTypeChange(newType: string) {
		navigate({
			to: '/',
			search: (prev: WorkflowSearchParams) => ({
				...prev,
				type: newType || undefined,
			}),
			replace: true,
		});
	}

	function handleSelectWorkflow(id: string) {
		navigate({
			to: '/',
			search: (prev: WorkflowSearchParams) => ({
				...prev,
				selected: id,
			}),
			replace: true,
		});
	}

	return (
		<div className="flex h-screen flex-col">
			<TopBar />

			<StatFilterBar
				activeStatus={status ?? ''}
				activeType={type ?? ''}
				types={uniqueTypes}
				workflows={workflows}
				onStatusChange={handleStatusChange}
				onTypeChange={handleTypeChange}
			/>

			<div className="flex flex-1 overflow-hidden">
				{/* Left panel - workflow list */}
				<div className="w-80 shrink-0 overflow-y-auto border-r border-border bg-surface-0">
					<div aria-live="polite">
						{isLoading ? (
							<div className="space-y-px">
								{Array.from({ length: 8 }).map((_, i) => (
									<div key={i} className="flex flex-col gap-1 border-b border-border-muted px-3 py-2.5">
										<div className="flex items-center gap-2">
											<div className="h-2 w-2 animate-pulse rounded-full bg-zinc-800" />
											<div className="h-4 w-24 animate-pulse rounded bg-zinc-800" />
										</div>
										<div className="flex items-center justify-between pl-4">
											<div className="h-3 w-20 animate-pulse rounded bg-zinc-800" />
											<div className="h-3 w-12 animate-pulse rounded bg-zinc-800" />
										</div>
									</div>
								))}
							</div>
						) : (
							<WorkflowList workflows={workflows} selectedId={selected ?? null} onSelect={handleSelectWorkflow} />
						)}
					</div>
				</div>

				{/* Right panel - detail */}
				<DetailPanel workflowId={selected ?? null} />
			</div>
		</div>
	);
}
