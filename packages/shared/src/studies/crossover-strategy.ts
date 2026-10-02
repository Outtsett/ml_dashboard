/**
 * Crossover strategy study: the body of GET /api/studies/crossover-strategy and
 * the pure compute the handler and its test share.
 *
 * It replaced Trading/quant/analytics/notebooks/crossover_visualization.py,
 * which ran an always-in EMA(5) over SMA(100) rule on MNQ 5-minute bars, drew
 * one two-week window (candles, MACD crossing markers, RSI) and the compounded
 * cost-adjusted equity curve and drawdown. Every function here reproduces one
 * line of that notebook or of the analytics package it leans on
 * (Trading/quant/analytics/crossovers/crossover.py), with the same conventions:
 *
 *   - EMA is pandas `ewm(span, adjust=False)`: seeded on the first close, NOT on
 *     an SMA of the first `period` closes, which is what the Market chart's
 *     calculators do. The two differ for the first few hundred bars, so the
 *     dashboard's calculators are not reused here.
 *   - SMA is `rolling(period)`, unknown (NaN) until `period` closes exist.
 *   - Position is +1 when fast > slow, -1 (0 in long_only) otherwise, 0 while
 *     either line is unknown. The return of bar t uses the position held at the
 *     close of bar t-1 (`position.shift(1)`): no lookahead.
 *   - Cost is `costPointsPerSide / close * |position change|`, so a full flip
 *     (change of 2) pays one round trip.
 *   - The frame starts at the second bar (the first has no return); MACD and RSI
 *     are computed on that frame, exactly as the notebook did after its dropna.
 *   - Sharpe is mean / sample standard deviation of the per-bar net return times
 *     the square root of the empirical bars per year (crossover.py `ann_factor`:
 *     bar count over the series' own span in years), in-sample being the bars
 *     before the timestamp 70% of the way through the series.
 */

import { histogram } from "../analytics/compute";
import type { HistogramBin } from "../analytics/types";
import { eightNumberSummary } from "../lens/stats";
import type { LensEightNumberSummary } from "../lens/types";

export const STUDY_DATASET = "study_crossover_strategy";
export const LANDED_VIEWS = {
  run: `derived_${STUDY_DATASET}_run_information`,
  sweep: `derived_${STUDY_DATASET}_sweep`,
  realityCheck: `derived_${STUDY_DATASET}_reality_check`,
  folds: `derived_${STUDY_DATASET}_walk_forward_folds`,
  referenceRules: `derived_${STUDY_DATASET}_reference_rules`,
} as const;

export type MovingAverageKind = "ema" | "sma";
export type PositionMode = "long_short" | "long_only";
export type PriceSeries = "naive" | "ratio";

/** The notebook's own settings; the page's defaults and the landed run's pair. */
export const NOTEBOOK_SETTINGS = {
  symbol: "MNQ",
  timeframe: "5m",
  windowStart: "2024-03-01",
  windowEnd: "2025-12-01",
  fastKind: "ema" as MovingAverageKind,
  slowKind: "sma" as MovingAverageKind,
  fastPeriod: 5,
  slowPeriod: 100,
  candleStart: "2024-06-01",
  candleEnd: "2024-06-15",
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  rsiPeriod: 14,
  trainFraction: 0.7,
} as const;

// ------------------------------------------------------------------ bars

