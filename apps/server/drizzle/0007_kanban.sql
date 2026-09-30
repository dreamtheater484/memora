CREATE TABLE `board_columns` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`wip_limit` integer,
	`wip_strict` integer DEFAULT false NOT NULL,
	`is_done` integer DEFAULT false NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL,
	`sort` text DEFAULT 'manual' NOT NULL,
	`sort_key` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `board_columns_board_id_idx` ON `board_columns` (`board_id`);--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_key` text NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `boards_project_id_idx` ON `boards` (`project_id`);--> statement-breakpoint
CREATE TABLE `card_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`card_id` text NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `card_activity_card_id_idx` ON `card_activity` (`card_id`);--> statement-breakpoint
CREATE TABLE `card_attachments` (
	`card_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`card_id`, `asset_id`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `card_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`card_id` text NOT NULL,
	`user_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `card_comments_card_id_idx` ON `card_comments` (`card_id`);--> statement-breakpoint
CREATE TABLE `card_labels` (
	`card_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`card_id`, `label_id`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_labels_label_id_idx` ON `card_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `card_pages` (
	`card_id` text NOT NULL,
	`page_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`card_id`, `page_id`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_pages_page_id_idx` ON `card_pages` (`page_id`);--> statement-breakpoint
CREATE TABLE `card_search` (
	`docid` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_search_card_id_unique` ON `card_search` (`card_id`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`board_id` text NOT NULL,
	`column_id` text NOT NULL,
	`swimlane_id` text,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`start_date` text,
	`due_date` text,
	`cover_color` text,
	`assignee_id` text,
	`sort_key` text NOT NULL,
	`completed_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`column_id`) REFERENCES `board_columns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`swimlane_id`) REFERENCES `swimlanes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cards_board_id_idx` ON `cards` (`board_id`);--> statement-breakpoint
CREATE INDEX `cards_column_id_idx` ON `cards` (`column_id`);--> statement-breakpoint
CREATE INDEX `cards_owner_id_idx` ON `cards` (`owner_id`);--> statement-breakpoint
CREATE TABLE `checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`checklist_id` text NOT NULL,
	`text` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checklist_id`) REFERENCES `checklists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checklist_items_checklist_id_idx` ON `checklist_items` (`checklist_id`);--> statement-breakpoint
CREATE TABLE `checklists` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`card_id` text NOT NULL,
	`title` text NOT NULL,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checklists_card_id_idx` ON `checklists` (`card_id`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `labels_project_id_idx` ON `labels` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`key` text NOT NULL,
	`color` text NOT NULL,
	`icon` text NOT NULL,
	`sort_key` text NOT NULL,
	`archived_at` integer,
	`next_card_number` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_owner_id_key_idx` ON `projects` (`owner_id`,`key`);--> statement-breakpoint
CREATE TABLE `swimlanes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`collapsed` integer DEFAULT false NOT NULL,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `swimlanes_board_id_idx` ON `swimlanes` (`board_id`);--> statement-breakpoint
-- Card search (§7.5): titles and descriptions, kept current by triggers like the pages'.
CREATE VIRTUAL TABLE `fts_cards` USING fts5(
	`title`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
--> statement-breakpoint
CREATE TRIGGER `cards_search_insert` AFTER INSERT ON `cards` BEGIN
	INSERT INTO `card_search` (`card_id`) VALUES (new.`id`);
	INSERT INTO `fts_cards` (`rowid`, `title`, `body`)
		VALUES ((SELECT `docid` FROM `card_search` WHERE `card_id` = new.`id`), new.`title`, new.`description`);
END;
--> statement-breakpoint
CREATE TRIGGER `cards_search_update` AFTER UPDATE OF `title`, `description` ON `cards` BEGIN
	UPDATE `fts_cards` SET `title` = new.`title`, `body` = new.`description`
		WHERE `rowid` = (SELECT `docid` FROM `card_search` WHERE `card_id` = new.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `cards_search_delete` AFTER DELETE ON `cards` BEGIN
	DELETE FROM `fts_cards` WHERE `rowid` = (SELECT `docid` FROM `card_search` WHERE `card_id` = old.`id`);
	DELETE FROM `card_search` WHERE `card_id` = old.`id`;
END;
