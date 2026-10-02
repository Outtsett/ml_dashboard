import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver } from './helpers';

export interface SignalParams {
  entryThresholdPercent?: number;
  exitThresholdPercent?: number;
  holdPeriodBars?: number;
}

export function generateSignalLabelsSQL(
  params: SignalParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const entryDecimal = Number(params.entryThresholdPercent ?? 0.5) / 100;
  const exitDecimal = Number(params.exitThresholdPercent ?? 0.3) / 100;
  const holdPeriod = Math.max(1, Math.floor(Number(params.holdPeriodBars ?? 5)));

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
    (close - prev_close) / NULLIF(prev_close, 0) as current_return_fraction,
    (future_close - close) / NULLIF(close, 0) as future_return_fraction
  FROM base
  WHERE prev_close IS NOT NULL
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    current_return_fraction,
    future_return_fraction,
    CASE
      WHEN future_return_fraction IS NULL THEN NULL
      WHEN future_return_fraction > ${entryDecimal} THEN 1   -- Buy signal
      WHEN future_return_fraction < -${exitDecimal} THEN -1  -- Sell signal
      ELSE 0                                         -- Hold
    END as label
  FROM with_returns
)
SELECT
  timestamp,
  symbol,
  close,
  label,
  ${holdPeriod} as resolution_bars,
  future_return_fraction,
  current_return_fraction
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}
