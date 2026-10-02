-- Label-set lifecycle (2026-09-26): recipe identity, validation report,
-- purge/embargo bar counts and the stage on generated_labels; a nullable
-- reference from training_sessions to the label set a run trained on.
--
-- Per migrations/README.md this folder is a hand-maintained audit trail:
-- `npm run db:push` introspects schema.ts and never reads this file. Every
-- ADD COLUMN / CREATE INDEX below is what db:push emits for additive
-- nullable/defaulted columns on an existing populated table (as in
-- 0001_xgb_hpo_nested.sql). The CHECK on generated_labels.stage is the
-- exception: Drizzle SQLite has no CHECK API, so db:push creates `stage`
-- without it and enforce-sqlite-invariants.ts (GENERATED_LABELS) retrofits it
-- on every boot.
--
-- Rollback: 0006_generated_labels_lifecycle.down.sql

ALTER TABLE generated_labels ADD COLUMN recipe TEXT;
ALTER TABLE generated_labels ADD COLUMN parameters_hash TEXT;
ALTER TABLE generated_labels ADD COLUMN timeframe_minutes INTEGER DEFAULT 1 NOT NULL;
ALTER TABLE generated_labels ADD COLUMN stage TEXT DEFAULT 'specified' NOT NULL;
ALTER TABLE generated_labels ADD COLUMN validation TEXT;
ALTER TABLE generated_labels ADD COLUMN validated_at INTEGER;
ALTER TABLE generated_labels ADD COLUMN source_fingerprint TEXT;
ALTER TABLE generated_labels ADD COLUMN max_horizon_bars INTEGER;
ALTER TABLE generated_labels ADD COLUMN purge_bars INTEGER;
ALTER TABLE generated_labels ADD COLUMN embargo_bars INTEGER;
ALTER TABLE generated_labels ADD COLUMN landed_at INTEGER;
ALTER TABLE generated_labels ADD COLUMN retired_at INTEGER;
ALTER TABLE generated_labels ADD COLUMN stale_detected_at INTEGER;
ALTER TABLE generated_labels ADD COLUMN stale_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS generated_labels_recipe_idx ON generated_labels (recipe);
CREATE INDEX IF NOT EXISTS generated_labels_stage_idx ON generated_labels (stage);

ALTER TABLE training_sessions ADD COLUMN label_set_id INTEGER REFERENCES generated_labels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ts_label_set_id_idx ON training_sessions (label_set_id);

-- Not expressible here or by db:push:
-- CHECK (stage IN ('specified','generated','validated','landed','cataloged',
--                   'consumed','stale','retired')) -- applied by
-- enforce-sqlite-invariants.ts's GENERATED_LABELS entry.
