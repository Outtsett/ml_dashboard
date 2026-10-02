/**
 * Trend scanning (López de Prado, AFML ch. 5.4): for each bar, fit a least
 * squares line through the next h closes for every horizon h in a range, keep
 * the horizon whose slope has the largest |t-statistic|, and label the sign.
 *
 * Think of it as: at each bar you draw the best straight line through the next
 * 3, 4, … 20 bars, and ask which of those lines is most clearly not flat.
 *
 * What changed from the earlier version (audit, 2026-09-26):
 *   - the statistic is a real regression t (slope / its standard error), not
 *     |forward move| / trailing σ, and it needs the FULL window (NULL at the tail);
 *   - the threshold is Šidák-adjusted for the number of horizons compared,
 *     because the largest of m correlated t-statistics is what is being tested
 *     (a single-test 2.0 becomes ~3.0 over 18 horizons; 93% of MNQ 5m bars were
 *     "significant" before);
 *   - `t_statistic_scaled = t / sqrt(n)` is emitted beside the raw t. A raw t of
 *     price on time grows like sqrt(n) under a random walk, so the raw statistic
 *     favours long horizons; the scaled one is the level-free statistic the
 *     TrendState calibration thresholds.
 *
 * The regression is closed-form over window sums so it costs four running sums
 * per horizon instead of five aggregate windows: with x = 0 … h,
 *   Σx = h(h+1)/2, Σx² = h(h+1)(2h+1)/6, Sxx = Σx² − (Σx)²/n,
 *   Σxy = Σ(bar_index·y) − bar_index_t·Σy,  Sxy = Σxy − Σx·Σy/n,
 *   slope = Sxy / Sxx,  SSE = Syy − slope·Sxy,  se = sqrt(SSE / (n−2) / Sxx).
 * y is log close centred on the first close of the series so the sums do not
 * lose digits at a price level of ~10 (log) or ~20,000 (raw).
 */
import type { LabelGeneratorConfig } from './helpers';
import { BAR_INDEX_COLUMN, DEFAULT_CONFIG, rowsForward, sidakThreshold, windowOver } from './helpers';

export interface TrendScanningParams {
  minimumHorizonBars?: number;
  maximumHorizonBars?: number;
  horizonStepBars?: number;
  tStatisticThreshold?: number;
  correctForHorizonCount?: boolean;
  useLogPrice?: boolean;
}

export function trendScanningHorizons(params: TrendScanningParams): number[] {
  const minimum = Math.max(2, Math.floor(Number(params.minimumHorizonBars ?? 3)));
  const maximum = Math.max(minimum, Math.floor(Number(params.maximumHorizonBars ?? 20)));
  const step = Math.max(1, Math.floor(Number(params.horizonStepBars ?? 1)));
  const horizons: number[] = [];
  for (let h = minimum; h <= maximum; h += step) horizons.push(h);
  return horizons;
}

export function generateTrendScanningLabelsSQL(
  params: TrendScanningParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const horizons = trendScanningHorizons(params);
  const threshold = Math.max(0, Number(params.tStatisticThreshold ?? 2.0));
  const correct = params.correctForHorizonCount ?? true;
  const useLog = params.useLogPrice ?? true;
  const applied = correct ? sidakThreshold(threshold, horizons.length) : threshold;

  const y = useLog ? 'LN(close) - first_log_close' : 'close - first_close';

  // Per horizon: the three running sums and the count over the forward frame.
  const sums = horizons.map(h => {
    const frame = rowsForward(h, cfg);
    return `
    SUM(y) ${frame} AS sum_y_${h},
    SUM(index_y) ${frame} AS sum_index_y_${h},
    SUM(y * y) ${frame} AS sum_y_squared_${h},
    COUNT(y) ${frame} AS count_${h}`;
  }).join(',');

  const fits = horizons.map(h => {
    const n = h + 1;
    const sumX = (h * (h + 1)) / 2;
    return `
    CASE WHEN count_${h} = ${n} THEN
      (sum_index_y_${h} - ${BAR_INDEX_COLUMN} * sum_y_${h}) - ${sumX} * sum_y_${h} / ${n}
    END AS sxy_${h},
    CASE WHEN count_${h} = ${n} THEN
      sum_y_squared_${h} - sum_y_${h} * sum_y_${h} / ${n}
    END AS syy_${h}`;
  }).join(',');

  const statistics = horizons.map(h => {
    const n = h + 1;
    const sumX = (h * (h + 1)) / 2;
    const sumXSquared = (h * (h + 1) * (2 * h + 1)) / 6;
    const sxx = sumXSquared - (sumX * sumX) / n;
    return `
    sxy_${h} / ${sxx} AS slope_${h},
    CASE
      WHEN sxy_${h} IS NULL THEN NULL
      WHEN (syy_${h} - sxy_${h} * sxy_${h} / ${sxx}) <= 0 THEN NULL
      ELSE (sxy_${h} / ${sxx}) / SQRT((syy_${h} - sxy_${h} * sxy_${h} / ${sxx}) / ${n - 2} / ${sxx})
    END AS t_${h}`;
  }).join(',');

  const bestAbs = `GREATEST(${horizons.map(h => `COALESCE(ABS(t_${h}), -1)`).join(', ')})`;
  const pick = (column: (h: number) => string) =>
    `CASE ${horizons.map(h => `WHEN ABS(t_${h}) = best_abs_t THEN ${column(h)}`).join(' ')} END`;

  return `
WITH indexed AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    ${BAR_INDEX_COLUMN},
    FIRST_VALUE(LN(close)) ${windowOver(cfg)} as first_log_close,
    FIRST_VALUE(close) ${windowOver(cfg)} as first_close
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
centred AS (
  SELECT timestamp, symbol, close, ${BAR_INDEX_COLUMN},
    ${y} as y,
    ${BAR_INDEX_COLUMN} * (${y}) as index_y
  FROM indexed
),
window_sums AS (
  SELECT timestamp, symbol, close, ${BAR_INDEX_COLUMN},${sums}
  FROM centred
),
fitted AS (
  SELECT timestamp, symbol, close,${fits}
  FROM window_sums
),
statistics AS (
  SELECT timestamp, symbol, close,${statistics}
  FROM fitted
),
ranked AS (
  SELECT *, ${bestAbs} as best_abs_t
  FROM statistics
),
chosen AS (
  SELECT
    timestamp, symbol, close,
    ${pick(h => `${h}`)} as horizon_bars,
    ${pick(h => `t_${h}`)} as t_statistic,
    ${pick(h => `slope_${h}`)} as trend_slope_per_bar
  FROM ranked
  WHERE best_abs_t >= 0
)
SELECT
  timestamp,
  symbol,
  close,
  CASE
    WHEN ABS(t_statistic) < ${applied} THEN 0
    WHEN trend_slope_per_bar > 0 THEN 1
    WHEN trend_slope_per_bar < 0 THEN -1
    ELSE 0
  END as label,
  horizon_bars as resolution_bars,
  horizon_bars,
  t_statistic,
  t_statistic / SQRT(horizon_bars + 1) as t_statistic_scaled,
  trend_slope_per_bar,
  ${horizons.length} as horizons_tested_count,
  ${applied} as t_statistic_threshold_applied
FROM chosen
WHERE t_statistic IS NOT NULL
ORDER BY timestamp`;
}
