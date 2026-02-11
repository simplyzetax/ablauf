PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workflow` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`workflow_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`payload` text,
	`result` text,
	`error` text,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_workflow`("id", "workflow_id", "type", "status", "payload", "result", "error", "paused", "created_at", "updated_at") SELECT "id", "workflow_id", "type", "status", "payload", "result", "error", "paused", "created_at", "updated_at" FROM `workflow`;--> statement-breakpoint
DROP TABLE `workflow`;--> statement-breakpoint
ALTER TABLE `__new_workflow` RENAME TO `workflow`;--> statement-breakpoint
PRAGMA foreign_keys=ON;