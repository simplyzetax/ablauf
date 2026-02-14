import type { WorkflowIndexEntry } from "@ablauf/workflows";

export type { StepInfo, TimelineEntry } from "@ablauf/workflows";
export type WorkflowListItem = WorkflowIndexEntry & { type: string };
