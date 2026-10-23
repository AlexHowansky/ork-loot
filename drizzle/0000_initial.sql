CREATE TABLE `campaign` (
	`id` text PRIMARY KEY NOT NULL,
	`gm_id` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`background_image` text,
	`currency_label` text DEFAULT 'gp' NOT NULL,
	`currency_decimals` integer DEFAULT 2 NOT NULL,
	`petty_cash` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`gm_id`) REFERENCES `gm`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_gm_idx` ON `campaign` (`gm_id`);--> statement-breakpoint
CREATE TABLE `character` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`shares` integer DEFAULT 1 NOT NULL,
	`join_code` text,
	`player_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_join_code_unique` ON `character` (`join_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `character_campaign_name_idx` ON `character` (`campaign_id`,`name`);--> statement-breakpoint
CREATE INDEX `character_player_idx` ON `character` (`player_id`);--> statement-breakpoint
CREATE TABLE `gm` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gm_username_unique` ON `gm` (`username`);--> statement-breakpoint
CREATE TABLE `login` (
	`id` text PRIMARY KEY NOT NULL,
	`gm_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`gm_id`) REFERENCES `gm`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `loot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`link` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`value` integer,
	`market_pct` integer DEFAULT 50 NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`character_id` text,
	`split_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`split_id`) REFERENCES `split`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `loot_session_idx` ON `loot` (`session_id`);--> statement-breakpoint
CREATE INDEX `loot_character_idx` ON `loot` (`character_id`);--> statement-breakpoint
CREATE TABLE `player` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_token_hash_unique` ON `player` (`token_hash`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` text NOT NULL,
	`date` text NOT NULL,
	`title` text,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_campaign_idx` ON `session` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `split` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` text NOT NULL,
	`total` integer NOT NULL,
	`total_shares` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `split_campaign_idx` ON `split` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `split_share` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`split_id` integer NOT NULL,
	`character_id` text,
	`character_name` text NOT NULL,
	`shares` integer NOT NULL,
	`gross` integer NOT NULL,
	`claimed` integer NOT NULL,
	`net` integer NOT NULL,
	FOREIGN KEY (`split_id`) REFERENCES `split`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `split_share_split_idx` ON `split_share` (`split_id`);