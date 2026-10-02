/**
 * From bars to a tensor: the response bodies of GET /api/studies/quant-bars-to-tensor
 * and the pure compute the handler and the page share. It replaces
 * Trading/quantlab/notebooks/transformer_pipeline.py and reproduces
 * quantlab's own src/quant/data.py, function for function:
 *
 *   distribution()          data.distribution  (sample SD with n-1, mixed-estimator skewness and kurtosis)
 *   splitWalkForward()      data.split_walk_forward (70/30, purge = sequence length + normalization window)
 *   persistenceBaseline()   data.persistence_baseline
 *
 * The trailing z-score itself runs in DuckDB (window aggregates with a count
 * guard, see the handler), so the lake does the heavy scan and this file only
 * holds what is cheap and checkable.
 */

export const ROOTS = ["MNQ", "MES", "ES", "NQ", "MYM", "M2K", "YM", "RTY"] as const;
export type Root = (typeof ROOTS)[number];

/** The per-bar feature vector, in quantlab's order (src/quant/data.py FEATURE_NAMES). */
export const FEATURE_NAMES = [
  "log_return_close",
  "body_fraction_of_range",
  "upper_wick_fraction_of_range",
  "lower_wick_fraction_of_range",
  "normalized_range",
  "log_volume_change",
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

export const FEATURE_DESCRIPTIONS: Record<FeatureName, string> = {
  log_return_close: "log(close / previous close): the bar's signed move",
  body_fraction_of_range: "(close - open) / (high - low): body as a signed share of the bar",
  upper_wick_fraction_of_range: "(high - max(open, close)) / (high - low): rejection above",
  lower_wick_fraction_of_range: "(min(open, close) - low) / (high - low): rejection below",
  normalized_range: "(high - low) / close: the bar's height, scale-free",
  log_volume_change: "log((volume + 1) / (previous volume + 1)): the surge in participation",
};

export const RAW_BAR_COLUMNS = ["open", "high", "low", "close", "volume"] as const;

export const TARGET_NAME = "next_log_return_close";

/** Fraction of windows that train; the rest, after the purge, validate (quantlab's default). */
export const TRAIN_FRACTION = 0.7;

/** A trailing window with a standard deviation at or below this has nothing to scale by. */
export const FLAT_WINDOW_STANDARD_DEVIATION = 1e-12;

/** Fine histogram resolution the server sends; the page merges adjacent bins to re-bin. */
export const HISTOGRAM_FINE_BIN_COUNT = 120;
/** Bin counts that divide the fine resolution exactly. */
export const HISTOGRAM_BIN_CHOICES = [10, 12, 15, 20, 24, 30, 40, 60, 120] as const;

// ── response bodies ────────────────────────────────────────────────────────

export interface DistributionSummary {
  count: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  skewness: number | null;
  kurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  minimum: number | null;
  maximum: number | null;
}

/** A 120-bin histogram over [lower, upper]; values outside are counted, not binned. */
export interface FineHistogram {
  lower: number;
  upper: number;
  counts: number[];
  below: number;
  above: number;
}

export type PipelineStage = "raw bars" | "feature vector" | "z-scored features" | "windowed target";

export interface ColumnPanel {
  name: string;
  stage: PipelineStage;
  description: string;
  summary: DistributionSummary;
  histogram: FineHistogram | null;
}

export interface ContractSpan {
  contractSymbol: string;
  firstTimestampMs: number;
  lastTimestampMs: number;
  barCount: number;
}

export interface TimelinePoint {
  timestampMs: number;
  close: number;
  /** Share of the bucket's bars that survive into a window (all six z-scores known), 0 to 1. */
  usableShare: number;
  contractSymbol: string;
}

export interface SplitSummary {
  trainEnd: number;
  purgeWindowCount: number;
  validationStart: number;
  trainWindowCount: number;
  validationWindowCount: number;
  /** The purge the notebook actually applied: sequence length + 256, whatever the slider said. */
  notebookPurgeWindowCount: number;
  trainEndTimestampMs: number | null;
  validationStartTimestampMs: number | null;
}

export interface BaselineSummary {
  zeroPredictionMeanSquaredError: number;
  persistenceMeanSquaredError: number;
  targetVariance: number;
  /** Multiplier that puts the z-scored last return back on the target's scale (the notebook's quirk). */
  persistenceScale: number;
  /** Least-squares copy of the last return with no intercept; not in the notebook. */
  bestScaledCopyMeanSquaredError: number;
  bestScaledCopyScale: number;
  /** Pearson correlation of the z-scored last return with the next return, over validation windows. */
  lastReturnCorrelation: number | null;
  validationWindowCount: number;
}

export interface TensorSummary {
  windowCount: number;
  sequenceLength: number;
  featureCount: number;
  /** Windows whose rows (or target bar) are not adjacent raw bars because a dropped row sits between them. */
  windowsSpanningDroppedRows: number;
  defaultWindowIndex: number;
}

export interface SummaryBody {
  part: "summary";
  landed: boolean;
  root: string;
  startDate: string;
  endDate: string;
  normalizationWindow: number;
  sequenceLength: number;
  bars: {
    count: number;
    firstTimestampMs: number | null;
    lastTimestampMs: number | null;
    contracts: ContractSpan[];
    zeroRangeBarCount: number;
    rawBarCountBeforeRoll: number;
  } | null;
  normalization: {
    droppedRowCount: number;
    usableRowCount: number;
    /** The first rows, before any trailing window is full. */
    warmupRowCount: number;
    /** Dropped after warmup because a trailing window held an unknown (a zero-range bar) or no spread. */
    unknownInsideWindowCount: number;
  } | null;
  stages: ColumnPanel[];
  timeline: TimelinePoint[];
  tensor: TensorSummary | null;
  split: SplitSummary | null;
  baseline: BaselineSummary | null;
}

export interface WindowLastBar {
  timestampMs: number;
  contractSymbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  previousClose: number | null;
  previousVolume: number | null;
  /** The six features of this bar before the z-score, in FEATURE_NAMES order (null when unknown). */
  featureValues: Array<number | null>;
  /** Trailing mean over the normalization window, per feature. */
  trailingMean: Array<number | null>;
  /** Trailing population standard deviation over the normalization window, per feature. */
  trailingStandardDeviation: Array<number | null>;
  /** The normalization window's raw values per feature, oldest first, ending on this bar (null when any is unknown). */
  trailingValues: Array<number[] | null>;
  /** The z-score the window carries for this bar, per feature. */
  zscores: Array<number | null>;
}

/** A window cannot be shown: no bars in the range, or too few usable rows for one window and its target. */
export interface WindowUnavailable {
  part: "window";
  landed: false;
}

export interface WindowBody {
  part: "window";
  landed: true;
  windowIndex: number;
  windowCount: number;
  sequenceLength: number;
  partition: "train" | "purge" | "validation";
  /** z-scored values, one row per position in the window, six features each. */
  values: number[][];
  timestampsMs: number[];
  /** Position of each row in the continuous bar series (consecutive unless a dropped row intervenes). */
  barIndexes: number[];
  contiguous: boolean;
  endTimestampMs: number;
  endClose: number;
  targetTimestampMs: number;
  targetClose: number;
  targetLogReturn: number;
  lastBar: WindowLastBar;
  /** This window's terms of the two baseline sums; null unless the window is a validation window. */
  errorTerms: { lastReturnZscore: number; zeroSquaredError: number; persistenceSquaredError: number } | null;
  baselineScale: number | null;
}

export interface BarRow {
  barIndex: number;
  timestampMs: number;
  contractSymbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarsBody {
  part: "bars";
  landed: boolean;
  offset: number;
  total: number;
  rows: BarRow[];
}

export type QuantBarsToTensorBody = SummaryBody | WindowBody | WindowUnavailable | BarsBody;

// ── numeric primitives ─────────────────────────────────────────────────────

function finiteOnly(values: ArrayLike<number>): Float64Array {
  const out = new Float64Array(values.length);
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (Number.isFinite(value)) {
      out[count] = value;
      count += 1;
    }
  }
  return out.slice(0, count);
}

/** numpy's default percentile: linear interpolation between order statistics. */
export function percentileOfSorted(sorted: ArrayLike<number>, percent: number): number {
  const count = sorted.length;
  if (count === 0) return Number.NaN;
  const position = (percent / 100) * (count - 1);
  const low = Math.floor(position);
  const high = Math.min(low + 1, count - 1);
  const fraction = position - low;
  return (sorted[low] as number) + ((sorted[high] as number) - (sorted[low] as number)) * fraction;
}

function nullable(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/**
 * The eight numbers exactly as quantlab's data.distribution computes them:
 * the standard deviation divides by n - 1; skewness is mean(d^3) / sd^3 and
 * kurtosis is mean(d^4) / sd^4 - 3 with that same n - 1 standard deviation;
 * below 3 and 4 observations those two are unknown (null), never omitted.
 */
export function distribution(values: ArrayLike<number>): DistributionSummary {
  const clean = finiteOnly(values);
  const count = clean.length;
  if (count === 0) {
    return { count: 0, mean: null, median: null, standardDeviation: null, skewness: null, kurtosis: null, percentile25: null, percentile75: null, minimum: null, maximum: null };
  }
  let total = 0;
  for (let i = 0; i < count; i += 1) total += clean[i] as number;
  const mean = total / count;
  let squares = 0;
  let cubes = 0;
  let fourths = 0;
  for (let i = 0; i < count; i += 1) {
    const deviation = (clean[i] as number) - mean;
    const square = deviation * deviation;
    squares += square;
    cubes += square * deviation;
    fourths += square * square;
  }
  const standardDeviation = count > 1 ? Math.sqrt(squares / (count - 1)) : Number.NaN;
  const usable = Number.isFinite(standardDeviation) && standardDeviation !== 0;
  const skewness = count > 2 && usable ? cubes / count / standardDeviation ** 3 : Number.NaN;
  const kurtosis = count > 3 && usable ? fourths / count / standardDeviation ** 4 - 3 : Number.NaN;
  clean.sort();
  return {
    count,
    mean: nullable(mean),
    median: nullable(percentileOfSorted(clean, 50)),
    standardDeviation: nullable(standardDeviation),
    skewness: nullable(skewness),
    kurtosis: nullable(kurtosis),
    percentile25: nullable(percentileOfSorted(clean, 25)),
    percentile75: nullable(percentileOfSorted(clean, 75)),
    minimum: nullable(clean[0] as number),
    maximum: nullable(clean[count - 1] as number),
  };
}

/** A fine histogram over the 0.1th to 99.9th percentile, so one outlier cannot flatten the picture. */
export function fineHistogram(values: ArrayLike<number>, binCount = HISTOGRAM_FINE_BIN_COUNT): FineHistogram | null {
  const clean = finiteOnly(values);
  if (clean.length === 0) return null;
  const sorted = clean.slice().sort();
  let lower = percentileOfSorted(sorted, 0.1);
  let upper = percentileOfSorted(sorted, 99.9);
  if (!(upper > lower)) {
    lower = sorted[0] as number;
    upper = sorted[sorted.length - 1] as number;
  }
  if (!(upper > lower)) {
    lower -= 0.5;
    upper += 0.5;
  }
  const counts = new Array<number>(binCount).fill(0);
  const width = (upper - lower) / binCount;
  let below = 0;
  let above = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = clean[i] as number;
    if (value < lower) below += 1;
    else if (value > upper) above += 1;
    else {
      const bin = Math.min(binCount - 1, Math.floor((value - lower) / width));
      counts[bin] = (counts[bin] as number) + 1;
    }
  }
  return { lower, upper, counts, below, above };
}

/** Merge adjacent fine bins into `binCount` bins (binCount must divide the fine count). */
export function mergeBins(counts: readonly number[], binCount: number): number[] {
  if (binCount <= 0 || counts.length % binCount !== 0) return [...counts];
  const factor = counts.length / binCount;
  const merged = new Array<number>(binCount).fill(0);
  for (let i = 0; i < counts.length; i += 1) {
    const bin = Math.floor(i / factor);
    merged[bin] = (merged[bin] as number) + (counts[i] as number);
  }
  return merged;
}

// ── the tensor's bookkeeping ───────────────────────────────────────────────

/** Indices of the rows whose six z-scores are all known (notebook: normalized.dropna(subset=FEATURE_NAMES)). */
export function usableRowIndices(zscores: readonly ArrayLike<number>[], rowCount: number): Int32Array {
  const out = new Int32Array(rowCount);
  let count = 0;
  for (let row = 0; row < rowCount; row += 1) {
    let known = true;
    for (const column of zscores) {
      if (!Number.isFinite(column[row] as number)) {
        known = false;
        break;
      }
    }
    if (known) {
      out[count] = row;
      count += 1;
    }
  }
  return out.slice(0, count);
}

/** Windows of `sequenceLength` over `usableCount` rows, the last one dropped because no bar follows it. */
export function windowCountFor(usableCount: number, sequenceLength: number): number {
  return usableCount < sequenceLength + 2 ? 0 : usableCount - sequenceLength;
}

/** Window i's target: the log return on the usable row right after its last row (data.window_into_tensor). */
export function windowTargets(usable: Int32Array, close: ArrayLike<number>, sequenceLength: number): Float64Array {
  const count = windowCountFor(usable.length, sequenceLength);
  const targets = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const endClose = close[usable[i + sequenceLength - 1] as number] as number;
    const targetClose = close[usable[i + sequenceLength] as number] as number;
    targets[i] = Math.log(targetClose / endClose);
  }
  return targets;
}

