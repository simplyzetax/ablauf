import { useConnectionStatus } from '~/lib/connection';
import { useQueryClient } from '@tanstack/react-query';

export function TopBar() {
	const connection = useConnectionStatus();
	const queryClient = useQueryClient();
	const apiUrl = import.meta.env.VITE_ABLAUF_API_URL ?? 'http://localhost:8787';

	return (
		<header className="sticky top-0 z-50 flex h-10 items-center justify-between border-b border-border bg-surface-0/80 px-4 backdrop-blur-sm">
			<span className="text-sm font-semibold tracking-tight text-zinc-100">Ablauf</span>

			<div className="flex items-center gap-3">
				{/* Connection indicator with API URL tooltip */}
				<div className="group relative" aria-live="polite">
					<span
						role="status"
						className={`inline-block h-2 w-2 rounded-full transition-colors ${
							connection.status === 'connected' ? 'bg-emerald-400' : connection.status === 'error' ? 'bg-red-400' : 'bg-zinc-600'
						} ${connection.status === 'connected' ? 'animate-[pulse-dot_2s_ease-in-out_infinite]' : ''}`}
					/>
					<div className="pointer-events-none absolute right-0 top-full z-10 mt-2 whitespace-nowrap rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
						{apiUrl}
						{connection.error && <p className="mt-1 text-red-400">{connection.error}</p>}
					</div>
				</div>

				{/* Refresh button */}
				<button
					onClick={() => queryClient.invalidateQueries()}
					className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
					aria-label="Refresh data"
				>
					<svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M21.015 4.356v4.992"
						/>
					</svg>
				</button>
			</div>
		</header>
	);
}
