import type {
  WorkflowListResponse,
  WorkflowListFilters,
  WorkflowDetail,
  TimelineResponse,
} from "./types";
import { reportSuccess, reportError } from "./connection";

function getBaseUrl(): string {
  return import.meta.env.VITE_ABLAUF_API_URL ?? "http://localhost:8787";
}

async function fetchAPI<T>(path: string): Promise<T> {
  const url = `${getBaseUrl()}/__ablauf${path}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    reportSuccess();
    return data as T;
  } catch (err) {
    reportError(err instanceof Error ? err.message : "Unknown error");
    throw err;
  }
}

export async function listWorkflows(
  filters?: WorkflowListFilters,
): Promise<WorkflowListResponse> {
  const params = new URLSearchParams();
  if (filters?.type) params.set("type", filters.type);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return fetchAPI(`/workflows${qs ? `?${qs}` : ""}`);
}

export async function getWorkflow(id: string): Promise<WorkflowDetail> {
  return fetchAPI(`/workflows/${id}`);
}

export async function getTimeline(id: string): Promise<TimelineResponse> {
  return fetchAPI(`/workflows/${id}/timeline`);
}
