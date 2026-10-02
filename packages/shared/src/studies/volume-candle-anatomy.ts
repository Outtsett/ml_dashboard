/**
 * Volume and the parts of a candle: the body of GET /api/studies/volume-candle-anatomy
 * (shared by the handler and the page) and the pure compute both use.
 *
 * Three parts, asked for separately so a control never re-sends what did not change:
 *   part=board    the whole-population rows of the landed study (derived_mnq_volume_candle_anatomy) and its conclusions
 *   part=deciles  the per-decile rows for one timeframe, population and volume reading (Panels D and E)
 *   part=window   real MNQ 5m holdout bars with the five readings of a volume bar (Panel A)
 */

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"] as const;

/** The notebook's order; the first four are the readings of a bar, the fifth cuts across them. */
export const ENCODING_ORDER = [
  "volume_contracts",
  "volume_bar_height_in_window",
  "volume_zscore_trailing",
  "volume_rank_trailing",
  "volume_signed_by_candle_direction",
] as const;

export const MEASURE_ORDER = [
  "upper_wick_in_average_ranges",
  "lower_wick_in_average_ranges",
  "body_absolute_in_average_ranges",
  "body_signed_in_average_ranges",
  "total_range_in_average_ranges",
  "body_fraction_of_range",
  "total_wick_fraction_of_range",
  "wick_asymmetry_upper_minus_lower",
] as const;

export const POPULATIONS = [
  { value: "closes_inside_range", label: "bars closing inside their range (the control)" },
  { value: "all_bars", label: "all bars" },
  { value: "rising_candles_inside_range", label: "rising candles only" },
  { value: "falling_candles_inside_range", label: "falling candles only" },
] as const;

/** Readings Panel D offers (the signed reading is covered by Panel E). */
export const DECILE_ENCODINGS = [
  "volume_rank_trailing",
  "volume_zscore_trailing",
  "volume_bar_height_in_window",
  "volume_contracts",
] as const;

/** Bars of history every trailing statistic looks at, shifted one bar (the notebook's and the build's window). */
export const TRAILING_WINDOW = 120;
/** Lead-in rows the window query reads before the first bar shown (the notebook's +140). */
export const LEAD_IN_ROWS = 140;

export interface BoardOverallRow {
  timeframe: string;
  bar_population: string;
  volume_encoding: string;
  anatomy_measure: string;
  bar_count: number;
  pearson_correlation: number | null;
  spearman_correlation: number | null;
  mutual_information_nats: number | null;
  gaussian_equivalent_mutual_information_nats: number | null;
  mutual_information_excess_ratio: number | null;
  relationship_is_nonlinear: boolean | null;
  pairing_shares_a_construction_term: boolean | null;
  anatomy_mean: number | null;
  anatomy_median: number | null;
  anatomy_standard_deviation: number | null;
  anatomy_skewness: number | null;
  anatomy_kurtosis: number | null;
  anatomy_percentile_25: number | null;
  anatomy_percentile_75: number | null;
  anatomy_minimum: number | null;
  anatomy_maximum: number | null;
}

export interface BoardDecileRow {
  timeframe: string;
  bar_population: string;
  volume_encoding: string;
  anatomy_measure: string;
  volume_decile: number;
  bar_count: number;
  anatomy_mean: number | null;
  anatomy_median: number | null;
  anatomy_standard_deviation: number | null;
  anatomy_skewness: number | null;
  anatomy_kurtosis: number | null;
  anatomy_percentile_25: number | null;
  anatomy_percentile_75: number | null;
  anatomy_minimum: number | null;
  anatomy_maximum: number | null;
}

export interface EncodingConclusion {
  volume_encoding: string;
  mean_absolute_spearman: number;
  pairing_count: number;
}

export interface MeasureConclusion {
  anatomy_measure: string;
  best_absolute_spearman: number;
  best_volume_encoding: string;
}

export interface BoardBody {
  recipe: string;
  /** Every row the study landed, deciles included (8,800 in the first recipe). */
  rowCount: number;
  timeframes: string[];
  overall: BoardOverallRow[];
  /** Panel G answer tables: bars closing inside their range, pairings that share no construction term. */
  byEncoding: EncodingConclusion[];
  byMeasure: MeasureConclusion[];
}

/** A raw bar as read from the lake. */
export interface RawBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WindowBar extends RawBar {
  volume_contracts: number;
  volume_bar_height_in_window: number;
  volume_zscore_trailing: number | null;
  volume_rank_trailing: number;
  volume_signed_by_candle_direction: number;
  candle_direction: "rising" | "falling";
}

export interface WindowBody {
  recipe: string;
  /** Bars in the 2025 holdout, so the page can size its scroll slider. */
  holdoutBarCount: number;
  windowStart: number;
  windowLength: number;
  bars: WindowBar[];
  /** Spearman between the raw count and the bar height on these bars: not 1.0, because the height's denominator moves. */
  spearmanRawAgainstHeight: number | null;
}

