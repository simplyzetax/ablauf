CREATE TABLE `instances` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `steps` (
	`name` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`wake_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `workflow` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`payload` text,
	`result` text,
	`error` text,
	`paused` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