export interface PriceBars {
  /** Epoch seconds, ascending. */
  timestampSeconds: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

/**
 * Ratio back-adjustment across contract rolls (datalake core.lake._ratio_back_adjust_ohlc):
 * at each change of contract every earlier bar is multiplied by new close / old
 * close, so the roll bar's return is exactly zero and every other percentage
 * move is kept. The newest contract keeps its own prices.
 */
export function ratioBackAdjust(symbols: readonly string[], bars: PriceBars): PriceBars {
  const count = bars.close.length;
  const factor = new Float64Array(count).fill(1);
  let cumulative = 1;
  for (let i = count - 1; i > 0; i -= 1) {
    const previousClose = bars.close[i - 1] as number;
    if (symbols[i] !== symbols[i - 1] && previousClose > 0) cumulative *= (bars.close[i] as number) / previousClose;
    factor[i - 1] = cumulative;
  }
  const scale = (values: number[]) => values.map((value, i) => value * (factor[i] as number));
  return {
    timestampSeconds: bars.timestampSeconds,
    open: scale(bars.open),
    high: scale(bars.high),
    low: scale(bars.low),
    close: scale(bars.close),
    volume: bars.volume,
  };
}

// --------------------------------------------------------------- averages

/** pandas `ewm(span=period, adjust=False).mean()`: y0 = x0, y_t = (1 - a) y_{t-1} + a x_t, a = 2 / (span + 1). */
export function exponentialMovingAverage(values: ArrayLike<number>, span: number): Float64Array {
  const out = new Float64Array(values.length);
  if (values.length === 0) return out;
  const alpha = 2 / (span + 1);
  out[0] = values[0] as number;
  for (let i = 1; i < values.length; i += 1) out[i] = alpha * (values[i] as number) + (1 - alpha) * (out[i - 1] as number);
  return out;
}

/** pandas `rolling(period).mean()`: NaN until `period` values exist. */
export function simpleMovingAverage(values: ArrayLike<number>, period: number): Float64Array {
  const count = values.length;
  const out = new Float64Array(count).fill(Number.NaN);
  if (period < 1 || count < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i] as number;
  out[period - 1] = sum / period;
  for (let i = period; i < count; i += 1) {
    sum += (values[i] as number) - (values[i - period] as number);
    out[i] = sum / period;
  }
  return out;
}

export function movingAverage(values: ArrayLike<number>, period: number, kind: MovingAverageKind): Float64Array {
  return kind === "ema" ? exponentialMovingAverage(values, period) : simpleMovingAverage(values, period);
}

// ---------------------------------------------------------------- strategy

export interface CrossoverSettings {
  fastKind: MovingAverageKind;
  slowKind: MovingAverageKind;
  fastPeriod: number;
  slowPeriod: number;
  mode: PositionMode;
  /** Price points charged on every traded side (a full flip is two sides). */
  costPointsPerSide: number;
}

/**
 * The strategy on a frame of `barCount - 1` rows: row k is bar k + 1, the bar
 * whose return the position held at bar k earned.
 */
export interface CrossoverRun {
  /** Bar k + 1's timestamp. */
  timestampSeconds: number[];
  close: Float64Array;
  fast: Float64Array;
  slow: Float64Array;
  /** The notebook's `position` column: the position decided at bar k + 1's close. */
  position: Float64Array;
  /** The position held through bar k + 1, decided at bar k's close. */
  heldPosition: Float64Array;
  barReturn: Float64Array;
  turnover: Float64Array;
  /** Cost as a fraction of the close, `costPointsPerSide / close * turnover`. */
  costFraction: Float64Array;
  grossReturn: Float64Array;
  netReturn: Float64Array;
  equity: Float64Array;
  grossEquity: Float64Array;
  buyAndHoldEquity: Float64Array;
  /** equity / running maximum of equity - 1, the running maximum starting at the first equity. */
  drawdown: Float64Array;
  /** Bars loaded, including the first one the frame drops. */
  barCount: number;
}

export function runCrossover(bars: PriceBars, settings: CrossoverSettings): CrossoverRun {
  const barCount = bars.close.length;
  const rows = Math.max(0, barCount - 1);
  const close = bars.close;
  const fastLine = movingAverage(close, settings.fastPeriod, settings.fastKind);
  const slowLine = movingAverage(close, settings.slowPeriod, settings.slowKind);
  const shortValue = settings.mode === "long_short" ? -1 : 0;

  const positionAll = new Float64Array(barCount);
  for (let i = 0; i < barCount; i += 1) {
    const f = fastLine[i] as number;
    const s = slowLine[i] as number;
    positionAll[i] = Number.isNaN(f) || Number.isNaN(s) ? 0 : f > s ? 1 : shortValue;
  }

  const run: CrossoverRun = {
    timestampSeconds: bars.timestampSeconds.slice(1),
    close: new Float64Array(rows),
    fast: new Float64Array(rows),
    slow: new Float64Array(rows),
    position: new Float64Array(rows),
    heldPosition: new Float64Array(rows),
    barReturn: new Float64Array(rows),
    turnover: new Float64Array(rows),
    costFraction: new Float64Array(rows),
    grossReturn: new Float64Array(rows),
    netReturn: new Float64Array(rows),
    equity: new Float64Array(rows),
    grossEquity: new Float64Array(rows),
    buyAndHoldEquity: new Float64Array(rows),
    drawdown: new Float64Array(rows),
    barCount,
  };

  let equity = 1;
  let gross = 1;
  let buyAndHold = 1;
  let peak = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < rows; k += 1) {
    const i = k + 1;
    const held = positionAll[i - 1] as number;
    const decided = positionAll[i] as number;
    const barReturn = (close[i] as number) / (close[i - 1] as number) - 1;
    const turnover = Math.abs(decided - held);
    const costFraction = (settings.costPointsPerSide / (close[i] as number)) * turnover;
    const grossReturn = held * barReturn;
    const net = grossReturn - costFraction;

    equity *= 1 + net;
    gross *= 1 + grossReturn;
    buyAndHold *= 1 + barReturn;
    if (equity > peak) peak = equity;

    run.close[k] = close[i] as number;
    run.fast[k] = fastLine[i] as number;
    run.slow[k] = slowLine[i] as number;
    run.position[k] = decided;
    run.heldPosition[k] = held;
    run.barReturn[k] = barReturn;
    run.turnover[k] = turnover;
    run.costFraction[k] = costFraction;
    run.grossReturn[k] = grossReturn;
    run.netReturn[k] = net;
    run.equity[k] = equity;
    run.grossEquity[k] = gross;
    run.buyAndHoldEquity[k] = buyAndHold;
    run.drawdown[k] = equity / peak - 1;
  }
  return run;
}

