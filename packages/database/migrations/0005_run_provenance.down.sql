-- Rollback for 0005_run_provenance.sql.
-- Drop order: indexes first, then tables. `runs` has an FK to `experiments`,
-- so `runs` must be dropped before `experiments`. `run_manifests` and
-- `run_metrics` carry no FKs (their run_id/experiment_id are plain columns —
-- a manifest must survive the deletion of nothing, and the append-only
-- invariant means these rows are never deleted in normal operation).

DROP INDEX IF EXISTS idx_run_metrics_experiment;
DROP INDEX IF EXISTS idx_run_metrics_run;
DROP INDEX IF EXISTS idx_run_metrics_run_metric;
DROP TABLE IF EXISTS run_metrics;

DROP INDEX IF EXISTS idx_run_manifests_experiment;
DROP INDEX IF EXISTS idx_run_manifests_run;
DROP TABLE IF EXISTS run_manifests;

DROP INDEX IF EXISTS idx_runs_heartbeat;
DROP INDEX IF EXISTS idx_runs_coordinates;
DROP INDEX IF EXISTS idx_runs_config_hash;
DROP INDEX IF EXISTS idx_runs_legacy_model_id;
DROP INDEX IF EXISTS idx_runs_status;
DROP INDEX IF EXISTS idx_runs_experiment;
DROP TABLE IF EXISTS runs;

DROP INDEX IF EXISTS idx_experiments_created_at;
DROP INDEX IF EXISTS idx_experiments_status;
DROP INDEX IF EXISTS idx_experiments_catalog;
DROP TABLE IF EXISTS experiments;
