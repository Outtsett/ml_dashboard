/**
 * TA-indicator strategy vs 600 MNQ ticks a day: the body of
 * GET /api/studies/ta-strategy-600-ticks?part=<part> for every part, and the
 * pure arithmetic the page and the server share (the goal formula, the
 * frequency curve, the expected-move formula and the zone merge of
 * packages/ml-engine/src/ta_strategy/levels.py `zones_for_bars`, ported line for line).
 *
 * The study itself lives in packages/ml-engine/src/ta_strategy (rounds landed as
 * derived_ta_strategy_600_ticks_*, derived_ta_rule_strategies_600_ticks_*,
 * derived_ta_conditional_strategies_600_ticks_*); section 15's per-session
 * rebuild is landed by packages/ml-engine/src/studies/ta_strategy_600_ticks/build.py as
 * derived_study_ta_strategy_600_ticks_zone_build_*.
 */

export type Row = Record<string, unknown>;

/** Every part the page asks for; each tab reads one or more. */
export const TA_STRATEGY_PARTS = [
  "overview",
  "battery",
  "battery_round",
  "battery_configuration",
  "rules",
  "rules_round",
  "rules_strategy",
  "conditional",
  "conditional_round",
  "conditional_session",
  "conditional_template",
  "frequency",
  "season",
  "cascade",
  "cascade_session",
  "zones",
  "zones_session",
  "build_days",
  "build",
] as const;
export type TaStrategyPart = (typeof TA_STRATEGY_PARTS)[number];

export const STUDY_MARKETS = ["MNQ", "NQ"] as const;
export const BUILD_MARKETS = ["MNQ", "NQ", "ES", "MES"] as const;
export const BUILD_TIMEFRAMES = ["5m", "15m", "30m"] as const;
export const BUILD_FAMILIES = [
  "session", "overnight", "opening_range", "week", "round", "fractal_15m", "fractal_1h", "fractal_4h",
  "swing_5m", "swing_15m", "swing_30m", "vwap",
] as const;
export const VWAP_KEYS = [
  "session_vwap", "session_vwap_upper_1", "session_vwap_lower_1", "session_vwap_upper_2", "session_vwap_lower_2",
] as const;

/** One column of a frame profiled on the server: its eight numbers and a histogram. */
export interface ColumnProfile {
  column: string;
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
  bins: Array<{ lower: number; upper: number; count: number }>;
}

export interface OverviewBody {
  goalTicks: number;
  costTicks: number;
  tickValueUsd: number;
  tickSizePoints: number;
  costPerSideUsd: number;
  costSource: string;
}

export interface BatteryBody { rounds: Row[]; reviews: Row[] }
export interface BatteryRoundBody { configurations: Row[]; oracle: Row[]; oracleProfiles: ColumnProfile[]; importance: Row[] }
export interface BatteryConfigurationBody { daily: Row[]; folds: Row[]; tradeProfiles: ColumnProfile[]; tradeCount: number }

export interface RulesBody { rounds: Row[]; reviews: Row[] }
export interface RulePoint {
  strategy_id: string;
  timeframe: string;
  filter: string;
  rate: number | null;
  random_rate: number | null;
  lift_over_random: number | null;
  profit_factor: number | null;
  net_ticks_per_session_day: number | null;
  trades_per_session_day: number | null;
  payoff_ratio: number | null;
}
export interface RulesRoundBody {
  strict: boolean;
  period: string;
  rateColumn: string;
  points: RulePoint[];
  baselines: Row[];
  inVersusOut: Row[];
  top: Row[];
  profiles: ColumnProfile[];
  keptStrategies: string[];
  strategyCount: number;
}
export interface RulesStrategyBody { daily: Row[]; exits: Row[]; yearly: Row[]; tradeProfiles: ColumnProfile[]; tradeCount: number }

/** Cumulative daily series on one shared date axis (columnar, so thousands of days stay small). */
export interface SeriesSet {
  dates: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
}

