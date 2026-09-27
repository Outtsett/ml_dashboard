/**
 * Market regime — a rule-based state of the bar itself (no forward horizon).
 *
 * Two causal quantities: the trailing volatility of 1-bar log returns and the
 * trailing trend. "High volatility" means above the TRAILING median of that
 * volatility over `regimeLookbackBars` bars before this one; the previous
 * version ranked each bar against the WHOLE queried range (`PERCENT_RANK()`
 * with no frame), so extending the query's end date relabelled its start.
 * The 3-regime trend cutoff is in volatility units, not a fixed 1%.
 */
import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rollingStd, trailingMedian } from './helpers';

export interface MarketRegimeParams {
  volatilityWindowBars?: number;
  trendWindowBars?: number;
  regimeLookbackBars?: number;
  trendThresholdVolatilityMultiple?: number;
  regimeCount?: number;
}

export function generateMarketRegimeLabelsSQL(
  params: MarketRegimeParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const volatilityWindow = Math.max(2, Math.floor(Number(params.volatilityWindowBars ?? 20)));
  const trendWindow = Math.max(1, Math.floor(Number(params.trendWindowBars ?? 50)));
  const lookback = Math.max(volatilityWindow, Math.floor(Number(params.regimeLookbackBars ?? 500)));
  const trendMultiple = Math.max(0, Number(params.trendThresholdVolatilityMultiple ?? 1.0));
  const regimeCount = Number(params.regimeCount ?? 4);

  const labelCase = regimeCount === 4 ? `
      WHEN NOT volatility_above_trailing_median AND trend_fraction < 0 THEN 0
      WHEN NOT volatility_above_trailing_median AND trend_fraction >= 0 THEN 1
      WHEN volatility_above_trailing_median AND trend_fraction < 0 THEN 2
      ELSE 3`
    : regimeCount === 3 ? `
      WHEN trend_fraction > trend_threshold_fraction THEN 2
      WHEN trend_fraction < -trend_threshold_fraction THEN 0
      ELSE 1`
    : `
      WHEN trend_fraction >= 0 THEN 1
      ELSE 0`;

  const nameCase = regimeCount === 4 ? `
    WHEN 0 THEN 'low_volatility_down'
    WHEN 1 THEN 'low_volatility_up'
    WHEN 2 THEN 'high_volatility_down'
    ELSE 'high_volatility_up'`
    : regimeCount === 3 ? `
    WHEN 0 THEN 'downtrend'
    WHEN 1 THEN 'sideways'
    ELSE 'uptrend'`
    : `
    WHEN 0 THEN 'bearish'
    ELSE 'bullish'`;

  return `
WITH returns AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    LN(close / NULLIF(LAG(close, 1) ${windowOver(cfg)}, 0)) as log_return,
    LAG(close, ${trendWindow}) ${windowOver(cfg)} as close_trend_window_ago
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
metrics AS (
  SELECT
    timestamp,
    symbol,
    close,
    ${rollingStd('log_return', volatilityWindow - 1, cfg)} as trailing_return_volatility_fraction,
    (close - close_trend_window_ago) / NULLIF(close_trend_window_ago, 0) as trend_fraction
  FROM returns
),
with_median AS (
  SELECT
    *,
    ${trailingMedian('trailing_return_volatility_fraction', lookback, cfg)} as volatility_trailing_median_fraction,
    ${trendMultiple} * trailing_return_volatility_fraction * SQRT(${trendWindow}) as trend_threshold_fraction
  FROM metrics
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    trailing_return_volatility_fraction,
    trend_fraction,
    volatility_trailing_median_fraction,
    trailing_return_volatility_fraction > volatility_trailing_median_fraction as volatility_above_trailing_median,
    CASE${labelCase}
    END as label
  FROM with_median
  WHERE trailing_return_volatility_fraction IS NOT NULL
    AND trend_fraction IS NOT NULL
    AND volatility_trailing_median_fraction IS NOT NULL
)
SELECT
  timestamp,
  symbol,
  close,
  label,
  0 as resolution_bars,
  CASE label${nameCase}
  END as regime_name,
  trailing_return_volatility_fraction,
  trend_fraction,
  volatility_trailing_median_fraction
FROM labeled
ORDER BY timestamp`;
}
