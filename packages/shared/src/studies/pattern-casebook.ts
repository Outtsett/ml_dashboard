/**
 * Pattern casebook: the body of GET /api/studies/pattern-casebook and the pure
 * arithmetic the handler and the page share. Replaced
 * datalake/notebooks/findings_casebook.py.
 *
 * Every price here is a real MNQ price on the 0.25 grid and every trade is one
 * contract: gross ticks come from the lake (landed by
 * packages/ml-engine/src/studies/pattern_casebook/build.py), and net dollars are
 * (gross ticks - round-trip cost in ticks) x dollars per tick at the cost the
 * page is showing, so the same trades can be priced at the casebook's cost,
 * the dashboard's cost_model.json cost, or none.
 *
 * Statistics follow the notebook's own code (numpy / scipy defaults), not the
 * lens helpers, so the numbers match it: sample standard deviation (n - 1),
 * scipy's biased skewness and biased Fisher excess kurtosis, numpy's linear
 * percentiles, and numpy.histogram's bins (the last bin closed on the right).
 */

import type { LensEightNumberSummary } from "../lens/types";

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"] as const;
export type CasebookTimeframe = (typeof TIMEFRAMES)[number];
export const HORIZON = 6;
export const MINIMUM_TRADES_SHOWN = 30;

export type CasebookPart = "overview" | "sides" | "case" | "distribution" | "columns";

/** The notebook's verdicts in its order, each with an Okabe-Ito colour and a distinct glyph. */
export const VERDICTS = [
  { verdict: "pays after costs", colour: "#E69F00", glyph: "triangle-up" },
  { verdict: "real but smaller than the cost", colour: "#56B4E9", glyph: "diamond" },
  { verdict: "forecasts size, not direction", colour: "#009E73", glyph: "square" },
  { verdict: "unconfirmed", colour: "#CC79A7", glyph: "cross" },
  { verdict: "no edge", colour: "#0072B2", glyph: "triangle-down" },
  { verdict: "correction", colour: "#D55E00", glyph: "wedge" },
  { verdict: "descriptive", colour: "#8a8a8a", glyph: "circle" },
] as const;

// ---------------------------------------------------------------- bodies

export interface RunInformation {
  round_trip_cost_ticks: number;
  round_trip_cost_dollars: number;
  tick_size_points: number;
  dollars_per_tick: number;
  dollars_per_point: number;
  trade_rule: string;
  random_draws: number;
  empirical_draw_limit: number;
  minimum_trades: number;
  seed: number;
  build_seconds: number;
  built_at_milliseconds: number;
  source: string;
  cost_model: string;
}

export interface FindingRow {
  finding_date: string;
  repository: string;
  area: string;
  finding: string;
  result: string;
  verdict: string;
  in_trader_terms: string;
  where_to_see_it: string;
  computed_source: string;
}

export interface LastMoveRule {
  timeframe: string;
  rule: string;
  period: string;
  trade_count: number;
  sessions: number;
  trades_per_session: number;
  hit_rate_gross: number;
  share_next_candle_flat: number;
  average_winning_trade_ticks: number;
  average_losing_trade_ticks: number;
  gross_ticks_per_trade: number;
  gross_ticks_mean: number | null;
  gross_ticks_median: number | null;
  gross_ticks_standard_deviation: number | null;
  gross_ticks_skewness: number | null;
  gross_ticks_excess_kurtosis: number | null;
  gross_ticks_percentile_25: number | null;
  gross_ticks_percentile_75: number | null;
  gross_ticks_minimum: number | null;
  gross_ticks_maximum: number | null;
  round_trip_cost_ticks: number;
  net_ticks_per_trade: number;
  net_dollars_per_trade: number;
  net_dollars_per_session: number;
  break_even_cost_ticks: number;
  break_even_hit_rate_at_cost: number;
  always_long_net_dollars_per_trade: number;
  hit_rate_excluding_flat_next_candles: number;
  close_to_next_close_hit_rate_excluding_unchanged: number;
  close_to_next_close_ticks_per_call: number;
  close_to_next_open_ticks_per_call: number;
}

