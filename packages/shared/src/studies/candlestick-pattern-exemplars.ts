/**
 * The body of GET /api/studies/candlestick-pattern-exemplars, shared by the
 * handler and the page, with the pure arithmetic both sides use.
 *
 * Source tables (landed by packages/ml-engine/src/studies/candlestick_pattern_exemplars/build.py
 * from scripts/candlestick_pattern_exemplars.py): one row per TA-Lib
 * candlestick firing on MNQ daily bars, with its shape in fractions of the
 * bar's own range, the trend that preceded it, the trend its meaning needs,
 * and its distance to the pattern's median-shape archetype.
 */

/** Closes used to judge "what came before": the stretch ends at the bar before the firing. */
export const PRIOR_TREND_LOOKBACK_BARS = 10;
/** A move must be at least this multiple of the window's median bar range to count as a trend. */
export const PRIOR_TREND_MINIMUM_RANGE_MULTIPLE = 1.0;
/** Bars before a firing the handler sends with each exemplar: the trend window (lookback + 1 closes). */
export const WINDOW_BARS_BEFORE = PRIOR_TREND_LOOKBACK_BARS + 1;
/** Exemplars that carry their bars; the page's slider runs 1..this. */
export const MAXIMUM_EXEMPLARS = 12;

export type ContextFilter = "all" | "confirmed" | "contradicted";
export type ContextScope = "all" | "needs_context" | "fired";
export type TrendDirection = "up" | "down" | "sideways" | "unknown";

/** One firing of the selected pattern, ranked (1 = closest to the archetype). */
export interface FiringRow {
  /** The bar's stamp in epoch milliseconds (the lake's clock: wall-clock date stored as UTC). */
  bar_timestamp_ms: number;
  /** yyyy-mm-dd of that stamp. */
  bar_date: string;
  prototypicality_rank: number;
  signal_direction: string;
  emitted_value: number;
  body_fraction_of_range: number | null;
  upper_shadow_fraction_of_range: number | null;
  lower_shadow_fraction_of_range: number | null;
  close_versus_open: string;
  close_versus_previous_close: string;
  prior_trend_direction: string;
  required_prior_trend: string;
  archetype_distance: number | null;
  body_size_points: number | null;
  total_range_points: number | null;
  volume: number | null;
}

/** One pattern's rule as TA-Lib states it. */
export interface RuleRow {
  talib_function: string;
  bars_the_rule_reads: number;
  pattern_type: string | null;
  required_prior_trend_for_bullish_signal: string | null;
  required_prior_trend_for_bearish_signal: string | null;
  talib_verifies_prior_trend: boolean;
  emitted_values: string | null;
  shape_conditions: string | null;
  adaptive_settings_used: string | null;
}

/** One of the 61 patterns with how often it fired and how often its context held. */
export interface ContextRow {
  talib_function: string;
  bars_the_rule_reads: number;
  pattern_type: string | null;
  required_prior_trend_for_bullish_signal: string | null;
  required_prior_trend_for_bearish_signal: string | null;
  talib_verifies_prior_trend: boolean;
  firings: number;
  context_required: number;
  context_held: number;
  /** Null when no firing needed a trend (a dash in the table, never 0). */
  context_held_percent: number | null;
}

/** One daily bar around an exemplar; offset 0 is the firing bar. Prices are absolute, labelled as such. */
export interface WindowBar {
  bar_offset: number;
  bar_timestamp_ms: number;
  absolute_open_price: number;
  absolute_high_price: number;
  absolute_low_price: number;
  absolute_close_price: number;
}

/** The pattern's median shape over ALL its firings (not just the filtered ones). */
export interface Archetype {
  body_fraction_of_range: number;
  upper_shadow_fraction_of_range: number;
  lower_shadow_fraction_of_range: number;
}

export interface Headline {
  pattern_count: number;
  patterns_needing_prior_trend: number;
  patterns_talib_verifies_prior_trend: number;
  fired_pattern_count: number;
  firing_count: number;
  gated_firing_count: number;
  gated_held_count: number;
  symbol: string;
  timeframe: string;
  first_bar_date: string;
  last_bar_date: string;
}

/** Every firing of every pattern as parallel arrays, for the chart's one-label-per-bar choice. */
export interface ShapeColumns {
  patterns: string[];
  timestamp_ms: number[];
  pattern_index: number[];
  body: number[];
  upper: number[];
  lower: number[];
}

export interface ExemplarsBody {
  /** False when the three tables are not in the lake. */
  landed: boolean;
  headline: Headline | null;
  /** Patterns that fired, most firings first: the dropdown's options. */
  patterns: Array<{ talib_function: string; firings: number }>;
  /** The pattern this body is for (the requested one, or the first that fired when it never did). */
  pattern: string | null;
  context: ContextFilter;
  rule: RuleRow | null;
  archetype: Archetype | null;
  /** The pattern's firings under the context filter, rank order. */
  firings: FiringRow[];
  /** Bars around the best MAXIMUM_EXEMPLARS of those firings, keyed by the firing's stamp in ms. */
  windows: Record<string, WindowBar[]>;
  contextRows: ContextRow[];
  shapes: ShapeColumns;
}

export const EMPTY_SHAPES: ShapeColumns = { patterns: [], timestamp_ms: [], pattern_index: [], body: [], upper: [], lower: [] };