// ----------------------------------------------------------------- Sharpe

/** crossovers.crossover.ann_factor: bars per year from the series' own span. */
export function annualisationFactor(firstSeconds: number, lastSeconds: number, barCount: number): number {
  const spanDays = Math.max((lastSeconds - firstSeconds) / 86400, 1e-9);
  return barCount / (spanDays / 365.25);
}

/** crossovers.crossover._sharpe: mean / sample standard deviation * sqrt(annualisation); 0 when undefined. */
export function sharpeRatio(values: ArrayLike<number>, annualisation: number, from = 0, to = values.length): number {
  const count = to - from;
  if (count < 2) return 0;
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += values[i] as number;
  const average = sum / count;
  let squares = 0;
  for (let i = from; i < to; i += 1) {
    const delta = (values[i] as number) - average;
    squares += delta * delta;
  }
  const deviation = Math.sqrt(squares / (count - 1));
  if (!(deviation > 0) || !Number.isFinite(deviation)) return 0;
  return (average / deviation) * Math.sqrt(annualisation);
}

export interface SplitSharpe {
  inSample: number;
  outOfSample: number;
  full: number;
}

export interface SeriesSplit {
  /** crossover.py: the loaded bars' timestamp at index int(n * trainFraction). */
  splitTimestampSeconds: number;
  /** First frame row at or after the split. */
  splitRow: number;
  annualisation: number;
}

export function seriesSplit(bars: PriceBars, run: CrossoverRun, trainFraction: number): SeriesSplit {
  const count = bars.timestampSeconds.length;
  const splitTimestampSeconds = bars.timestampSeconds[Math.min(count - 1, Math.trunc(count * trainFraction))] as number;
  let splitRow = run.timestampSeconds.length;
  for (let k = 0; k < run.timestampSeconds.length; k += 1) {
    if ((run.timestampSeconds[k] as number) >= splitTimestampSeconds) {
      splitRow = k;
      break;
    }
  }
  const annualisation = annualisationFactor(bars.timestampSeconds[0] as number, bars.timestampSeconds[count - 1] as number, count);
  return { splitTimestampSeconds, splitRow, annualisation };
}

