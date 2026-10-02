-- Add per-fold and pruning-curve persistence for nested HPO.
-- Generated 2026-05-08. Drizzle reads schema.ts as the source of truth; this
-- file is the manual SQL counterpart for the better-sqlite3 deploy path.

ALTER TABLE hpo_trials ADD COLUMN intermediate_values TEXT;
ALTER TABLE hpo_trials ADD COLUMN fold_index INTEGER;
CREATE INDEX IF NOT EXISTS hpo_t_fold_idx ON hpo_trials (fold_index);