export const EMPTY_BODY: ExemplarsBody = {
  landed: false,
  headline: null,
  patterns: [],
  pattern: null,
  context: "all",
  rule: null,
  archetype: null,
  firings: [],
  windows: {},
  contextRows: [],
  shapes: EMPTY_SHAPES,
};

// ── pure arithmetic ────────────────────────────────────────────────────────

export function requiresTrend(required: string | null | undefined): boolean {
  return required === "up" || required === "down";
}

/** The trend the firing's meaning needs is there: equal to the stamped prior trend. */
export function contextAgrees(row: Pick<FiringRow, "prior_trend_direction" | "required_prior_trend">): boolean {
  return row.prior_trend_direction === row.required_prior_trend;
}

/** The notebook's context filter, exactly: "contradicts" is every firing whose prior trend differs from the required one, including those that require none. */
export function filterByContext<T extends Pick<FiringRow, "prior_trend_direction" | "required_prior_trend">>(rows: readonly T[], filter: ContextFilter): T[] {
  if (filter === "confirmed") return rows.filter(contextAgrees);
  if (filter === "contradicted") return rows.filter((row) => !contextAgrees(row));
  return [...rows];
}

/** Percent of rows for which `predicate` holds; 0 for no rows (the notebook's convention). */
export function sharePercent<T>(rows: readonly T[], predicate: (row: T) => boolean): number {
  if (rows.length === 0) return 0;
  let held = 0;
  for (const row of rows) if (predicate(row)) held += 1;
  return (100 * held) / rows.length;
}

/** Firings that need a trend, and how many of those found it. */
export function gatedCounts(rows: ReadonlyArray<Pick<FiringRow, "prior_trend_direction" | "required_prior_trend">>): { gated: number; held: number } {
  let gated = 0;
  let held = 0;
  for (const row of rows) {
    if (!requiresTrend(row.required_prior_trend)) continue;
    gated += 1;
    if (row.prior_trend_direction === row.required_prior_trend) held += 1;
  }
  return { gated, held };
}

export function patternNeedsTrend(row: Pick<ContextRow, "required_prior_trend_for_bullish_signal" | "required_prior_trend_for_bearish_signal">): boolean {
  return requiresTrend(row.required_prior_trend_for_bullish_signal) || requiresTrend(row.required_prior_trend_for_bearish_signal);
}

/** The context table under the notebook's "Show" radio. */
export function scopeContextRows(rows: readonly ContextRow[], scope: ContextScope): ContextRow[] {
  if (scope === "needs_context") return rows.filter(patternNeedsTrend);
  if (scope === "fired") return rows.filter((row) => row.firings > 0);
  return [...rows];
}

/** Euclidean distance of a shape (body, upper shadow, lower shadow fractions) to the archetype. */
export function archetypeDistance(shape: { body: number; upper: number; lower: number }, archetype: { body: number; upper: number; lower: number }): number {
  return Math.sqrt((shape.body - archetype.body) ** 2 + (shape.upper - archetype.upper) ** 2 + (shape.lower - archetype.lower) ** 2);
}

export interface PriorTrendMeasurement {
  direction: TrendDirection;
  /** close at the last window bar minus close ten bars earlier; null when the window is short. */
  move: number | null;
  /** median high-low over the window's bars. */
  typicalRange: number | null;
  /** the move a trend must clear: the multiple times the typical range. */
  threshold: number | null;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2 : (sorted[middle] as number);
}

/**
 * The prior trend as scripts/candlestick_pattern_exemplars.py stamps it, from
 * the bars around a firing: the stretch of closes ENDING AT THE BAR BEFORE the
 * firing (offsets -11..-1), up or down only when the move clears the window's
 * median range, else sideways; unknown when the window is shorter than that.
 */
export function measurePriorTrend(bars: readonly WindowBar[]): PriorTrendMeasurement {
  const byOffset = new Map(bars.map((bar) => [bar.bar_offset, bar]));
  const window: WindowBar[] = [];
  for (let offset = -WINDOW_BARS_BEFORE; offset <= -1; offset += 1) {
    const bar = byOffset.get(offset);
    if (!bar) return { direction: "unknown", move: null, typicalRange: null, threshold: null };
    window.push(bar);
  }
  const first = window[0] as WindowBar;
  const last = window[window.length - 1] as WindowBar;
  const move = last.absolute_close_price - first.absolute_close_price;
  const typicalRange = medianOf(window.map((bar) => bar.absolute_high_price - bar.absolute_low_price));
  const threshold = PRIOR_TREND_MINIMUM_RANGE_MULTIPLE * typicalRange;
  if (typicalRange <= 0) return { direction: "sideways", move, typicalRange, threshold };
  if (Math.abs(move) < threshold) return { direction: "sideways", move, typicalRange, threshold };
  return { direction: move > 0 ? "up" : "down", move, typicalRange, threshold };
}

/** Group the flat window rows the handler reads by the firing they belong to. */
export function groupWindows(rows: ReadonlyArray<WindowBar & { firing_timestamp_ms: number }>): Record<string, WindowBar[]> {
  const out: Record<string, WindowBar[]> = {};
  for (const row of rows) {
    const { firing_timestamp_ms: key, ...bar } = row;
    (out[String(key)] ??= []).push(bar);
  }
  for (const bars of Object.values(out)) bars.sort((a, b) => a.bar_offset - b.bar_offset);
  return out;
}
