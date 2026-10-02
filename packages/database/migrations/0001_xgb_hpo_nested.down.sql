-- Rollback for 0001_xgb_hpo_nested.sql.
-- SQLite cannot DROP COLUMN before 3.35 and even on modern SQLite
-- better-sqlite3's DROP COLUMN support depends on the compiled version;
-- use the documented 12-step table-rebuild pattern to remove the two
-- added columns safely instead of assuming DROP COLUMN is available.

DROP INDEX IF EXISTS hpo_t_fold_idx;

CREATE TABLE hpo_trials__rollback_tmp (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`trial_id` integer NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`params` text NOT NULL,
	`score` real,
	`metrics` text,
	`pruned` integer DEFAULT 0 NOT NULL,
	`pruned_at_step` integer,
	`error` text,
	`duration_sec` real,
	`iteration_history` text,
	`model_path` text,
	`trained_model_id` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer
);

INSERT INTO hpo_trials__rollback_tmp
  (id, session_id, trial_id, status, params, score, metrics, pruned, pruned_at_step,
   error, duration_sec, iteration_history, model_path, trained_model_id, started_at, completed_at)
  SELECT
   id, session_id, trial_id, status, params, score, metrics, pruned, pruned_at_step,
   error, duration_sec, iteration_history, model_path, trained_model_id, started_at, completed_at
  FROM hpo_trials;

DROP TABLE hpo_trials;
ALTER TABLE hpo_trials__rollback_tmp RENAME TO hpo_trials;

CREATE INDEX IF NOT EXISTS hpo_t_score_idx ON hpo_trials (score);
CREATE INDEX IF NOT EXISTS hpo_t_session_id_idx ON hpo_trials (session_id);
CREATE INDEX IF NOT EXISTS hpo_t_session_trial_idx ON hpo_trials (session_id, trial_id);
CREATE INDEX IF NOT EXISTS hpo_t_status_idx ON hpo_trials (status);
