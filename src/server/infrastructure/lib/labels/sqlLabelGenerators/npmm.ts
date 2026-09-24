import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rowsBack, shiftForward } from './helpers';

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

  // Every window here originally ended in `N FOLLOWING`, which QuestDB rejects
  // ("frame end supports _number_ PRECEDING and CURRENT ROW only"). Each one is
  // rebuilt as a TRAILING frame evaluated `lookforwardPeriod` bars later and
  // pulled back with LEAD:
  //
  //   centred [t-back, t+fwd]  ==  trailing (back+fwd) at t+fwd, shifted back fwd
  //   forward [t, t+fwd]       ==  trailing (fwd)      at t+fwd, shifted back fwd
  const centredSpan = lookbackPeriod + lookforwardPeriod;

  return `
WITH base AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    ROW_NUMBER() ${windowOver(cfg)} as row_num,
    LEAD(close, ${confirmationBars}) ${windowOver(cfg)} as future_close_confirm
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
trailing AS (
  SELECT
    timestamp,
    symbol,
    close,
    row_num,
    future_close_confirm,
    MIN(close) ${rowsBack(centredSpan, cfg)} as trail_centred_min,
    MAX(close) ${rowsBack(centredSpan, cfg)} as trail_centred_max,
    MIN(close) ${rowsBack(lookforwardPeriod, cfg)} as trail_fwd_min,
    MAX(close) ${rowsBack(lookforwardPeriod, cfg)} as trail_fwd_max
  FROM base
),
shifted AS (
  SELECT
    timestamp,
    symbol,
    close,
    row_num,
    future_close_confirm,
    ${shiftForward('trail_centred_min', lookforwardPeriod, cfg)} as window_min,
    ${shiftForward('trail_centred_max', lookforwardPeriod, cfg)} as window_max,
    ${shiftForward('trail_fwd_min', lookforwardPeriod, cfg)} as min_after,
    ${shiftForward('trail_fwd_max', lookforwardPeriod, cfg)} as max_after
  FROM trailing
),
extrema AS (
  SELECT
    timestamp,
    symbol,
    close,
    window_min,
    window_max,
    future_close_confirm,
    max_after,
    min_after,
    CASE
      WHEN close = window_min AND future_close_confirm > close THEN 1
      WHEN close = window_max AND future_close_confirm < close THEN -1
      ELSE NULL
    END as raw_label,
    CASE
      WHEN close = window_min THEN (max_after - close) / NULLIF(close, 0)
      WHEN close = window_max THEN (close - min_after) / NULLIF(close, 0)
      ELSE NULL
    END as move_size
  FROM shifted
)
SELECT
  timestamp,
  symbol,
  close,
  raw_label as label,
  move_size
FROM extrema
WHERE raw_label IS NOT NULL
  AND move_size >= ${minMoveDecimal}
ORDER BY timestamp`;
}
