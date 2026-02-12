const UNITS: Record<string, number> = {
	ms: 1,
	s: 1000,
	m: 60 * 1000,
	h: 60 * 60 * 1000,
	d: 24 * 60 * 60 * 1000,
};

export function parseDuration(duration: string): number {
	const match = duration.match(/^(\d+)\s*(ms|s|m|h|d)$/);
	if (!match) {
		throw new Error(`Invalid duration: "${duration}". Use format like "30s", "5m", "24h", "7d".`);
	}
	return parseInt(match[1], 10) * UNITS[match[2]];
}
