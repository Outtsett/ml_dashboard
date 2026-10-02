-- Rollback for 0002_model_registry.sql (W7 model registry tables).
-- Drop order: trigger → indexes → tables in reverse FK dependency order.
-- deployments depends on model_versions (FK ON DELETE RESTRICT), so deployments
-- must be dropped before model_versions. promotion_gates is FK-independent.

DROP TRIGGER IF EXISTS trg_model_versions_updated;

DROP INDEX IF EXISTS idx_promotion_gates_transition;
DROP INDEX IF EXISTS idx_deployments_one_live_per_sym_tf;
DROP INDEX IF EXISTS idx_deployments_symbol_tf_mode;
DROP INDEX IF EXISTS idx_deployments_status;
DROP INDEX IF EXISTS idx_deployments_version;
DROP INDEX IF EXISTS idx_model_versions_artifact;
DROP INDEX IF EXISTS idx_model_versions_trained_at;
DROP INDEX IF EXISTS idx_model_versions_data_hash;
DROP INDEX IF EXISTS idx_model_versions_symbol_tf;
DROP INDEX IF EXISTS idx_model_versions_catalog;
DROP INDEX IF EXISTS idx_model_versions_status;

DROP TABLE IF EXISTS promotion_gates;
DROP TABLE IF EXISTS deployments;
DROP TABLE IF EXISTS model_versions;
