import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { StepStatus, StepType, WorkflowStatus } from '../engine/types';

// Per-workflow-instance tables (stored in each workflow DO)
export const workflowTable = sqliteTable('workflow', {
	id: integer('id').primaryKey().default(1),
	workflowId: text('workflow_id').notNull(),
	type: text('type').notNull(),
	status: text('status').notNull().$type<WorkflowStatus>().default('created'),
	payload: text('payload'),
	result: text('result'),
	error: text('error'),
	paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull(),
});

export const stepsTable = sqliteTable('steps', {
	name: text('name').primaryKey(),
	type: text('type').notNull().$type<StepType>(),
	status: text('status').notNull().$type<StepStatus>(),
	result: text('result'),
	error: text('error'),
	attempts: integer('attempts').notNull().default(0),
	wakeAt: integer('wake_at'),
	completedAt: integer('completed_at'),
	// Observability columns
	startedAt: integer('started_at'),
	duration: integer('duration'),
	errorStack: text('error_stack'),
	retryHistory: text('retry_history'),
});

/** Buffer for events sent before the workflow reaches `waitForEvent()`. */
export const eventBufferTable = sqliteTable('event_buffer', {
	/** Event name matching a key in the workflow's event schema. */
	eventName: text('event_name').primaryKey(),
	/** Superjson-serialized event payload. */
	payload: text('payload').notNull(),
	/** Unix timestamp (ms) when the event was received. */
	receivedAt: integer('received_at').notNull(),
});

export const sseMessagesTable = sqliteTable('sse_messages', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	event: text('event').notNull(),
	data: text('data').notNull(),
	createdAt: integer('created_at').notNull(),
});

// Index shard table (stored in __index:{type} DOs)
export const instancesTable = sqliteTable('instances', {
	id: text('id').primaryKey(),
	status: text('status').notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull(),
});
