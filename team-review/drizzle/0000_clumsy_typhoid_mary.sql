CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clips` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`project` text NOT NULL,
	`match_group` text NOT NULL,
	`fingerprint` text NOT NULL,
	`duration` real NOT NULL,
	`interval_sec` real NOT NULL,
	`expected_frames` integer NOT NULL,
	`status` text DEFAULT 'importing' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clips_fingerprint_unique` ON `clips` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `frames` (
	`id` text PRIMARY KEY NOT NULL,
	`clip_id` text NOT NULL,
	`seq` integer NOT NULL,
	`timestamp_sec` real NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`proposal` text NOT NULL,
	`model_name` text NOT NULL,
	`assignee` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_operation` text,
	`assigned_at` integer,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clip_sequence` ON `frames` (`clip_id`,`seq`);--> statement-breakpoint
CREATE INDEX `frame_queue` ON `frames` (`state`,`assignee`,`clip_id`,`seq`);--> statement-breakpoint
CREATE TABLE `labels` (
	`frame_id` text PRIMARY KEY NOT NULL,
	`reviewer_id` text,
	`answer` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code_hash` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_code_hash_unique` ON `members` (`code_hash`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`frame_id` text NOT NULL,
	`reviewer_id` text,
	`answer` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`member_id` text,
	`role` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
