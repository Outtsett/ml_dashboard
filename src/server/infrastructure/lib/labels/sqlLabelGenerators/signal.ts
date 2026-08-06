import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver } from './helpers';

export interface SignalParams {
  entryThreshold: number;
  exitThreshold: number;
  holdPeriod: number;
}

export function generateSignalLabelsSQL(
  params: SignalParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { entryThreshold, exitThreshold, holdPeriod } = params;
  const entryDecimal = entryThreshold / 100;
  const exitDecimal = exitThreshold / 100;

  return `
WITH base AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    LAG(close, 1) ${windowOver(cfg)} as prev_close,
    LEAD(close, ${holdPeriod}) ${windowOver(cfg)} as future_close
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
with_returns AS (
  SELECT
    timestamp,
    symbol,
    close,
    (close - prev_close) / NULLIF(prev_close, 0) as current_return,
    (future_close - close) / NULLIF(close, 0) as future_return
  FROM base
  WHERE prev_close IS NOT NULL
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    current_return,
    future_return,
    CASE
      WHEN future_return IS NULL THEN NULL
      WHEN future_return > ${entryDecimal} THEN 1   -- Buy signal
      WHEN future_return < -${exitDecimal} THEN -1  -- Sell signal
      ELSE 0                                         -- Hold
    END as label
  FROM with_returns
)
SELECT
  timestamp,
  symbol,
  close,
  future_return,
  label
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}