export interface OverviewBody {
  run: RunInformation | null;
  findings: FindingRow[];
  rules: LastMoveRule[];
  /** MNQ round trip from the dashboard's packages/config/cost_model.json, in ticks (null when unreadable). */
  dashboardCostTicks: number | null;
}

/** One row of pattern_side_dollars, repriced at the cost the page shows. */
export interface SideRow {
  timeframe: string;
  pattern: string;
  side: string;
  trade_direction: string;
  calendar_year: number;
  candle: number;
  trade_count: number;
  trading_days_with_a_trade: number;
  sessions_in_year: number;
  net_dollars_per_trade_mean: number;
  net_dollars_per_trade_median: number;
  net_dollars_per_trade_standard_deviation: number | null;
  net_dollars_per_trade_skewness: number | null;
  net_dollars_per_trade_excess_kurtosis: number | null;
  net_dollars_per_trade_percentile_25: number;
  net_dollars_per_trade_percentile_75: number;
  net_dollars_per_trade_minimum: number;
  net_dollars_per_trade_maximum: number;
  share_of_trades_net_positive: number;
  total_net_dollars: number;
  net_dollars_per_session: number;
  every_bar_same_direction_net_dollars_per_trade: number;
  pattern_minus_every_bar_dollars_per_trade: number;
  random_bars_total_net_dollars_percentile_5: number;
  random_bars_total_net_dollars_median: number;
  random_bars_total_net_dollars_percentile_95: number;
  share_of_random_totals_at_or_above_pattern: number;
  random_band_method: string;
}

export type AgainstRandom = "above random bars" | "inside random bars" | "below random bars";

export interface SidesBody {
  rows: SideRow[];
  costTicks: number;
}

export interface CaseTrade {
  bar_timestamp_milliseconds: number;
  contract_symbol: string;
  pattern_close_price: number;
  entry_price: number;
  exit_price: number;
  gross_ticks: number;
  net_ticks: number;
  net_dollars: number;
  rank_best_first: number;
}

export interface WindowCandle {
  bars_from_signal: number;
  timestamp_milliseconds: number;
  trading_day: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CaseBody {
  population: "pattern" | "random";
  tradeDirection: 1 | -1;
  patternCandleCount: number;
  tradeCount: number;
  step: number;
  trade: CaseTrade | null;
  window: WindowCandle[];
  /** False when the lake's candle at the trade's timestamp no longer matches the casebook (the lake moved). */
  aligned: boolean;
  shareNetPositive: number | null;
  totalNetDollars: number | null;
  medianNetDollars: number | null;
  costTicks: number;
  dollarsPerTick: number;
  tickSize: number;
}

export interface HistogramShare {
  net_dollars: number;
  pattern_share_of_trades: number;
  every_bar_share_of_trades: number;
}

export interface RunningPoint {
  bar_timestamp_milliseconds: number;
  running_dollars: number;
}

export interface CasebookEightNumbers extends LensEightNumberSummary {
  shareNetPositive: number | null;
  total: number | null;
}

export interface DistributionBody {
  available: boolean;
  message: string | null;
  view: "net" | "gross";
  costTicks: number;
  histogram: HistogramShare[];
  patternLine: RunningPoint[];
  randomLines: Array<{ draw: number; points: RunningPoint[] }>;
  band: { bar_timestamp_milliseconds: number; low: number; high: number } | null;
  pattern: CasebookEightNumbers | null;
  everyBar: CasebookEightNumbers | null;
  stats: {
    tradeCount: number;
    tradingDaysWithATrade: number;
    shareMadeMoney: number;
    meanPerTrade: number;
    medianPerTrade: number;
    everyBarPerTrade: number;
    wholeYear: number;
    perSession: number;
    roundTripsCost: number;
    randomLow: number;
    randomHigh: number;
    shareOfRandomTotalsAtOrAbovePattern: number;
    randomBandMethod: string;
  } | null;
}

export interface ColumnProfile {
  column: string;
  bins: Array<{ lower: number; upper: number; count: number }>;
  summary: LensEightNumberSummary;
}

export interface ColumnsBody {
  rowCount: number;
  constants: Array<{ column: string; value: string }>;
  numeric: ColumnProfile[];
  months: Array<{ month: string; trades: number }>;
  tradesPerTradingDay: Array<{ lower: number; upper: number; tradingDays: number }>;
  categorical: Array<{ column: string; counts: Array<{ value: string; trades: number }> }>;
  costTicks: number;
}

// ---------------------------------------------------------------- statistics (numpy / scipy conventions)

/** numpy.percentile (linear) of an ascending-sorted array. */
export function percentileSorted(sorted: ArrayLike<number>, percent: number): number | null {
  const count = sorted.length;
  if (count === 0) return null;
  const position = (percent / 100) * (count - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] as number;
  if (lower === upper) return low;
  return low + ((sorted[upper] as number) - low) * (position - lower);
}

function finiteSorted(values: ArrayLike<number>): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (Number.isFinite(value)) out.push(value);
  }
  return Float64Array.from(out).sort();
}

