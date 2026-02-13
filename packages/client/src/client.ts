import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { dashboardRouter } from "@ablauf/workflows";
import type { AblaufClientConfig } from "./types";

export type AblaufClient = RouterClient<typeof dashboardRouter>;

export function createAblaufClient(config: AblaufClientConfig): AblaufClient {
	const link = new RPCLink({
		url: config.url,
		headers: config.headers ? () => config.headers! : undefined,
		fetch: config.withCredentials
			? (input, init) => fetch(input, { ...init, credentials: "include" })
			: undefined,
	});
	return createORPCClient(link);
}
