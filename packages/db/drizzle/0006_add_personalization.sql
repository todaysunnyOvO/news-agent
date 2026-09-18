ALTER TABLE `subscriptions` ADD `personalization_enabled` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `inferred_preferences` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `kind` text NOT NULL,
  `value` text NOT NULL,
  `weight` integer NOT NULL,
  `confidence` integer NOT NULL,
  `status` text NOT NULL,
  `evidence_count` integer NOT NULL,
  `evidence_json` text NOT NULL,
  `last_reinforced_at` text NOT NULL,
  `expires_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inferred_preferences_user_kind_value_unique`
  ON `inferred_preferences` (`user_id`, `kind`, `value`);
--> statement-breakpoint
CREATE INDEX `inferred_preferences_user_status_index`
  ON `inferred_preferences` (`user_id`, `status`);
