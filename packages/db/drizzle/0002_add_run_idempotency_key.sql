ALTER TABLE `agent_runs` ADD `idempotency_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `agent_runs_idempotency_key_unique`
  ON `agent_runs` (`idempotency_key`);
