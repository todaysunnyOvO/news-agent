ALTER TABLE `subscriptions` ADD `paused_until` text;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `skip_dates_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `delivery_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `brief_id` text NOT NULL,
  `run_id` text NOT NULL,
  `user_id` text NOT NULL,
  `channel` text NOT NULL,
  `destination_hash` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `status` text NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `next_attempt_at` text,
  `last_error` text,
  `delivered_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT OR IGNORE INTO `delivery_jobs` (
  `id`, `brief_id`, `run_id`, `user_id`, `channel`, `destination_hash`, `idempotency_key`,
  `status`, `attempt_count`, `next_attempt_at`, `last_error`, `delivered_at`, `created_at`, `updated_at`
)
SELECT
  legacy.`id`, brief.`id`, legacy.`run_id`, brief.`user_id`, legacy.`channel`, 'legacy',
  'legacy:' || legacy.`run_id` || ':' || legacy.`channel`,
  CASE WHEN legacy.`status` = 'delivered' THEN 'succeeded' ELSE legacy.`status` END,
  legacy.`attempts`, NULL, legacy.`last_error`, legacy.`delivered_at`,
  COALESCE(legacy.`delivered_at`, CURRENT_TIMESTAMP), COALESCE(legacy.`delivered_at`, CURRENT_TIMESTAMP)
FROM `delivery_attempts` legacy
INNER JOIN `briefs` brief ON brief.`run_id` = legacy.`run_id`;
--> statement-breakpoint
ALTER TABLE `delivery_attempts` RENAME TO `delivery_attempts_legacy`;
--> statement-breakpoint
CREATE TABLE `delivery_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `delivery_job_id` text NOT NULL,
  `attempt_number` integer NOT NULL,
  `status` text NOT NULL,
  `provider_message_id` text,
  `error_code` text,
  `duration_ms` integer NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`delivery_job_id`) REFERENCES `delivery_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `delivery_attempts_legacy`;
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_jobs_idempotency_key_unique` ON `delivery_jobs` (`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_jobs_run_channel_unique` ON `delivery_jobs` (`run_id`, `channel`);
--> statement-breakpoint
CREATE INDEX `delivery_jobs_status_next_attempt_index` ON `delivery_jobs` (`status`, `next_attempt_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_attempts_job_number_unique`
  ON `delivery_attempts` (`delivery_job_id`, `attempt_number`);