export function splitSharpe(returns: ArrayLike<number>, split: SeriesSplit): SplitSharpe {
  return {
    inSample: sharpeRatio(returns, split.annualisation, 0, split.splitRow),
    outOfSample: sharpeRatio(returns, split.annualisation, split.splitRow, returns.length),
    full: sharpeRatio(returns, split.annualisation),
  };
}

// --------------------------------------------------------------- statistics

export interface SeriesStatistics {
  finalEquity: number;
  totalReturn: number;
  maximumDrawdown: number;
  /** Timestamp of the lowest drawdown, epoch seconds. */
  worstDrawdownSeconds: number | null;
  sharpeInSample: number;
  sharpeOutOfSample: number;
  sharpeFull: number;
}

function minimumIndex(values: ArrayLike<number>): number {
  let best = -1;
  let bestValue = Number.POSITIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (value < bestValue) {
      bestValue = value;
      best = i;
    }
  }
  return best;
}

/** The buy and hold baseline's drawdown array: equity over its running maximum. */
export function drawdownOf(equity: ArrayLike<number>): Float64Array {
  const out = new Float64Array(equity.length);
  let peak = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < equity.length; i += 1) {
    const value = equity[i] as number;
    if (value > peak) peak = value;
    out[i] = value / peak - 1;
  }
  return out;
}

export function statisticsOf(returns: ArrayLike<number>, equity: ArrayLike<number>, drawdown: ArrayLike<number>, timestamps: readonly number[], split: SeriesSplit): SeriesStatistics {
  const final = equity.length > 0 ? (equity[equity.length - 1] as number) : 1;
  const worst = minimumIndex(drawdown);
  const sharpes = splitSharpe(returns, split);
  return {
    finalEquity: final,
    totalReturn: final - 1,
    maximumDrawdown: worst >= 0 ? (drawdown[worst] as number) : 0,
    worstDrawdownSeconds: worst >= 0 ? (timestamps[worst] as number) : null,
    sharpeInSample: sharpes.inSample,
    sharpeOutOfSample: sharpes.outOfSample,
    sharpeFull: sharpes.full,
  };
}

// ------------------------------------------------------------------ trades

export interface TradeSpell {
  side: 1 | -1;
  startRow: number;
  endRow: number;
  /** Product of (1 + net return) over the spell's rows, the round trip paid at its closing flip included. */
  factor: number;
  bars: number;
}

/**
 * Maximal runs of a constant non-zero held position. Each run's factor includes
 * the cost of the flip that ends it, and the factors of every run (flat spells
 * too) multiply to the final equity exactly.
 */
export function tradeSpells(run: CrossoverRun): { spells: TradeSpell[]; flatFactor: number } {
  const spells: TradeSpell[] = [];
  let flatFactor = 1;
  const rows = run.netReturn.length;
  let start = 0;
  while (start < rows) {
    const side = run.heldPosition[start] as number;
    let end = start;
    let factor = 1;
    while (end < rows && (run.heldPosition[end] as number) === side) {
      factor *= 1 + (run.netReturn[end] as number);
      end += 1;
    }
    if (side === 0) flatFactor *= factor;
    else spells.push({ side: side > 0 ? 1 : -1, startRow: start, endRow: end - 1, factor, bars: end - start });
    start = end;
  }
  return { spells, flatFactor };
}

export interface TradeStatistics {
  count: number;
  longCount: number;
  shortCount: number;
  winRate: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  /** Average win over the absolute average loss. */
  payoffRatio: number | null;
  /** Sum of wins over the absolute sum of losses. */
  profitFactor: number | null;
  expectancy: number | null;
  averageHoldingBars: number | null;
  medianHoldingBars: number | null;
  best: number | null;
  worst: number | null;
}

