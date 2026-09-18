ALTER TABLE `agent_runs` ADD `turn_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `duration_ms` integer;
--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `input_tokens` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `output_tokens` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `cost_usd_micros` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `delivery_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `channel` text NOT NULL,
  `status` text NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `last_error` text,
  `delivered_at` text,
  FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `delivery_attempts_run_channel_unique`
  ON `delivery_attempts` (`run_id`, `channel`);
