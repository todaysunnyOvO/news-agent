PRAGMA foreign_keys = ON;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `users` (
  `id` text PRIMARY KEY NOT NULL,
  `display_name` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `topics_json` text NOT NULL,
  `keywords_json` text NOT NULL,
  `excluded_keywords_json` text NOT NULL,
  `languages_json` text NOT NULL,
  `source_ids_json` text NOT NULL,
  `max_items` integer NOT NULL,
  `schedule_cron` text NOT NULL,
  `timezone` text NOT NULL,
  `delivery_channel` text NOT NULL,
  `enabled` integer NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `subscriptions_user_id_unique`
  ON `subscriptions` (`user_id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `articles` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL,
  `source_name` text NOT NULL,
  `title` text NOT NULL,
  `canonical_url` text NOT NULL,
  `author` text,
  `language` text NOT NULL,
  `published_at` text NOT NULL,
  `event_time` text,
  `summary` text,
  `content` text,
  `content_hash` text,
  `retrieved_at` text NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `articles_canonical_url_unique`
  ON `articles` (`canonical_url`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `agent_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `trigger` text NOT NULL,
  `status` text NOT NULL,
  `started_at` text,
  `finished_at` text,
  `model` text NOT NULL,
  `tool_call_count` integer DEFAULT 0 NOT NULL,
  `error_message` text,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `briefs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `run_id` text NOT NULL,
  `local_date` text NOT NULL,
  `title` text NOT NULL,
  `overview` text NOT NULL,
  `markdown_path` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `briefs_run_id_unique` ON `briefs` (`run_id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `brief_items` (
  `id` text PRIMARY KEY NOT NULL,
  `brief_id` text NOT NULL,
  `headline` text NOT NULL,
  `summary` text NOT NULL,
  `why_it_matters` text NOT NULL,
  `topic` text NOT NULL,
  `rank` integer NOT NULL,
  FOREIGN KEY (`brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `brief_item_sources` (
  `brief_item_id` text NOT NULL,
  `article_id` text NOT NULL,
  PRIMARY KEY (`brief_item_id`, `article_id`),
  FOREIGN KEY (`brief_item_id`) REFERENCES `brief_items`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
