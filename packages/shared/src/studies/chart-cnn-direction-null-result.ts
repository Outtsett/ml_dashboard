/**
 * The body of GET /api/studies/chart-cnn-direction-null-result, shared by the handler and the page, and the
 * pure arithmetic the page runs on it (the AUC rebuilt from score bins, the ROC trapezoids, rank correlation
 * across bins, the verdict bands of the notebook's "How to read this" table, the filter tiling).
 *
 * The rows are the four tables landed by packages/ml-engine/src/studies/chart_cnn_direction_null_result/build.py under
 * s3://derived/study_chart_cnn_direction_null_result/, column names as landed.
 */

export interface ModelResultRow {
  dataset_tag: string;
  model_name: string;
  test_observation_count: number;
  area_under_curve: number;
  area_under_curve_interval_low: number;
  area_under_curve_interval_high: number;
  long_top_20_percent_mean_return_atr_multiples: number;
  short_bottom_20_percent_mean_return_atr_multiples: number;
  naive_long_mean_return_atr_multiples: number;
  base_up_rate: number;
  return_standard_deviation_atr_multiples: number;
}

export interface ModelComparisonRow {
  dataset_tag: string;
  test_observation_count: number;
  image_area_under_curve: number;
  sequence_area_under_curve: number;
  area_under_curve_difference_image_minus_sequence: number;
  difference_interval_low: number;
  difference_interval_high: number;
  difference_z_statistic: number;
}

export interface ScoreBinRow {
  dataset_tag: string;
  model_name: string;
  bin_count_requested: number;
  bin_number: number;
  observation_count: number;
  mean_score: number;
  score_minimum: number;
  score_maximum: number;
  up_rate: number;
  up_rate_interval_low: number;
  up_rate_interval_high: number;
  base_up_rate: number;
  mean_return_atr_multiples: number;
  mean_return_standard_error_atr_multiples: number;
}

export interface FilterWeightRow {
  filter_number: number;
  price_row: number;
  time_column: number;
  weight: number;
}

export interface DirectionNullBody {
  /** The landed recipe these rows came from ("" when nothing is landed). */
  recipe: string;
  modelResults: ModelResultRow[];
  comparisons: ModelComparisonRow[];
  scoreBins: ScoreBinRow[];
  filters: FilterWeightRow[];
}

export const MODEL_IMAGE = "2D image";
export const MODEL_SEQUENCE = "1D sequence";

// ------------------------------------------------------------------ the notebook's "How to read this" table

export type Verdict = "null" | "weak" | "real";

export interface VerdictBand {
  verdict: Verdict;
  label: string;
  lower: number;
  upper: number;
  meaning: string;
}

/** AUC bands exactly as the notebook states them. */
export const VERDICT_BANDS: readonly VerdictBand[] = [
  { verdict: "null", label: "below 0.53", lower: 0, upper: 0.53, meaning: "shape carries no direction at this scale: a null result" },
  { verdict: "weak", label: "0.53 to 0.58", lower: 0.53, upper: 0.58, meaning: "weak; check top and bottom decile R net of cost before believing it" },
  { verdict: "real", label: "above 0.58", lower: 0.58, upper: 1, meaning: "real; move to walk-forward validation and a cost model" },
];

export function verdictFor(areaUnderCurve: number): Verdict {
  if (areaUnderCurve < 0.53) return "null";
  if (areaUnderCurve <= 0.58) return "weak";
  return "real";
}

// ------------------------------------------------------------------ rebuilding the AUC from score bins

export interface RocStep {
  /** 1 = the highest-scoring bin. */
  step: number;
  binNumber: number;
  positiveCount: number;
  negativeCount: number;
  /** True-positive rate and false-positive rate after this bin joins the "predicted up" set. */
  truePositiveRate: number;
  falsePositiveRate: number;
  previousTruePositiveRate: number;
  previousFalsePositiveRate: number;
  /** (F_j - F_{j-1}) (T_{j-1} + T_j) / 2: the trapezoid this bin adds under the ROC curve. */
  area: number;
  cumulativeArea: number;
}

export interface RocFromBins {
  positiveTotal: number;
  negativeTotal: number;
  steps: RocStep[];
  /** The area under the piecewise-linear ROC through the bin boundaries. */
  areaUnderCurve: number;
}

interface BinCounts {
  binNumber: number;
  observationCount: number;
  upRate: number;
}

/**
 * The ROC curve a set of equal-count score bins implies, walking from the highest-scoring bin down. Ties inside
 * a bin count half, which is what the straight segment across the bin does. Positives per bin are the landed
 * `up_rate` times the bin's count, rounded (the landed rate is an exact count divided by the count).
 */