export interface ConditionalBody {
  rounds: Row[];
  reviews: Row[];
  confirmation: { rounds: Row[]; strategies: Row[]; cumulativeExcess: SeriesSet; pooled: Array<{ session_date: string; pooled_excess_ticks: number; cumulative_pooled_excess_ticks: number }> };
}
export interface ConditionalRoundBody {
  levelQuality: Row[];
  levelQualitySource: string;
  templates: Row[];
  folds: Row[];
  sessionDays: string[];
  families: string[];
}
export interface ConditionalSessionBody { bars: Row[]; levels: Row[] }
export interface ConditionalTemplateBody { daily: Row[]; trials: Row[]; exits: Row[]; tradeProfiles: ColumnProfile[]; tradeCount: number }

export interface FrequencyBody { rounds: Row[]; variants: Row[]; portfolio: Row[]; years: Row[]; prices: Row[]; hours: Row[] }

export interface SeasonBody {
  recipe: string;
  years: string[];
  buckets: Row[];
  heat: Row[];
  shapeYear: string;
  shape: Row[];
  events: Row[];
  sessions: Row[];
  sessionProfiles: ColumnProfile[];
  parts: Row[];
  calendar: Row[];
  stability: Row[];
  roundFive: RoundTemplates;
}

/** The last recipe of one conditional round: its rounds rows, templates and a cumulative daily series per template. */
export interface RoundTemplates { recipe: string | null; rounds: Row[]; templates: Row[]; cumulative: SeriesSet }

export interface CascadeBody {
  recipe: string;
  levels: Row[];
  occupancy: Row[];
  moves: Row[];
  volumeDeciles: Row[];
  volumeSummary: Row[];
  volatility: Row[];
  oracle: Row[];
  sessionDays: string[];
  roundTen: RoundTemplates;
}
export interface CascadeSessionBody { minutes: Row[]; levels: Row[]; trades: Row[] }

export interface ZonesBody {
  recipe: string;
  summary: Row[];
  leak: Row[];
  touchStatistics: { resolvedTouches: number; sessionDays: number; favourableTicksMedian: number | null; shareOfTouchesPayingCost: number | null };
  profiles: ColumnProfile[];
  sessionDays: string[];
  roundsTwelveThirteen: { recipes: Row[]; templates: Row[]; cumulative: SeriesSet };
}
export interface ZonesSessionBody { touches: Row[]; minutes: Row[]; trades: Row[] }

export interface BuildDaysBody { days: string[] }
export interface BuildBar {
  bar: number;
  timestamp_seconds: number;
  bar_end_seconds: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  average_true_range_14: number | null;
  raw_close: number;
  contract: string;
  session_vwap: number;
  session_vwap_upper_1: number;
  session_vwap_lower_1: number;
  session_vwap_upper_2: number;
  session_vwap_lower_2: number;
}
export interface LevelEvent {
  price: number;
  source: string;
  family: string;
  family_group: string;
  known_from_seconds: number;
  valid_until_seconds: number;
}
export interface BuildBody { session: Row | null; bars: BuildBar[]; events: LevelEvent[]; reference: Row[] }

// ── section 1: the goal as a formula ─────────────────────────────────────────

export interface GoalInputs {
  goalTicks: number;        // G
  tradesPerDay: number;     // N
  riskTicks: number;        // T
  rewardToRisk: number;     // R
  contracts: number;        // k
  costTicks: number;        // c
}

/** p = (G/k/N + c + T) / ((R + 1) T): the win rate a day of N trades needs to net G over k contracts. */
export function winRateNeeded(inputs: GoalInputs): number {
  const { goalTicks, tradesPerDay, riskTicks, rewardToRisk, contracts, costTicks } = inputs;
  return (goalTicks / contracts / tradesPerDay + costTicks + riskTicks) / ((rewardToRisk + 1) * riskTicks);
}

/** The win rate that nets zero: (c + T) / ((R + 1) T). */
export function winRateBreakEven(inputs: Pick<GoalInputs, "riskTicks" | "rewardToRisk" | "costTicks">): number {
  return (inputs.costTicks + inputs.riskTicks) / ((inputs.rewardToRisk + 1) * inputs.riskTicks);
}