/** Windows (rows plus the target bar) with a dropped raw row somewhere between two of their usable rows. */
export function windowsSpanningDroppedRows(usable: Int32Array, sequenceLength: number): number {
  const count = windowCountFor(usable.length, sequenceLength);
  if (count === 0) return 0;
  const gapPrefix = new Int32Array(usable.length);
  for (let k = 0; k + 1 < usable.length; k += 1) {
    gapPrefix[k + 1] = (gapPrefix[k] as number) + ((usable[k + 1] as number) - (usable[k] as number) !== 1 ? 1 : 0);
  }
  let spanning = 0;
  for (let i = 0; i < count; i += 1) {
    // pairs k = i .. i + sequenceLength - 1 connect rows i .. i + sequenceLength
    if ((gapPrefix[i + sequenceLength] as number) - (gapPrefix[i] as number) > 0) spanning += 1;
  }
  return spanning;
}

export interface WalkForwardSplit {
  trainEnd: number;
  purge: number;
  validationStart: number;
  trainWindowCount: number;
  validationWindowCount: number;
}

/**
 * Chronological split with a purge gap, never shuffled (data.split_walk_forward).
 * The purge covers both overlaps: adjacent windows share sequenceLength - 1 rows,
 * and every row's z-score looked back normalizationWindow bars, so the default
 * is their sum. The notebook called it without normalizationWindow, so its
 * purge stayed at sequenceLength + 256 whatever the slider said; this takes the
 * slider's value, which is what the function's own docstring intends.
 */
