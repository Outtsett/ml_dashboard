/**
 * Labels on the candles: the body of GET /api/studies/label-overlay and the
 * pure computation the page and the tests share.
 *
 * The data is Trading/quant/model's shipped MNQ 1-minute label dataset
 * (`mnq_labels_1m`, 2,340,445 rows, 48 label columns) joined one-to-one on
 * timestamp to the bars (`mnq_ohlcv_1m`). Every name below is the full-word
 * alias of a stored column; `LABEL_COLUMNS` is the table that maps them.
 *
 * One defect of the notebook this replaces is fixed here on purpose:
 * `tbl_exit_bar` is an ABSOLUTE row number in the dataset, so the exit of a
 * barrier drawn inside a window is `exit row - the window's first row`. The
 * notebook subtracted `w.index[0]`, which is 0 after `reset_index(drop=True)`,
 * so every exit of a window that did not start at row 0 silently fell back to
 * the vertical-barrier edge.
 */

export const DIRECTION_HORIZONS = [1, 5, 15, 60, 90, 240, 1440] as const;
export const FORWARD_RETURN_HORIZONS = [15, 60, 240, 1440] as const;
export const VOLATILITY_HORIZONS = [1, 5, 15, 60] as const;

export const WINDOW_MODES = ["busiest", "median", "latest", "date"] as const;
export type WindowMode = (typeof WINDOW_MODES)[number];

/** The notebook's constants. */
export const DEFAULT_BARS_PER_WINDOW = 240;
export const DEFAULT_BARRIER_EVERY = 12;
/** The barrier box is drawn this many bars wide: the dataset's vertical barrier (BARRIER.vertical_bars = 5). */
export const BARRIER_BOX_BARS = 5;
/** The box half-height is this multiple of the trailing mean bar range (the notebook's display proxy for 1.5 ATR). */
export const BARRIER_BAND_MULTIPLE = 1.5;
export const BARRIER_BAND_WINDOW_BARS = 14;

// --- the dataset's columns, stored name to full-word name -------------------

export type ColumnKind = "discrete" | "continuous";

export interface LabelColumn {
  /** The column as stored in mnq_labels_1m. */
  stored: string;
  /** The full-word name every response and every page uses. */
  name: string;
  kind: ColumnKind;
  /** What the column holds, in words. */
  meaning: string;
  unit: string;
}

const horizonColumns = (
  stored: (horizon: number) => string,
  name: (horizon: number) => string,
  horizons: readonly number[],
  kind: ColumnKind,
  meaning: (horizon: number) => string,
  unit: string,
): LabelColumn[] => horizons.map((h) => ({ stored: stored(h), name: name(h), kind, meaning: meaning(h), unit }));

