/**
 * Slope of price as a trading signal: the response body of
 * `GET /api/studies/slope-signal-backtest` and the pure maths the handler and
 * its tests share. Replaced Trading/quant/model/notebooks/slope_analysis.py.
 *
 * What the notebook did, and what this keeps exactly:
 *   - a rolling ordinary-least-squares line through the last N closes against
 *     the bar index 0..N-1 (scipy.stats.linregress), its slope in points per bar;
 *   - the signal: +1 above k times the rolling sample standard deviation of the
 *     slope (window 200, at least 50 slopes), -1 below minus that, 0 between;
 *   - the backtest: the previous bar's signal times this bar's log return, less
 *     a cost, cumulated, against buy and hold.
 *
 * Two backtests are computed from the same signals, and the page shows both:
 *   `notebook`  the notebook's own accounting, bug for bug: a full round trip
 *               (1.4 points) on every change of the signal including to flat,
 *               two start-up "trades" from NaN != NaN, and annualisation by
 *               252 x 78 bars a year. It exists so the notebook's numbers
 *               reproduce on the page.
 *   `corrected` a cost of half a round trip for each unit of position changed
 *               (flat to long is one side, long to short is two), priced at the
 *               price the trade is made at, annualised by the bars actually
 *               observed per year, on prices back-adjusted at each contract roll.
 *
 * Causality: the signal at bar t uses closes up to t only, and is held during
 * bar t+1. Every rolling statistic is trailing with a minimum-periods guard;
 * warm-up rows are NaN (and read as flat in the signal, as in the notebook).
 * The slope here is computed with the bar index centred on its mean, which is
 * algebraically the same line as `linregCore` (market/lib/calculators/
 * math_primitives.ts, the chart's `linreg_slope` indicator) and avoids the
 * cancellation in its raw sums; a test holds the two equal.
 */

import type { EightNumberSummary } from "../analytics/types";
import { eightNumberSummary } from "../lens/stats";

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60 };

export type SlopeUnit = "points" | "percent";

/** The constants the notebook hard-coded, kept as the defaults and as the "notebook accounting" inputs. */
export const NOTEBOOK = {
  start: "2025-09-25",
  windows: [10, 20, 50],
  signalWindow: 20,
  slowWindow: 50,
  thresholdMultiplier: 0.3,
  standardDeviationWindow: 200,
  standardDeviationMinimumPeriods: 50,
  costPoints: 1.4,
  barsPerYear: 252 * 78,
  zoomBars: 2000,
  demoStart: 100,
  demoWindow: 20,
} as const;