export function tradeStatistics(spells: readonly TradeSpell[]): TradeStatistics {
  const returns = spells.map((spell) => spell.factor - 1);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value <= 0);
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const holding = spells.map((spell) => spell.bars).sort((a, b) => a - b);
  const averageWin = wins.length ? sum(wins) / wins.length : null;
  const averageLoss = losses.length ? sum(losses) / losses.length : null;
  return {
    count: spells.length,
    longCount: spells.filter((spell) => spell.side === 1).length,
    shortCount: spells.filter((spell) => spell.side === -1).length,
    winRate: spells.length ? wins.length / spells.length : null,
    averageWin,
    averageLoss,
    payoffRatio: averageWin !== null && averageLoss !== null && averageLoss !== 0 ? averageWin / Math.abs(averageLoss) : null,
    profitFactor: losses.length && sum(losses) !== 0 ? sum(wins) / Math.abs(sum(losses)) : null,
    expectancy: spells.length ? sum(returns) / spells.length : null,
    averageHoldingBars: spells.length ? sum(holding) / spells.length : null,
    medianHoldingBars: holding.length ? (holding[Math.floor((holding.length - 1) / 2)] as number) / 2 + (holding[Math.ceil((holding.length - 1) / 2)] as number) / 2 : null,
    best: returns.length ? Math.max(...returns) : null,
    worst: returns.length ? Math.min(...returns) : null,
  };
}

/** Number of position changes, counted the way crossovers.crossover._count_trades counts (the warm-up's first entry included). */
export function positionChangeCount(run: CrossoverRun): number {
  let count = 0;
  for (let k = 0; k < run.turnover.length; k += 1) if ((run.turnover[k] as number) !== 0) count += 1;
  return count;
}

// --------------------------------------------------------------- drawdowns

export interface DrawdownEpisode {
  peakSeconds: number;
  troughSeconds: number;
  /** When equity regained its peak; null when it had not by the end of the window. */
  recoverySeconds: number | null;
  depth: number;
  barsPeakToTrough: number;
  barsToRecovery: number | null;
}

/** Every stretch below a running high, deepest first. */
export function drawdownEpisodes(run: CrossoverRun, limit = 8): DrawdownEpisode[] {
  const episodes: DrawdownEpisode[] = [];
  const rows = run.equity.length;
  let peakRow = 0;
  let troughRow = -1;
  let troughDepth = 0;
  for (let k = 0; k < rows; k += 1) {
    const depth = run.drawdown[k] as number;
    if (depth >= 0) {
      if (troughRow >= 0) {
        episodes.push({
          peakSeconds: run.timestampSeconds[peakRow] as number,
          troughSeconds: run.timestampSeconds[troughRow] as number,
          recoverySeconds: run.timestampSeconds[k] as number,
          depth: troughDepth,
          barsPeakToTrough: troughRow - peakRow,
          barsToRecovery: k - peakRow,
        });
        troughRow = -1;
        troughDepth = 0;
      }
      peakRow = k;
    } else if (depth < troughDepth) {
      troughDepth = depth;
      troughRow = k;
    }
  }
  if (troughRow >= 0) {
    episodes.push({
      peakSeconds: run.timestampSeconds[peakRow] as number,
      troughSeconds: run.timestampSeconds[troughRow] as number,
      recoverySeconds: null,
      depth: troughDepth,
      barsPeakToTrough: troughRow - peakRow,
      barsToRecovery: null,
    });
  }
  return episodes.sort((a, b) => a.depth - b.depth).slice(0, limit);
}

/** How many separate stretches below a high went deeper than `threshold` (a negative fraction). */
export function episodeCountDeeperThan(run: CrossoverRun, threshold: number): number {
  return drawdownEpisodes(run, Number.MAX_SAFE_INTEGER).filter((episode) => episode.depth <= threshold).length;
}

// ---------------------------------------------------------------- months

export interface MonthlyReturn {
  /** "2024-06" in the stamped (wall-clock) calendar. */
  month: string;
  strategy: number;
  buyAndHold: number;
  barCount: number;
}

export function monthlyReturns(run: CrossoverRun): MonthlyReturn[] {
  const out: MonthlyReturn[] = [];
  let current: { month: string; strategy: number; buyAndHold: number; barCount: number } | null = null;
  for (let k = 0; k < run.netReturn.length; k += 1) {
    const month = new Date((run.timestampSeconds[k] as number) * 1000).toISOString().slice(0, 7);
    if (!current || current.month !== month) {
      if (current) out.push({ month: current.month, strategy: current.strategy - 1, buyAndHold: current.buyAndHold - 1, barCount: current.barCount });
      current = { month, strategy: 1, buyAndHold: 1, barCount: 0 };
    }
    current.strategy *= 1 + (run.netReturn[k] as number);
    current.buyAndHold *= 1 + (run.barReturn[k] as number);
    current.barCount += 1;
  }
  if (current) out.push({ month: current.month, strategy: current.strategy - 1, buyAndHold: current.buyAndHold - 1, barCount: current.barCount });
  return out;
}

