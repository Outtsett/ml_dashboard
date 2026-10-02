/**
 * The body of GET /api/studies/candlestick-pattern-census and the pure compute
 * the page and its tests share. The server sends the census rows once (61
 * TA-Lib patterns x 5 timeframes = 305 rows); every control re-selects and
 * re-counts here in the browser.
 */

export const TIMEFRAME_ORDER = ["1m", "5m", "15m", "1h", "4h"] as const;
export type Timeframe = (typeof TIMEFRAME_ORDER)[number];
export const POOLED = "all" as const;
export type TimeframeChoice = typeof POOLED | Timeframe;
export const CANDLE_COUNTS = [1, 2, 3, 4, 5] as const;

/** One row of derived_mnq_candlestick_pattern_census: a pattern on one timeframe. */
export interface CensusRow {
  pattern_name: string;
  talib_function: string;
  talib_pattern_number: number;
  candle_count: number;
  pattern_type: string;
  talib_checks_prior_trend: boolean | null;
  shape_condition_count: number | null;
  emitted_values: string | null;
  bar_count_scanned: number;
  firing_count_total: number;
  firing_count_bullish: number;
  firing_count_bearish: number;
  firing_count_holdout_2025: number;
  firing_rate_percent: number | null;
  fires_in_this_timeframe: boolean;
  fires_anywhere_in_the_data: boolean;
  meets_minimum_firing_count_on_holdout: boolean;
  also_defined_as_hand_written_arithmetic_rule: boolean | null;
  recognition_area_under_curve: number | null;
  recognition_average_precision: number | null;
  recognition_positive_window_count: number | null;
  recognition_visible_window_count: number | null;
  recognition_prevalence: number | null;
  timeframe: string;
}

/** One pattern registry on the machine (landed by packages/ml-engine/src/studies/candlestick_pattern_census/build.py). */
export interface RegistryRow {
  registry_name: string;
  definition_count: number;
  definition_kind: string;
  where_it_lives: string;
  how_counted: string;
  definition_count_typed_in_notebook: number;
  count_matches_notebook: boolean;
}

/** One TA-Lib in play (the census was built with one version, the chart's drawings are verified with another). */
export interface ProvenanceRow {
  source_name: string;
  talib_version: string;
  library_function_count: number | null;
  candlestick_function_count: number;
  detail: string;
}

/** What the scorecard dataset adds to the count: tests run, distinct (pattern, side) pairs, survivors. */
export interface ScorecardCrossTabulation {
  testCount: number;
  patternSideCount: number;
  survivorCount: number;
}

export interface CensusBody {
  rows: CensusRow[];
  registries: RegistryRow[];
  provenance: ProvenanceRow[];
  scorecard: ScorecardCrossTabulation | null;
}

// ---------------------------------------------------------------------------
// One row per pattern, and the selected view
// ---------------------------------------------------------------------------

/** A pattern summed over every timeframe (the population-level view). */
export interface PatternTotals {
  pattern_name: string;
  talib_function: string;
  talib_pattern_number: number;
  candle_count: number;
  pattern_type: string;
  firingCountAllTimeframes: number;
  firingCountBullish: number;
  firingCountBearish: number;
  firingCountHoldout: number;
  barReadingsScanned: number;
  timeframesItFiresOn: number;
}

export function acrossTimeframes(rows: readonly CensusRow[]): PatternTotals[] {
  const byPattern = new Map<string, PatternTotals>();
  for (const row of rows) {
    let entry = byPattern.get(row.pattern_name);
    if (!entry) {
      entry = {
        pattern_name: row.pattern_name,
        talib_function: row.talib_function,
        talib_pattern_number: row.talib_pattern_number,
        candle_count: row.candle_count,
        pattern_type: row.pattern_type,
        firingCountAllTimeframes: 0,
        firingCountBullish: 0,
        firingCountBearish: 0,
        firingCountHoldout: 0,
        barReadingsScanned: 0,
        timeframesItFiresOn: 0,
      };
      byPattern.set(row.pattern_name, entry);
    }
    entry.firingCountAllTimeframes += row.firing_count_total;
    entry.firingCountBullish += row.firing_count_bullish;
    entry.firingCountBearish += row.firing_count_bearish;
    entry.firingCountHoldout += row.firing_count_holdout_2025;
    entry.barReadingsScanned += row.bar_count_scanned;
    entry.timeframesItFiresOn += row.fires_in_this_timeframe ? 1 : 0;
  }
  return [...byPattern.values()].sort(
    (a, b) => b.firingCountAllTimeframes - a.firingCountAllTimeframes || a.talib_pattern_number - b.talib_pattern_number,
  );
}