/** The notebook's curve over N = 1..100, clamped at 1.2 so an impossible rate stays on the chart. */
export function winRateCurve(inputs: GoalInputs, maximumTrades = 100): Array<{ tradesPerDay: number; winRateNeeded: number }> {
  const out: Array<{ tradesPerDay: number; winRateNeeded: number }> = [];
  for (let n = 1; n <= maximumTrades; n += 1) {
    out.push({ tradesPerDay: n, winRateNeeded: Math.min(winRateNeeded({ ...inputs, tradesPerDay: n }), 1.2) });
  }
  return out;
}

/** Section 11: the average gross ticks a trade must capture for N trades to total G: G / N + c. */
export function requiredGrossPerTrade(goalTicks: number, tradesPerDay: number, costTicks: number): number {
  return goalTicks / tradesPerDay + costTicks;
}

// ── section 12: the expected move ────────────────────────────────────────────

export interface ExpectedMove {
  windowMinutes: number;
  sumOfSquares: number;
  levelFraction: number;      // L x the typical average-minute absolute return, as a fraction
  movePoints: number;
  flatMovePoints: number;
  peakShape: number | null;
  clock: string;
}

/**
 * expected range = sqrt(8/pi) sqrt(pi/2) L sqrt(sum_{u=t+1}^{t+h} s_u^2) P, with s_u the seasonal shape of
 * minute u (each 5-minute bucket's value repeated five times, as the notebook does) and L the level times
 * the average-minute absolute return in basis points.
 */
export function expectedMove(shapePerMinute: readonly number[], start: number, horizon: number, level: number,
  meanAbsoluteBasisPoints: number, price: number): ExpectedMove {
  const window = shapePerMinute.slice(start + 1, Math.min(start + 1 + horizon, shapePerMinute.length));
  let sumOfSquares = 0;
  let peak: number | null = null;
  for (const value of window) {
    if (!Number.isFinite(value)) continue;
    sumOfSquares += value * value;
    peak = peak === null ? value : Math.max(peak, value);
  }
  const levelFraction = (level * meanAbsoluteBasisPoints) / 1e4;
  const factor = Math.sqrt(8 / Math.PI) * Math.sqrt(Math.PI / 2) * levelFraction * price;
  const minutes = (start + 900) % 1440;
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return {
    windowMinutes: window.length,
    sumOfSquares,
    levelFraction,
    movePoints: factor * Math.sqrt(sumOfSquares),
    flatMovePoints: factor * Math.sqrt(window.length),
    peakShape: peak,
    clock,
  };
}

// ── section 15: zones, ported from levels.zones_for_bars ────────────────────

export interface ZoneAtBar {
  support_price: number | null;
  support_low: number | null;
  support_high: number | null;
  support_strength: number | null;
  support_families: string | null;
  resistance_price: number | null;
  resistance_low: number | null;
  resistance_high: number | null;
  resistance_strength: number | null;
  resistance_families: string | null;
  inside_zone: boolean;
  zones_within_2_atr: number | null;
}

const EMPTY_ZONE: ZoneAtBar = {
  support_price: null, support_low: null, support_high: null, support_strength: null, support_families: null,
  resistance_price: null, resistance_low: null, resistance_high: null, resistance_strength: null, resistance_families: null,
  inside_zone: false, zones_within_2_atr: null,
};

export interface ZoneBarInput {
  bar_end_seconds: number;
  close: number;
  average_true_range_14: number | null;
  vwap?: Readonly<Record<string, number>> | null;
}

/** A level in reach of one bar's close, with the zone it falls in (the section-15 ladder). */
export interface LadderLevel {
  price: number;
  source: string;
  family: string;
  family_group: string;
  distance_atr: number;
  gap_to_previous: number | null;
  starts_new_zone: boolean;
  zone: number;
}
export interface LadderZone {
  zone: number;
  low: number;
  high: number;
  centre: number;
  levels: number;
  families: string;
  strength: number;
  role: "support" | "resistance" | "";
  width_ticks: number;
  distance_from_close_ticks: number;
}

