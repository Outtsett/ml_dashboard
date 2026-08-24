-- prediction_log_rollup_1m — 1-minute aggregated rollup of prediction_log.
--
-- Why a materialized view?
-- ------------------------
-- The dashboard's "deployment health" panel and the paper-PnL curve need to
-- refresh sub-second even when a deployment has been running for weeks and
-- emitted millions of rows into prediction_log. Scanning the full base table
-- per panel refresh (every 1-5s) would push 10-100M rows through SAMPLE BY
-- on every poll — wasteful and bursty.
--
-- This mat view pre-aggregates every prediction_log insert at 1m granularity,
-- keyed by (ts, deployment_id, symbol, timeframe), so a dashboard query for
-- "last 24h of deployment_id=1" reads at most 1440 rows instead of potentially
-- 86,400 rows per deployment per day. Refresh is incremental (QuestDB applies
-- only the delta on each base insert via WAL), so write amplification is
-- bounded and the view is always within one WAL commit of the base table.
--
-- Aggregations:
--   count()                — predictions_emitted per minute (heartbeat / liveness)
--   last(paper_pnl_total)  — PnL curve sample (most-recent total in the minute)
--   avg(confidence)        — avg model confidence in the minute
--
-- Group keys: ts (sample), deployment_id, symbol, timeframe.
--
-- PARTITION BY DAY mirrors the base table so partition pruning works the
-- same way (WHERE ts > dateadd('d', -7, now()) only scans 7 day-partitions).
--
-- Refresh mode: IMMEDIATE = QuestDB applies WAL deltas synchronously to the
-- view on every base commit. This is what 9.3.x calls "incremental refresh".
-- The task spec's `REFRESH INCREMENTAL` is the marketing name; `IMMEDIATE`
-- is the actual SQL keyword in 9.3.x.
--
-- Common queries:
--
-- 1) Last 24h PnL curve for deployment 1:
--   SELECT ts, paper_pnl_total
--   FROM prediction_log_rollup_1m
--   WHERE deployment_id = 1
--     AND ts > dateadd('d', -1, now())
--   ORDER BY ts;
--
-- 2) Activity heatmap (predictions per minute across deployments):
--   SELECT ts, deployment_id, predictions_emitted
--   FROM prediction_log_rollup_1m
--   WHERE ts > dateadd('h', -6, now())
--   ORDER BY ts;

CREATE MATERIALIZED VIEW IF NOT EXISTS prediction_log_rollup_1m
WITH BASE prediction_log REFRESH IMMEDIATE AS (
    SELECT
        ts,
        deployment_id,
        symbol,
        timeframe,
        count()                AS predictions_emitted,
        last(paper_pnl_total)  AS paper_pnl_total,
        avg(confidence)        AS avg_confidence
    FROM prediction_log
    SAMPLE BY 1m ALIGN TO CALENDAR
) PARTITION BY DAY;
