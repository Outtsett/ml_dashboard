/**
 * The body of GET /api/studies/label-audit-1m, shared by the handler and the
 * page, and the pure arithmetic both sides use.
 *
 * Two sources feed it. The live part is SQL over `mnq_labels_1m` (the stored
 * labels on the 2,340,445 span-aligned MNQ 1m bars) and `mnq_ohlcv_1m`, so the
 * page's controls (horizon, flat dead zone, bucket size, histogram, shift) move
 * real numbers. The landed part is `derived_study_label_audit_1m_<table>`,
 * written by packages/ml-engine/src/studies/label_audit_1m/build.py with the notebook's own
 * generators: the exponentially weighted persistence baselines (a recursion),
 * the triple-barrier and swing sweeps (numba), the inventory, the purge audit
 * and the eight findings.
 */

import type { LensEightNumberSummary } from "../lens/types";

/** Horizons the stored direction labels exist for (`dir_h<H>`, `dir_delta_pts_h<H>`). */
export const DIRECTION_HORIZONS = [1, 5, 15, 60, 90, 240, 1440] as const;
export type DirectionHorizon = (typeof DIRECTION_HORIZONS)[number];

/** The notebook's pinned flat thresholds, in points. */
export const NOTEBOOK_FLAT_THRESHOLDS = [0, 1, 2, 5, 10, 25] as const;

/** MNQ's tick, in points: every close-to-close delta is a multiple of it. */
export const TICK_POINTS = 0.25;

/** log(1e-9): the value the pre-fix volatility label floored a zero-range bar to. */
export const ZERO_RANGE_FLOOR = Math.log(1e-9);

export interface DirectionHorizonRow {
  horizon_bars: number;
  valid_bar_count: number;
  up_rate: number | null;
  majority_baseline: number | null;
  free_edge_over_coin_flip: number | null;
}

export interface DirectionYearRow {
  year: number;
  valid_bar_count: number;
  up_rate: number | null;
  majority_baseline: number | null;
}

export interface FlatPoint {
  flat_threshold_points: number;
  kept_bar_count: number;
  kept_share: number | null;
  dropped_flat_bar_count: number;
  /** Share of kept bars whose close rose, so the majority baseline after the dead zone. */
  up_rate_among_kept: number | null;
}

/** One group of `|close[t+H] - close[t]|` in whole ticks, with how many of those bars rose. */
export interface MagnitudeGroup {
  ticks: number;
  bar_count: number;
  up_count: number;
}

export interface HistogramBin {
  lower: number;
  upper: number;
  count: number;
}

export interface RangeBucketRow {
  bucket_index: number;
  bucket_centre_points: number;
  bar_count: number;
  share: number;
}

export interface BarrierRow {
  take_profit_multiple_of_average_true_range: number;
  stop_loss_multiple_of_average_true_range: number;
  vertical_barrier_bars: number;
  is_shipped_default_before_fix: boolean;
  labelled_bar_count: number;
  take_profit_first_share: number;
  stop_loss_first_share: number;
  vertical_timeout_share: number;
}

export interface SwingRow {
  fractal_period_bars: number;
  vertical_barrier_bars: number;
  forward_reach_bars: number;
  labelled_bar_count: number;
  next_pivot_high_share: number;
  next_pivot_low_share: number;
  timeout_share: number;
}

export interface VolatilityBaselineRow {
  exponential_smoothing_factor: number;
  zero_range_policy: "floored" | "masked";
  r_squared: number;
  scored_bar_count: number;
}

export interface VolatilitySummary {
  total_bar_count: number;
  labelled_bar_count: number;
  log_range_mean: number;
  log_range_standard_deviation: number;
  log_range_minimum: number;
  log_range_maximum: number;
  zero_range_bar_count: number;
  zero_range_share: number;
  floor_log_value: number;
  floor_distance_in_standard_deviations: number;
  target_mean_r_squared: number;
  lag_one_autocorrelation: number;
  best_floored_smoothing_factor: number;
  best_floored_r_squared: number;
  best_masked_smoothing_factor: number;
  best_masked_r_squared: number;
  masked_scored_bar_count: number;
  floor_cost_r_squared: number;
}

export interface InventoryRow {
  module_path: string;
  label_name: string;
  definition: string;
  forward_bars: string;
  family: string;
  is_supervised_label: boolean;
}

export interface PurgeAuditRow {
  script: string;
  label_name: string;
  forward_reach_bars: number | null;
  purge_as_coded: string;
  reach_covered: boolean;
}

export interface FindingRow {
  finding_number: number;
  finding: string;
  evidence: string;
  action: string;
  status: string;
}

