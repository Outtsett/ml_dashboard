/**
 * Path geometry study: the response body of GET /api/studies/path-geometry-study
 * and the pure arithmetic the page and the server share.
 *
 * Sections 1 to 3 measure the efficiency ratio (net displacement over path
 * length) on MNQ 1m bars read live from the lake; section 4 shows the landed
 * forecasting results (four targets, all null); section 5 lines the direction
 * label up with the bars it describes.
 */

// ── constants the server and the page agree on ─────────────────────────────

export const DEFAULT_WINDOWS = [15, 60, 240, 1440] as const;
export const SELECTABLE_WINDOWS = [5, 15, 30, 60, 120, 240, 480, 1440] as const;
/** er x sqrt(W) is histogrammed over [0, HISTOGRAM_LIMIT] in HISTOGRAM_BINS bins (the notebook's 120 bins over [0, 4]). */
export const HISTOGRAM_BINS = 120;
export const HISTOGRAM_LIMIT = 4;
/** The forward move is histogrammed over [-DELTA_LIMIT, DELTA_LIMIT] points in DELTA_BINS bins. */
export const DELTA_LIMIT = 150;
export const DELTA_BINS = 200;
/** Rows of the thinned bar frame sent for the per-column graphics. */
export const FRAME_ROWS = 4000;
/** The four forecast targets, in the notebook's glob order. */
export const TARGETS = ["fwd_abs_tbeta", "fwd_er_vs_rw", "fwd_r2", "fwd_tbeta"] as const;
export type Target = (typeof TARGETS)[number];
export const TARGET_MEANING: Record<Target, string> = {
  fwd_er_vs_rw: "forward efficiency ratio x sqrt(W): does a straight hour follow a straight hour?",
  fwd_tbeta: "forward signed slope t-statistic (the control: a driftless walk should fail it)",
  fwd_r2: "forward regression R-squared: how line-like the next hour is",
  fwd_abs_tbeta: "forward absolute slope t-statistic: how strong the next hour's trend is, either way",
};

// ── body types ─────────────────────────────────────────────────────────────