export interface Bar {
  /** Epoch milliseconds in the lake's stamping (futures: Pacific wall clock stored as UTC). */
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SlopeParameters {
  symbol: string;
  timeframe: Timeframe;
  start: string;
  window: number;
  slowWindow: number;
  thresholdMultiplier: number;
  costPoints: number;
  longOnly: boolean;
  backAdjust: boolean;
  slopeUnit: SlopeUnit;
  demoStart: number;
  zoomBars: number;
}

export interface InstrumentInfo {
  symbol: string;
  pointValueUsd: number;
  tickSize: number;
  /** total_round_trip_points from packages/config/cost_model.json. */
  roundTripPoints: number;
}

// ─── Pure maths ─────────────────────────────────────────────────────────────

/**
 * The least-squares line through `values` against x = 0..N-1: slope, intercept
 * at x = 0 and R squared. x is centred on its mean, so the slope is a weighted
 * sum of the values with weights that add to zero and a constant offset cancels.
 */
export function linearFit(values: ArrayLike<number>): { slope: number; intercept: number; rSquared: number } {
  const count = values.length;
  if (count < 2) return { slope: NaN, intercept: NaN, rSquared: NaN };
  const centre = (count - 1) / 2;
  let sum = 0;
  for (let j = 0; j < count; j += 1) sum += values[j] as number;
  const average = sum / count;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let j = 0; j < count; j += 1) {
    const dx = j - centre;
    const dy = (values[j] as number) - average;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxy / sxx;
  return { slope, intercept: average - slope * centre, rSquared: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

/**
 * Rolling slope of `values` over `window` bars; NaN until the window is full.
 * O(n x window): direct, with no running sums to drift.
 */
export function rollingSlope(values: ArrayLike<number>, window: number): Float64Array {
  const count = values.length;
  const out = new Float64Array(count).fill(NaN);
  if (window < 2 || count < window) return out;
  const centre = (window - 1) / 2;
  const weights = new Float64Array(window);
  let sxx = 0;
  for (let j = 0; j < window; j += 1) {
    weights[j] = j - centre;
    sxx += weights[j]! * weights[j]!;
  }
  for (let i = window - 1; i < count; i += 1) {
    const base = i - window + 1;
    let sxy = 0;
    let bad = false;
    for (let j = 0; j < window; j += 1) {
      const v = values[base + j] as number;
      if (Number.isNaN(v)) {
        bad = true;
        break;
      }
      sxy += weights[j]! * v;
    }
    if (!bad) out[i] = sxy / sxx;
  }
  return out;
}

/**
 * pandas `Series.rolling(window, min_periods).mean()` and `.std()` (sample,
 * ddof = 1): the window is the last `window` rows, NaNs are skipped, and the
 * result is NaN while fewer than `minimumPeriods` values are present.
 */
export function rollingMeanAndStandardDeviation(values: ArrayLike<number>, window: number, minimumPeriods: number): { mean: Float64Array; standardDeviation: Float64Array } {
  const count = values.length;
  const mean = new Float64Array(count).fill(NaN);
  const standardDeviation = new Float64Array(count).fill(NaN);
  for (let i = 0; i < count; i += 1) {
    const from = Math.max(0, i - window + 1);
    let seen = 0;
    let sum = 0;
    for (let j = from; j <= i; j += 1) {
      const v = values[j] as number;
      if (!Number.isNaN(v)) {
        seen += 1;
        sum += v;
      }
    }
    if (seen < Math.max(1, minimumPeriods)) continue;
    const average = sum / seen;
    mean[i] = average;
    if (seen >= 2) {
      let squares = 0;
      for (let j = from; j <= i; j += 1) {
        const v = values[j] as number;
        if (!Number.isNaN(v)) squares += (v - average) * (v - average);
      }
      standardDeviation[i] = Math.sqrt(squares / (seen - 1));
    }
  }
  return { mean, standardDeviation };
}

/** +1 above the threshold, -1 below minus it, 0 otherwise (and 0 where either is NaN), as `np.where` reads it. */
export function generateSignal(slope: ArrayLike<number>, threshold: ArrayLike<number>): Int8Array {
  const out = new Int8Array(slope.length);
  for (let i = 0; i < slope.length; i += 1) {
    const s = slope[i] as number;
    const limit = threshold[i] as number;
    out[i] = s > limit ? 1 : s < -limit ? -1 : 0;
  }
  return out;
}

export interface Roll {
  /** Index of the first bar of the new contract. */
  index: number;
  from: string;
  to: string;
}

/** Runs of a contract label, carrying the last known label across unlabelled bars; one roll per change of label. */
export function detectRolls(contracts: ReadonlyArray<string | null>): Roll[] {
  const rolls: Roll[] = [];
  let current: string | null = null;
  for (let i = 0; i < contracts.length; i += 1) {
    const label = contracts[i] ?? null;
    if (label === null) continue;
    if (current !== null && label !== current) rolls.push({ index: i, from: current, to: label });
    current = label;
  }
  return rolls;
}

/**
 * The factor each bar's prices are multiplied by so a roll is not a move: the
 * newest contract is 1, and each older one is scaled by the product of every
 * later ratio (new close over old close at the same instant) — the dashboard's
 * ratio back-adjustment (`rollAdjustmentFactors`, marketData.ts).
 */
export function rollFactors(barCount: number, rolls: ReadonlyArray<{ index: number; ratio: number }>): Float64Array {
  const factors = new Float64Array(barCount).fill(1);
  let running = 1;
  for (let r = rolls.length - 1; r >= 0; r -= 1) {
    const roll = rolls[r]!;
    running *= roll.ratio;
    const from = r > 0 ? rolls[r - 1]!.index : 0;
    for (let i = Math.max(0, from); i < Math.min(barCount, roll.index); i += 1) factors[i] = running;
  }
  return factors;
}

/** `count` indexes from 0 to n-1, evenly spread, always ending on the last bar. */
export function thinnedIndexes(n: number, maxPoints: number): number[] {
  if (n <= 0) return [];
  if (n <= maxPoints) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  const step = (n - 1) / (maxPoints - 1);
  let previous = -1;
  for (let k = 0; k < maxPoints; k += 1) {
    const index = Math.round(k * step);
    if (index !== previous) out.push(index);
    previous = index;
  }
  return out;
}

/** Bucket boundaries [start, end) so that n values become at most `maxPoints` buckets. */
export function buckets(n: number, maxPoints: number): Array<[number, number]> {
  if (n <= 0) return [];
  const size = Math.max(1, Math.ceil(n / maxPoints));
  const out: Array<[number, number]> = [];
  for (let start = 0; start < n; start += size) out.push([start, Math.min(n, start + size)]);
  return out;
}

// ─── Response body ──────────────────────────────────────────────────────────

export interface FrameInfo {
  view: string;
  barCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  spanDays: number;
  distinctDates: number;
  barsPerDate: number;
  /** Bars observed per elapsed year: bar count over the span in years. */
  barsPerYearMeasured: number;
  /** The notebook's constant: 252 sessions x 78 five-minute bars. */
  barsPerYearNotebook: number;
  backAdjusted: boolean;
  /** Bars read but not matched to a contract (only when back-adjusting). */
  unmatchedBars: number;
}

export interface RollRow {
  barIndex: number;
  timestamp: number;
  fromContract: string;
  toContract: string;
  oldClose: number | null;
  newClose: number | null;
  /** New close over old close at the same instant; 1 when it could not be read. */
  ratio: number;
  /** The step the raw spliced series shows across the roll bar, in points. */
  rawStepPoints: number;
}

export interface ColumnStatistics {
  column: string;
  unit: string;
  summary: EightNumberSummary;
}

export interface SlopeWindowRow {
  window: number;
  validCount: number;
  mean: number | null;
  standardDeviation: number | null;
  firstValidBarIndex: number;
}

export interface SignalCounts {
  long: number;
  short: number;
  flat: number;
  total: number;
}

export interface DemoWindow {
  startIndex: number;
  startTimestamp: number;
  window: number;
  closes: number[];
  slope: number;
  intercept: number;
  rSquared: number;
  /** slope x (window - 1): the rise of the line from the first to the last bar. */
  riseAcrossWindow: number;
  meanClose: number;
}

export interface MetricsRow {
  label: string;
  totalReturnLog: number | null;
  totalReturnPercent: number | null;
  annualReturnPercent: number | null;
  annualVolatilityPercent: number | null;
  sharpeRatio: number | null;
  maxDrawdownLog: number | null;
  maxDrawdownPercent: number | null;
  winRatePercent: number | null;
  /** Position changes for a strategy row; 1 for buy and hold. */
  trades: number | null;
  barCount: number;
}

export interface BacktestResult {
  name: "corrected" | "notebook";
  description: string;
  costPoints: number;
  /** Per side for `corrected`, per change of signal for `notebook`. */
  costBasis: string;
  barsPerYear: number;
  metrics: MetricsRow[];
  /** Changes of position (corrected) or the notebook's reported "trades" count. */
  positionChanges: number;
  /** Contract sides traded (a flip is two); null for the notebook accounting. */
  sides: number | null;
  /** Share of bars holding a position, 0 to 1. */
  exposure: number | null;
  totalCostPoints: number;
  totalCostUsd: number;
}

export interface EquityPoint {
  t: number;
  strategyNet: number;
  strategyGross: number;
  buyAndHold: number;
  notebookNet: number;
  /** Drawdown of the corrected net curve, log units, at or below 0. */
  drawdown: number;
  notebookDrawdown: number;
}

export interface ZoomPoint {
  t: number;
  close: number;
  slopeFast: number | null;
  slopeSlow: number | null;
  threshold: number | null;
  signal: number;
}

export interface PricePoint {
  t: number;
  close: number;
  /** The raw spliced close before back-adjustment (equal to `close` when not adjusting). */
  rawClose: number;
}

export interface SlopeStudyBody {
  /** False when the bar view is not served or returned no bars. */
  ready: boolean;
  parameters: SlopeParameters;
  instrument: InstrumentInfo;
  frame: FrameInfo | null;
  rolls: RollRow[];
  priceSeries: PricePoint[];
  columnStatistics: ColumnStatistics[];
  slopeWindows: SlopeWindowRow[];
  demo: DemoWindow | null;
  signalCounts: SignalCounts;
  /** The threshold and its ingredients on the last bar with one. */
  lastBar: { slope: number | null; slopeStandardDeviation: number | null; threshold: number | null; close: number | null; signal: number } | null;
  zoom: ZoomPoint[];
  corrected: BacktestResult | null;
  notebook: BacktestResult | null;
  equity: EquityPoint[];
  /** Evenly thinned rows of every column, for the per-column grid. */
  frameSample: Array<Record<string, number | null>>;
  frameSampleTotal: number;
}

export function emptyBody(parameters: SlopeParameters, instrument: InstrumentInfo): SlopeStudyBody {
  return {
    ready: false,
    parameters,
    instrument,
    frame: null,
    rolls: [],
    priceSeries: [],
    columnStatistics: [],
    slopeWindows: [],
    demo: null,
    signalCounts: { long: 0, short: 0, flat: 0, total: 0 },
    lastBar: null,
    zoom: [],
    corrected: null,
    notebook: null,
    equity: [],
    frameSample: [],
    frameSampleTotal: 0,
  };
}

// ─── Metrics ────────────────────────────────────────────────────────────────

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** The notebook's `calc_metrics` over a log-return series (NaN already dropped). */
export function performanceMetrics(label: string, returns: ArrayLike<number>, barsPerYear: number, trades: number | null): MetricsRow {
  const count = returns.length;
  if (count === 0) {
    return { label, totalReturnLog: null, totalReturnPercent: null, annualReturnPercent: null, annualVolatilityPercent: null, sharpeRatio: null, maxDrawdownLog: null, maxDrawdownPercent: null, winRatePercent: null, trades, barCount: 0 };
  }
  let total = 0;
  for (let i = 0; i < count; i += 1) total += returns[i] as number;
  const average = total / count;
  let squares = 0;
  for (let i = 0; i < count; i += 1) squares += ((returns[i] as number) - average) ** 2;
  const sampleStandardDeviation = count > 1 ? Math.sqrt(squares / (count - 1)) : NaN;
  const annualFactor = barsPerYear / count;
  const annualReturn = total * annualFactor;
  const annualVolatility = sampleStandardDeviation * Math.sqrt(barsPerYear);
  const sharpe = annualVolatility > 0 ? annualReturn / annualVolatility : 0;
  let cumulative = 0;
  let peak = -Infinity;
  let maxDrawdown = 0;
  let wins = 0;
  let nonZero = 0;
  for (let i = 0; i < count; i += 1) {
    const r = returns[i] as number;
    cumulative += r;
    if (cumulative > peak) peak = cumulative;
    if (cumulative - peak < maxDrawdown) maxDrawdown = cumulative - peak;
    if (r > 0) wins += 1;
    if (r !== 0) nonZero += 1;
  }
  return {
    label,
    totalReturnLog: finiteOrNull(total),
    totalReturnPercent: finiteOrNull((Math.exp(total) - 1) * 100),
    annualReturnPercent: finiteOrNull((Math.exp(annualReturn) - 1) * 100),
    annualVolatilityPercent: finiteOrNull(annualVolatility * 100),
    sharpeRatio: finiteOrNull(sharpe),
    maxDrawdownLog: finiteOrNull(maxDrawdown),
    maxDrawdownPercent: finiteOrNull((Math.exp(maxDrawdown) - 1) * 100),
    winRatePercent: nonZero > 0 ? (wins / nonZero) * 100 : 0,
    trades,
    barCount: count,
  };
}

// ─── Backtests ──────────────────────────────────────────────────────────────

interface Simulation {
  /** Indexed like the bars; NaN where not defined. */
  logReturn: Float64Array;
  grossReturn: Float64Array;
  cost: Float64Array;
  net: Float64Array;
  position: Float64Array;
  /** Cumulative sums of `net` and `gross`, NaN where the series is not yet defined. */
  cumulativeNet: Float64Array;
  cumulativeGross: Float64Array;
  positionChanges: number;
  sides: number;
  reportedTrades: number;
  firstRow: number;
}

/**
 * The notebook's backtest, row for row. Rows start at the first bar with a
 * valid slope; the first row has no return; `trade_flag` is `signal_prev !=
 * signal_prev.shift(1)`, which is True on the first two rows because NaN
 * compares unequal to everything; the cost is 1.4 points over the close of the
 * row, charged on every flagged row.
 */
export function simulateNotebook(close: ArrayLike<number>, signal: Int8Array, firstRow: number, costPoints: number): Simulation {
  const n = close.length;
  const logReturn = new Float64Array(n).fill(NaN);
  const gross = new Float64Array(n).fill(NaN);
  const cost = new Float64Array(n).fill(NaN);
  const net = new Float64Array(n).fill(NaN);
  const position = new Float64Array(n).fill(NaN);
  const cumNet = new Float64Array(n).fill(NaN);
  const cumGross = new Float64Array(n).fill(NaN);
  let flags = 0;
  let cn = 0;
  let cg = 0;
  let positionChanges = 0;
  for (let i = firstRow; i < n; i += 1) {
    const r = i - firstRow;
    if (r >= 1) {
      logReturn[i] = Math.log((close[i] as number) / (close[i - 1] as number));
      position[i] = signal[i - 1] as number;
      gross[i] = (position[i] as number) * (logReturn[i] as number);
    }
    const flagged = r < 2 ? true : position[i] !== position[i - 1];
    if (flagged) flags += 1;
    if (r >= 1 && (position[i] as number) !== (r >= 2 ? (position[i - 1] as number) : 0)) positionChanges += 1;
    cost[i] = flagged ? costPoints / (close[i] as number) : 0;
    if (r >= 1) {
      net[i] = (gross[i] as number) - (cost[i] as number);
      cn += net[i] as number;
      cg += gross[i] as number;
      cumNet[i] = cn;
      cumGross[i] = cg;
    }
  }
  return { logReturn, grossReturn: gross, cost, net, position, cumulativeNet: cumNet, cumulativeGross: cumGross, positionChanges, sides: 0, reportedTrades: flags, firstRow };
}

/**
 * Half a round trip for each unit of position changed, priced at the close the
 * trade is made at (the bar before the one that earns the return), starting flat.
 */
export function simulateCorrected(close: ArrayLike<number>, signal: Int8Array, firstRow: number, roundTripPoints: number, longOnly: boolean): Simulation {
  const n = close.length;
  const logReturn = new Float64Array(n).fill(NaN);
  const gross = new Float64Array(n).fill(NaN);
  const cost = new Float64Array(n).fill(NaN);
  const net = new Float64Array(n).fill(NaN);
  const position = new Float64Array(n).fill(NaN);
  const cumNet = new Float64Array(n).fill(NaN);
  const cumGross = new Float64Array(n).fill(NaN);
  const perSide = roundTripPoints / 2;
  let cn = 0;
  let cg = 0;
  let changes = 0;
  let sides = 0;
  let before = 0;
  for (let i = firstRow + 1; i < n; i += 1) {
    const wanted = signal[i - 1] as number;
    const held = longOnly && wanted < 0 ? 0 : wanted;
    position[i] = held;
    logReturn[i] = Math.log((close[i] as number) / (close[i - 1] as number));
    gross[i] = held * (logReturn[i] as number);
    const moved = Math.abs(held - before);
    cost[i] = (perSide * moved) / (close[i - 1] as number);
    if (moved > 0) changes += 1;
    sides += moved;
    before = held;
    net[i] = (gross[i] as number) - (cost[i] as number);
    cn += net[i] as number;
    cg += gross[i] as number;
    cumNet[i] = cn;
    cumGross[i] = cg;
  }
  return { logReturn, grossReturn: gross, cost, net, position, cumulativeNet: cumNet, cumulativeGross: cumGross, positionChanges: changes, sides, reportedTrades: changes, firstRow };
}

function definedValues(values: Float64Array, from: number): number[] {
  const out: number[] = [];
  for (let i = from; i < values.length; i += 1) if (!Number.isNaN(values[i] as number)) out.push(values[i] as number);
  return out;
}

/** The cost in points: each bar's cost fraction times the price it was charged against (the previous close). */
function costInPoints(simulation: Simulation, close: ArrayLike<number>): number {
  let total = 0;
  for (let i = simulation.firstRow + 1; i < close.length; i += 1) {
    const c = simulation.cost[i] as number;
    if (Number.isFinite(c) && c !== 0) total += c * (close[i - 1] as number);
  }
  return total;
}

function drawdownOf(cumulative: Float64Array): Float64Array {
  const out = new Float64Array(cumulative.length).fill(NaN);
  let peak = -Infinity;
  for (let i = 0; i < cumulative.length; i += 1) {
    const v = cumulative[i] as number;
    if (Number.isNaN(v)) continue;
    if (v > peak) peak = v;
    out[i] = v - peak;
  }
  return out;
}

// ─── The study ──────────────────────────────────────────────────────────────

export interface AnalyseInput {
  /** Bars as the lake holds them (raw spliced prices), oldest first. */
  bars: readonly Bar[];
  /** Ratio adjustment per bar (1 = none), same length as `bars`; ignored unless `parameters.backAdjust`. */
  factors: Float64Array | null;
  rolls: readonly RollRow[];
  parameters: SlopeParameters;
  instrument: InstrumentInfo;
  view: string;
  unmatchedBars: number;
}

const PRICE_POINTS = 2500;
const ZOOM_POINTS = 2500;
const EQUITY_POINTS = 2500;
const SAMPLE_ROWS = 2500;

function distinctUtcDates(bars: readonly Bar[]): number {
  const seen = new Set<number>();
  for (const bar of bars) seen.add(Math.floor(bar.t / 86_400_000));
  return seen.size;
}

function slopeColumnName(window: number, suffix = ""): string {
  return `slope_${window}${suffix}`;
}

export function analyse(input: AnalyseInput): SlopeStudyBody {
  const { bars, parameters, instrument } = input;
  const n = bars.length;
  if (n === 0) return emptyBody(parameters, instrument);

  const adjust = parameters.backAdjust && input.factors !== null;
  const open = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const close = new Float64Array(n);
  const rawClose = new Float64Array(n);
  const volume = new Float64Array(n);
  const timestamps = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const bar = bars[i] as Bar;
    const f = adjust ? (input.factors as Float64Array)[i] as number : 1;
    open[i] = bar.open * f;
    high[i] = bar.high * f;
    low[i] = bar.low * f;
    close[i] = bar.close * f;
    rawClose[i] = bar.close;
    volume[i] = bar.volume;
    timestamps[i] = bar.t;
  }

  const percent = parameters.slopeUnit === "percent";
  const windows = [...new Set<number>([...NOTEBOOK.windows, parameters.window, parameters.slowWindow])].sort((a, b) => a - b);
  const slopes = new Map<number, Float64Array>();
  for (const w of windows) {
    const raw = rollingSlope(close, w);
    if (percent) for (let i = 0; i < n; i += 1) raw[i] = (raw[i] as number) / (close[i] as number) * 100;
    slopes.set(w, raw);
  }
  const zScores = new Map<number, Float64Array>();
  for (const w of windows) {
    const slope = slopes.get(w) as Float64Array;
    const { mean, standardDeviation } = rollingMeanAndStandardDeviation(slope, NOTEBOOK.standardDeviationWindow, NOTEBOOK.standardDeviationMinimumPeriods);
    const z = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i += 1) z[i] = ((slope[i] as number) - (mean[i] as number)) / (standardDeviation[i] as number);
    zScores.set(w, z);
  }

  const signalSlope = slopes.get(parameters.window) as Float64Array;
  const { standardDeviation: slopeStandardDeviation } = rollingMeanAndStandardDeviation(signalSlope, NOTEBOOK.standardDeviationWindow, NOTEBOOK.standardDeviationMinimumPeriods);
  const threshold = new Float64Array(n);
  for (let i = 0; i < n; i += 1) threshold[i] = parameters.thresholdMultiplier * (slopeStandardDeviation[i] as number);
  const signal = generateSignal(signalSlope, threshold);

  const counts: SignalCounts = { long: 0, short: 0, flat: 0, total: n };
  for (let i = 0; i < n; i += 1) {
    if (signal[i] === 1) counts.long += 1;
    else if (signal[i] === -1) counts.short += 1;
    else counts.flat += 1;
  }

  const firstRow = parameters.window - 1;
  const span = (timestamps[n - 1] as number) - (timestamps[0] as number);
  const spanYears = span / (365.25 * 86_400_000);
  const barsPerYearMeasured = spanYears > 0 ? n / spanYears : NOTEBOOK.barsPerYear;
  const distinctDates = distinctUtcDates(bars);

  // The notebook's accounting runs on the raw spliced prices it read; the corrected one on the adjusted prices.
  const notebookSim = n > firstRow + 1 ? simulateNotebook(rawClose, signal, firstRow, NOTEBOOK.costPoints) : null;
  const correctedSim = n > firstRow + 1 ? simulateCorrected(close, signal, firstRow, parameters.costPoints, parameters.longOnly) : null;

  const pointValue = instrument.pointValueUsd;
  let corrected: BacktestResult | null = null;
  let notebook: BacktestResult | null = null;
  if (correctedSim) {
    const netReturns = definedValues(correctedSim.net, firstRow + 1);
    const grossReturns = definedValues(correctedSim.grossReturn, firstRow + 1);
    const holdReturns = definedValues(correctedSim.logReturn, firstRow + 1);
    let exposed = 0;
    for (let i = firstRow + 1; i < n; i += 1) if ((correctedSim.position[i] as number) !== 0) exposed += 1;
    const totalCost = costInPoints(correctedSim, close);
    corrected = {
      name: "corrected",
      description: "Half a round trip per unit of position changed, priced where the trade is made; annualised by the bars observed per year; prices back-adjusted at each roll when that control is on.",
      costPoints: parameters.costPoints,
      costBasis: "per side: round trip / 2 x |change in position|",
      barsPerYear: barsPerYearMeasured,
      metrics: [
        performanceMetrics(parameters.longOnly ? "Slope strategy, long only (net)" : "Slope strategy (net)", netReturns, barsPerYearMeasured, correctedSim.positionChanges),
        performanceMetrics("Slope strategy (before cost)", grossReturns, barsPerYearMeasured, correctedSim.positionChanges),
        performanceMetrics("Buy and hold", holdReturns, barsPerYearMeasured, 1),
      ],
      positionChanges: correctedSim.positionChanges,
      sides: correctedSim.sides,
      exposure: netReturns.length > 0 ? exposed / netReturns.length : null,
      totalCostPoints: totalCost,
      totalCostUsd: totalCost * pointValue,
    };
  }
  if (notebookSim) {
    const netReturns = definedValues(notebookSim.net, firstRow + 1);
    const grossReturns = definedValues(notebookSim.grossReturn, firstRow + 1);
    const holdReturns = definedValues(notebookSim.logReturn, firstRow + 1);
    let exposed = 0;
    for (let i = firstRow + 1; i < n; i += 1) if ((notebookSim.position[i] as number) !== 0) exposed += 1;
    const totalCost = notebookSim.reportedTrades * NOTEBOOK.costPoints;
    notebook = {
      name: "notebook",
      description: "The notebook's own rules: 1.4 points on every change of signal including to flat, the two start-up flags from NaN != NaN, 252 x 78 bars a year, raw spliced prices.",
      costPoints: NOTEBOOK.costPoints,
      costBasis: "per change of the lagged signal: a full 1.4 points",
      barsPerYear: NOTEBOOK.barsPerYear,
      metrics: [
        performanceMetrics("Slope Strategy (net)", netReturns, NOTEBOOK.barsPerYear, notebookSim.reportedTrades),
        performanceMetrics("Slope Strategy (before cost)", grossReturns, NOTEBOOK.barsPerYear, notebookSim.reportedTrades),
        performanceMetrics("Buy & Hold", holdReturns, NOTEBOOK.barsPerYear, 1),
      ],
      positionChanges: notebookSim.reportedTrades,
      sides: null,
      exposure: netReturns.length > 0 ? exposed / netReturns.length : null,
      totalCostPoints: totalCost,
      totalCostUsd: totalCost * pointValue,
    };
  }

  // ── Series for the charts ────────────────────────────────────────────────
  const priceSeries: PricePoint[] = thinnedIndexes(n, PRICE_POINTS).map((i) => ({ t: timestamps[i] as number, close: close[i] as number, rawClose: rawClose[i] as number }));

  const zoomCount = Math.max(0, Math.min(parameters.zoomBars, n - firstRow));
  const zoomFrom = n - zoomCount;
  const slow = slopes.get(parameters.slowWindow) as Float64Array;
  const zoom: ZoomPoint[] = thinnedIndexes(zoomCount, ZOOM_POINTS).map((k) => {
    const i = zoomFrom + k;
    const fast = signalSlope[i] as number;
    return {
      t: timestamps[i] as number,
      close: close[i] as number,
      slopeFast: Number.isNaN(fast) ? null : fast,
      slopeSlow: Number.isNaN(slow[i] as number) ? null : (slow[i] as number),
      threshold: Number.isNaN(threshold[i] as number) ? null : (threshold[i] as number),
      signal: signal[i] as number,
    };
  });

  let equity: EquityPoint[] = [];
  if (correctedSim && notebookSim) {
    const cumulativeHold = new Float64Array(n).fill(NaN);
    let ch = 0;
    for (let i = firstRow + 1; i < n; i += 1) {
      ch += correctedSim.logReturn[i] as number;
      cumulativeHold[i] = ch;
    }
    const drawdown = drawdownOf(correctedSim.cumulativeNet);
    const notebookDrawdown = drawdownOf(notebookSim.cumulativeNet);
    const rows = n - (firstRow + 1);
    equity = buckets(rows, EQUITY_POINTS).map(([start, end]) => {
      const last = firstRow + 1 + end - 1;
      let worst = 0;
      let notebookWorst = 0;
      for (let i = firstRow + 1 + start; i <= last; i += 1) {
        const d = drawdown[i] as number;
        if (d < worst) worst = d;
        const nd = notebookDrawdown[i] as number;
        if (nd < notebookWorst) notebookWorst = nd;
      }
      return {
        t: timestamps[last] as number,
        strategyNet: correctedSim.cumulativeNet[last] as number,
        strategyGross: correctedSim.cumulativeGross[last] as number,
        buyAndHold: cumulativeHold[last] as number,
        notebookNet: notebookSim.cumulativeNet[last] as number,
        drawdown: worst,
        notebookDrawdown: notebookWorst,
      };
    });
  }

  // ── Column statistics and the sampled frame ──────────────────────────────
  const priceUnit = "points";
  const slopeUnit = percent ? "% of price per bar" : "points per bar";
  const columns: Array<{ name: string; unit: string; values: ArrayLike<number> }> = [
    { name: "open", unit: priceUnit, values: open },
    { name: "high", unit: priceUnit, values: high },
    { name: "low", unit: priceUnit, values: low },
    { name: "close", unit: priceUnit, values: close },
    { name: "volume", unit: "contracts", values: volume },
  ];
  for (const w of windows) columns.push({ name: slopeColumnName(w), unit: slopeUnit, values: slopes.get(w) as Float64Array });
  for (const w of windows) columns.push({ name: slopeColumnName(w, "_z"), unit: "standard deviations", values: zScores.get(w) as Float64Array });
  columns.push({ name: "slope_threshold", unit: slopeUnit, values: threshold });
  if (correctedSim) {
    columns.push({ name: "log_return", unit: "log return per bar", values: correctedSim.logReturn });
    columns.push({ name: "strategy_return_before_cost", unit: "log return per bar", values: correctedSim.grossReturn });
    columns.push({ name: "cost", unit: "log return per bar", values: correctedSim.cost });
    columns.push({ name: "strategy_net", unit: "log return per bar", values: correctedSim.net });
  }
  const columnStatistics: ColumnStatistics[] = columns.map((column) => ({ column: column.name, unit: column.unit, summary: eightNumberSummary(column.values) }));

  const sampleIndexes = thinnedIndexes(n, SAMPLE_ROWS);
  const frameSample = sampleIndexes.map((i) => {
    const row: Record<string, number | null> = {};
    for (const column of columns) {
      const v = column.values[i] as number;
      row[column.name] = Number.isFinite(v) ? v : null;
    }
    return row;
  });

  const slopeWindows: SlopeWindowRow[] = windows.map((w) => {
    const values = slopes.get(w) as Float64Array;
    const valid = definedValues(values, 0);
    const summary = eightNumberSummary(valid);
    return { window: w, validCount: valid.length, mean: summary.mean, standardDeviation: summary.standardDeviation, firstValidBarIndex: w - 1 };
  });

  const demoWindow = Math.min(parameters.window, n);
  const demoStart = Math.max(0, Math.min(parameters.demoStart, n - demoWindow));
  const demoCloses = Array.from(close.subarray(demoStart, demoStart + demoWindow));
  const fit = linearFit(demoCloses);
  const demo: DemoWindow = {
    startIndex: demoStart,
    startTimestamp: timestamps[demoStart] as number,
    window: demoWindow,
    closes: demoCloses,
    slope: fit.slope,
    intercept: fit.intercept,
    rSquared: fit.rSquared,
    riseAcrossWindow: fit.slope * (demoWindow - 1),
    meanClose: demoCloses.reduce((a, b) => a + b, 0) / demoCloses.length,
  };

  let lastBar: SlopeStudyBody["lastBar"] = null;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (!Number.isNaN(threshold[i] as number)) {
      lastBar = {
        slope: Number.isNaN(signalSlope[i] as number) ? null : (signalSlope[i] as number),
        slopeStandardDeviation: slopeStandardDeviation[i] as number,
        threshold: threshold[i] as number,
        close: close[i] as number,
        signal: signal[i] as number,
      };
      break;
    }
  }

  return {
    ready: true,
    parameters,
    instrument,
    frame: {
      view: input.view,
      barCount: n,
      firstTimestamp: timestamps[0] as number,
      lastTimestamp: timestamps[n - 1] as number,
      spanDays: span / 86_400_000,
      distinctDates,
      barsPerDate: n / distinctDates,
      barsPerYearMeasured,
      barsPerYearNotebook: NOTEBOOK.barsPerYear,
      backAdjusted: adjust,
      unmatchedBars: input.unmatchedBars,
    },
    rolls: [...input.rolls],
    priceSeries,
    columnStatistics,
    slopeWindows,
    demo,
    signalCounts: counts,
    lastBar,
    zoom,
    corrected,
    notebook,
    equity,
    frameSample,
    frameSampleTotal: n,
  };
}
