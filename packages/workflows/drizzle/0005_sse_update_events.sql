PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sse_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_sse_messages`("id", "event", "data", "created_at")
SELECT "seq", 'message', "data", "created_at" FROM `sse_messages`;--> statement-breakpoint
DROP TABLE `sse_messages`;--> statement-breakpoint
ALTER TABLE `__new_sse_messages` RENAME TO `sse_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