export interface DecilesBody {
  recipe: string;
  timeframe: string;
  population: string;
  encoding: string;
  /** The chosen population, plus the rising and the falling candles inside their range for Panel E. */
  rows: BoardDecileRow[];
}

export interface VolumeCandleAnatomyBody {
  part: "board" | "deciles" | "window";
  board: BoardBody | null;
  deciles: DecilesBody | null;
  window: WindowBody | null;
}

// ---------------------------------------------------------------------------
// Panel A: the five readings of a volume bar (causal: every trailing statistic
// is shifted one bar and needs a full window, so warmup rows are dropped).
// ---------------------------------------------------------------------------

function sampleStandardDeviation(values: number[], mean: number): number {
  let sum = 0;
  for (const value of values) sum += (value - mean) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

/**
 * The readings for `rows` (ascending in time), keeping the last `length` bars that have a full
 * trailing window. `window` bars precede each shown bar and never include it:
 *   bar height   = volume / max(previous window volumes)
 *   z-score      = (ln volume - mean(ln previous)) / sample standard deviation(ln previous)
 *   rank         = share of the previous window volumes strictly below this one
 *   signed       = volume x sign(close - open)
 */
export function volumeReadings(rows: readonly RawBar[], length: number, window = TRAILING_WINDOW): WindowBar[] {
  const out: WindowBar[] = [];
  for (let index = window; index < rows.length; index += 1) {
    const bar = rows[index] as RawBar;
    const previous = rows.slice(index - window, index);
    const volumes = previous.map((row) => row.volume);
    const logs = previous.map((row) => Math.log(Math.max(row.volume, 1)));
    const logMean = logs.reduce((a, b) => a + b, 0) / window;
    const logStandardDeviation = sampleStandardDeviation(logs, logMean);
    const maximum = Math.max(...volumes);
    const body = bar.close - bar.open;
    out.push({
      ...bar,
      volume_contracts: bar.volume,
      volume_bar_height_in_window: maximum > 0 ? bar.volume / maximum : Number.NaN,
      volume_zscore_trailing: logStandardDeviation > 0 ? (Math.log(Math.max(bar.volume, 1)) - logMean) / logStandardDeviation : null,
      volume_rank_trailing: volumes.filter((volume) => volume < bar.volume).length / window,
      volume_signed_by_candle_direction: bar.volume * Math.sign(body),
      candle_direction: bar.close >= bar.open ? "rising" : "falling",
    });
  }
  return out.slice(-length);
}

/** Average ranks (ties share the mean of the positions they occupy), 1-based. */
function averageRanks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && (order[end + 1] as { value: number }).value === (order[start] as { value: number }).value) end += 1;
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k += 1) ranks[(order[k] as { index: number }).index] = rank;
    start = end + 1;
  }
  return ranks;
}

