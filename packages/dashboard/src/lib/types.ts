export type WorkflowStatus =
  | "created"
  | "running"
  | "completed"
  | "errored"
  | "paused"
  | "sleeping"
  | "waiting"
  | "terminated";

export interface WorkflowListItem {
  id: string;
  type: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface RetryHistoryEntry {
  attempt: number;
  error: string;
  errorStack: string | null;
  timestamp: number;
  duration: number;
}

export interface StepInfo {
  name: string;
  type: string;
  status: string;
  attempts: number;
  result: unknown;
  error: string | null;
  completedAt: number | null;
  startedAt: number | null;
  duration: number | null;
  errorStack: string | null;
  retryHistory: RetryHistoryEntry[] | null;
}

export interface WorkflowDetail {
  id: string;
  type: string;
  status: WorkflowStatus;
  payload: unknown;
  result: unknown;
  error: string | null;
  steps: StepInfo[];
  createdAt: number;
  updatedAt: number;
}

export interface TimelineEntry {
  name: string;
  type: string;
  status: string;
  startedAt: number | null;
  duration: number;
  attempts: number;
  error: string | null;
  retryHistory: RetryHistoryEntry[] | null;
}

export interface TimelineResponse {
  id: string;
  type: string;
  status: string;
  timeline: TimelineEntry[];
}

export interface WorkflowListResponse {
  workflows: WorkflowListItem[];
}

export interface WorkflowListFilters {
  type?: string;
  status?: string;
  limit?: number;
}
