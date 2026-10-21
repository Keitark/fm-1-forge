CREATE TABLE `forge_baselines` (
	`user_id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`sha256` text NOT NULL,
	`verified_at` integer NOT NULL
);
