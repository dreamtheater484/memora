CREATE TABLE `notebooks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`icon` text NOT NULL,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_root_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notebooks_owner_id_idx` ON `notebooks` (`owner_id`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`section_id` text NOT NULL,
	`parent_page_id` text,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`content_text` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`sort_key` text NOT NULL,
	`view_mode` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_root_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pages_type_valid" CHECK("pages"."type" IN ('markdown', 'rich'))
);
--> statement-breakpoint
CREATE INDEX `pages_owner_id_idx` ON `pages` (`owner_id`);--> statement-breakpoint
CREATE INDEX `pages_section_id_idx` ON `pages` (`section_id`);--> statement-breakpoint
CREATE INDEX `pages_parent_page_id_idx` ON `pages` (`parent_page_id`);--> statement-breakpoint
CREATE TABLE `section_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`notebook_id` text NOT NULL,
	`parent_group_id` text,
	`name` text NOT NULL,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_root_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_group_id`) REFERENCES `section_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `section_groups_owner_id_idx` ON `section_groups` (`owner_id`);--> statement-breakpoint
CREATE INDEX `section_groups_notebook_id_idx` ON `section_groups` (`notebook_id`);--> statement-breakpoint
CREATE INDEX `section_groups_parent_group_id_idx` ON `section_groups` (`parent_group_id`);--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`notebook_id` text,
	`group_id` text,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`sort_key` text NOT NULL,
	`is_inbox` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_root_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `section_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sections_inbox_outside_notebooks" CHECK(("sections"."is_inbox" = 1 AND "sections"."notebook_id" IS NULL AND "sections"."group_id" IS NULL) OR ("sections"."is_inbox" = 0 AND "sections"."notebook_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `sections_owner_id_idx` ON `sections` (`owner_id`);--> statement-breakpoint
CREATE INDEX `sections_notebook_id_idx` ON `sections` (`notebook_id`);--> statement-breakpoint
CREATE INDEX `sections_group_id_idx` ON `sections` (`group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sections_one_inbox_per_owner` ON `sections` (`owner_id`) WHERE "sections"."is_inbox" = 1;--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