/**
 * The eight numbers as datalake's `eight_numbers` computes them: sample
 * standard deviation, scipy's biased skewness and biased excess kurtosis
 * (null below 3 and 4 values, or when every value is the same).
 */
export function eightNumbers(values: ArrayLike<number>): LensEightNumberSummary {
  const sorted = finiteSorted(values);
  const count = sorted.length;
  if (count === 0) {
    return { count: 0, mean: null, median: null, standardDeviation: null, skewness: null, kurtosis: null, percentile25: null, percentile75: null, minimum: null, maximum: null };
  }
  let total = 0;
  for (const value of sorted) total += value;
  const average = total / count;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const value of sorted) {
    const delta = value - average;
    const squared = delta * delta;
    m2 += squared;
    m3 += squared * delta;
    m4 += squared * squared;
  }
  m2 /= count;
  m3 /= count;
  m4 /= count;
  const constant = (sorted[count - 1] as number) === (sorted[0] as number);
  return {
    count,
    mean: average,
    median: percentileSorted(sorted, 50),
    standardDeviation: count > 1 ? Math.sqrt((m2 * count) / (count - 1)) : null,
    skewness: count < 3 || constant ? null : m3 / Math.pow(m2, 1.5),
    kurtosis: count < 4 || constant ? null : m4 / (m2 * m2) - 3,
    percentile25: percentileSorted(sorted, 25),
    percentile75: percentileSorted(sorted, 75),
    minimum: sorted[0] as number,
    maximum: sorted[count - 1] as number,
  };
}

export function casebookEightNumbers(values: ArrayLike<number>): CasebookEightNumbers {
  const summary = eightNumbers(values);
  let positive = 0;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (value > 0) positive += 1;
    total += value;
  }
  return { ...summary, shareNetPositive: values.length > 0 ? positive / values.length : null, total: values.length > 0 ? total : null };
}

/** numpy.histogram over `edges` (equal width): values outside are dropped, the last bin includes its right edge. */
export function histogramCounts(values: ArrayLike<number>, lower: number, upper: number, binCount: number): number[] {
  const counts = new Array<number>(binCount).fill(0);
  if (!(upper > lower)) {
    let inside = 0;
    for (let i = 0; i < values.length; i += 1) if ((values[i] as number) === lower) inside += 1;
    counts[Math.floor(binCount / 2)] = inside;
    return counts;
  }
  const width = (upper - lower) / binCount;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (!(value >= lower && value <= upper)) continue;
    const index = value === upper ? binCount - 1 : Math.min(binCount - 1, Math.floor((value - lower) / width));
    counts[index] = (counts[index] as number) + 1;
  }
  return counts;
}

/** numpy.histogram(values, bins=binCount) over the finite values: range min..max. */
export function numpyHistogram(values: ArrayLike<number>, binCount: number): Array<{ lower: number; upper: number; count: number }> {
  const sorted = finiteSorted(values);
  if (sorted.length === 0) return [];
  let lower = sorted[0] as number;
  let upper = sorted[sorted.length - 1] as number;
  if (lower === upper) {
    lower -= 0.5;
    upper += 0.5;
  }
  const counts = histogramCounts(sorted, lower, upper, binCount);
  const width = (upper - lower) / binCount;
  return counts.map((count, index) => ({ lower: lower + index * width, upper: lower + (index + 1) * width, count }));
}

