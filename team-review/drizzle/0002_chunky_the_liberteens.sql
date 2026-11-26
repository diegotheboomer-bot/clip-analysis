CREATE TABLE `review_changes` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`reviewer_id` text,
	`answer` text NOT NULL,
	`completed` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `review_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `review_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`frame_id` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`answer` text,
	`version` integer DEFAULT 0 NOT NULL,
	`last_operation` text,
	`updated_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `review_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_frame_task` ON `review_items` (`frame_id`,`kind`);--> statement-breakpoint
CREATE INDEX `review_job_items` ON `review_items` (`job_id`,`position`);--> statement-breakpoint
CREATE TABLE `review_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`depends_on` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_job_request` ON `review_jobs` (`request_key`,`kind`);--> statement-breakpoint
CREATE TRIGGER reserve_unused_ball_frame BEFORE INSERT ON review_items
WHEN NEW.kind='ball' AND EXISTS(SELECT 1 FROM frames f WHERE f.id=NEW.frame_id AND (f.state!='pending' OR f.assignee IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'ball frame already claimed'); END;
