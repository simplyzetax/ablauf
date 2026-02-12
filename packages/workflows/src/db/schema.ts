import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { WorkflowStatus } from "../engine/types";

// Per-workflow-instance tables (stored in each workflow DO)
export const workflowTable = sqliteTable("workflow", {
	id: integer("id").primaryKey().default(1),
	workflowId: text("workflow_id").notNull(),
	type: text("type").notNull(),
	status: text("status").notNull().$type<WorkflowStatus>().default("created"),
	payload: text("payload"),
	result: text("result"),
	error: text("error"),
	paused: integer("paused", { mode: "boolean" }).notNull().default(false),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

export const stepsTable = sqliteTable("steps", {
	name: text("name").primaryKey(),
	type: text("type").notNull(), // 'do' | 'sleep' | 'wait_for_event'
	status: text("status").notNull(), // 'completed' | 'failed' | 'sleeping' | 'waiting'
	result: text("result"),
	error: text("error"),
	attempts: integer("attempts").notNull().default(0),
	wakeAt: integer("wake_at"),
	completedAt: integer("completed_at"),
	// Observability columns
	startedAt: integer("started_at"),
	duration: integer("duration"),
	errorStack: text("error_stack"),
	retryHistory: text("retry_history"),
});

export const sseMessagesTable = sqliteTable("sse_messages", {
	seq: integer("seq").primaryKey({ autoIncrement: true }),
	data: text("data").notNull(),
	createdAt: integer("created_at").notNull(),
});

// Index shard table (stored in __index:{type} DOs)
export const instancesTable = sqliteTable("instances", {
	id: text("id").primaryKey(),
	status: text("status").notNull(),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});