export interface Distribution {
  count: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  skewness: number | null;
  kurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  percentile95: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface WindowStatistics {
  window: number;
  /** 1 / sqrt(W): the efficiency ratio of a driftless random walk. */
  nullRatio: number;
  efficiency: Distribution;
  normalized: Distribution;
}

export interface WindowHistogram {
  window: number;
  /** Values inside [0, HISTOGRAM_LIMIT]; counts sum to this. */
  inRangeCount: number;
  counts: number[];
}

export interface ExtremeWindow {
  /** Index of the window's last bar within the loaded bars (0-based). */
  index: number;
  timestampMs: number;
  efficiency: number;
  /** The W + 1 closes the window spans, oldest first. */
  closes: number[];
  timestamps: number[];
}

export interface Extremes {
  window: number;
  straightest: ExtremeWindow | null;
  choppiest: ExtremeWindow | null;
}

export interface BarsInView {
  requested: number;
  loaded: number;
  /** Bars in the source that pass the loader's filters (volume > 0, prices > 0). */
  available: number;
  firstMs: number | null;
  lastMs: number | null;
}

export interface LabelSummary {
  horizon: number;
  flatThreshold: number;
  barCount: number;
  finiteCount: number;
  upCount: number;
  downCount: number;
  flatCount: number;
  /** Bars whose last `horizon` positions have no future (must be unlabelled). */
  tailLabelledCount: number;
  /** Labelled bars where the label (by lead) disagrees with the re-derivation (by position join). */
  alignmentChecked: number;
  alignmentMismatches: number;
  /** The same comparison against a label shifted one bar further (must disagree somewhere). */
  offByOneChecked: number;
  offByOneMismatches: number;
  medianAbsoluteMove: number | null;
  /** Candle colour against arrow at the show horizon, every labelled bar. */
  showHorizon: number;
  agreementChecked: number;
  agreementCount: number;
}

export interface HourRate {
  hour: number;
  count: number;
  upCount: number;
}

export interface LakeLabelCheck {
  recipe: string;
  horizon: number;
  directionalChecked: number;
  signDisagreements: number;
}

export interface SliceBars {
  /** 0-based index within the loaded bars of the first row. */
  startIndex: number;
  /** [timestampMs, open, high, low, close] */
  rows: Array<[number, number, number, number, number]>;
}

export interface TargetRow {
  target: string;
  horizon_bars: number;
  training_row_count: number;
  feature_count: number;
  fold_count: number;
  purge_bars: number;
  fold_months: number;
  verdict_best_model: string;
  verdict_beats_baseline_fold_level: boolean;
  verdict_beats_baseline_bar_level: boolean;
  verdict_persistence_r_squared: number;
  verdict_note: string;
  persistence_r_squared_median: number;
  persistence_information_coefficient_median: number;
  train_mean_r_squared_median: number;
  ridge_r_squared_median: number;
  ridge_information_coefficient_median: number;
  ridge_skill_median: number;
  ridge_skill_fold_interval_low: number | null;
  ridge_skill_fold_interval_high: number | null;
  ridge_folds_with_positive_skill: number;
  ridge_diebold_mariano_mean_loss_differential: number | null;
  ridge_diebold_mariano_interval_low: number | null;
  ridge_diebold_mariano_interval_high: number | null;
  ridge_diebold_mariano_block_length: number | null;
  ridge_diebold_mariano_effective_sample_size: number | null;
  ridge_diebold_mariano_beats_baseline: boolean | null;
  gradient_boosting_r_squared_median: number;
  gradient_boosting_information_coefficient_median: number;
  gradient_boosting_skill_median: number;
  gradient_boosting_skill_fold_interval_low: number | null;
  gradient_boosting_skill_fold_interval_high: number | null;
  gradient_boosting_folds_with_positive_skill: number;
  gradient_boosting_diebold_mariano_mean_loss_differential: number | null;
  gradient_boosting_diebold_mariano_interval_low: number | null;
  gradient_boosting_diebold_mariano_interval_high: number | null;
  gradient_boosting_diebold_mariano_block_length: number | null;
  gradient_boosting_diebold_mariano_effective_sample_size: number | null;
  gradient_boosting_diebold_mariano_beats_baseline: boolean | null;
  [column: string]: unknown;
}

export interface FoldRow {
  target: string;
  fold: number;
  training_row_count: number;
  test_row_count: number;
  persistence_r_squared: number;
  train_mean_r_squared: number;
  baseline_r_squared: number;
  persistence_information_coefficient: number;
  persistence_target_correlation: number;
  baseline_used: string;
  ridge_r_squared: number;
  ridge_information_coefficient: number;
  ridge_skill: number;
  gradient_boosting_r_squared: number;
  gradient_boosting_information_coefficient: number;
  gradient_boosting_skill: number;
  [column: string]: unknown;
}

export interface PathGeometryBody {
  bars: BarsInView;
  windows: number[];
  statistics: WindowStatistics[];
  histograms: WindowHistogram[];
  extremes: Extremes;
  /** Thinned bar frame for the per-column graphics: one object per sampled bar, full-word keys. */
  frame: { step: number; rows: Array<Record<string, number | null>> };
  labels: LabelSummary | null;
  hourRates: HourRate[];
  deltaCounts: number[];
  lakeLabelCheck: LakeLabelCheck | null;
  slice: SliceBars | null;
  targets: TargetRow[];
  folds: FoldRow[];
}

export function emptyBody(): PathGeometryBody {
  return {
    bars: { requested: 0, loaded: 0, available: 0, firstMs: null, lastMs: null },
    windows: [],
    statistics: [],
    histograms: [],
    extremes: { window: 0, straightest: null, choppiest: null },
    frame: { step: 1, rows: [] },
    labels: null,
    hourRates: [],
    deltaCounts: [],
    lakeLabelCheck: null,
    slice: null,
    targets: [],
    folds: [],
  };
}

// ── pure arithmetic ────────────────────────────────────────────────────────

/** The efficiency ratio of a driftless random walk over W steps: sigma cancels, leaving 1 / sqrt(W). */
export function randomWalkNull(window: number): number {
  return 1 / Math.sqrt(window);
}

/** E|net| = sigma sqrt(2W/pi) and E[path] = W sigma sqrt(2/pi) for a driftless walk with step deviation sigma. */
export function randomWalkExpectations(window: number, sigma: number): { net: number; path: number; ratio: number } {
  const net = sigma * Math.sqrt((2 * window) / Math.PI);
  const path = window * sigma * Math.sqrt(2 / Math.PI);
  return { net, path, ratio: net / path };
}

export interface WindowGeometry {
  /** |ln p_t - ln p_{t-W}|: how far price got. */
  net: number;
  /** sum |ln p_i - ln p_{i-1}|: how far price travelled. */
  path: number;
  /** net / path, or null when the path is (numerically) zero. */
  efficiency: number | null;
  /** efficiency x sqrt(W). */
  normalized: number | null;
}

const EPSILON = 1e-12;

/** net, path and ratio for the window spanned by `closes` (W + 1 closes = W log steps). */
export function windowGeometry(closes: readonly number[]): WindowGeometry | null {
  if (closes.length < 2) return null;
  const steps = closes.length - 1;
  let path = 0;
  for (let i = 1; i < closes.length; i += 1) path += Math.abs(Math.log(closes[i] as number) - Math.log(closes[i - 1] as number));
  const net = Math.abs(Math.log(closes[closes.length - 1] as number) - Math.log(closes[0] as number));
  const efficiency = path > EPSILON ? net / path : null;
  return { net, path, efficiency, normalized: efficiency === null ? null : efficiency * Math.sqrt(steps) };
}

/** The trailing efficiency ratio at every bar (null for the first W bars), as the notebook's `efficiency_ratio`. */
export function efficiencySeries(closes: readonly number[], window: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (window < 1 || closes.length <= window) return out;
  const logs = closes.map((value) => Math.log(value));
  const steps = logs.map((value, i) => (i === 0 ? Number.NaN : Math.abs(value - (logs[i - 1] as number))));
  let path = 0;
  for (let i = 1; i <= window; i += 1) path += steps[i] as number;
  for (let i = window; i < closes.length; i += 1) {
    if (i > window) path += (steps[i] as number) - (steps[i - window] as number);
    const net = Math.abs((logs[i] as number) - (logs[i - window] as number));
    out[i] = path > EPSILON ? net / path : null;
  }
  return out;
}

export interface ForwardLabels {
  /** 1 when close[t+H] > close[t], 0 when lower or equal, null when unlabelled. */
  labels: Array<0 | 1 | null>;
  /** close[t+H] - close[t] rounded to 32 bits as the labeller does, null in the last H bars. */
  delta: Array<number | null>;
}

/**
 * The project's `generate_direction_labels`: label = 1 if close[t+H] > close[t],
 * null in the last H bars and (when flatThreshold > 0) where |delta| < threshold.
 */
export function forwardLabels(closes: readonly number[], horizon: number, flatThreshold = 0): ForwardLabels {
  const count = closes.length;
  const labels: Array<0 | 1 | null> = new Array(count).fill(null);
  const delta: Array<number | null> = new Array(count).fill(null);
  for (let i = 0; i + horizon < count; i += 1) {
    const move = Math.fround((closes[i + horizon] as number) - (closes[i] as number));
    delta[i] = move;
    if (flatThreshold > 0 && Math.abs(move) < flatThreshold) continue;
    labels[i] = move > 0 ? 1 : 0;
  }
  return { labels, delta };
}

/** Whether a bar's own colour (close >= open is up) agrees with its label, over the labelled bars. */
export function candleAgreement(opens: readonly number[], closes: readonly number[], labels: ReadonlyArray<0 | 1 | null>): { checked: number; agreeing: number } {
  let checked = 0;
  let agreeing = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    if (label === null || label === undefined) continue;
    checked += 1;
    if (((closes[i] as number) >= (opens[i] as number)) === (label === 1)) agreeing += 1;
  }
  return { checked, agreeing };
}

