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
