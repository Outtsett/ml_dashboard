-- Model registry, deployments, and promotion gates for ML Studio Workshop (W7).
-- Generated 2026-05-10. Drizzle reads schema.ts as the source of truth; this
-- file is the manual SQL counterpart for the better-sqlite3 deploy path.
-- Forward DDL — see 0002_model_registry.down.sql for rollback.
-- Tables: model_versions, deployments, promotion_gates (+ 6 seed gates).
-- Note: partial unique index `idx_deployments_one_live_per_sym_tf` cannot be
-- expressed in Drizzle today; lives in raw SQL only.

CREATE TABLE IF NOT EXISTS model_versions (
  version_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_id          TEXT NOT NULL,
  runner_key          TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('candidate','shadow','paper','live','retired')),
  data_hash           TEXT NOT NULL,
  symbol              TEXT NOT NULL,
  timeframe           TEXT NOT NULL,
  date_range_start    TEXT NOT NULL,
  date_range_end      TEXT NOT NULL,
  feature_pipeline    TEXT NOT NULL,
  label_config        TEXT NOT NULL,            -- JSON
  hyperparameters     TEXT NOT NULL,            -- JSON
  walk_forward_config TEXT,                     -- JSON
  hpo_study_id        TEXT,
  model_artifact_path TEXT NOT NULL,
  diagnostics_path    TEXT NOT NULL,
  metrics_summary     TEXT NOT NULL,            -- JSON
  trained_at          TEXT NOT NULL,
  promoted_at         TEXT,
  retired_at          TEXT,
  parent_version_id   INTEGER REFERENCES model_versions(version_id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_model_versions_status ON model_versions(status);
CREATE INDEX IF NOT EXISTS idx_model_versions_catalog ON model_versions(catalog_id);
CREATE INDEX IF NOT EXISTS idx_model_versions_symbol_tf ON model_versions(symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_model_versions_data_hash ON model_versions(data_hash);
CREATE INDEX IF NOT EXISTS idx_model_versions_trained_at ON model_versions(trained_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_versions_artifact ON model_versions(model_artifact_path);

CREATE TRIGGER IF NOT EXISTS trg_model_versions_updated
  AFTER UPDATE ON model_versions
  BEGIN
    UPDATE model_versions SET updated_at = CURRENT_TIMESTAMP WHERE version_id = NEW.version_id;
  END;

CREATE TABLE IF NOT EXISTS deployments (
  deployment_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id          INTEGER NOT NULL REFERENCES model_versions(version_id) ON DELETE RESTRICT,
  mode                TEXT NOT NULL CHECK (mode IN ('shadow','paper','live')),
  status              TEXT NOT NULL CHECK (status IN ('running','paused','stopped','failed')),
  symbol              TEXT NOT NULL,
  timeframe           TEXT NOT NULL,
  started_at          TEXT NOT NULL,
  stopped_at          TEXT,
  predictions_emitted INTEGER NOT NULL DEFAULT 0,
  paper_pnl           REAL,
  last_prediction_at  TEXT,
  last_error          TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployments_version ON deployments(version_id);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_symbol_tf_mode ON deployments(symbol, timeframe, mode);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deployments_one_live_per_sym_tf
  ON deployments(symbol, timeframe, mode)
  WHERE status = 'running' AND mode = 'live';

CREATE TABLE IF NOT EXISTS promotion_gates (
  gate_id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_status         TEXT NOT NULL,
  to_status           TEXT NOT NULL,
  metric              TEXT NOT NULL,
  comparator          TEXT NOT NULL CHECK (comparator IN ('>=','<=','>','<','==','!=')),
  threshold           REAL NOT NULL,
  enforced            INTEGER NOT NULL DEFAULT 1,
  description         TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_promotion_gates_transition ON promotion_gates(from_status, to_status);

INSERT INTO promotion_gates (from_status, to_status, metric, comparator, threshold, description) VALUES
  ('candidate','shadow','sharpe_after_costs','>=',0.20,'Cost-adjusted Sharpe minimum'),
  ('candidate','shadow','ece','<=',0.10,'Calibration error ceiling'),
  ('candidate','shadow','fold_dispersion','<=',0.30,'Walk-forward fold-Sharpe std cap'),
  ('shadow','paper','bootstrap_pvalue_vs_baseline','<=',0.05,'Block-bootstrap p-value vs buy-hold'),
  ('paper','live','paper_pnl_14d','>',0.0,'14-day paper PnL must be positive'),
  ('paper','live','prediction_drift','<=',0.20,'PSI drift between training and live distribution');
