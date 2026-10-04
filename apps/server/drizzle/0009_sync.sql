CREATE TABLE `sync_alias` (
	`tbl` text NOT NULL,
	`from_key` text NOT NULL,
	`to_key` text NOT NULL,
	PRIMARY KEY(`tbl`, `from_key`)
);
--> statement-breakpoint
CREATE TABLE `sync_clock` (
	`tbl` text NOT NULL,
	`key` text NOT NULL,
	`born` text,
	`clocks` text DEFAULT '{}' NOT NULL,
	`deleted` text,
	PRIMARY KEY(`tbl`, `key`)
);
--> statement-breakpoint
CREATE TABLE `sync_dirty` (
	`tbl` text NOT NULL,
	`key` text NOT NULL,
	`base` text,
	`ver` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`tbl`, `key`)
);
--> statement-breakpoint
CREATE TABLE `sync_parked` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tbl` text NOT NULL,
	`key` text NOT NULL,
	`device` text NOT NULL,
	`change` text NOT NULL,
	`parked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_parked_tbl_key_idx` ON `sync_parked` (`tbl`,`key`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