export function splitWalkForward(total: number, sequenceLength: number, normalizationWindow: number, trainFraction = TRAIN_FRACTION): WalkForwardSplit {
  const purge = sequenceLength + normalizationWindow;
  const trainEnd = Math.trunc(total * trainFraction);
  const validationStart = Math.min(trainEnd + purge, total);
  return { trainEnd, purge, validationStart, trainWindowCount: trainEnd, validationWindowCount: total - validationStart };
}

function populationStandardDeviation(values: ArrayLike<number>): number {
  const count = values.length;
  if (count === 0) return Number.NaN;
  let total = 0;
  for (let i = 0; i < count; i += 1) total += values[i] as number;
  const mean = total / count;
  let squares = 0;
  for (let i = 0; i < count; i += 1) {
    const deviation = (values[i] as number) - mean;
    squares += deviation * deviation;
  }
  return Math.sqrt(squares / count);
}

/**
 * What copying the last observed return scores (data.persistence_baseline).
 * The window is z-scored, so the copy is put back on the target's scale with
 * std(target) / std(last return), a scale taken from the very targets it is
 * scored on (the notebook's quirk, kept so the numbers match). The
 * least-squares copy is added beside it as the best any copy could do.
 */
export function persistenceBaseline(lastReturns: ArrayLike<number>, targets: ArrayLike<number>): BaselineSummary | null {
  const count = targets.length;
  if (count === 0 || lastReturns.length !== count) return null;
  const targetStd = populationStandardDeviation(targets);
  const lastStd = populationStandardDeviation(lastReturns);
  const scale = targetStd / Math.max(lastStd, 1e-12);
  let persistenceSquares = 0;
  let zeroSquares = 0;
  let crossProduct = 0;
  let lastSquares = 0;
  let targetTotal = 0;
  let lastTotal = 0;
  for (let i = 0; i < count; i += 1) {
    const last = lastReturns[i] as number;
    const target = targets[i] as number;
    const error = last * scale - target;
    persistenceSquares += error * error;
    zeroSquares += target * target;
    crossProduct += last * target;
    lastSquares += last * last;
    targetTotal += target;
    lastTotal += last;
  }
  const targetMean = targetTotal / count;
  let varianceSquares = 0;
  for (let i = 0; i < count; i += 1) {
    const deviation = (targets[i] as number) - targetMean;
    varianceSquares += deviation * deviation;
  }
  const bestScale = lastSquares > 0 ? crossProduct / lastSquares : 0;
  let bestSquares = 0;
  for (let i = 0; i < count; i += 1) {
    const error = (lastReturns[i] as number) * bestScale - (targets[i] as number);
    bestSquares += error * error;
  }
  const lastMean = lastTotal / count;
  let covariance = 0;
  for (let i = 0; i < count; i += 1) covariance += ((lastReturns[i] as number) - lastMean) * ((targets[i] as number) - targetMean);
  const correlation = lastStd > 0 && targetStd > 0 ? covariance / count / (lastStd * targetStd) : Number.NaN;
  return {
    zeroPredictionMeanSquaredError: zeroSquares / count,
    persistenceMeanSquaredError: persistenceSquares / count,
    targetVariance: varianceSquares / count,
    persistenceScale: scale,
    bestScaledCopyMeanSquaredError: bestSquares / count,
    bestScaledCopyScale: bestScale,
    lastReturnCorrelation: nullable(correlation),
    validationWindowCount: count,
  };
}

/** Trailing mean and population standard deviation of `values[end - window + 1 .. end]`, null when any is unknown. */
export function trailingMoments(values: ArrayLike<number>, end: number, window: number): { mean: number; standardDeviation: number } | null {
  const start = end - window + 1;
  if (start < 0) return null;
  let total = 0;
  for (let i = start; i <= end; i += 1) {
    const value = values[i] as number;
    if (!Number.isFinite(value)) return null;
    total += value;
  }
  const mean = total / window;
  let squares = 0;
  for (let i = start; i <= end; i += 1) {
    const deviation = (values[i] as number) - mean;
    squares += deviation * deviation;
  }
  return { mean, standardDeviation: Math.sqrt(squares / window) };
}
