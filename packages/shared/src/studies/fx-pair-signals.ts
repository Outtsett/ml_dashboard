/**
 * Per-pair FX signal research: the body of GET /api/studies/fx-pair-signals,
 * shared by the handler and the page, plus the small pure computations both
 * use (the notebook's hour-21 ratio, the participation ratio's running sums,
 * mechanical share, the colour scales).
 *
 * Source tables: derived_study_fx_pair_signals_<table>, landed by
 * packages/ml-engine/src/studies/fx_pair_signals/build.py from the CSVs forexmodel's
 * scripts/pair_spread.py, pair_correlation.py and pair_structure.py emit.
 */

export const LADDER_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
export const CORRELATION_TIMEFRAMES = ["5m", "1h", "1d"] as const;
export const SCREEN_TIMEFRAMES = ["15m", "1h", "1d"] as const;
export const SCREEN_TARGETS = ["forward_log_range", "forward_log_return"] as const;
export type ScreenTarget = (typeof SCREEN_TARGETS)[number];

export const TARGET_LABEL: Record<ScreenTarget, string> = {
  forward_log_range: "forward log range (volatility)",
  forward_log_return: "forward log return (direction)",
};

export interface InventoryRow {
  pair: string;
  bar_count: number;
  first_bar_timestamp: number;
  last_bar_timestamp: number;
  bars_with_quotes_count: number;
  first_quote_timestamp: number;
  last_quote_timestamp: number;
  quote_coverage_ratio: number;
}

/** The statistics each spread unit carries (pips and basis points). */
export const SPREAD_STATISTICS = [
  "count", "mean", "median", "standard_deviation", "skewness", "excess_kurtosis",
  "percentile_25", "percentile_50", "percentile_75", "minimum", "maximum", "dropped_count",
] as const;
export type SpreadStatistic = (typeof SPREAD_STATISTICS)[number];
export type SpreadUnit = "basis_points" | "pips";

export type SpreadColumns = {
  [K in `spread_${SpreadUnit}_${SpreadStatistic}`]: number | null;
};

export interface SpreadRow extends SpreadColumns {
  pair: string;
  first_quote_timestamp: number;
  last_quote_timestamp: number;
}

export interface SpreadHourRow extends SpreadColumns {
  pair: string;
  hour_utc: number;
}

/** The notebook's hour-of-day curve: per hour, the median across pairs of each pair's median spread. */
export interface HourAcrossPairsRow {
  hour_utc: number;
  median_basis_points: number;
  median_pips: number;
  pair_count: number;
}

export interface TradabilityRow {
  pair: string;
  timeframe: string;
  bar_count: number;
  average_true_range_14_bars_price: number;
  average_true_range_14_bars_pips: number;
  average_true_range_14_bars_basis_points: number;
  median_spread_pips: number;
  spread_over_average_true_range: number;
  round_trip_over_average_true_range: number;
  breakeven_move_average_true_ranges: number;
  breakeven_move_pips: number;
}

export interface CorrelationRow {
  timeframe: string;
  pair_a: string;
  pair_b: string;
  shared_currency: string | null;
  observation_count: number;
  correlation_raw_pearson: number | null;
  correlation_raw_spearman: number | null;
  correlation_tail_decile: number | null;
  tail_observation_count: number;
  correlation_residual_pearson: number | null;
  residual_observation_count: number;
  residual_identifiable: boolean;
  mechanical_share: number | null;
}

export interface EigenRow {
  timeframe: string;
  matrix: "raw" | "residual";
  component: number;
  eigenvalue: number;
  variance_share: number;
  cumulative_variance_share: number;
  observation_count: number;
  participation_ratio: number;
}

export interface ParticipationRow {
  timeframe: string;
  matrix: string;
  participation_ratio: number;
  observation_count: number;
}

export interface BodyVersusTailRow {
  timeframe: string;
  mean_absolute_raw: number;
  mean_absolute_residual: number;
  mean_absolute_tail: number;
  pair_combination_count: number;
}

export interface UnidentifiableRow {
  timeframe: string;
  pair_a: string;
  pair_b: string;
  shared_currency: string | null;
  correlation_residual_pearson: number | null;
}

export interface SurvivalRow {
  target: ScreenTarget;
  family: string;
  tests: number;
  survived: number;
  max_absolute_spearman: number;
  survival_rate: number;
}