export interface ProvenanceRow {
  lake_bar_count: number;
  lake_first_timestamp: string;
  lake_last_timestamp: string;
  audited_bar_count: number;
  audited_first_timestamp: string;
  audited_last_timestamp: string;
  bars_clipped_by_span_alignment: number;
  current_loader_bar_count: number;
  current_loader_first_timestamp: string;
  current_loader_last_timestamp: string;
  built_at: string;
}

export interface Coverage {
  lake_bar_count: number;
  lake_first_timestamp: number | null;
  lake_last_timestamp: number | null;
  labelled_bar_count: number;
  labelled_first_timestamp: number | null;
  labelled_last_timestamp: number | null;
}

export interface LogRangeSamplePoint {
  /** Epoch milliseconds (the lake stamps futures in Pacific wall clock). */
  time: number;
  log_range: number | null;
  zero_range: boolean;
}

export interface RangeSummary {
  labelled_bar_count: number;
  centre_share: number | null;
  majority_share: number | null;
  chance_share: number;
  sparse_bucket_count: number;
  empty_bucket_count: number;
}

export interface LabelAuditBody {
  /** Whether mnq_labels_1m is served (the live sections). */
  labelsServed: boolean;
  /** Whether the landed study tables are served (the recursion, sweeps, inventory, findings). */
  recordServed: boolean;
  coverage: Coverage | null;
  provenance: ProvenanceRow | null;
  inventory: InventoryRow[];
  purgeAudit: PurgeAuditRow[];
  findings: FindingRow[];
  direction: {
    horizons: DirectionHorizonRow[];
    horizon: number;
    years: DirectionYearRow[];
    flatCurve: FlatPoint[];
    flatPinned: FlatPoint[];
    flatSelected: FlatPoint | null;
    /** The largest threshold the curve reaches: the 95th percentile of |delta| at this horizon. */
    flatCurveMaximum: number;
  };
  volatility: {
    summary: VolatilitySummary | null;
    baselines: VolatilityBaselineRow[];
    policy: "floored" | "masked";
    cutoff: number;
    eight: LensEightNumberSummary | null;
    histogram: HistogramBin[];
    histogramMedian: number | null;
    shownCount: number;
    belowCutoffCount: number;
    /** 120 consecutive bars around the most recent zero-range bar, under the chosen policy, for the forecast walk-through. */
    sample: LogRangeSamplePoint[];
  };
  range: {
    bucketSize: number;
    bucketCount: number;
    occupancy: RangeBucketRow[];
    summary: RangeSummary;
    quantiles: Array<{ quantile: number; points: number | null }>;
    suggestedBucketSize: number | null;
    /** The notebook's pinned 2.0-point scheme, from the landed record. */
    pinned: RangeBucketRow[];
  };
  barrier: BarrierRow[];
  swing: SwingRow[];
  shift: {
    horizon: number;
    shiftBars: number;
    honestMaximum: number | null;
    leakyMaximum: number | null;
    leakyMismatchCount: number;
    comparedCount: number;
  } | null;
}

/** The share of bars the majority class wins with no skill: max(p, 1 - p). */
export function majorityBaseline(upRate: number | null | undefined): number | null {
  if (upRate === null || upRate === undefined || !Number.isFinite(upRate)) return null;
  return Math.max(upRate, 1 - upRate);
}

/** A threshold in points as whole ticks, rounded up so `|delta| >= threshold` is exact on the tick grid. */
export function thresholdTicks(thresholdPoints: number): number {
  return Math.ceil(thresholdPoints / TICK_POINTS - 1e-9);
}

/**
 * Flat dead zone at one threshold, from magnitude groups: a bar is kept when
 * `|delta| >= threshold` (the notebook's `generate_direction_labels`), so a
 * threshold of 0 keeps every bar with a delta.
 */
export function flatPoint(groups: readonly MagnitudeGroup[], thresholdPoints: number): FlatPoint {
  const minimum = thresholdTicks(thresholdPoints);
  let total = 0;
  let kept = 0;
  let up = 0;
  for (const group of groups) {
    total += group.bar_count;
    if (group.ticks >= minimum) {
      kept += group.bar_count;
      up += group.up_count;
    }
  }
  return {
    flat_threshold_points: thresholdPoints,
    kept_bar_count: kept,
    kept_share: total > 0 ? kept / total : null,
    dropped_flat_bar_count: total - kept,
    up_rate_among_kept: kept > 0 ? up / kept : null,
  };
}

