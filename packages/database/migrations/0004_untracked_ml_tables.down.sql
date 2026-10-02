-- Rollback for 0004_untracked_ml_tables.sql.
-- Drop order: indexes first, then tables. No FK dependencies between the 3
-- tables or to any other table, so no inter-table ordering is required.

DROP INDEX IF EXISTS pl_symbol_ts_idx;
DROP INDEX IF EXISTS pl_split_idx;
DROP INDEX IF EXISTS pl_predicted_class_idx;
DROP INDEX IF EXISTS pl_model_id_idx;
DROP INDEX IF EXISTS pl_checkpoint_idx;
DROP TABLE IF EXISTS prediction_log;

DROP INDEX IF EXISTS mss_session_iteration_idx;
DROP INDEX IF EXISTS mss_session_idx;
DROP TABLE IF EXISTS model_state_snapshots;

DROP INDEX IF EXISTS mc_symbol_tf_idx;
DROP INDEX IF EXISTS mc_symbol_idx;
DROP INDEX IF EXISTS mc_primary_metric_idx;
DROP INDEX IF EXISTS mc_model_type_idx;
DROP INDEX IF EXISTS mc_created_at_idx;
DROP INDEX IF EXISTS mc_active_idx;
DROP INDEX IF EXISTS model_checkpoints_model_id_unique;
DROP TABLE IF EXISTS model_checkpoints;
