-- Training metrics time-series table
-- Stores scalar metrics from all training phases of the Universal Market Model
CREATE TABLE IF NOT EXISTS training_metrics (
  ts TIMESTAMP,
  phase SYMBOL,        -- A, B, C, D, E
  model SYMBOL,        -- mae, cpc, tstcc, slot_attention, som, gat, ...
  metric SYMBOL,       -- loss, accuracy, silhouette, etc.
  value DOUBLE,
  step LONG,           -- global step counter
  epoch INT,           -- epoch within phase
  fold INT             -- walk-forward fold index
) TIMESTAMP(ts) PARTITION BY DAY WAL
DEDUP ENABLED UPSERT KEYS(ts, phase, model, metric, step);