/** The flat curve at `steps + 1` evenly spaced thresholds from 0 to `maximum`, each on the tick grid. */
export function flatCurve(groups: readonly MagnitudeGroup[], maximum: number, steps = 120): FlatPoint[] {
  const top = Math.max(TICK_POINTS, Math.ceil(maximum / TICK_POINTS) * TICK_POINTS);
  const seen = new Set<number>();
  const out: FlatPoint[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const threshold = Math.round((top * step) / steps / TICK_POINTS) * TICK_POINTS;
    if (seen.has(threshold)) continue;
    seen.add(threshold);
    out.push(flatPoint(groups, threshold));
  }
  return out;
}

/** The magnitude, in points, below which `share` of the bars sit (a quantile read off the groups). */
export function magnitudeQuantile(groups: readonly MagnitudeGroup[], share: number): number | null {
  const sorted = [...groups].sort((a, b) => a.ticks - b.ticks);
  const total = sorted.reduce((sum, group) => sum + group.bar_count, 0);
  if (total === 0) return null;
  let running = 0;
  for (const group of sorted) {
    running += group.bar_count;
    if (running / total >= share) return group.ticks * TICK_POINTS;
  }
  return (sorted[sorted.length - 1] as MagnitudeGroup).ticks * TICK_POINTS;
}

/** Centre of bucket `index` for `bucketCount` symmetric buckets of `bucketSize` points (range_labels.make_bucket_centers). */
export function bucketCentre(index: number, bucketSize: number, bucketCount: number): number {
  return (index - (bucketCount - 1) / 2) * bucketSize;
}

/**
 * The bucket a delta falls in: np.digitize against the edges halfway between
 * centres, which is floor(delta / b + (N - 1) / 2 + 1/2) clamped to [0, N - 1].
 */
export function bucketIndex(deltaPoints: number, bucketSize: number, bucketCount: number): number {
  const raw = Math.floor(deltaPoints / bucketSize + (bucketCount - 1) / 2 + 0.5);
  return Math.min(Math.max(raw, 0), bucketCount - 1);
}

/** Every bucket, including empty ones, with its share of the labelled bars. */
export function fillBuckets(counts: ReadonlyArray<{ bucket_index: number; bar_count: number }>, bucketSize: number, bucketCount: number): RangeBucketRow[] {
  const byIndex = new Map<number, number>();
  let total = 0;
  for (const row of counts) {
    byIndex.set(row.bucket_index, (byIndex.get(row.bucket_index) ?? 0) + row.bar_count);
    total += row.bar_count;
  }
  const out: RangeBucketRow[] = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const count = byIndex.get(index) ?? 0;
    out.push({ bucket_index: index, bucket_centre_points: bucketCentre(index, bucketSize, bucketCount), bar_count: count, share: total > 0 ? count / total : 0 });
  }
  return out;
}

/** Centre share, the free majority-class accuracy, chance, and the buckets holding under 0.1 % of bars. */
export function rangeSummary(buckets: readonly RangeBucketRow[]): RangeSummary {
  const total = buckets.reduce((sum, row) => sum + row.bar_count, 0);
  const centre = buckets[Math.floor(buckets.length / 2)];
  const majority = buckets.reduce((best, row) => Math.max(best, row.share), 0);
  return {
    labelled_bar_count: total,
    centre_share: total > 0 && centre ? centre.share : null,
    majority_share: total > 0 ? majority : null,
    chance_share: buckets.length > 0 ? 1 / buckets.length : 0,
    sparse_bucket_count: buckets.filter((row) => row.share < 0.001).length,
    empty_bucket_count: buckets.filter((row) => row.bar_count === 0).length,
  };
}

/** R squared of a forecast: 1 - sum of squared errors / total sum of squares. */
export function rSquared(actual: readonly number[], forecast: readonly number[]): number | null {
  const n = Math.min(actual.length, forecast.length);
  if (n < 2) return null;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += actual[i] as number;
  mean /= n;
  let errors = 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const y = actual[i] as number;
    errors += (y - (forecast[i] as number)) ** 2;
    total += (y - mean) ** 2;
  }
  return total > 0 ? 1 - errors / total : null;
}

/**
 * The exponentially weighted persistence forecast of the next bar's log-range
 * (volatility_labels.ewma_log_range_forecast): e[t] = lambda * e[t-1] + (1 - lambda) * x[t],
 * seeded with the first value; a missing bar carries the previous value.
 */
export function exponentialForecast(values: readonly number[], smoothing: number): number[] {
  const out: number[] = [];
  let state: number | null = null;
  for (const value of values) {
    if (Number.isFinite(value)) state = state === null ? value : smoothing * state + (1 - smoothing) * value;
    out.push(state ?? Number.NaN);
  }
  return out;
}
