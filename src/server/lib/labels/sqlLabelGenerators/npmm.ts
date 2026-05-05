import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rowsBetween } from './helpers';

export interface NPMMParams {
  lookbackPeriod: number;
  lookforwardPeriod: number;
  confirmationBars: number;
  minMovePct: number;
}

export function generateNPMMLabelsSQL(
  params: NPMMParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { lookbackPeriod, lookforwardPeriod, confirmationBars, minMovePct } = params;
  const minMoveDecimal = minMovePct / 100;

  return `
WITH base AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    ROW_NUMBER() ${windowOver(cfg)} as row_num,
    MIN(close) ${rowsBetween(lookbackPeriod, lookforwardPeriod, cfg)} as window_min,
    MAX(close) ${rowsBetween(lookbackPeriod, lookforwardPeriod, cfg)} as window_max,
    LEAD(close, ${confirmationBars}) ${windowOver(cfg)} as future_close_confirm,
    MAX(close) ${rowsBetween(0, lookforwardPeriod, cfg)} as max_after,
    MIN(close) ${rowsBetween(0, lookforwardPeriod, cfg)} as min_after
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
extrema AS (
  SELECT
    timestamp,
    symbol,
    close,
    row_num,
    window_min,
    window_max,
    future_close_confirm,
    max_after,
    min_after,
    CASE
      WHEN close = window_min AND future_close_confirm > close THEN 1  -- Local min (buy signal)
      WHEN close = window_max AND future_close_confirm < close THEN -1 -- Local max (sell signal)
      ELSE NULL
    END as raw_label,
    CASE
      WHEN close = window_min THEN (max_after - close) / close
      WHEN close = window_max THEN (close - min_after) / close
      ELSE NULL
    END as move_size
  FROM base
),
filtered AS (
  SELECT
    timestamp,
    symbol,
    close,
    raw_label as label,
    move_size
  FROM extrema
  WHERE raw_label IS NOT NULL
    AND move_size >= ${minMoveDecimal}
)
SELECT * FROM filtered
ORDER BY timestamp`;
}
