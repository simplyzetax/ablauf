import type { WorkflowRunnerStub, WorkflowClass, WorkflowIndexListFilters } from "./engine/types";

export interface DashboardHandlerOptions {
	binding: DurableObjectNamespace;
	workflows: WorkflowClass[];
	authenticate?: (request: Request) => boolean | Promise<boolean>;
}

export function createDashboardHandler(options: DashboardHandlerOptions) {
	const { binding, workflows, authenticate } = options;

	const workflowTypes = workflows.map((w) => w.type);

	function getStub(id: string): WorkflowRunnerStub {
		return binding.get(binding.idFromName(id)) as unknown as WorkflowRunnerStub;
	}

	function getIndexStub(type: string): WorkflowRunnerStub {
		return binding.get(binding.idFromName(`__index:${type}`)) as unknown as WorkflowRunnerStub;
	}

	function json(data: unknown, status = 200): Response {
		return new Response(JSON.stringify(data), {
			status,
			headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
		});
	}

	return async function handler(request: Request, basePath: string): Promise<Response> {
		if (authenticate) {
			const allowed = await authenticate(request);
			if (!allowed) return json({ error: "Unauthorized" }, 401);
		}

		const url = new URL(request.url);
		const path = url.pathname.replace(basePath, "");

		// GET /workflows
		if (path === "/workflows" && request.method === "GET") {
			const typeFilter = url.searchParams.get("type");
			const statusFilter = url.searchParams.get("status") ?? undefined;
			const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
			const filters: WorkflowIndexListFilters = { status: statusFilter, limit };

			const types = typeFilter ? [typeFilter] : workflowTypes;
			const all = await Promise.all(
				types.map(async (type) => {
					try {
						const entries = await getIndexStub(type).indexList(filters);
						return entries.map((e) => ({ ...e, type }));
					} catch {
						return [];
					}
				}),
			);
			return json({ workflows: all.flat() });
		}

		// GET /workflows/:id/timeline
		const timelineMatch = path.match(/^\/workflows\/([^/]+)\/timeline$/);
		if (timelineMatch && request.method === "GET") {
			const id = timelineMatch[1];
			try {
				const status = await getStub(id).getStatus();
				const timeline = status.steps
					.filter((s) => s.startedAt != null)
					.map((s) => ({
						name: s.name,
						type: s.type,
						status: s.status,
						startedAt: s.startedAt,
						duration: s.duration ?? 0,
						attempts: s.attempts,
						error: s.error,
						retryHistory: s.retryHistory,
					}))
					.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
				return json({ id: status.id, type: status.type, status: status.status, timeline });
			} catch {
				return json({ error: "Workflow not found" }, 404);
			}
		}

		// GET /workflows/:id
		const detailMatch = path.match(/^\/workflows\/([^/]+)$/);
		if (detailMatch && request.method === "GET") {
			const id = detailMatch[1];
			try {
				const status = await getStub(id).getStatus();
				return json(status);
			} catch {
				return json({ error: "Workflow not found" }, 404);
			}
		}

		return json({ error: "Not found" }, 404);
	};
}