function numeric(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Python's float mean of a slice (sum in order, then divide), so centres match numpy to the last bit. */
function sliceMean(values: readonly number[], start: number, stop: number): number {
  let total = 0;
  for (let index = start; index < stop; index += 1) total += values[index] as number;
  return total / (stop - start);
}

/**
 * The zone map at each bar's close: every active level within `reachAtr` x ATR, plus the VWAP bands when
 * given, sorted and single-linked (a gap larger than max(widthAtr x ATR, 4 ticks) starts a new zone);
 * support = the zone whose centre is nearest at or below the close, resistance = nearest above; strength =
 * distinct family groups. `events` must be sorted by known_from_seconds (stable), as the lake returns them.
 */
export function zonesForBars(bars: readonly ZoneBarInput[], events: readonly LevelEvent[], tick: number,
  widthAtr = 0.25, reachAtr = 6): ZoneAtBar[] {
  const out: ZoneAtBar[] = [];
  let active: number[] = [];
  let pointer = 0;
  for (const bar of bars) {
    const end = bar.bar_end_seconds;
    while (pointer < events.length && (events[pointer] as LevelEvent).known_from_seconds <= end) {
      active.push(pointer);
      pointer += 1;
    }
    active = active.filter((index) => (events[index] as LevelEvent).valid_until_seconds > end);
    const close = bar.close;
    const atr = bar.average_true_range_14;
    if (!numeric(atr) || atr <= 0) {
      out.push({ ...EMPTY_ZONE });
      continue;
    }
    const members: Array<{ price: number; group: string }> = [];
    for (const index of active) {
      const event = events[index] as LevelEvent;
      if (Math.abs(event.price - close) <= reachAtr * atr) members.push({ price: event.price, group: event.family_group });
    }
    if (bar.vwap) for (const value of Object.values(bar.vwap)) members.push({ price: value, group: "vwap" });
    if (members.length === 0) {
      out.push({ ...EMPTY_ZONE });
      continue;
    }
    // numpy's argsort is not stable by default, but ties share a price, so the zone bounds do not depend on it
    members.sort((a, b) => a.price - b.price);
    const prices = members.map((member) => member.price);
    const gap = Math.max(widthAtr * atr, 4 * tick);
    const starts = [0];
    for (let index = 1; index < prices.length; index += 1) {
      if ((prices[index] as number) - (prices[index - 1] as number) > gap) starts.push(index);
    }
    const stops = [...starts.slice(1), prices.length];
    const centres = starts.map((start, zone) => sliceMean(prices, start, stops[zone] as number));
    const result: ZoneAtBar = { ...EMPTY_ZONE };
    result.zones_within_2_atr = centres.filter((centre) => Math.abs(centre - close) <= 2 * atr).length;
    let below = -1;
    let above = -1;
    centres.forEach((centre, zone) => {
      if (centre <= close) below = zone;
      else if (above < 0) above = zone;
    });
    for (const [name, pick] of [["support", below], ["resistance", above]] as const) {
      if (pick < 0) continue;
      const start = starts[pick] as number;
      const stop = stops[pick] as number;
      const groups = [...new Set(members.slice(start, stop).map((member) => member.group))].sort();
      result[`${name}_price`] = centres[pick] as number;
      result[`${name}_low`] = prices[start] as number;
      result[`${name}_high`] = prices[stop - 1] as number;
      result[`${name}_strength`] = groups.length;
      result[`${name}_families`] = groups.join("+");
    }
    result.inside_zone = starts.some((start, zone) => {
      const low = prices[start] as number;
      const high = prices[(stops[zone] as number) - 1] as number;
      return low - gap / 2 <= close && close <= high + gap / 2;
    });
    out.push(result);
  }
  return out;
}

/** The section-15 ladder for one bar: the levels in reach, sorted, with the gaps that cut them into zones. */
export function zoneLadder(bar: ZoneBarInput, events: readonly LevelEvent[], tick: number, widthAtr: number,
  reachAtr: number): { levels: LadderLevel[]; zones: LadderZone[]; gap: number | null } {
  const atr = bar.average_true_range_14;
  const close = bar.close;
  const end = bar.bar_end_seconds;
  if (!numeric(atr) || atr <= 0) return { levels: [], zones: [], gap: null };
  const candidates: Array<Omit<LadderLevel, "gap_to_previous" | "starts_new_zone" | "zone">> = [];
  for (const event of events) {
    if (event.known_from_seconds > end || event.valid_until_seconds <= end) continue;
    const distance = (event.price - close) / atr;
    if (Math.abs(distance) <= reachAtr) {
      candidates.push({ price: event.price, source: event.source, family: event.family, family_group: event.family_group, distance_atr: distance });
    }
  }
  if (bar.vwap) {
    for (const [source, price] of Object.entries(bar.vwap)) {
      const distance = (price - close) / atr;
      if (Math.abs(distance) <= reachAtr) candidates.push({ price, source, family: "session_vwap", family_group: "vwap", distance_atr: distance });
    }
  }
  candidates.sort((a, b) => a.price - b.price);
  const gap = Math.max(widthAtr * atr, 4 * tick);
  let zone = 0;
  const levels: LadderLevel[] = candidates.map((candidate, index) => {
    const previous = index > 0 ? (candidates[index - 1] as { price: number }).price : null;
    const gapToPrevious = previous === null ? null : candidate.price - previous;
    const starts = gapToPrevious === null || gapToPrevious > gap;
    if (starts) zone += 1;
    return { ...candidate, gap_to_previous: gapToPrevious, starts_new_zone: starts, zone };
  });
  const zones: LadderZone[] = [];
  for (let z = 1; z <= zone; z += 1) {
    const members = levels.filter((level) => level.zone === z);
    const prices = members.map((member) => member.price);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const centre = prices.reduce((a, b) => a + b, 0) / prices.length;
    const groups = [...new Set(members.map((member) => member.family_group))].sort();
    zones.push({
      zone: z, low, high, centre, levels: members.length, families: groups.join("+"), strength: groups.length, role: "",
      width_ticks: (high - low) / tick, distance_from_close_ticks: (centre - close) / tick,
    });
  }
  const below = zones.filter((z) => z.centre <= close);
  const above = zones.filter((z) => z.centre > close);
  if (below.length) (below[below.length - 1] as LadderZone).role = "support";
  if (above.length) (above[0] as LadderZone).role = "resistance";
  return { levels, zones, gap };
}

// ── small shared helpers ─────────────────────────────────────────────────────

/** The CME session a stamp belongs to: the date of (stamp + 9 hours), Pacific wall clock stored as UTC. */
export function sessionDayOf(timestampMilliseconds: number): string {
  return new Date(timestampMilliseconds + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Rows of (name, session_date, value) sorted by date into cumulative sums on one date axis; a series is null
 * before its first day and carries its total over days it did not trade.
 */
export function cumulativeSeries(rows: readonly Row[], nameKey: string, valueKey: string): SeriesSet {
  const dates = [...new Set(rows.map((row) => String(row.session_date)))].sort();
  const position = new Map(dates.map((date, index) => [date, index]));
  const byName = new Map<string, Array<number | null>>();
  for (const row of rows) {
    const name = String(row[nameKey]);
    let values = byName.get(name);
    if (!values) {
      values = new Array<number | null>(dates.length).fill(null);
      byName.set(name, values);
    }
    const index = position.get(String(row.session_date)) as number;
    const value = typeof row[valueKey] === "number" && Number.isFinite(row[valueKey]) ? (row[valueKey] as number) : 0;
    values[index] = (values[index] ?? 0) + value;
  }
  const series = [...byName.entries()].map(([name, daily]) => {
    let total: number | null = null;
    const values = daily.map((value) => {
      if (value !== null) total = (total ?? 0) + value;
      return total;
    });
    return { name, values };
  });
  return { dates, series };
}

/** Running sums of `key` in row order, one series per `groupKey` value when given. */
export function cumulative<T extends Row>(rows: readonly T[], key: string, into: string, groupKey?: string): Array<T & Record<string, number>> {
  const totals = new Map<string, number>();
  return rows.map((row) => {
    const group = groupKey ? String(row[groupKey]) : "";
    const value = typeof row[key] === "number" && Number.isFinite(row[key]) ? (row[key] as number) : 0;
    const total = (totals.get(group) ?? 0) + value;
    totals.set(group, total);
    return { ...row, [into]: total } as T & Record<string, number>;
  });
}