/** The patterns that never fire anywhere, alphabetical. */
export function neverFires(totals: readonly PatternTotals[]): string[] {
  return totals.filter((entry) => entry.firingCountAllTimeframes === 0).map((entry) => entry.pattern_name).sort();
}

/** Bar readings the notebook reports: one pattern's scanned bars summed over the timeframes. */
export function barReadings(rows: readonly CensusRow[]): number {
  const first = rows[0]?.pattern_name;
  if (first === undefined) return 0;
  return rows.filter((row) => row.pattern_name === first).reduce((total, row) => total + row.bar_count_scanned, 0);
}

export interface ViewControls {
  timeframe: TimeframeChoice;
  holdoutOnly: boolean;
  candleCounts: readonly number[];
}

/** One pattern as the current controls see it. */
export interface SelectedPattern {
  pattern_name: string;
  talib_function: string;
  talib_pattern_number: number;
  candle_count: number;
  pattern_type: string;
  shape_condition_count: number | null;
  recognitionAreaUnderCurve: number | null;
  firingCountSelected: number;
  firingCountBullish: number;
  firingCountBearish: number;
}

export interface SelectedView {
  patterns: SelectedPattern[];
  barsInView: number;
  candleSizes: number[];
}

/**
 * The single frame every panel reads: one row per pattern carrying the firing
 * count the controls select (pooled or one timeframe; all bars or the 2025
 * holdout only; the chosen candle counts), sorted by that count descending.
 */
export function selectView(rows: readonly CensusRow[], controls: ViewControls): SelectedView {
  const sizes = controls.candleCounts.length > 0 ? [...controls.candleCounts] : [...CANDLE_COUNTS];
  let patterns: SelectedPattern[];
  let barsInView: number;
  if (controls.timeframe === POOLED) {
    const totals = acrossTimeframes(rows);
    const shape = new Map<string, CensusRow>();
    for (const row of rows) if (!shape.has(row.pattern_name)) shape.set(row.pattern_name, row);
    patterns = totals.map((entry) => {
      const source = shape.get(entry.pattern_name) as CensusRow;
      return {
        pattern_name: entry.pattern_name,
        talib_function: entry.talib_function,
        talib_pattern_number: entry.talib_pattern_number,
        candle_count: entry.candle_count,
        pattern_type: entry.pattern_type,
        shape_condition_count: source.shape_condition_count,
        recognitionAreaUnderCurve: source.recognition_area_under_curve,
        firingCountSelected: controls.holdoutOnly ? entry.firingCountHoldout : entry.firingCountAllTimeframes,
        firingCountBullish: entry.firingCountBullish,
        firingCountBearish: entry.firingCountBearish,
      };
    });
    barsInView = barReadings(rows);
  } else {
    const single = rows.filter((row) => row.timeframe === controls.timeframe);
    patterns = single.map((row) => ({
      pattern_name: row.pattern_name,
      talib_function: row.talib_function,
      talib_pattern_number: row.talib_pattern_number,
      candle_count: row.candle_count,
      pattern_type: row.pattern_type,
      shape_condition_count: row.shape_condition_count,
      recognitionAreaUnderCurve: row.recognition_area_under_curve,
      firingCountSelected: controls.holdoutOnly ? row.firing_count_holdout_2025 : row.firing_count_total,
      firingCountBullish: row.firing_count_bullish,
      firingCountBearish: row.firing_count_bearish,
    }));
    barsInView = single[0]?.bar_count_scanned ?? 0;
  }
  patterns = patterns
    .filter((entry) => sizes.includes(entry.candle_count))
    .sort((a, b) => b.firingCountSelected - a.firingCountSelected || a.talib_pattern_number - b.talib_pattern_number);
  return { patterns, barsInView, candleSizes: [...sizes].sort((a, b) => a - b) };
}

export type Presence = "clears the threshold" | "fires, but below the threshold" | "never fires";

/** The bar a pattern must clear is at least one firing (a threshold of 0 still means "fires"). */
export function effectiveThreshold(threshold: number): number {
  return Math.max(threshold, 1);
}

export function presenceOf(count: number, threshold: number): Presence {
  if (count === 0) return "never fires";
  return count >= effectiveThreshold(threshold) ? "clears the threshold" : "fires, but below the threshold";
}

