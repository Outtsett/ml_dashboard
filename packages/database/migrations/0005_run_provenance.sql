-- Run provenance, stage 1 (write-only). Adds 4 tables declared in
-- src/shared/schema.ts: experiments, runs, run_manifests, run_metrics.
--
-- Per migrations/README.md this folder is a hand-maintained SQL audit trail;
-- the project's wired workflow is `npm run db:push`, which introspects
-- schema.ts directly. This file exists so a from-scratch rebuild that replays
-- migrations/*.sql produces the same 4 tables, and so the DDL is reviewable in
-- one place. Everything here is expressible by db:push (no CHECK constraints,
-- no partial indexes), so unlike 0002/0003 there is nothing for
-- enforce-sqlite-invariants.ts to retrofit. Status enums are enforced by the
-- Drizzle `text({ enum: ... })` type in schema.ts, which narrows insert/select
-- types but emits no DDL constraint — deliberately matching the existing
-- convention rather than introducing a CHECK that db:push would silently drop.
--
-- Purely additive: no existing table is altered, no existing row is touched,
-- and none of the 16 directories under data/models/ are affected. Artifacts
-- stay at data/models/<legacy_model_id>/; runs.artifact_dir records the path.
--
-- Rollback: 0005_run_provenance.down.sql

CREATE TABLE IF NOT EXISTS `experiments` (
	`experiment_id` text PRIMARY KEY NOT NULL,
	`catalog_id` text NOT NULL,
	`runner_key` text NOT NULL,
	`name` text,
	`symbol` text,
	`timeframe` text,
	`status` text NOT NULL,
	`run_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`finalized_at` text
);

CREATE INDEX IF NOT EXISTS `idx_experiments_catalog` ON `experiments` (`catalog_id`);
CREATE INDEX IF NOT EXISTS `idx_experiments_status` ON `experiments` (`status`);
CREATE INDEX IF NOT EXISTS `idx_experiments_created_at` ON `experiments` (`created_at`);

-- `legacy_model_id` is intentionally NOT unique: it is the pre-existing
-- second-resolution `SYMBOL_TF_TYPE_YYYYMMDDTHHMMSS` identifier, which
-- collides when two runs start within the same second. `run_id` is the
-- physical key; the legacy id is kept for artifact-path lookup only.
CREATE TABLE IF NOT EXISTS `runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`catalog_id` text NOT NULL,
	`runner_key` text NOT NULL,
	`legacy_model_id` text NOT NULL,
	`trial_idx` integer,
	`fold_idx` integer,
	`status` text NOT NULL,
	`config_hash` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`manifest_path` text NOT NULL,
	`artifact_dir` text NOT NULL,
	`training_session_id` integer,
	`pid` integer,
	`exit_code` integer,
	`error_message` text,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`heartbeat_at` text,
	`finished_at` text,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`experiment_id`) ON UPDATE no action ON DELETE restrict
);

CREATE INDEX IF NOT EXISTS `idx_runs_experiment` ON `runs` (`experiment_id`);
CREATE INDEX IF NOT EXISTS `idx_runs_status` ON `runs` (`status`);
CREATE INDEX IF NOT EXISTS `idx_runs_legacy_model_id` ON `runs` (`legacy_model_id`);
CREATE INDEX IF NOT EXISTS `idx_runs_config_hash` ON `runs` (`config_hash`);
CREATE INDEX IF NOT EXISTS `idx_runs_coordinates` ON `runs` (`experiment_id`,`trial_idx`,`fold_idx`);
CREATE INDEX IF NOT EXISTS `idx_runs_heartbeat` ON `runs` (`heartbeat_at`);

-- Keyed by content hash: two runs with a byte-identical manifest share one
-- row, which is what makes "these runs are comparable" a lookup rather than a
-- diff.
CREATE TABLE IF NOT EXISTS `run_manifests` (
	`manifest_hash` text PRIMARY KEY NOT NULL,
	`manifest_version` integer NOT NULL,
	`run_id` text NOT NULL,
	`experiment_id` text NOT NULL,
	`manifest_path` text NOT NULL,
	`manifest` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_run_manifests_run` ON `run_manifests` (`run_id`);
CREATE INDEX IF NOT EXISTS `idx_run_manifests_experiment` ON `run_manifests` (`experiment_id`);

-- Supersedes `training_metrics`, which has never had an insert call site and
-- whose integer `session_id` cannot express the (experiment, run, trial, fold)
-- identity. `training_metrics` is left in place and untouched.
CREATE TABLE IF NOT EXISTS `run_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`experiment_id` text NOT NULL,
	`trial_idx` integer,
	`fold_idx` integer,
	`metric_name` text NOT NULL,
	`metric_value` real,
	`iteration` integer,
	`total` integer,
	`seq` integer,
	`ts` text,
	`recorded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_run_metrics_run_metric` ON `run_metrics` (`run_id`,`metric_name`,`iteration`);
CREATE INDEX IF NOT EXISTS `idx_run_metrics_run` ON `run_metrics` (`run_id`);
CREATE INDEX IF NOT EXISTS `idx_run_metrics_experiment` ON `run_metrics` (`experiment_id`,`metric_name`);