export function pearsonCorrelation(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Spearman rank correlation: Pearson on average ranks, so ties (volume repeats) are handled. */
export function spearmanCorrelation(xs: readonly number[], ys: readonly number[]): number | null {
  return pearsonCorrelation(averageRanks(xs), averageRanks(ys));
}

// ---------------------------------------------------------------------------
// Panels B, C, C2, F: pure views over the landed rows and the information units.
// ---------------------------------------------------------------------------

/** 1 nat = 1 / ln 2 bits. */
export function natsToBits(nats: number): number {
  return nats / Math.LN2;
}

/** I = -1/2 ln(1 - rho^2)  inverted: the Pearson correlation a bivariate normal needs to carry `nats`. */
export function equivalentCorrelation(nats: number): number {
  return Math.sqrt(Math.max(0, 1 - Math.exp(-2 * Math.max(nats, 0))));
}

/** The Gaussian-equivalent information of a correlation, in nats. */
export function gaussianEquivalentNats(correlation: number): number {
  const squared = Math.min(Math.max(correlation ** 2, 0), 1 - 1e-12);
  return -0.5 * Math.log(1 - squared);
}

export interface PairingPoint {
  pairing: string;
  volume_encoding: string;
  anatomy_measure: string;
  absoluteCorrelation: number;
  nats: number;
  gaussianNats: number;
  excessRatio: number;
  barCount: number;
  /** Real dependence at a correlation below 0.15: nats over three times the Gaussian equivalent. */
  hidden: boolean;
}

/** Panel C's points: finite excess ratio only, pairings that share a construction term optionally dropped. */
export function pairingPoints(rows: readonly BoardOverallRow[], hideTautology: boolean): PairingPoint[] {
  const out: PairingPoint[] = [];
  for (const row of rows) {
    if (hideTautology && row.pairing_shares_a_construction_term) continue;
    const excess = row.mutual_information_excess_ratio;
    const nats = row.mutual_information_nats;
    const gaussian = row.gaussian_equivalent_mutual_information_nats;
    const pearson = row.pearson_correlation;
    if (excess === null || !Number.isFinite(excess) || nats === null || gaussian === null || pearson === null) continue;
    const absoluteCorrelation = Math.abs(pearson);
    out.push({
      pairing: `${row.volume_encoding}  ×  ${row.anatomy_measure}`,
      volume_encoding: row.volume_encoding,
      anatomy_measure: row.anatomy_measure,
      absoluteCorrelation,
      nats,
      gaussianNats: gaussian,
      excessRatio: excess,
      barCount: row.bar_count,
      hidden: absoluteCorrelation < 0.15 && nats > 3 * gaussian,
    });
  }
  return out;
}

export interface ControlShift {
  timeframe: string;
  volume_encoding: string;
  anatomy_measure: string;
  allBars: number;
  controlBars: number;
  shift: number;
}

/** Panel F: each pairing's Spearman over all bars against over bars closing inside their range. */
export function controlShifts(rows: readonly BoardOverallRow[]): ControlShift[] {
  const byKey = new Map<string, { all?: number; inside?: number; row: BoardOverallRow }>();
  for (const row of rows) {
    if (row.pairing_shares_a_construction_term) continue;
    if (row.bar_population !== "all_bars" && row.bar_population !== "closes_inside_range") continue;
    if (row.spearman_correlation === null) continue;
    const key = `${row.timeframe}|${row.volume_encoding}|${row.anatomy_measure}`;
    const entry = byKey.get(key) ?? { row };
    if (row.bar_population === "all_bars") entry.all = row.spearman_correlation;
    else entry.inside = row.spearman_correlation;
    byKey.set(key, entry);
  }
  const out: ControlShift[] = [];
  for (const entry of byKey.values()) {
    if (entry.all === undefined || entry.inside === undefined) continue;
    out.push({
      timeframe: entry.row.timeframe,
      volume_encoding: entry.row.volume_encoding,
      anatomy_measure: entry.row.anatomy_measure,
      allBars: entry.all,
      controlBars: entry.inside,
      shift: entry.inside - entry.all,
    });
  }
  return out;
}

/** A seeded standard-normal stream (mulberry32 + Box-Muller) so Panel C2's cloud is the same on every render. */
export function seededNormals(count: number, seed: number): number[] {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: number[] = [];
  while (out.length < count) {
    const u = Math.max(uniform(), 1e-12);
    const v = uniform();
    const radius = Math.sqrt(-2 * Math.log(u));
    out.push(radius * Math.cos(2 * Math.PI * v));
    if (out.length < count) out.push(radius * Math.sin(2 * Math.PI * v));
  }
  return out;
}

/** The cloud Panel C2 draws: y = rho x + sqrt(1 - rho^2) e on fixed x and e, so moving the slider reshapes the same points. */
export function correlatedCloud(rho: number, count = 1200): Array<{ x: number; y: number }> {
  const xs = seededNormals(count, 7);
  const noise = seededNormals(count, 1007);
  const scale = Math.sqrt(Math.max(1 - rho * rho, 0));
  return xs.map((x, i) => ({ x, y: rho * x + scale * (noise[i] as number) }));
}

/** Least-squares line through a cloud, for the reference line of Panel C2. */
export function fitLine(points: ReadonlyArray<{ x: number; y: number }>): { slope: number; intercept: number } {
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx };
}

export interface RankComparison {
  /** (timeframe, candle part) cells with all three readings present. */
  cellCount: number;
  /** Cells where the rank reading's absolute Spearman exceeds both the raw count's and the bar height's. */
  rankBeatsBoth: number;
  exceptions: Array<{ timeframe: string; anatomy_measure: string; rank: number; raw: number; height: number }>;
}

/**
 * Checks the notebook's solution line on the landed rows (bars closing inside their range, pairings that share
 * no construction term): does volume_rank_trailing rank above the raw count and above the chart's bar height?
 */
export function compareRankReading(rows: readonly BoardOverallRow[]): RankComparison {
  const cells = new Map<string, { timeframe: string; anatomy_measure: string; rank?: number; raw?: number; height?: number }>();
  for (const row of rows) {
    if (row.bar_population !== "closes_inside_range" || row.pairing_shares_a_construction_term || row.spearman_correlation === null) continue;
    const key = `${row.timeframe}|${row.anatomy_measure}`;
    const cell = cells.get(key) ?? { timeframe: row.timeframe, anatomy_measure: row.anatomy_measure };
    const value = Math.abs(row.spearman_correlation);
    if (row.volume_encoding === "volume_rank_trailing") cell.rank = value;
    else if (row.volume_encoding === "volume_contracts") cell.raw = value;
    else if (row.volume_encoding === "volume_bar_height_in_window") cell.height = value;
    cells.set(key, cell);
  }
  const result: RankComparison = { cellCount: 0, rankBeatsBoth: 0, exceptions: [] };
  for (const cell of cells.values()) {
    if (cell.rank === undefined || cell.raw === undefined || cell.height === undefined) continue;
    result.cellCount += 1;
    if (cell.rank > cell.raw && cell.rank > cell.height) result.rankBeatsBoth += 1;
    else result.exceptions.push({ timeframe: cell.timeframe, anatomy_measure: cell.anatomy_measure, rank: cell.rank, raw: cell.raw, height: cell.height });
  }
  return result;
}
