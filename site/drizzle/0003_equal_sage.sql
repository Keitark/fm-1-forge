CREATE TABLE `forge_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`config` text NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `forge_projects_owner_updated` ON `forge_projects` (`user_id`,`updated`);--> statement-breakpoint
CREATE TABLE `forge_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`setting_key` text NOT NULL,
	`value` text NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forge_settings_owner_key` ON `forge_settings` (`user_id`,`setting_key`);