export const LABEL_COLUMNS: readonly LabelColumn[] = [
  ...horizonColumns((h) => `dir_h${h}`, (h) => `direction_up_after_${h}_bars`, DIRECTION_HORIZONS, "discrete", (h) => `1 when the close ${h} bars ahead is above this close, else 0`, "class"),
  ...horizonColumns((h) => `dir_delta_pts_h${h}`, (h) => `close_change_points_after_${h}_bars`, DIRECTION_HORIZONS, "continuous", (h) => `close ${h} bars ahead minus this close`, "points"),
  { stored: "range_pts", name: "bar_range_points", kind: "continuous", meaning: "high minus low of this bar", unit: "points" },
  { stored: "zero_range", name: "zero_range_bar", kind: "discrete", meaning: "1 when high equals low (no log range exists; the bar is masked, not floored)", unit: "flag" },
  { stored: "logrange", name: "log_bar_range", kind: "continuous", meaning: "natural log of this bar's range", unit: "log points" },
  ...horizonColumns((h) => `vol_logrange_h${h}`, (h) => `log_bar_range_${h}_bars_ahead`, VOLATILITY_HORIZONS, "continuous", (h) => `log range of the bar ${h} bars ahead (the volatility target)`, "log points"),
  { stored: "rng_bucket_h1", name: "next_bar_range_bucket", kind: "continuous", meaning: "21-bucket class of the next bar's range (10 is the centre)", unit: "bucket" },
  { stored: "tbl_label", name: "triple_barrier_outcome", kind: "discrete", meaning: "+1 take-profit first, -1 stop-loss first, 0 vertical barrier", unit: "class" },
  { stored: "tbl_ret_pts", name: "triple_barrier_return_points", kind: "continuous", meaning: "close at the exit minus close at the entry", unit: "points" },
  { stored: "tbl_exit_bar", name: "triple_barrier_exit_row_number", kind: "continuous", meaning: "ABSOLUTE row number of the exit bar in the dataset (-1 when unresolved)", unit: "row" },
  { stored: "swing_label", name: "next_swing_pivot_direction", kind: "discrete", meaning: "+1 the next confirmed fractal pivot is a high, -1 a low, 0 timeout", unit: "class" },
  { stored: "swing_ret_pts", name: "swing_return_points", kind: "continuous", meaning: "move from this close to the pivot it points at", unit: "points" },
  { stored: "vol_regime", name: "volatility_regime", kind: "discrete", meaning: "causal expanding tercile of trailing volatility: 0 low, 1 middle, 2 high", unit: "class" },
  ...horizonColumns((h) => `fwd_ret_h${h}`, (h) => `forward_log_return_${h}_bars`, FORWARD_RETURN_HORIZONS, "continuous", (h) => `ln(close ${h} bars ahead / this close)`, "log return"),
  ...[60, 240].flatMap((h) => [
    { stored: `fwd_tbeta_h${h}`, name: `forward_trend_t_statistic_${h}_bars`, kind: "continuous" as const, meaning: `t-statistic of the least-squares slope over the next ${h} bars`, unit: "t" },
    { stored: `fwd_r2_h${h}`, name: `forward_trend_r_squared_${h}_bars`, kind: "continuous" as const, meaning: `r-squared of that slope over the next ${h} bars`, unit: "ratio" },
    { stored: `fwd_er_vs_rw_h${h}`, name: `forward_efficiency_ratio_vs_random_walk_${h}_bars`, kind: "continuous" as const, meaning: `net displacement over path length, scaled so a random walk reads 1, next ${h} bars`, unit: "ratio" },
    { stored: `fwd_abs_tbeta_h${h}`, name: `forward_absolute_trend_t_statistic_${h}_bars`, kind: "continuous" as const, meaning: `absolute value of the next-${h}-bar slope t-statistic`, unit: "t" },
  ]),
  ...[10, 60].flatMap((h) => [
    { stored: `fwd_max_range_h${h}`, name: `forward_max_range_${h}_bars`, kind: "continuous" as const, meaning: `highest high minus lowest low over the next ${h} bars`, unit: "points" },
    { stored: `fwd_realized_vol_h${h}`, name: `forward_realized_volatility_${h}_bars`, kind: "continuous" as const, meaning: `realised volatility over the next ${h} bars`, unit: "log return" },
  ]),
  { stored: "meta_armed", name: "meta_label_armed", kind: "discrete", meaning: "1 when the meta-labelling rule fired on this bar (a mask, not a label)", unit: "flag" },
  { stored: "meta_side", name: "meta_label_side", kind: "discrete", meaning: "side the rule took: +1 long, -1 short", unit: "class" },
  { stored: "meta_label", name: "meta_label_outcome", kind: "discrete", meaning: "1 when the rule's take-profit was hit first", unit: "class" },
  { stored: "meta_ret_pts", name: "meta_label_return_points", kind: "continuous", meaning: "realised move of the rule's trade", unit: "points" },
];

export const COLUMN_BY_STORED: ReadonlyMap<string, LabelColumn> = new Map(LABEL_COLUMNS.map((column) => [column.stored, column]));

export const directionColumn = (horizon: number): string => `direction_up_after_${horizon}_bars`;
export const forwardReturnColumn = (horizon: number): string => `forward_log_return_${horizon}_bars`;

// --- response bodies ---------------------------------------------------------

/** One bar of the window with every label the overlays draw, under full-word keys. */
export interface WindowRow {
  /** Absolute 0-based row number in the dataset (the coordinate tbl_exit_bar is in). */
  row_number: number;
  /** Epoch milliseconds. Futures stamps are Pacific wall clock stored as UTC. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  bar_range_points: number | null;
  volatility_regime: number | null;
  next_swing_pivot_direction: number | null;
  triple_barrier_outcome: number | null;
  triple_barrier_exit_row_number: number | null;
  log_bar_range: number | null;
  log_bar_range_1_bars_ahead: number | null;
  zero_range_bar: number | null;
  next_bar_range_bucket: number | null;
  close_change_points_after_1_bars: number | null;
  [column: string]: number | null;
}

export interface WindowChoice {
  /** Row number of the window's first bar. */
  startRow: number;
  startTimestamp: number;
  endTimestamp: number;
  /** Sum of the window's bar ranges, in points (the notebook's "points travelled" is high max - low min; this is the activity score the choice maximises). */
  rollingRangePoints: number | null;
}

export interface WindowBody {
  datasetRows: number;
  barsPerWindow: number;
  mode: WindowMode;
  /** The window actually returned. */
  window: WindowChoice | null;
  rows: WindowRow[];
  /** The two windows the notebook drew, for this bars-per-window. */
  busiest: WindowChoice | null;
  median: WindowChoice | null;
}

