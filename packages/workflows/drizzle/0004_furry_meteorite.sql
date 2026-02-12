ALTER TABLE `steps` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `steps` ADD `duration` integer;--> statement-breakpoint
ALTER TABLE `steps` ADD `error_stack` text;--> statement-breakpoint
ALTER TABLE `steps` ADD `retry_history` text;