export interface ScreenRow {
  pair: string;
  timeframe: string;
  target: ScreenTarget;
  feature: string;
  family: string;
  observation_count: number;
  spearman_correlation: number;
  null_95th_percentile_per_feature: number;
  null_95th_percentile_family_wise: number;
  survives_per_feature: boolean;
  survives_family_wise: boolean;
}

/** One screen row's numbers only, for the column profiles (the filtered screen can be all 5,400 rows). */
export interface ScreenProfileRow {
  spearman_correlation: number;
  null_95th_percentile_per_feature: number;
  null_95th_percentile_family_wise: number;
  observation_count: number;
}

export interface HeatCell {
  pair: string;
  feature: string;
  family: string;
  spearman_correlation: number;
  survives: boolean;
}

export interface RedundancyRow {
  feature_a: string;
  feature_b: string;
  family_a: string;
  family_b: string;
  spearman_correlation: number;
}

export interface FxPairSignalsBody {
  recipe: string | null;
  inventory: InventoryRow[];
  spread: SpreadRow[];
  spreadHour: SpreadHourRow[];
  hourAcrossPairs: HourAcrossPairsRow[];
  tradability: TradabilityRow[];
  correlation: CorrelationRow[];
  eigen: EigenRow[];
  participation: ParticipationRow[];
  bodyVersusTail: BodyVersusTailRow[];
  unidentifiable: UnidentifiableRow[];
  /** Survival per (target, family) under the screen filters and criterion. */
  survival: SurvivalRow[];
  /** The strongest surviving tests under the filters, by absolute Spearman correlation. */
  strongest: ScreenRow[];
  screenProfile: ScreenProfileRow[];
  /** Pair x feature Spearman correlation at the heat map's timeframe and target. */
  heatmap: HeatCell[];
  /** Feature pairs above the redundancy threshold, strongest first (the notebook's near duplicates). */
  nearDuplicates: RedundancyRow[];
  /** Every feature pair (1,225), for the redundancy histogram and matrix. */
  redundancy: RedundancyRow[];
  pairs: string[];
  families: string[];
}

export const EMPTY_BODY: FxPairSignalsBody = {
  recipe: null, inventory: [], spread: [], spreadHour: [], hourAcrossPairs: [], tradability: [], correlation: [], eigen: [],
  participation: [], bodyVersusTail: [], unidentifiable: [], survival: [], strongest: [], screenProfile: [], heatmap: [],
  nearDuplicates: [], redundancy: [], pairs: [], families: [],
};

// ── wire format: the five large frames travel column by column ──────────────
//
// Row objects repeat every key on every row; for the 5,400-row screen and the
// 26-column hour table that was most of a 2.4 MB response. Columns carry each
// name once, and doubles are rounded to 8 significant digits (display needs 4;
// every headline number is computed in SQL at full precision before this).

export interface Columnar<Row> {
  count: number;
  columns: string[];
  values: Record<string, unknown[]>;
  /** Only for typing: the row shape these columns decode to. */
  readonly __row?: Row;
}

const SIGNIFICANT_DIGITS = 8;

function compactValue(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) return Number(value.toPrecision(SIGNIFICANT_DIGITS));
  return value;
}

export function toColumnar<Row extends object>(rows: readonly Row[]): Columnar<Row> {
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const values: Record<string, unknown[]> = {};
  for (const column of columns) values[column] = rows.map((row) => compactValue((row as Record<string, unknown>)[column]));
  return { count: rows.length, columns, values };
}

export function fromColumnar<Row>(table: Columnar<Row>): Row[] {
  const rows: Row[] = [];
  for (let index = 0; index < table.count; index += 1) {
    const row: Record<string, unknown> = {};
    for (const column of table.columns) row[column] = table.values[column]?.[index] ?? null;
    rows.push(row as Row);
  }
  return rows;
}

type ColumnarField = "spreadHour" | "correlation" | "redundancy" | "screenProfile" | "heatmap";

export type FxPairSignalsWire = Omit<FxPairSignalsBody, ColumnarField> & {
  [K in ColumnarField]: Columnar<FxPairSignalsBody[K][number]>;
};

export function encodeBody(body: FxPairSignalsBody): FxPairSignalsWire {
  return {
    ...body,
    spreadHour: toColumnar(body.spreadHour),
    correlation: toColumnar(body.correlation),
    redundancy: toColumnar(body.redundancy),
    screenProfile: toColumnar(body.screenProfile),
    heatmap: toColumnar(body.heatmap),
  };
}

