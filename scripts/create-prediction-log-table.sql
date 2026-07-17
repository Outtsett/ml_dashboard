-- prediction_log — bar-by-bar prediction stream from live model deployments.
--
-- Each row is one model emission: classification label OR a numeric value
-- (regression / probability), with confidence, paper-trading PnL delta and
-- running total, plus FKs back to the SQLite-side deployments + model_versions
-- tables (denormalized model_version_id for fast joins on the QuestDB side).
--
-- Designated timestamp: ts (bar timestamp). PARTITION BY DAY because a
-- deployment emitting on every 1-second bar produces ~86k rows/day per
-- deployment — daily partitions keep each partition in the 30-80M-row
-- sweet spot once N deployments scale up.
--
-- DEDUP UPSERT KEYS(ts, deployment_id) — retried writes (network blip,
-- restart of the runner) replace rather than duplicate. A single deployment
-- emits exactly one row per (ts, deployment_id) tuple.
--
-- WAL enabled — required for dedup + materialized views built over this
-- table (see scripts/create-prediction-log-rollup.sql).
--
-- ILP line format (sent by src/server/deployments/predictionLog.ts):
--   prediction_log,symbol=MNQ,timeframe=1m \
--     deployment_id=1i,prediction_str="long",prediction_num=0.73,\
--     confidence=0.85,paper_pnl_delta=12.50,paper_pnl_total=145.30,\
--     model_version_id=42i \
--     1715472000000000000
--
-- Common query — latest 100 predictions for deployment 1:
--   SELECT ts, prediction_str, prediction_num, confidence,
--          paper_pnl_delta, paper_pnl_total
--   FROM prediction_log
--   WHERE deployment_id = 1
--   ORDER BY ts DESC
--   LIMIT 100;
--
-- Common query — running paper PnL curve for deployment 1, last 7 days:
--   SELECT ts, paper_pnl_total
--   FROM prediction_log
--   WHERE deployment_id = 1
--     AND ts > dateadd('d', -7, now())
--   ORDER BY ts;

CREATE TABLE IF NOT EXISTS prediction_log (
    ts                TIMESTAMP,
    deployment_id     LONG,
    prediction_str    SYMBOL CAPACITY 64 NOCACHE,
    prediction_num    DOUBLE,
    confidence        DOUBLE,
    paper_pnl_delta   DOUBLE,
    paper_pnl_total   DOUBLE,
    model_version_id  LONG,
    symbol            SYMBOL CAPACITY 64 INDEX,
    timeframe         SYMBOL CAPACITY 16 INDEX
) TIMESTAMP(ts) PARTITION BY DAY WAL
  DEDUP UPSERT KEYS(ts, deployment_id);
