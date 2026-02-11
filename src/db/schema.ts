import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Per-workflow-instance tables (stored in each workflow DO)
export const workflowTable = sqliteTable("workflow", {
	id: integer("id").primaryKey().default(1),
	type: text("type").notNull(),
	status: text("status").notNull().default("created"),
	payload: text("payload"),
	result: text("result"),
	error: text("error"),
	paused: integer("paused").notNull().default(0),
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
});

// Index shard table (stored in __index:{type} DOs)
export const instancesTable = sqliteTable("instances", {
	id: text("id").primaryKey(),
	status: text("status").notNull(),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});