/**
 * Section 2's step histogram: both populations clipped to the middle `spanPercent`
 * of the two pooled, 60 equal bins, each bin as a share of its own population.
 */
export function histogramShares(pattern: ArrayLike<number>, everyBar: ArrayLike<number>, spanPercent: number, binCount = 60): HistogramShare[] {
  const pooled = finiteSorted([...Array.from(pattern), ...Array.from(everyBar)]);
  if (pooled.length === 0) return [];
  const tail = (100 - spanPercent) / 2;
  const low = percentileSorted(pooled, tail) as number;
  const high = percentileSorted(pooled, 100 - tail) as number;
  const clip = (values: ArrayLike<number>) => Array.from(values, (value) => Math.min(high, Math.max(low, value)));
  const patternCounts = histogramCounts(clip(pattern), low, high, binCount);
  const everyCounts = histogramCounts(clip(everyBar), low, high, binCount);
  const width = (high - low) / binCount;
  return patternCounts.map((count, index) => ({
    net_dollars: low + (index + 0.5) * width,
    pattern_share_of_trades: pattern.length > 0 ? count / pattern.length : 0,
    every_bar_share_of_trades: everyBar.length > 0 ? (everyCounts[index] as number) / everyBar.length : 0,
  }));
}

/**
 * Running dollars through the year for trades already in time order, thinned
 * the notebook's way: every max(1, n / 500)-th point plus the last, one point
 * per timestamp (the last one).
 */
export function runningDollars(timestamps: ArrayLike<number>, dollars: ArrayLike<number>): RunningPoint[] {
  const count = timestamps.length;
  if (count === 0) return [];
  const running = new Float64Array(count);
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    total += dollars[i] as number;
    running[i] = total;
  }
  const step = Math.max(1, Math.floor(count / 500));
  const picked: number[] = [];
  for (let i = 0; i < count; i += step) picked.push(i);
  picked.push(count - 1);
  const byTimestamp = new Map<number, number>();
  for (const index of picked) byTimestamp.set(timestamps[index] as number, running[index] as number);
  return [...byTimestamp.entries()].map(([bar_timestamp_milliseconds, running_dollars]) => ({ bar_timestamp_milliseconds, running_dollars }));
}

// ---------------------------------------------------------------- random bars

/** A seeded uniform generator in [0, 1) (mulberry32). The notebook used numpy's; draws are not the same bars. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `size` distinct indices of 0..poolSize-1 chosen at random with this seed, ascending (time order). */
export function sampleWithoutReplacement(poolSize: number, size: number, seed: number): number[] {
  const count = Math.min(Math.max(0, size), poolSize);
  const random = seededRandom(seed);
  const chosen = new Map<number, number>();
  const out: number[] = [];
  // Partial Fisher-Yates on a sparse copy of 0..poolSize-1.
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(random() * (poolSize - i));
    const atJ = chosen.get(j) ?? j;
    const atI = chosen.get(i) ?? i;
    chosen.set(j, atI);
    out.push(atJ);
  }
  return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------- repricing at another cost

export function netDollars(grossTicks: number, costTicks: number, dollarsPerTick: number): number {
  return (grossTicks - costTicks) * dollarsPerTick;
}

/**
 * A stored pattern_side_dollars row (net at the build's cost) moved to another
 * cost. Every net dollar figure moves by the same amount per trade, the totals
 * and the random-bar band by that times the trade count; the share of random
 * totals at or above the pattern does not move. The share of trades net
 * positive does move, and is passed in (computed from the trades).
 */
