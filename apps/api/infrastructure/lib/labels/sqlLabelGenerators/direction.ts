import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver } from './helpers';

export interface DirectionParams {
  horizonBars?: number;
  thresholdPercent?: number;
  classCount?: 2 | 3;
}

export function generateDirectionLabelsSQL(
  params: DirectionParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const horizon = Math.max(1, Math.floor(Number(params.horizonBars ?? 1)));
  const thresholdDecimal = Number(params.thresholdPercent ?? 0) / 100;
  const numClasses = Number(params.classCount ?? 2);

  return `
WITH base AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    LEAD(close, ${horizon}) ${windowOver(cfg)} as future_close
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    future_close,
    (future_close - close) / NULLIF(close, 0) as future_return_fraction,
    CASE
      WHEN future_close IS NULL THEN NULL
      ${numClasses === 3 ? `
      WHEN (future_close - close) / NULLIF(close, 0) > ${thresholdDecimal} THEN 1
      WHEN (future_close - close) / NULLIF(close, 0) < -${thresholdDecimal} THEN -1
      ELSE 0
      ` : `
      WHEN future_close >= close THEN 1
      ELSE -1
      `}
    END as label
  FROM base
)
SELECT
  timestamp,
  symbol,
  close,
  label,
  ${horizon} as resolution_bars,
  future_return_fraction
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}
