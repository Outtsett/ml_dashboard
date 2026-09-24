import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver } from './helpers';

export interface DirectionParams {
  horizon: number;
  threshold: number;
  numClasses: 2 | 3;
}

export function generateDirectionLabelsSQL(
  params: DirectionParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { horizon, threshold, numClasses } = params;
  const thresholdDecimal = threshold / 100;

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
    (future_close - close) / NULLIF(close, 0) as future_return,
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
  future_return,
  label
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}
