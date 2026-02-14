import type { WorkflowIndexEntry } from '@der-ablauf/workflows';

export type { StepInfo, TimelineEntry } from '@der-ablauf/workflows';
export type WorkflowListItem = WorkflowIndexEntry & { type: string };
