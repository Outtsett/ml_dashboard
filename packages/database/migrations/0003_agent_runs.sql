-- Agent run history for ML Studio Workshop agent dispatcher (W8.a).
-- Generated 2026-05-10. Drizzle reads schema.ts as the source of truth; this
-- file is the manual SQL counterpart for the better-sqlite3 deploy path.
-- Forward DDL — see 0003_agent_runs.down.sql for rollback.
-- Single table: agent_runs (+ 3 indexes). Persists Claude Agent SDK dispatch
-- queue / running / completion records so server restarts can mark in-flight
-- runs as failed and operators can audit historical agent activity.

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id              TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL CHECK (agent_id IN ('feature-curator','arch-designer','hpo-strategist','eval-reviewer')),
  status              TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
  context_blob        TEXT NOT NULL,
  context_blob_hash   TEXT NOT NULL,
  requested_at        TEXT NOT NULL,
  started_at          TEXT,
  completed_at        TEXT,
  output              TEXT,
  error               TEXT,
  cancelled_reason    TEXT,
  duration_ms         INTEGER,
  token_usage         TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_status ON agent_runs(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_requested_at ON agent_runs(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_context_hash ON agent_runs(context_blob_hash);
