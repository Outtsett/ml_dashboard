import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rollingStd } from './helpers';

export interface VolatilityAdaptiveParams {
  horizon: number;
  volatilityWindow: number;
  threshold: number;
  numClasses: 2 | 3;
}

export function generateVolatilityAdaptiveLabelsSQL(
  params: VolatilityAdaptiveParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { horizon, volatilityWindow, threshold, numClasses } = params;

  return `
WITH returns_calc AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    (close - LAG(close, 1) ${windowOver(cfg)}) / LAG(close, 1) ${windowOver(cfg)} as return_1bar,
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
    (future_close - close) / close as future_return,
    ${rollingStd('return_1bar', volatilityWindow - 1, cfg)} as rolling_vol
  FROM returns_calc
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    future_return,
    rolling_vol,
    future_return / NULLIF(rolling_vol, 0) as z_score,
    CASE
      WHEN future_close IS NULL OR rolling_vol IS NULL OR rolling_vol = 0 THEN NULL
      ${numClasses === 3 ? `
      WHEN ABS(future_return) >= ${threshold} * rolling_vol AND future_return > 0 THEN 1
      WHEN ABS(future_return) >= ${threshold} * rolling_vol AND future_return < 0 THEN -1
      ELSE 0
      ` : `
      WHEN future_return >= 0 THEN 1
      ELSE -1
      `}
    END as label
  FROM with_volatility
)
SELECT
  timestamp,
  symbol,
  close,
  future_return,
  rolling_vol,
  z_score,
  label
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}
