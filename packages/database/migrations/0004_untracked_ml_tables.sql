-- Backfill migration record for 3 tables declared in src/shared/schema.ts and
-- present in the live database (created directly via `npm run db:push`, which
-- bypasses the migrations/ folder entirely) but that previously had NO
-- CREATE TABLE anywhere under migrations/*.sql. Without this file, a rebuild
-- that replayed migrations/*.sql in sequence (rather than running `db:push`)
-- would silently omit these 3 tables. Generated 2026-07-13 as part of AUD-008
-- remediation (see docs/DEPLOYMENT-CHECKLIST.md and CLAUDE.md). DDL text below
-- is captured verbatim from `SELECT sql FROM sqlite_master` against the live
-- database — see 0004_untracked_ml_tables.down.sql for rollback.

CREATE TABLE IF NOT EXISTS `model_checkpoints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model_id` text NOT NULL,
	`model_type` text NOT NULL,
	`symbol` text NOT NULL,
	`timeframe` text NOT NULL,
	`diagnostics_json` text NOT NULL,
	`checkpoint_path` text NOT NULL,
	`diagnostics_path` text,
	`primary_metric` real,
	`primary_metric_name` text,
	`param_count` integer,
	`training_duration_sec` real,
	`n_bars_train` integer,
	`n_bars_val` integer,
	`is_active` integer DEFAULT 0 NOT NULL,
	`session_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `model_checkpoints_model_id_unique` ON `model_checkpoints` (`model_id`);
CREATE INDEX IF NOT EXISTS `mc_active_idx` ON `model_checkpoints` (`is_active`);
CREATE INDEX IF NOT EXISTS `mc_created_at_idx` ON `model_checkpoints` (`created_at`);
CREATE INDEX IF NOT EXISTS `mc_model_type_idx` ON `model_checkpoints` (`model_type`);
CREATE INDEX IF NOT EXISTS `mc_primary_metric_idx` ON `model_checkpoints` (`primary_metric`);
CREATE INDEX IF NOT EXISTS `mc_symbol_idx` ON `model_checkpoints` (`symbol`);
CREATE INDEX IF NOT EXISTS `mc_symbol_tf_idx` ON `model_checkpoints` (`symbol`,`timeframe`);

CREATE TABLE IF NOT EXISTS `model_state_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`iteration` integer NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE INDEX IF NOT EXISTS `mss_session_idx` ON `model_state_snapshots` (`session_id`);
CREATE INDEX IF NOT EXISTS `mss_session_iteration_idx` ON `model_state_snapshots` (`session_id`,`iteration`);

CREATE TABLE IF NOT EXISTS `prediction_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`checkpoint_id` integer NOT NULL,
	`model_id` text NOT NULL,
	`symbol` text NOT NULL,
	`bar_timestamp` integer NOT NULL,
	`predicted_class` integer NOT NULL,
	`actual_class` integer,
	`confidence` real,
	`probabilities` text,
	`realized_return` real,
	`exit_bars` integer,
	`barrier_hit` text,
	`fold_index` integer,
	`split_type` text DEFAULT 'oos' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE INDEX IF NOT EXISTS `pl_checkpoint_idx` ON `prediction_log` (`checkpoint_id`);
CREATE INDEX IF NOT EXISTS `pl_model_id_idx` ON `prediction_log` (`model_id`);
CREATE INDEX IF NOT EXISTS `pl_predicted_class_idx` ON `prediction_log` (`predicted_class`);
CREATE INDEX IF NOT EXISTS `pl_split_idx` ON `prediction_log` (`split_type`);
CREATE INDEX IF NOT EXISTS `pl_symbol_ts_idx` ON `prediction_log` (`symbol`,`bar_timestamp`);