export interface ViewCounts {
  inView: number;
  fireAtLeastOnce: number;
  present: number;
  below: number;
  thin: number;
  dead: string[];
}

export function viewCounts(patterns: readonly SelectedPattern[], threshold: number): ViewCounts {
  const bar = effectiveThreshold(threshold);
  const present = patterns.filter((entry) => entry.firingCountSelected >= bar).length;
  const fireAtLeastOnce = patterns.filter((entry) => entry.firingCountSelected > 0).length;
  return {
    inView: patterns.length,
    fireAtLeastOnce,
    present,
    below: patterns.length - present,
    thin: patterns.filter((entry) => entry.firingCountSelected > 0 && entry.firingCountSelected < bar).length,
    dead: patterns.filter((entry) => entry.firingCountSelected === 0).map((entry) => entry.pattern_name),
  };
}

// ---------------------------------------------------------------------------
// The summation N_present(tau, m, c) = sum_p 1[f_{p,tau} >= m]
// ---------------------------------------------------------------------------

export interface SummationTerm {
  /** 1-based step index p, in TA-Lib order. */
  index: number;
  pattern: SelectedPattern;
  firings: number;
  indicator: 0 | 1;
  runningTotal: number;
}

export function summationTerms(patterns: readonly SelectedPattern[], threshold: number): SummationTerm[] {
  const bar = effectiveThreshold(threshold);
  const ordered = [...patterns].sort((a, b) => a.talib_pattern_number - b.talib_pattern_number);
  let running = 0;
  return ordered.map((pattern, position) => {
    const indicator: 0 | 1 = pattern.firingCountSelected >= bar ? 1 : 0;
    running += indicator;
    return { index: position + 1, pattern, firings: pattern.firingCountSelected, indicator, runningTotal: running };
  });
}

// ---------------------------------------------------------------------------
// By candle count, and by side
// ---------------------------------------------------------------------------

export interface LengthRow {
  candleCount: number;
  patternsDefined: number;
  patternsThatFire: number;
  patternsThatNeverFire: number;
  totalFirings: number;
}

export function lengthBreakdown(totals: readonly PatternTotals[]): LengthRow[] {
  const byLength = new Map<number, LengthRow>();
  for (const entry of totals) {
    const row = byLength.get(entry.candle_count) ?? {
      candleCount: entry.candle_count,
      patternsDefined: 0,
      patternsThatFire: 0,
      patternsThatNeverFire: 0,
      totalFirings: 0,
    };
    row.patternsDefined += 1;
    if (entry.firingCountAllTimeframes > 0) row.patternsThatFire += 1;
    else row.patternsThatNeverFire += 1;
    row.totalFirings += entry.firingCountAllTimeframes;
    byLength.set(entry.candle_count, row);
  }
  return [...byLength.values()].sort((a, b) => a.candleCount - b.candleCount);
}

export type SidesObserved = "both sides" | "bullish only" | "bearish only" | "never fired";

export function sidesObserved(bullish: number, bearish: number): SidesObserved {
  if (bullish > 0 && bearish > 0) return "both sides";
  if (bullish > 0) return "bullish only";
  if (bearish > 0) return "bearish only";
  return "never fired";
}

/** Patterns that fired on exactly one side (the notebook's XOR of the two zero tests). */
export function singleSided(patterns: readonly SelectedPattern[]): SelectedPattern[] {
  return patterns.filter((entry) => (entry.firingCountBullish === 0) !== (entry.firingCountBearish === 0));
}

// ---------------------------------------------------------------------------
// Symmetric log and histograms for count columns
// ---------------------------------------------------------------------------

/** log10(1 + |x|) with the sign kept: zero is a real value, so a count of 0 sits at 0. */
export function symlog(value: number): number {
  return value < 0 ? -Math.log10(1 - value) : Math.log10(1 + value);
}

export function symlogInverse(transformed: number): number {
  return transformed < 0 ? 1 - 10 ** -transformed : 10 ** transformed - 1;
}

export interface Bin {
  lower: number;
  upper: number;
  count: number;
}