// -------------------------------------------------------------- thinning

export interface ThinnedSeries {
  timestampSeconds: number[];
  equity: number[];
  grossEquity: number[];
  buyAndHoldEquity: number[];
  /** The lowest drawdown inside each bucket, so a deep dip never disappears. */
  drawdown: number[];
  /** Bars per bucket. */
  step: number;
}

export function thinSeries(run: CrossoverRun, maxPoints: number): ThinnedSeries {
  const rows = run.equity.length;
  const step = Math.max(1, Math.ceil(rows / Math.max(1, maxPoints)));
  const out: ThinnedSeries = { timestampSeconds: [], equity: [], grossEquity: [], buyAndHoldEquity: [], drawdown: [], step };
  for (let start = 0; start < rows; start += step) {
    const end = Math.min(rows, start + step) - 1;
    let lowest = 0;
    for (let k = start; k <= end; k += 1) if ((run.drawdown[k] as number) < lowest) lowest = run.drawdown[k] as number;
    out.timestampSeconds.push(run.timestampSeconds[end] as number);
    out.equity.push(run.equity[end] as number);
    out.grossEquity.push(run.grossEquity[end] as number);
    out.buyAndHoldEquity.push(run.buyAndHoldEquity[end] as number);
    out.drawdown.push(lowest);
  }
  return out;
}

// ------------------------------------------------------------ MACD and RSI

export interface MacdSeries {
  macd: Float64Array;
  signalLine: Float64Array;
  histogram: Float64Array;
}

/** MACD(fast, slow, signal) as the notebook drew it: three pandas `ewm(adjust=False)` averages. */
export function macdSeries(close: ArrayLike<number>, fast: number, slow: number, signal: number): MacdSeries {
  const fastLine = exponentialMovingAverage(close, fast);
  const slowLine = exponentialMovingAverage(close, slow);
  const macd = new Float64Array(close.length);
  for (let i = 0; i < close.length; i += 1) macd[i] = (fastLine[i] as number) - (slowLine[i] as number);
  const signalLine = exponentialMovingAverage(macd, signal);
  const histogramValues = new Float64Array(close.length);
  for (let i = 0; i < close.length; i += 1) histogramValues[i] = (macd[i] as number) - (signalLine[i] as number);
  return { macd, signalLine, histogram: histogramValues };
}

/**
 * The notebook's Wilder RSI: average gain and loss are `ewm(alpha=1/period,
 * adjust=False, min_periods=period)` of the clipped price changes, so the first
 * value appears at row `period`; a zero average loss leaves the value unknown.
 */
export function relativeStrengthIndex(close: ArrayLike<number>, period: number): Float64Array {
  const out = new Float64Array(close.length).fill(Number.NaN);
  const alpha = 1 / period;
  let averageGain = 0;
  let averageLoss = 0;
  for (let i = 1; i < close.length; i += 1) {
    const delta = (close[i] as number) - (close[i - 1] as number);
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    if (i === 1) {
      averageGain = gain;
      averageLoss = loss;
    } else {
      averageGain = (1 - alpha) * averageGain + alpha * gain;
      averageLoss = (1 - alpha) * averageLoss + alpha * loss;
    }
    if (i >= period && averageLoss !== 0) out[i] = 100 - 100 / (1 + averageGain / averageLoss);
  }
  return out;
}

export interface WindowCrossings {
  /** Window-relative indices where the sign of (macd - signal) changed to +1. */
  longs: number[];
  /** ... to -1. */
  shorts: number[];
}