export function rocFromBins(bins: readonly BinCounts[]): RocFromBins {
  const descending = [...bins].sort((a, b) => b.binNumber - a.binNumber);
  const positives = descending.map((bin) => Math.round(bin.upRate * bin.observationCount));
  const negatives = descending.map((bin, index) => bin.observationCount - (positives[index] as number));
  const positiveTotal = positives.reduce((a, b) => a + b, 0);
  const negativeTotal = negatives.reduce((a, b) => a + b, 0);
  const steps: RocStep[] = [];
  let cumulativePositive = 0;
  let cumulativeNegative = 0;
  let cumulativeArea = 0;
  for (let index = 0; index < descending.length; index += 1) {
    const previousTrue = positiveTotal > 0 ? cumulativePositive / positiveTotal : 0;
    const previousFalse = negativeTotal > 0 ? cumulativeNegative / negativeTotal : 0;
    cumulativePositive += positives[index] as number;
    cumulativeNegative += negatives[index] as number;
    const truePositiveRate = positiveTotal > 0 ? cumulativePositive / positiveTotal : 0;
    const falsePositiveRate = negativeTotal > 0 ? cumulativeNegative / negativeTotal : 0;
    const area = (falsePositiveRate - previousFalse) * (previousTrue + truePositiveRate) / 2;
    cumulativeArea += area;
    steps.push({
      step: index + 1,
      binNumber: (descending[index] as BinCounts).binNumber,
      positiveCount: positives[index] as number,
      negativeCount: negatives[index] as number,
      truePositiveRate,
      falsePositiveRate,
      previousTruePositiveRate: previousTrue,
      previousFalsePositiveRate: previousFalse,
      area,
      cumulativeArea,
    });
  }
  return { positiveTotal, negativeTotal, steps, areaUnderCurve: cumulativeArea };
}

// ------------------------------------------------------------------ statistics across bins

function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(values.length).fill(0);
  let start = 0;
  while (start < order.length) {
    let stop = start;
    while (stop < order.length && (order[stop] as { value: number }).value === (order[start] as { value: number }).value) stop += 1;
    const rank = (start + stop - 1) / 2 + 1;
    for (let position = start; position < stop; position += 1) out[(order[position] as { index: number }).index] = rank;
    start = stop;
  }
  return out;
}

/** Spearman rank correlation of two equal-length series; null when either has no spread. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (rx[i] as number) - mx;
    const dy = (ry[i] as number) - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export interface BinSpread {
  /** Mean return of the highest-scoring bin minus the lowest, in ATR multiples, with its 95% half-width. */
  difference: number;
  halfWidth: number;
  top: number;
  bottom: number;
}

/** Top-bin minus bottom-bin mean return, treating the two bins as independent samples. */
export function topMinusBottom(bins: readonly ScoreBinRow[]): BinSpread | null {
  if (bins.length < 2) return null;
  const sorted = [...bins].sort((a, b) => a.bin_number - b.bin_number);
  const bottom = sorted[0] as ScoreBinRow;
  const top = sorted[sorted.length - 1] as ScoreBinRow;
  const variance = top.mean_return_standard_error_atr_multiples ** 2 + bottom.mean_return_standard_error_atr_multiples ** 2;
  return {
    difference: top.mean_return_atr_multiples - bottom.mean_return_atr_multiples,
    halfWidth: 1.959963984540054 * Math.sqrt(variance),
    top: top.mean_return_atr_multiples,
    bottom: bottom.mean_return_atr_multiples,
  };
}

/** Bins whose Wilson interval excludes the base rate: how many of k look different from a coin weighted to the base rate. */
export function binsOutsideBaseRate(bins: readonly ScoreBinRow[]): number {
  return bins.filter((bin) => bin.up_rate_interval_low > bin.base_up_rate || bin.up_rate_interval_high < bin.base_up_rate).length;
}

// ------------------------------------------------------------------ first-layer filters

export interface FilterTile {
  filterNumber: number;
  /** weights[priceRow - 1][timeColumn - 1]. */
  weights: number[][];
  /** Euclidean length of the 15 weights: how strongly the filter responds to anything. */
  norm: number;
  mean: number;
  positiveShare: number;
}

export function filterTiles(rows: readonly FilterWeightRow[]): FilterTile[] {
  const byFilter = new Map<number, FilterWeightRow[]>();
  for (const row of rows) {
    const list = byFilter.get(row.filter_number) ?? [];
    list.push(row);
    byFilter.set(row.filter_number, list);
  }
  const tiles: FilterTile[] = [];
  for (const [filterNumber, cells] of [...byFilter.entries()].sort((a, b) => a[0] - b[0])) {
    const priceRows = Math.max(...cells.map((cell) => cell.price_row));
    const timeColumns = Math.max(...cells.map((cell) => cell.time_column));
    const weights = Array.from({ length: priceRows }, () => new Array<number>(timeColumns).fill(0));
    for (const cell of cells) (weights[cell.price_row - 1] as number[])[cell.time_column - 1] = cell.weight;
    const flat = cells.map((cell) => cell.weight);
    tiles.push({
      filterNumber,
      weights,
      norm: Math.sqrt(flat.reduce((total, value) => total + value * value, 0)),
      mean: flat.reduce((a, b) => a + b, 0) / flat.length,
      positiveShare: flat.filter((value) => value > 0).length / flat.length,
    });
  }
  return tiles;
}
