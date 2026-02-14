export function formatTimestamp(ts: number): string {
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).format(new Date(ts));
}

export function truncateId(id: string, maxLen = 12): string {
	return id.length > maxLen ? id.slice(0, maxLen) + '\u2026' : id;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60_000).toFixed(1)}m`;
}

export function formatRelativeTime(ts: number): string {
	const now = Date.now();
	const diff = now - ts;
	if (diff < 0) return 'just now';
	if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function getStatusDotColor(status: string): string {
	switch (status) {
		case 'running':
			return 'bg-blue-400';
		case 'completed':
			return 'bg-emerald-400';
		case 'errored':
		case 'terminated':
			return 'bg-red-400';
		case 'paused':
			return 'bg-yellow-400';
		default:
			return 'bg-zinc-400';
	}
}

export function getStatusBorderColor(status: string): string {
	switch (status) {
		case 'running':
			return 'border-blue-400';
		case 'completed':
			return 'border-emerald-400';
		case 'errored':
		case 'terminated':
			return 'border-red-400';
		case 'paused':
			return 'border-yellow-400';
		default:
			return 'border-zinc-400';
	}
}
