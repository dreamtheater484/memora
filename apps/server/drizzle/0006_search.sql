CREATE TABLE `page_links` (
	`source_page_id` text NOT NULL,
	`target_title` text NOT NULL,
	`target_key` text NOT NULL,
	PRIMARY KEY(`source_page_id`, `target_key`),
	FOREIGN KEY (`source_page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_links_target_key_idx` ON `page_links` (`target_key`);--> statement-breakpoint
CREATE TABLE `page_search` (
	`docid` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_search_page_id_unique` ON `page_search` (`page_id`);--> statement-breakpoint
CREATE TABLE `page_tags` (
	`page_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`page_id`, `tag_id`),
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_tags_tag_id_idx` ON `page_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`color` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_owner_id_name_key_idx` ON `tags` (`owner_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `templates_owner_id_idx` ON `templates` (`owner_id`);--> statement-breakpoint
-- Full-text search (§7.5): titles, text and tag names, kept current by the triggers below in
-- the same transaction as every change. Rows are keyed by page_search.docid.
CREATE VIRTUAL TABLE `fts_pages` USING fts5(
	`title`,
	`body`,
	`tags`,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
--> statement-breakpoint
INSERT INTO `page_search` (`page_id`) SELECT `id` FROM `pages` ORDER BY `created_at`;
--> statement-breakpoint
INSERT INTO `fts_pages` (`rowid`, `title`, `body`, `tags`)
	SELECT s.`docid`, p.`title`, p.`content_text`, '' FROM `pages` p JOIN `page_search` s ON s.`page_id` = p.`id`;
--> statement-breakpoint
CREATE TRIGGER `pages_search_insert` AFTER INSERT ON `pages` BEGIN
	INSERT INTO `page_search` (`page_id`) VALUES (new.`id`);
	INSERT INTO `fts_pages` (`rowid`, `title`, `body`, `tags`)
		VALUES ((SELECT `docid` FROM `page_search` WHERE `page_id` = new.`id`), new.`title`, new.`content_text`, '');
END;
--> statement-breakpoint
CREATE TRIGGER `pages_search_update` AFTER UPDATE OF `title`, `content_text` ON `pages` BEGIN
	UPDATE `fts_pages` SET `title` = new.`title`, `body` = new.`content_text`
		WHERE `rowid` = (SELECT `docid` FROM `page_search` WHERE `page_id` = new.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `pages_search_delete` AFTER DELETE ON `pages` BEGIN
	DELETE FROM `fts_pages` WHERE `rowid` = (SELECT `docid` FROM `page_search` WHERE `page_id` = old.`id`);
	DELETE FROM `page_search` WHERE `page_id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `page_tags_search_insert` AFTER INSERT ON `page_tags` BEGIN
	UPDATE `fts_pages` SET `tags` = (
		SELECT coalesce(group_concat(t.`name`, ' '), '') FROM `page_tags` pt JOIN `tags` t ON t.`id` = pt.`tag_id` WHERE pt.`page_id` = new.`page_id`
	) WHERE `rowid` = (SELECT `docid` FROM `page_search` WHERE `page_id` = new.`page_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `page_tags_search_delete` AFTER DELETE ON `page_tags` BEGIN
	UPDATE `fts_pages` SET `tags` = (
		SELECT coalesce(group_concat(t.`name`, ' '), '') FROM `page_tags` pt JOIN `tags` t ON t.`id` = pt.`tag_id` WHERE pt.`page_id` = old.`page_id`
	) WHERE `rowid` = (SELECT `docid` FROM `page_search` WHERE `page_id` = old.`page_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `tags_search_rename` AFTER UPDATE OF `name` ON `tags` BEGIN
	UPDATE `fts_pages` SET `tags` = (
		SELECT coalesce(group_concat(t.`name`, ' '), '') FROM `page_tags` pt JOIN `tags` t ON t.`id` = pt.`tag_id`
		WHERE pt.`page_id` = (SELECT `page_id` FROM `page_search` WHERE `docid` = `fts_pages`.`rowid`)
	) WHERE `rowid` IN (
		SELECT s.`docid` FROM `page_tags` pt JOIN `page_search` s ON s.`page_id` = pt.`page_id` WHERE pt.`tag_id` = new.`id`
	);
END;
