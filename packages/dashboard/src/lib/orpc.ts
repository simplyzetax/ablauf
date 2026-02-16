import { createDashboardClient } from '@der-ablauf/client';
import { createRouterUtils } from '@orpc/tanstack-query';
import { getApiUrl } from './config';

/** Returns the WebSocket URL derived from the configured worker URL. */
export function getWsUrl(): string {
	return getApiUrl().replace(/^http/, 'ws');
}

export const client = createDashboardClient({
	url: `${getApiUrl()}/__ablauf`,
});
export const orpc = createRouterUtils(client);