/** Changes of sign(macd - signal) inside rows [from, to]; the window's first row is never a change. */
export function macdCrossings(macd: ArrayLike<number>, signalLine: ArrayLike<number>, from: number, to: number): WindowCrossings {
  const longs: number[] = [];
  const shorts: number[] = [];
  let previous = Math.sign((macd[from] as number) - (signalLine[from] as number));
  for (let k = from + 1; k <= to; k += 1) {
    const current = Math.sign((macd[k] as number) - (signalLine[k] as number));
    if (current !== previous) {
      if (current === 1) longs.push(k - from);
      else if (current === -1) shorts.push(k - from);
    }
    previous = current;
  }
  return { longs, shorts };
}

/** Changes of the crossover rule's own position inside rows [from, to]: where the EMA/SMA lines crossed. */
export function positionFlips(position: ArrayLike<number>, from: number, to: number): WindowCrossings {
  const longs: number[] = [];
  const shorts: number[] = [];
  for (let k = from + 1; k <= to; k += 1) {
    const current = position[k] as number;
    if (current !== (position[k - 1] as number)) {
      if (current === 1) longs.push(k - from);
      else if (current === -1) shorts.push(k - from);
    }
  }
  return { longs, shorts };
}

// ------------------------------------------------------------ column frame

export interface ColumnSummary {
  /** The frame column's name in full words. */
  name: string;
  description: string;
  summary: LensEightNumberSummary;
  histogram: HistogramBin[];
}

export interface FrameColumns {
  [name: string]: { description: string; values: ArrayLike<number> };
}

/** Every column of the frame: eight numbers and one histogram each (1st to 99th percentile, edge bins absorb the tails). */
export function columnSummaries(columns: FrameColumns, bins: number): ColumnSummary[] {
  return Object.entries(columns).map(([name, column]) => {
    const finite: number[] = [];
    for (let i = 0; i < column.values.length; i += 1) {
      const value = column.values[i] as number;
      if (Number.isFinite(value)) finite.push(value);
    }
    return { name, description: column.description, summary: eightNumberSummary(finite), histogram: histogram(finite, bins) };
  });
}

/** Typed array to a JSON-safe array: NaN becomes null, values rounded to `digits` decimals. */
export function nullableRange(values: ArrayLike<number>, from: number, to: number, digits = 4): Array<number | null> {
  const scale = 10 ** digits;
  const out: Array<number | null> = [];
  for (let k = from; k <= to; k += 1) {
    const value = values[k] as number;
    out.push(Number.isFinite(value) ? Math.round(value * scale) / scale : null);
  }
  return out;
}

// -------------------------------------------------------------- body types

export const MAXIMUM_TERMS = 5000;

export interface CrossoverParameters {
  symbol: string;
  timeframe: string;
  series: PriceSeries;
  windowStart: string;
  windowEnd: string;
  fastKind: MovingAverageKind;
  slowKind: MovingAverageKind;
  fastPeriod: number;
  slowPeriod: number;
  mode: PositionMode;
  costSource: string;
  costPointsPerSide: number;
  candleStart: string;
  candleEnd: string;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  rsiPeriod: number;
  trainFraction: number;
  bins: number;
}

export interface CostPreset {
  source: "notebook" | "dashboard";
  label: string;
  costPointsPerSide: number;
  roundTripUsd: number;
  pointValueUsd: number;
  file: string;
}

export interface CandleWindow {
  timestampSeconds: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  fast: Array<number | null>;
  slow: Array<number | null>;
  macd: Array<number | null>;
  macdSignal: Array<number | null>;
  macdHistogram: Array<number | null>;
  relativeStrengthIndex: Array<number | null>;
  macdLongIndices: number[];
  macdShortIndices: number[];
  flipLongIndices: number[];
  flipShortIndices: number[];
  /** True when the requested window held more bars than the page draws. */
  clipped: boolean;
  requestedBarCount: number;
}