export function decodeBody(wire: FxPairSignalsWire): FxPairSignalsBody {
  return {
    ...wire,
    spreadHour: fromColumnar(wire.spreadHour),
    correlation: fromColumnar(wire.correlation),
    redundancy: fromColumnar(wire.redundancy),
    screenProfile: fromColumnar(wire.screenProfile),
    heatmap: fromColumnar(wire.heatmap),
  };
}

export const EMPTY_WIRE: FxPairSignalsWire = encodeBody(EMPTY_BODY);

// ── pure computations ───────────────────────────────────────────────────────

export function median(values: readonly number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export interface HourRatio {
  /** Spread in the chosen hour. */
  spike: number | null;
  /** Median of the per-hour spreads over the hours before `ordinaryBelow` (the notebook: hours 0-19). */
  ordinary: number | null;
  ratio: number | null;
  /** (dearest - cheapest) / cheapest among the ordinary hours: the notebook's "about 5%". */
  ordinaryRange: number | null;
  ordinaryHourCount: number;
}

/**
 * The notebook's rollover call-out: spread at `spikeHour` against the median of
 * the ordinary hours (`hour_utc < ordinaryBelow`). Defaults are the notebook's, 21 and 20.
 */
export function hourRatio(curve: ReadonlyArray<{ hour_utc: number; value: number }>, spikeHour = 21, ordinaryBelow = 20): HourRatio {
  const spike = curve.find((row) => row.hour_utc === spikeHour)?.value ?? null;
  const ordinaryValues = curve.filter((row) => row.hour_utc < ordinaryBelow && row.hour_utc !== spikeHour).map((row) => row.value);
  const ordinary = median(ordinaryValues);
  const lowest = ordinaryValues.length ? Math.min(...ordinaryValues) : null;
  const highest = ordinaryValues.length ? Math.max(...ordinaryValues) : null;
  return {
    spike,
    ordinary,
    ratio: spike !== null && ordinary !== null && ordinary !== 0 ? spike / ordinary : null,
    ordinaryRange: lowest !== null && highest !== null && lowest !== 0 ? (highest - lowest) / lowest : null,
    ordinaryHourCount: ordinaryValues.length,
  };
}

export interface ParticipationStep {
  component: number;
  eigenvalue: number;
  runningSum: number;
  runningSumOfSquares: number;
  /** (running sum)^2 / running sum of squares: the participation ratio of the first k components. */
  runningRatio: number;
}

/** Participation ratio (sum lambda)^2 / sum lambda^2, with its running terms for the stepper. */
export function participationSteps(eigenvalues: readonly number[]): ParticipationStep[] {
  let sum = 0;
  let squares = 0;
  return eigenvalues.map((eigenvalue, index) => {
    sum += eigenvalue;
    squares += eigenvalue * eigenvalue;
    return { component: index + 1, eigenvalue, runningSum: sum, runningSumOfSquares: squares, runningRatio: squares > 0 ? (sum * sum) / squares : 0 };
  });
}

/** 1 - |residual| / |raw|: the share of a raw correlation the shared currency leg explains (pair_correlation.py). */
export function mechanicalShare(raw: number | null, residual: number | null): number | null {
  if (raw === null || residual === null || !Number.isFinite(raw) || !Number.isFinite(residual) || raw === 0) return null;
  return 1 - Math.abs(residual) / Math.abs(raw);
}

// ── colour scales (Okabe-Ito diverging, cividis sequential) ─────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function blend(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * Math.min(1, Math.max(0, t)));
  return `rgb(${mix(ar, br)},${mix(ag, bg)},${mix(ab, bb)})`;
}

const NEUTRAL = "#262626";

/** Negative blue #0072B2, positive orange #E69F00, zero dark neutral; `limit` maps to full colour. */
export function divergingColour(value: number | null, limit = 1): string {
  if (value === null || !Number.isFinite(value)) return "#111111";
  const t = Math.min(1, Math.abs(value) / (limit || 1));
  return value >= 0 ? blend(NEUTRAL, "#E69F00", t) : blend(NEUTRAL, "#0072B2", t);
}

const CIVIDIS = ["#00204D", "#31446B", "#666970", "#958F78", "#CBBA69", "#FFEA46"];

/** Cividis for a position t in [0, 1]. */
export function cividis(t: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const scaled = clamped * (CIVIDIS.length - 1);
  const index = Math.min(CIVIDIS.length - 2, Math.floor(scaled));
  return blend(CIVIDIS[index] as string, CIVIDIS[index + 1] as string, scaled - index);
}
