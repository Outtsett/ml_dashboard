-- Rollback of 0006_generated_labels_lifecycle.sql.
-- SQLite's DROP COLUMN cannot remove a column that an index references and is
-- version-dependent besides, so generated_labels is rebuilt without the added
-- columns (the 12-step procedure, https://www.sqlite.org/lang_altertable.html#otheralter).
-- Every row is preserved; only the 2026-09-26 columns and their indexes go.

PRAGMA foreign_keys = OFF;
BEGIN;

DROP INDEX IF EXISTS generated_labels_recipe_idx;
DROP INDEX IF EXISTS generated_labels_stage_idx;
DROP INDEX IF EXISTS ts_label_set_id_idx;

CREATE TABLE generated_labels__rollback_tmp (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id             INTEGER REFERENCES ml_models(id) ON DELETE SET NULL,
  name                 TEXT NOT NULL,
  generator_type       TEXT NOT NULL,
  category             TEXT NOT NULL,
  symbol               TEXT NOT NULL,
  config               TEXT NOT NULL,
  sample_count         INTEGER NOT NULL DEFAULT 0,
  positive_count       INTEGER,
  negative_count       INTEGER,
  neutral_count        INTEGER,
  label_distribution   TEXT,
  data_start_timestamp INTEGER,
  data_end_timestamp   INTEGER,
  parquet_path         TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  error_message        TEXT,
  generation_time_ms   INTEGER,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
INSERT INTO generated_labels__rollback_tmp
  SELECT id, model_id, name, generator_type, category, symbol, config, sample_count,
         positive_count, negative_count, neutral_count, label_distribution,
         data_start_timestamp, data_end_timestamp, parquet_path, status, error_message,
         generation_time_ms, created_at, updated_at
  FROM generated_labels;
DROP TABLE generated_labels;
ALTER TABLE generated_labels__rollback_tmp RENAME TO generated_labels;
CREATE INDEX IF NOT EXISTS generated_labels_model_id_idx ON generated_labels(model_id);
CREATE INDEX IF NOT EXISTS generated_labels_generator_type_idx ON generated_labels(generator_type);
CREATE INDEX IF NOT EXISTS generated_labels_symbol_idx ON generated_labels(symbol);
CREATE INDEX IF NOT EXISTS generated_labels_status_idx ON generated_labels(status);

-- training_sessions: capture the live DDL first
--   node scripts/inspect-sqlite-schema.mjs data/ml_dashboard.db --table=training_sessions
-- and rebuild it without label_set_id the same way. Left as the documented
-- procedure rather than a fixed CREATE TABLE because that table's column set
-- has grown in four phases and the rebuild must copy exactly what is live.

COMMIT;
PRAGMA foreign_keys = ON;
