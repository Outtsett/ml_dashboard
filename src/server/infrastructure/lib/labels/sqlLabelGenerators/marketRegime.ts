import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rollingStd } from './helpers';

export interface MarketRegimeParams {
  volatilityWindow: number;
  trendWindow: number;
  numRegimes: number;
}

export function generateMarketRegimeLabelsSQL(
  params: MarketRegimeParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { volatilityWindow, trendWindow, numRegimes } = params;

  // Rule-based regime detection (simplified HMM-like)
  // Regimes: 0=low-vol-down, 1=low-vol-up, 2=high-vol-down, 3=high-vol-up
  // `STDDEV_POP(LN(close / LAG(...) OVER (...))) OVER (...)` nests a window
  // function inside an aggregate's argument, which QuestDB rejects with
  // "non-window function called in window context". log_return is materialised
  // in its own CTE first so the rolling deviation reads a plain column.
  return `
WITH returns AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    LN(close / LAG(close, 1) ${windowOver(cfg)}) as log_return,
    LAG(close, ${trendWindow}) ${windowOver(cfg)} as close_lag_trend
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
metrics AS (
  SELECT
    timestamp,
    symbol,
    close,
    ${rollingStd('log_return', volatilityWindow - 1, cfg)} as rolling_vol,
    (close - close_lag_trend) / NULLIF(close_lag_trend, 0) as trend_pct
  FROM returns
),
with_percentiles AS (
  SELECT
    *,
    PERCENT_RANK() OVER (ORDER BY rolling_vol) as vol_pctile,
    PERCENT_RANK() OVER (ORDER BY trend_pct) as trend_pctile
  FROM metrics
  WHERE rolling_vol IS NOT NULL AND trend_pct IS NOT NULL
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    rolling_vol,
    trend_pct,
    vol_pctile,
    trend_pctile,
    CASE
      ${numRegimes === 4 ? `
      WHEN vol_pctile < 0.5 AND trend_pct < 0 THEN 0  -- Low vol, down
      WHEN vol_pctile < 0.5 AND trend_pct >= 0 THEN 1 -- Low vol, up
      WHEN vol_pctile >= 0.5 AND trend_pct < 0 THEN 2 -- High vol, down
      ELSE 3  -- High vol, up
      ` : numRegimes === 3 ? `
      WHEN trend_pct > 0.01 THEN 2  -- Uptrend
      WHEN trend_pct < -0.01 THEN 0 -- Downtrend
      ELSE 1 -- Sideways
      ` : `
      WHEN trend_pct >= 0 THEN 1
      ELSE 0
      `}
    END as label
  FROM with_percentiles
)
SELECT
  timestamp,
  symbol,
  close,
  label,
  rolling_vol,
  trend_pct,
  CASE label
    ${numRegimes === 4 ? `
    WHEN 0 THEN 'low_vol_down'
    WHEN 1 THEN 'low_vol_up'
    WHEN 2 THEN 'high_vol_down'
    ELSE 'high_vol_up'
    ` : numRegimes === 3 ? `
    WHEN 0 THEN 'downtrend'
    WHEN 1 THEN 'sideways'
    ELSE 'uptrend'
    ` : `
    WHEN 0 THEN 'bearish'
    ELSE 'bullish'
    `}
  END as regime_name
FROM labeled
ORDER BY timestamp`;
}
