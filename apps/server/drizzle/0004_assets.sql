CREATE TABLE `asset_blobs` (
	`owner_id` text NOT NULL,
	`sha256` text NOT NULL,
	`data` blob NOT NULL,
	PRIMARY KEY(`owner_id`, `sha256`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`sha256` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`original_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assets_owner_id_sha256_idx` ON `assets` (`owner_id`,`sha256`);