export interface SummaryBlock {
  /** Bars loaded; the frame below has one fewer (the first bar has no return). */
  loadedBarCount: number;
  frameRowCount: number;
  firstTimestampSeconds: number;
  lastTimestampSeconds: number;
  spanDays: number;
  annualisationBarsPerYear: number;
  splitTimestampSeconds: number;
  strategy: SeriesStatistics;
  buyAndHold: SeriesStatistics;
  grossFinalEquity: number;
  totalCostFraction: number;
  positionChangeCount: number;
  longShare: number;
  shortShare: number;
  flatShare: number;
  /** Stretches below a high deeper than 10%, 5% and 2.5%. */
  episodesDeeperThan: Array<{ threshold: number; count: number }>;
}

export interface SweepRow {
  configuration_label: string;
  fast_kind: MovingAverageKind;
  slow_kind: MovingAverageKind;
  fast_period: number;
  slow_period: number;
  in_sample_sharpe: number;
  out_of_sample_sharpe: number;
  full_sample_sharpe: number;
  total_return_fraction: number;
  maximum_drawdown_fraction: number;
  trade_count: number;
  in_sample_rank: number;
  is_notebook_pair: boolean;
  is_in_sample_winner: boolean;
}

export interface RealityCheckRow {
  candidate: string;
  configuration_label: string;
  fast_kind: string;
  slow_kind: string;
  fast_period: number;
  slow_period: number;
  full_sample_sharpe: number;
  total_return_fraction: number;
  walk_forward_fold_count: number;
  walk_forward_median_sharpe: number;
  walk_forward_losing_fold_count: number;
  bootstrap_block_bars: number;
  bootstrap_replicate_count: number;
  bootstrap_interval_low: number;
  bootstrap_median: number;
  bootstrap_interval_high: number;
  bootstrap_interval_includes_zero: boolean;
  per_bar_sharpe: number;
  selection_null_per_bar_sharpe: number;
  return_skewness: number;
  return_kurtosis_pearson: number;
  trial_count: number;
  deflated_sharpe_ratio: number;
  survives_reality_check: boolean;
}

export interface FoldRow {
  candidate: string;
  fold: number;
  start_index: number;
  end_index: number;
  sharpe: number;
}

export interface ReferenceRuleRow {
  rule: string;
  description: string;
  in_sample_sharpe: number;
  out_of_sample_sharpe: number;
  full_sample_sharpe: number;
  total_return_fraction: number;
  maximum_drawdown_fraction: number;
  trade_count: number;
  notebook_claimed_out_of_sample_sharpe: number | null;
}

export interface LandedRun {
  symbol: string;
  timeframe: string;
  price_series: string;
  window_start: string;
  window_end: string;
  bar_count: number;
  mode: string;
  cost_points_per_side: number;
  train_fraction: number;
  split_timestamp: string;
  annualisation_bars_per_year: number;
  sweep_pair_count: number;
  search_timeframe_count: number;
  notebook_fast_kind: string;
  notebook_slow_kind: string;
  notebook_fast_period: number;
  notebook_slow_period: number;
  notebook_pair_in_sample_rank: number;
  [column: string]: unknown;
}

export interface LandedRecord {
  run: LandedRun | null;
  sweep: SweepRow[];
  realityCheck: RealityCheckRow[];
  folds: FoldRow[];
  referenceRules: ReferenceRuleRow[];
}

/** One trade, the term the equity product multiplies in: the page steps through these. */
export interface TradeTerm {
  startSeconds: number;
  side: 1 | -1;
  bars: number;
  /** 1 + the trade's net return. */
  factor: number;
}

export interface CrossoverBody {
  /** False when the bars for this symbol, timeframe and window are not in the lake. */
  available: boolean;
  parameters: CrossoverParameters;
  costPresets: CostPreset[];
  summary: SummaryBlock | null;
  series: ThinnedSeries | null;
  candles: CandleWindow | null;
  months: MonthlyReturn[];
  episodes: DrawdownEpisode[];
  trades:
    | (TradeStatistics & {
        returnHistogram: HistogramBin[];
        factorProductError: number;
        /** The product of the flat (position 0) spells' factors, multiplied in before the trades. */
        flatFactor: number;
        /** The first trades in time order, at most MAXIMUM_TERMS. */
        terms: TradeTerm[];
        termsClipped: boolean;
      })
    | null;
  columns: ColumnSummary[];
  landed: LandedRecord;
}
