import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { orpc } from '~/lib/orpc';
import { TopBar } from '~/components/top-bar';
import { StatFilterBar } from '~/components/filter-bar';
import { WorkflowTable } from '~/components/workflow-table';
import { DetailPanel } from '~/components/detail-panel';

interface WorkflowSearchParams {
	status?: string;
	type?: string;
	selected?: string;
	q?: string;
}

export const Route = createFileRoute('/')({
	validateSearch: (search: Record<string, unknown>): WorkflowSearchParams => ({
		status: typeof search.status === 'string' ? search.status : undefined,
		type: typeof search.type === 'string' ? search.type : undefined,
		selected: typeof search.selected === 'string' ? search.selected : undefined,
		q: typeof search.q === 'string' ? search.q : undefined,
	}),
	component: HomePage,
});

function HomePage() {
	const { status, type, selected, q } = Route.useSearch();
	const navigate = useNavigate();

	const { data, isLoading } = useQuery(
		orpc.workflows.list.queryOptions({
			input: { status: status || undefined, type: type || undefined },
			refetchInterval: 5000,
		}),
	);

	const workflows = data?.workflows ?? [];
	const uniqueTypes = [...new Set(workflows.map((wf) => wf.type))].sort();

	const searchQuery = q ?? '';
	const filtered = workflows.filter((wf) => {
		if (searchQuery && !wf.id.toLowerCase().includes(searchQuery.toLowerCase())) return false;
		return true;
	});

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

	function handleSearchChange(query: string) {
		navigate({
			to: '/',
			search: (prev: WorkflowSearchParams) => ({
				...prev,
				q: query || undefined,
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

	function handleCloseDetail() {
		navigate({
			to: '/',
			search: (prev: WorkflowSearchParams) => ({
				...prev,
				selected: undefined,
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
				searchQuery={searchQuery}
				onStatusChange={handleStatusChange}
				onTypeChange={handleTypeChange}
				onSearchChange={handleSearchChange}
			/>

			<div className="flex-1 overflow-auto">
				<WorkflowTable workflows={filtered} selectedId={selected ?? null} isLoading={isLoading} onSelect={handleSelectWorkflow} />
			</div>

			<DetailPanel workflowId={selected ?? null} onClose={handleCloseDetail} />
		</div>
	);
}