export interface AlignmentCheck {
  /** Stored column name (the dataset's own). */
  stored: string;
  name: string;
  /** What it is recomputed as, in words. */
  rule: string;
  tolerance: number | null;
  compared: number;
  mismatches: number;
}

export interface ClassCount {
  value: number | null;
  count: number;
}

export interface ColumnClassBalance {
  stored: string;
  name: string;
  meaning: string;
  counts: ClassCount[];
}

export interface ColumnProfile {
  stored: string;
  name: string;
  meaning: string;
  unit: string;
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
  /** Histogram range: the 0.5th to 99.5th percentile, so one outlier cannot flatten the picture. */
  histogramLow: number;
  histogramHigh: number;
  /** 100 equal bins across [histogramLow, histogramHigh]. */
  bins: number[];
  belowRange: number;
  aboveRange: number;
}

export interface ExitBarAudit {
  resolvedRows: number;
  /** Rows whose tbl_exit_bar is not after their own row number: > 0 would mean the column is relative, not absolute. */
  exitNotAfterEntry: number;
  minimumBarsToExit: number | null;
  maximumBarsToExit: number | null;
  unresolvedRows: number;
}

export interface DatasetBody {
  datasetRows: number;
  barRows: number;
  joinedRows: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  classBalance: ColumnClassBalance[];
  profiles: ColumnProfile[];
  alignmentChecks: AlignmentCheck[];
  negativeControl: AlignmentCheck | null;
  exitBarAudit: ExitBarAudit | null;
}

export type LabelOverlayBody = { section: "window"; window: WindowBody } | { section: "dataset"; dataset: DatasetBody };

export const EMPTY_WINDOW: WindowBody = { datasetRows: 0, barsPerWindow: DEFAULT_BARS_PER_WINDOW, mode: "busiest", window: null, rows: [], busiest: null, median: null };
export const EMPTY_DATASET: DatasetBody = {
  datasetRows: 0, barRows: 0, joinedRows: 0, firstTimestamp: null, lastTimestamp: null,
  classBalance: [], profiles: [], alignmentChecks: [], negativeControl: null, exitBarAudit: null,
};

// --- pure computation --------------------------------------------------------

/** Trailing mean with min_periods = 1 (the notebook's atr_proxy): a bar's mean covers the bars up to and including it. */
export function trailingMeanMinOne(values: ReadonlyArray<number | null>, window: number): Array<number | null> {
  const out: Array<number | null> = [];
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j += 1) {
      const value = values[j];
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }
    out.push(count > 0 ? sum / count : null);
  }
  return out;
}

export interface RegimeRun {
  /** Index of the first bar of the run. */
  from: number;
  /** Index of the bar the run's shading ends at (the start of the next run, or the last bar). */
  to: number;
  regime: number;
}

/** Consecutive equal, known volatility regimes as runs; unknown runs are skipped, exactly as the notebook draws them. */
export function regimeRuns(regimes: ReadonlyArray<number | null>): RegimeRun[] {
  const runs: RegimeRun[] = [];
  if (regimes.length === 0) return runs;
  let start = 0;
  let value = regimes[0] ?? null;
  for (let i = 1; i <= regimes.length; i += 1) {
    const next = i < regimes.length ? (regimes[i] ?? null) : undefined;
    if (i === regimes.length || next !== value) {
      if (value !== null && Number.isFinite(value)) runs.push({ from: start, to: Math.min(i, regimes.length - 1), regime: value });
      start = i;
      value = next ?? null;
    }
  }
  return runs;
}

export interface BarrierBox {
  /** Window index of the entry bar (the entry is its close). */
  index: number;
  /** Window index of the box's right edge (the vertical barrier, clamped to the window). */
  rightIndex: number;
  entry: number;
  lower: number;
  upper: number;
  /** +1 take-profit first, -1 stop-loss first, 0 vertical. */
  outcome: number;
  /** Window index of the exit bar. */
  exitIndex: number;
  /** false when the exit row is unresolved or outside the window and the X sits on the right edge instead. */
  exitResolved: boolean;
}

/**
 * The triple-barrier boxes drawn every `every` bars. `firstRow` is the dataset
 * row number of the window's first bar: `triple_barrier_exit_row_number` is
 * absolute, so the exit's window index is `exit - firstRow`.
 */
