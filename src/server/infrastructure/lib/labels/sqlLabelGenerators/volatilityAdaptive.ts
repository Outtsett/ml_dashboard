import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rollingStd } from './helpers';

export interface VolatilityAdaptiveParams {
  horizonBars?: number;
  volatilityWindowBars?: number;
  volatilityMultiple?: number;
  classCount?: 2 | 3;
}

export function generateVolatilityAdaptiveLabelsSQL(
  params: VolatilityAdaptiveParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const horizon = Math.max(1, Math.floor(Number(params.horizonBars ?? 5)));
  const volatilityWindow = Math.max(2, Math.floor(Number(params.volatilityWindowBars ?? 20)));
  const threshold = Number(params.volatilityMultiple ?? 1.5);
  const numClasses = Number(params.classCount ?? 3);

  return `
WITH returns_calc AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    (close - LAG(close, 1) ${windowOver(cfg)}) / NULLIF(LAG(close, 1) ${windowOver(cfg)}, 0) as return_1bar,
    LEAD(close, ${horizon}) ${windowOver(cfg)} as future_close
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
with_volatility AS (
  SELECT
    timestamp,
    symbol,
    close,
    return_1bar,
    future_close,
    (future_close - close) / NULLIF(close, 0) as future_return_fraction,
    ${rollingStd('return_1bar', volatilityWindow - 1, cfg)} as trailing_return_volatility_fraction
  FROM returns_calc
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    future_return_fraction,
    trailing_return_volatility_fraction,
    future_return_fraction / NULLIF(trailing_return_volatility_fraction, 0) as future_return_volatility_units,
    CASE
      WHEN future_close IS NULL OR trailing_return_volatility_fraction IS NULL OR trailing_return_volatility_fraction = 0 THEN NULL
      ${numClasses === 3 ? `
      WHEN ABS(future_return_fraction) >= ${threshold} * trailing_return_volatility_fraction AND future_return_fraction > 0 THEN 1
      WHEN ABS(future_return_fraction) >= ${threshold} * trailing_return_volatility_fraction AND future_return_fraction < 0 THEN -1
      ELSE 0
      ` : `
      WHEN future_return_fraction >= 0 THEN 1
      ELSE -1
      `}
    END as label
  FROM with_volatility
)
SELECT
  timestamp,
  symbol,
  close,
  label,
  ${horizon} as resolution_bars,
  future_return_fraction,
  trailing_return_volatility_fraction,
  future_return_volatility_units
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}
