import { createDashboardClient } from '@der-ablauf/client';
import { createRouterUtils } from '@orpc/tanstack-query';

function getBaseUrl(): string {
	return import.meta.env.VITE_ABLAUF_API_URL ?? 'http://localhost:8787';
}

export function getWsUrl(): string {
	const base = getBaseUrl();
	return base.replace(/^http/, 'ws');
}

export const client = createDashboardClient({
	url: `${getBaseUrl()}/__ablauf`,
});
export const orpc = createRouterUtils(client);
