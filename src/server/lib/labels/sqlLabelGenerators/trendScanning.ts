import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rowsBetween } from './helpers';

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

  // Generate horizon-specific t-stat calculations
  // Simplified: use slope sign and magnitude as proxy for t-stat
  const horizonCalcs = Array.from(
    { length: maxHorizon - minHorizon + 1 },
    (_, i) => {
      const h = minHorizon + i;
      return `
        (LEAD(close, ${h}) ${windowOver(cfg)} - close) / close / ${h} as slope_${h},
        ABS((LEAD(close, ${h}) ${windowOver(cfg)} - close) / close) /
          NULLIF(STDDEV_POP((close - LAG(close, 1) ${windowOver(cfg)}) / LAG(close, 1) ${windowOver(cfg)})
            ${rowsBetween(h - 1, 0, cfg)}, 0) as pseudo_tstat_${h}`;
    }
  ).join(',\n    ');

  // Find best horizon
  const horizonComparisons = Array.from(
    { length: maxHorizon - minHorizon + 1 },
    (_, i) => `pseudo_tstat_${minHorizon + i}`
  ).join(', ');

  const slopeCases = Array.from(
    { length: maxHorizon - minHorizon + 1 },
    (_, i) => {
      const h = minHorizon + i;
      return `WHEN best_horizon = ${h} THEN slope_${h}`;
    }
  ).join('\n      ');

  const tstatCases = Array.from(
    { length: maxHorizon - minHorizon + 1 },
    (_, i) => {
      const h = minHorizon + i;
      return `WHEN best_horizon = ${h} THEN pseudo_tstat_${h}`;
    }
  ).join('\n      ');

  return `
WITH horizon_stats AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    ${horizonCalcs}
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
with_best_horizon AS (
  SELECT
    *,
    (SELECT h FROM (VALUES ${Array.from({ length: maxHorizon - minHorizon + 1 }, (_, i) =>
      `(${minHorizon + i}, pseudo_tstat_${minHorizon + i})`).join(', ')}) AS t(h, tstat)
     ORDER BY tstat DESC NULLS LAST LIMIT 1) as best_horizon
  FROM horizon_stats
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    best_horizon,
    CASE
      ${slopeCases}
    END as best_slope,
    CASE
      ${tstatCases}
    END as best_tstat,
    CASE
      WHEN (CASE ${tstatCases} END) >= ${tThreshold} THEN
        CASE WHEN (CASE ${slopeCases} END) > 0 THEN 1 ELSE -1 END
      ELSE 0
    END as label
  FROM with_best_horizon
)
SELECT
  timestamp,
  symbol,
  close,
  label,
  best_horizon as optimal_horizon,
  best_tstat as t_statistic,
  best_slope as trend_slope
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}