/** Density from counts in equal-width bins: counts / (in-range total x bin width). */
export function densityFromCounts(counts: readonly number[], binWidth: number): number[] {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || binWidth <= 0) return counts.map(() => 0);
  return counts.map((value) => value / (total * binWidth));
}

/** Merge runs of `factor` adjacent bins (the counts length must be divisible). */
export function mergeBins(counts: readonly number[], factor: number): number[] {
  if (factor <= 1) return [...counts];
  const out: number[] = [];
  for (let i = 0; i < counts.length; i += factor) {
    let sum = 0;
    for (let j = i; j < Math.min(i + factor, counts.length); j += 1) sum += counts[j] as number;
    out.push(sum);
  }
  return out;
}

/**
 * A symmetric-log axis transform with matplotlib's semantics (base 10,
 * linscale 1): linear inside +-linthresh, logarithmic outside. Used to draw
 * intervals that span zero and sit five orders of magnitude apart.
 */
export function symlog(value: number, linthresh = 1e-4): number {
  const scale = 1 / (1 - 1 / 10);
  const magnitude = Math.abs(value);
  if (magnitude <= linthresh) return (value / linthresh) * scale;
  return Math.sign(value) * (scale + Math.log10(magnitude / linthresh));
}

/** The value a symlog coordinate stands for (inverse of `symlog`). */
export function inverseSymlog(coordinate: number, linthresh = 1e-4): number {
  const scale = 1 / (1 - 1 / 10);
  const magnitude = Math.abs(coordinate);
  if (magnitude <= scale) return (coordinate / scale) * linthresh;
  return Math.sign(coordinate) * linthresh * 10 ** (magnitude - scale);
}

/** Where a confidence interval sits against zero, in words the verdict uses. */
export function intervalVerdict(low: number | null, high: number | null): "below zero" | "above zero" | "spans zero" | "missing" {
  if (low === null || high === null) return "missing";
  if (high < 0) return "below zero";
  if (low > 0) return "above zero";
  return "spans zero";
}

/** The skill of a model over the best trivial predictor, from the three R-squared values. */
export function skillOverBaseline(modelRSquared: number, persistenceRSquared: number, trainMeanRSquared: number): number {
  return modelRSquared - Math.max(persistenceRSquared, trainMeanRSquared);
}

/** An uncorrelated predictor with the target's own mean and variance scores exactly -1. */
export const UNCORRELATED_PERSISTENCE_R_SQUARED = -1;