/** Equal-width bins over the full range (in symlog space when asked); lower and upper are in raw units. */
export function histogramBins(values: readonly number[], binCount: number, useSymlog: boolean): Bin[] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return [];
  const mapped = useSymlog ? finite.map(symlog) : finite;
  const low = Math.min(...mapped);
  const high = Math.max(...mapped);
  if (!(high > low)) return [{ lower: finite[0] as number, upper: finite[0] as number, count: finite.length }];
  const width = (high - low) / binCount;
  const counts = new Array<number>(binCount).fill(0);
  for (const value of mapped) {
    const index = Math.min(binCount - 1, Math.floor((value - low) / width));
    counts[index] = (counts[index] as number) + 1;
  }
  return counts.map((count, index) => {
    const lower = low + index * width;
    const upper = low + (index + 1) * width;
    return { lower: useSymlog ? symlogInverse(lower) : lower, upper: useSymlog ? symlogInverse(upper) : upper, count };
  });
}

/** Value counts of a categorical column, largest first. */
export function valueCounts(values: readonly (string | number | boolean | null)[]): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value === null ? "missing" : String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

// ---------------------------------------------------------------------------
// The eight numbers with the notebook's estimators
// ---------------------------------------------------------------------------

export interface PopulationMoments {
  count: number;
  mean: number;
  median: number;
  standardDeviation: number | null;
  skewness: number | null;
  excessKurtosis: number | null;
  percentile25: number;
  percentile75: number;
  minimum: number;
  maximum: number;
}

function quantileLinear(sorted: readonly number[], quantile: number): number {
  const position = quantile * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] as number;
  return low + ((sorted[upper] as number) - low) * (position - lower);
}

/**
 * The notebook's own estimators: standard deviation with n - 1, skewness and
 * excess kurtosis as the mean of the standardised cube and fourth power (the
 * standardisation uses that same n - 1 deviation), null below four values or
 * with no spread. The dashboard's kit uses the sample-adjusted G1 / G2 instead;
 * the page offers both.
 */
export function populationMoments(values: readonly number[]): PopulationMoments | null {
  const finite = values.filter((value) => Number.isFinite(value));
  const count = finite.length;
  if (count === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const mean = finite.reduce((total, value) => total + value, 0) / count;
  const deviation = count > 1 ? Math.sqrt(finite.reduce((total, value) => total + (value - mean) ** 2, 0) / (count - 1)) : null;
  let skewness: number | null = null;
  let excessKurtosis: number | null = null;
  if (count >= 4 && deviation !== null && deviation > 0) {
    let cubed = 0;
    let fourth = 0;
    for (const value of finite) {
      const standardised = (value - mean) / deviation;
      cubed += standardised ** 3;
      fourth += standardised ** 4;
    }
    skewness = cubed / count;
    excessKurtosis = fourth / count - 3;
  }
  return {
    count,
    mean,
    median: quantileLinear(sorted, 0.5),
    standardDeviation: deviation,
    skewness,
    excessKurtosis,
    percentile25: quantileLinear(sorted, 0.25),
    percentile75: quantileLinear(sorted, 0.75),
    minimum: sorted[0] as number,
    maximum: sorted[count - 1] as number,
  };
}

/** The columns the notebook profiles. */
export const NUMERIC_COLUMNS = [
  "firing_count_total",
  "firing_count_bullish",
  "firing_count_bearish",
  "firing_count_holdout_2025",
  "firing_rate_percent",
  "bar_count_scanned",
  "candle_count",
  "shape_condition_count",
  "talib_pattern_number",
  "recognition_area_under_curve",
  "recognition_average_precision",
  "recognition_prevalence",
  "recognition_positive_window_count",
  "recognition_visible_window_count",
] as const satisfies ReadonlyArray<keyof CensusRow>;

/** Count columns get the symmetric-log axis. */
export const COUNT_COLUMNS: ReadonlySet<string> = new Set([
  "firing_count_total",
  "firing_count_bullish",
  "firing_count_bearish",
  "firing_count_holdout_2025",
  "recognition_positive_window_count",
  "recognition_visible_window_count",
  "bar_count_scanned",
]);

export const CATEGORICAL_COLUMNS = [
  "timeframe",
  "pattern_type",
  "sides_observed",
  "candle_count",
  "talib_checks_prior_trend",
  "fires_in_this_timeframe",
  "fires_anywhere_in_the_data",
  "meets_minimum_firing_count_on_holdout",
  "also_defined_as_hand_written_arithmetic_rule",
] as const;

export function categoricalValue(row: CensusRow, column: (typeof CATEGORICAL_COLUMNS)[number]): string | number | boolean | null {
  if (column === "sides_observed") return sidesObserved(row.firing_count_bullish, row.firing_count_bearish);
  return row[column];
}
