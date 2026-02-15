CREATE TABLE `event_buffer` (
	`event_name` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`received_at` integer NOT NULL
);