export function repriceSide(row: SideRow, buildCostTicks: number, costTicks: number, dollarsPerTick: number, shareNetPositive: number | null): SideRow {
  const perTrade = (buildCostTicks - costTicks) * dollarsPerTick;
  const whole = perTrade * row.trade_count;
  const shift = (value: number | null) => (value === null ? null : value + perTrade);
  return {
    ...row,
    net_dollars_per_trade_mean: row.net_dollars_per_trade_mean + perTrade,
    net_dollars_per_trade_median: row.net_dollars_per_trade_median + perTrade,
    net_dollars_per_trade_percentile_25: row.net_dollars_per_trade_percentile_25 + perTrade,
    net_dollars_per_trade_percentile_75: row.net_dollars_per_trade_percentile_75 + perTrade,
    net_dollars_per_trade_minimum: row.net_dollars_per_trade_minimum + perTrade,
    net_dollars_per_trade_maximum: row.net_dollars_per_trade_maximum + perTrade,
    net_dollars_per_trade_standard_deviation: row.net_dollars_per_trade_standard_deviation,
    share_of_trades_net_positive: shareNetPositive ?? row.share_of_trades_net_positive,
    total_net_dollars: row.total_net_dollars + whole,
    net_dollars_per_session: (row.total_net_dollars + whole) / row.sessions_in_year,
    every_bar_same_direction_net_dollars_per_trade: shift(row.every_bar_same_direction_net_dollars_per_trade) as number,
    random_bars_total_net_dollars_percentile_5: row.random_bars_total_net_dollars_percentile_5 + whole,
    random_bars_total_net_dollars_median: row.random_bars_total_net_dollars_median + whole,
    random_bars_total_net_dollars_percentile_95: row.random_bars_total_net_dollars_percentile_95 + whole,
  };
}

/** Section 3's class: the mean per trade against the random bars' 5th-95th percentile per trade. */
export function againstRandom(row: SideRow): { low: number; high: number; against: AgainstRandom } {
  const low = row.random_bars_total_net_dollars_percentile_5 / row.trade_count;
  const high = row.random_bars_total_net_dollars_percentile_95 / row.trade_count;
  const mean = row.net_dollars_per_trade_mean;
  const against: AgainstRandom = mean > high ? "above random bars" : mean < low ? "below random bars" : "inside random bars";
  return { low, high, against };
}

// ---------------------------------------------------------------- section 4: the rule's arithmetic

export interface PersistenceTerms {
  terms: Array<{ index: number; name: string; value: number; start: number; end: number }>;
  net: number;
  breakEvenHitRate: number;
}

/** net = h·W − (1 − h)·L − c and h* = (c + L) / (W + L), with the waterfall's running totals. */
export function persistenceTerms(hitRate: number, averageWin: number, averageLoss: number, costTicks: number): PersistenceTerms {
  const values = [
    { name: "h × W (winning trades)", value: hitRate * averageWin },
    { name: "−(1 − h) × L (losing trades)", value: -(1 - hitRate) * averageLoss },
    { name: "−c (round trip)", value: -costTicks },
  ];
  let running = 0;
  const terms = values.map((term, index) => {
    const start = running;
    running += term.value;
    return { index: index + 1, name: term.name, value: term.value, start, end: running };
  });
  return { terms, net: running, breakEvenHitRate: (costTicks + averageLoss) / (averageWin + averageLoss) };
}

/** The dollar lines of a last-move rule at another cost (its gross ticks do not depend on the cost). */
export function repriceRule(rule: LastMoveRule, costTicks: number, dollarsPerTick: number) {
  const netTicks = rule.gross_ticks_per_trade - costTicks;
  return {
    netTicksPerTrade: netTicks,
    netDollarsPerTrade: netTicks * dollarsPerTick,
    netDollarsPerSession: netTicks * dollarsPerTick * rule.trades_per_session,
    alwaysLongNetDollarsPerTrade: rule.always_long_net_dollars_per_trade + (rule.round_trip_cost_ticks - costTicks) * dollarsPerTick,
    breakEvenHitRate: (costTicks + rule.average_losing_trade_ticks) / (rule.average_winning_trade_ticks + rule.average_losing_trade_ticks),
  };
}

/** Rank 1 = best net dollars; ties keep their order in `netDollars` (polars rank "ordinal"). */
export function rankBestFirst(net: ArrayLike<number>): number[] {
  const order = Array.from({ length: net.length }, (_, index) => index);
  order.sort((a, b) => (net[b] as number) - (net[a] as number) || a - b);
  const ranks = new Array<number>(net.length);
  order.forEach((index, position) => {
    ranks[index] = position + 1;
  });
  return ranks;
}
