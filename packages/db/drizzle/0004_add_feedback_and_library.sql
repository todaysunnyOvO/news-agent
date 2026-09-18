CREATE TABLE IF NOT EXISTS `brief_feedback` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `brief_id` text NOT NULL,
  `usefulness` text,
  `length_rating` text,
  `missed_important_news` integer DEFAULT 0 NOT NULL,
  `comment` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `brief_feedback_user_brief_unique`
  ON `brief_feedback` (`user_id`, `brief_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `brief_item_feedback` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `brief_item_id` text NOT NULL,
  `feedback_type` text NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`brief_item_id`) REFERENCES `brief_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `brief_item_feedback_user_item_type_unique`
  ON `brief_item_feedback` (`user_id`, `brief_item_id`, `feedback_type`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `saved_items` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `brief_item_id` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`brief_item_id`) REFERENCES `brief_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `saved_items_user_item_unique`
  ON `saved_items` (`user_id`, `brief_item_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tracked_topics` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `label` text NOT NULL,
  `query_json` text NOT NULL,
  `status` text NOT NULL,
  `source_brief_item_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_brief_item_id`) REFERENCES `brief_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tracked_topics_user_status_index`
  ON `tracked_topics` (`user_id`, `status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tracked_topics_user_source_unique`
  ON `tracked_topics` (`user_id`, `source_brief_item_id`);
