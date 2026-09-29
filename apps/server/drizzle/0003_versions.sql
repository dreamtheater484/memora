CREATE TABLE `page_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`page_id` text NOT NULL,
	`revision` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`reason` text NOT NULL,
	`device_label` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_versions_owner_id_idx` ON `page_versions` (`owner_id`);--> statement-breakpoint
CREATE INDEX `page_versions_page_id_created_at_idx` ON `page_versions` (`page_id`,`created_at`);