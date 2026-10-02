-- Rollback for 0003_agent_runs.sql (W8 agent dispatcher persistence).
-- Drop order: indexes first, then the table. agent_runs has no FK
-- dependencies, so no inter-table ordering is required.

DROP INDEX IF EXISTS idx_agent_runs_context_hash;
DROP INDEX IF EXISTS idx_agent_runs_requested_at;
DROP INDEX IF EXISTS idx_agent_runs_agent_status;

DROP TABLE IF EXISTS agent_runs;