export function barrierBoxes(rows: readonly WindowRow[], every: number): BarrierBox[] {
  const boxes: BarrierBox[] = [];
  if (rows.length === 0 || every < 1) return boxes;
  const firstRow = rows[0]?.row_number ?? 0;
  const proxy = trailingMeanMinOne(rows.map((row) => row.bar_range_points), BARRIER_BAND_WINDOW_BARS);
  for (let i = 0; i < rows.length - (BARRIER_BOX_BARS + 1); i += every) {
    const row = rows[i] as WindowRow;
    const outcome = row.triple_barrier_outcome;
    if (outcome === null || !Number.isFinite(outcome)) continue;
    const band = BARRIER_BAND_MULTIPLE * (proxy[i] ?? 0);
    const rightIndex = Math.min(i + BARRIER_BOX_BARS, rows.length - 1);
    const exitRow = row.triple_barrier_exit_row_number;
    const local = exitRow === null || !Number.isFinite(exitRow) || exitRow < 0 ? null : exitRow - firstRow;
    const resolved = local !== null && local >= 0 && local < rows.length;
    boxes.push({
      index: i,
      rightIndex,
      entry: row.close,
      lower: row.close - band,
      upper: row.close + band,
      outcome,
      exitIndex: resolved ? (local as number) : rightIndex,
      exitResolved: resolved,
    });
  }
  return boxes;
}

export interface ClassShares {
  positive: number;
  negative: number;
  zero: number;
}

/** Share of the window's bars in each class, over ALL bars (an unknown label counts in no class), as the notebook prints it. */
export function classShares(values: ReadonlyArray<number | null>): ClassShares {
  const n = values.length;
  if (n === 0) return { positive: 0, negative: 0, zero: 0 };
  let positive = 0;
  let negative = 0;
  let zero = 0;
  for (const value of values) {
    if (value === 1) positive += 1;
    else if (value === -1) negative += 1;
    else if (value === 0) zero += 1;
  }
  return { positive: positive / n, negative: negative / n, zero: zero / n };
}

/** Points travelled in a window: highest high minus lowest low. */
export function pointsTravelled(rows: readonly WindowRow[]): number {
  if (rows.length === 0) return 0;
  let high = -Infinity;
  let low = Infinity;
  for (const row of rows) {
    if (row.high > high) high = row.high;
    if (row.low < low) low = row.low;
  }
  return high - low;
}

/** The direction label recomputed from the bars: 1 when the close `horizon` bars on is above this close. null when that bar is past the window. */
export function recomputedDirection(rows: readonly WindowRow[], index: number, horizon: number): number | null {
  const ahead = rows[index + horizon];
  const here = rows[index];
  if (!ahead || !here) return null;
  return ahead.close > here.close ? 1 : 0;
}

export interface DirectionTerm {
  index: number;
  stored: number | null;
  recomputed: number | null;
  /** 1 when both are known and differ. null when either is unknown. */
  mismatch: number | null;
  runningMismatches: number;
  runningCompared: number;
}

/** The terms of the mismatch sum over a window's bars, each with the running total (what the formula explorer steps through). */
export function directionMismatchTerms(rows: readonly WindowRow[], horizon: number): DirectionTerm[] {
  const key = directionColumn(horizon);
  const terms: DirectionTerm[] = [];
  let running = 0;
  let compared = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const stored = rows[i]?.[key] ?? null;
    const recomputed = recomputedDirection(rows, i, horizon);
    const known = stored !== null && Number.isFinite(stored) && recomputed !== null;
    const mismatch = known ? (stored !== recomputed ? 1 : 0) : null;
    if (mismatch !== null) {
      compared += 1;
      running += mismatch;
    }
    terms.push({ index: i, stored, recomputed, mismatch, runningMismatches: running, runningCompared: compared });
  }
  return terms;
}

/**
 * Collapse a 100-bin histogram to `bins` bins (a divisor of 100), so the page's
 * bins control re-bins the server's counts without another request.
 */
export function rebin(counts: readonly number[], bins: number): number[] {
  if (counts.length === 0 || bins >= counts.length || counts.length % bins !== 0) return [...counts];
  const group = counts.length / bins;
  const out: number[] = [];
  for (let i = 0; i < bins; i += 1) {
    let sum = 0;
    for (let j = 0; j < group; j += 1) sum += counts[i * group + j] ?? 0;
    out.push(sum);
  }
  return out;
}

/** Up-rate and majority class of a direction column from its class counts (the baseline a model is graded against). */
export function majorityBaseline(counts: readonly ClassCount[]): { upRate: number | null; majority: "up" | "down" | null; majorityRate: number | null } {
  let up = 0;
  let down = 0;
  for (const entry of counts) {
    if (entry.value === 1) up += entry.count;
    else if (entry.value === 0) down += entry.count;
  }
  const total = up + down;
  if (total === 0) return { upRate: null, majority: null, majorityRate: null };
  const upRate = up / total;
  return { upRate, majority: up >= down ? "up" : "down", majorityRate: Math.max(up, down) / total };
}
