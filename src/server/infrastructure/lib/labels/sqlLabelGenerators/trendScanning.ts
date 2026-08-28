import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rollingStd } from './helpers';

export interface TrendScanningParams {
  minHorizon: number;
  maxHorizon: number;
  tThreshold: number;
  minSamples: number;
}

export function generateTrendScanningLabelsSQL(
  params: TrendScanningParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { minHorizon, maxHorizon, tThreshold } = params;

  const horizons = Array.from(
    { length: Math.max(1, maxHorizon - minHorizon + 1) },
    (_, i) => minHorizon + i,
  );

  // Per-horizon forward slope and a pseudo t-statistic (forward move scaled by
  // trailing return volatility over the same span).
  //
  // Two rewrites versus the original:
  //   - `STDDEV_POP(...) OVER (...)` is not a QuestDB window function; the
  //     rolling deviation is rebuilt from windowed AVG (see `rollingStd`).
  //   - the winning horizon was picked with `(SELECT h FROM (VALUES ...))`,
  //     which QuestDB cannot parse and reported only as "')' expected".
  //     `greatest(...)` over the t-stat columns replaces it.
  const horizonCalcs = horizons.map(h => `
    (LEAD(close, ${h}) ${windowOver(cfg)} - close) / close / ${h} as slope_${h},
    ABS((LEAD(close, ${h}) ${windowOver(cfg)} - close) / close) /
      NULLIF(${rollingStd('return_1bar', h - 1, cfg)}, 0) as pseudo_tstat_${h}`
  ).join(',');

  const tstatList = horizons.map(h => `COALESCE(pseudo_tstat_${h}, -1e308)`).join(', ');
  const horizonPick = horizons.map(h =>
    `WHEN pseudo_tstat_${h} = best_tstat THEN ${h}`).join('\n      ');
  const slopeCases = horizons.map(h =>
    `WHEN best_horizon = ${h} THEN slope_${h}`).join('\n      ');

  return `
WITH returns AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    (close - LAG(close, 1) ${windowOver(cfg)}) /
      NULLIF(LAG(close, 1) ${windowOver(cfg)}, 0) as return_1bar
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
horizon_stats AS (
  SELECT
    timestamp,
    symbol,
    close,${horizonCalcs}
  FROM returns
),
with_best_tstat AS (
  SELECT
    *,
    greatest(${tstatList}) as best_tstat
  FROM horizon_stats
),
with_best_horizon AS (
  SELECT
    *,
    CASE
      ${horizonPick}
      ELSE NULL
    END as best_horizon
  FROM with_best_tstat
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    best_horizon,
    best_tstat,
    CASE
      ${slopeCases}
      ELSE NULL
    END as best_slope
  FROM with_best_horizon
  WHERE best_horizon IS NOT NULL
)
SELECT
  timestamp,
  symbol,
  close,
  CASE
    WHEN best_tstat >= ${tThreshold} AND best_slope > 0 THEN 1
    WHEN best_tstat >= ${tThreshold} AND best_slope <= 0 THEN -1
    ELSE 0
  END as label,
  best_horizon as optimal_horizon,
  -- Bars forward to the bar this label is about. The horizon is chosen per
  -- row here, so the chart cannot derive it from the params.
  best_horizon as outcome_offset,
  best_tstat as t_statistic,
  best_slope as trend_slope
FROM labeled
WHERE best_slope IS NOT NULL
ORDER BY timestamp`;
}
