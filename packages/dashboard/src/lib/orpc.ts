import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createRouterUtils } from "@orpc/tanstack-query";
import type { RouterClient } from "@orpc/server";
import type { dashboardRouter } from "@ablauf/workflows";

function getBaseUrl(): string {
	return import.meta.env.VITE_ABLAUF_API_URL ?? "http://localhost:8787";
}

const link = new RPCLink({
	url: `${getBaseUrl()}/__ablauf`,
});

export const client: RouterClient<typeof dashboardRouter> = createORPCClient(link);
export const orpc = createRouterUtils(client);
