CREATE TABLE `join_code` (
	`code` text PRIMARY KEY NOT NULL,
	`character_id` text,
	`observer_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observer_id`) REFERENCES `observer`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "join_code_one_seat" CHECK((character_id IS NULL) <> (observer_id IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `join_code_character_id_unique` ON `join_code` (`character_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `join_code_observer_id_unique` ON `join_code` (`observer_id`);--> statement-breakpoint
CREATE TABLE `observer` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`player_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observer_campaign_name_idx` ON `observer` (`campaign_id`,`name`);--> statement-breakpoint
CREATE INDEX `observer_player_idx` ON `observer` (`player_id`);--> statement-breakpoint
-- Unused character codes move into join_code before their column goes.
INSERT INTO `join_code` (`code`, `character_id`, `created_at`)
	SELECT `join_code`, `id`, `created_at` FROM `character` WHERE `join_code` IS NOT NULL;--> statement-breakpoint
DROP INDEX `character_join_code_unique`;--> statement-breakpoint
ALTER TABLE `character` DROP COLUMN `join_code`;