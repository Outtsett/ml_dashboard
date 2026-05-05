/**
 * Monte Carlo Analysis — assess strategy robustness via trade resampling.
 * Shuffles trade sequence, bootstraps returns, computes confidence intervals.
 *
 * Uses a seeded LCG PRNG for reproducible results.
 */

import type { TradeRecord } from './tradeSimulator';

// ============================================================
// TYPES
// ============================================================

export interface MonteCarloConfig {
  numSimulations: number;
  confidenceLevels: number[];
  seed?: number;
}

export interface MonteCarloResult {
  numSimulations: number;
  terminalEquity: {
    mean: number;
    median: number;
    stdDev: number;
    percentiles: Record<string, number>;
    distribution: number[];
  };
  maxDrawdown: {
    mean: number;
    median: number;
    percentiles: Record<string, number>;
    distribution: number[];
  };
  sharpeRatio: {
    mean: number;
    median: number;
    percentiles: Record<string, number>;
  };
  winRate: {
    mean: number;
    percentiles: Record<string, number>;
  };
  profitProbability: number;
  ruinProbability: number;
}

// ============================================================
// SEEDED PRNG (Linear Congruential Generator)
// ============================================================

class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed & 0x7fffffff;
    if (this.state === 0) this.state = 1;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    // LCG parameters (Numerical Recipes)
    this.state = (this.state * 1664525 + 1013904223) & 0x7fffffff;
    return this.state / 0x80000000;
  }

  /** Returns an integer in [0, max). */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

// ============================================================
// MONTE CARLO ENGINE
// ============================================================

const DEFAULT_CONFIG: MonteCarloConfig = {
  numSimulations: 1000,
  confidenceLevels: [0.05, 0.25, 0.50, 0.75, 0.95],
};

/**
 * Run Monte Carlo analysis on a set of trade results.
 *
 * For each simulation:
 *   1. Resample trades WITH replacement (bootstrap)
 *   2. Compute equity curve from resampled sequence
 *   3. Calculate terminal equity, max drawdown, Sharpe, win rate
 *
 * Then aggregate across all simulations for confidence intervals.
 */
export function runMonteCarloAnalysis(
  trades: TradeRecord[],
  initialCapital: number,
  config?: MonteCarloConfig,
): MonteCarloResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { numSimulations, confidenceLevels } = cfg;

  // Extract net P&L from each closed trade
  const pnls = trades
    .filter(t => t.exitPrice !== null && t.netPnl !== null)
    .map(t => t.netPnl!);

  if (pnls.length === 0) {
    return emptyResult(numSimulations);
  }

  const rng = new SeededRNG(cfg.seed ?? 42);
  const numTrades = pnls.length;

  // Storage for simulation results
  const terminalEquities: number[] = [];
  const maxDrawdowns: number[] = [];
  const sharpeRatios: number[] = [];
  const winRates: number[] = [];

  for (let sim = 0; sim < numSimulations; sim++) {
    // Bootstrap: resample trades with replacement
    const resampledPnls: number[] = [];
    for (let t = 0; t < numTrades; t++) {
      resampledPnls.push(pnls[rng.nextInt(numTrades)]!);
    }

    // Build equity curve from resampled trades
    let equity = initialCapital;
    let peakEquity = equity;
    let maxDD = 0;
    let wins = 0;

    const returns: number[] = [];

    for (const pnl of resampledPnls) {
      equity += pnl;
      if (pnl > 0) wins++;

      const ret = initialCapital > 0 ? pnl / initialCapital : 0;
      returns.push(ret);

      if (equity > peakEquity) peakEquity = equity;
      const dd = peakEquity - equity;
      if (dd > maxDD) maxDD = dd;
    }

    terminalEquities.push(equity);
    maxDrawdowns.push(maxDD);
    winRates.push(numTrades > 0 ? wins / numTrades : 0);

    // Sharpe from this simulation's returns
    const meanRet = returns.length > 0
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : 0;
    const variance = returns.length > 1
      ? returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length - 1)
      : 0;
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? (meanRet / stdDev) * Math.sqrt(252) : 0;
    sharpeRatios.push(isFinite(sharpe) ? sharpe : 0);
  }

  // Aggregate results
  const ruinThreshold = initialCapital * 0.5; // 50% drawdown = ruin

  return {
    numSimulations,
    terminalEquity: {
      mean: mean(terminalEquities),
      median: percentile(terminalEquities, 0.50),
      stdDev: stdDeviation(terminalEquities),
      percentiles: computePercentiles(terminalEquities, confidenceLevels),
      distribution: computeHistogram(terminalEquities, 20),
    },
    maxDrawdown: {
      mean: mean(maxDrawdowns),
      median: percentile(maxDrawdowns, 0.50),
      percentiles: computePercentiles(maxDrawdowns, confidenceLevels),
      distribution: computeHistogram(maxDrawdowns, 20),
    },
    sharpeRatio: {
      mean: mean(sharpeRatios),
      median: percentile(sharpeRatios, 0.50),
      percentiles: computePercentiles(sharpeRatios, confidenceLevels),
    },
    winRate: {
      mean: mean(winRates),
      percentiles: computePercentiles(winRates, confidenceLevels),
    },
    profitProbability: terminalEquities.filter(e => e > initialCapital).length / numSimulations * 100,
    ruinProbability: maxDrawdowns.filter(dd => dd >= ruinThreshold).length / numSimulations * 100,
  };
}

// ============================================================
// STATISTICS HELPERS
// ============================================================

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDeviation(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower]!;
  const frac = idx - lower;
  return sorted[lower]! * (1 - frac) + sorted[upper]! * frac;
}

function computePercentiles(
  arr: number[],
  levels: number[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const level of levels) {
    const pctKey = Math.round(level * 100).toString();
    result[pctKey] = percentile(arr, level);
  }
  return result;
}

/**
 * Compute a histogram of values into `numBins` equal-width bins.
 * Returns an array of counts.
 */
function computeHistogram(arr: number[], numBins: number): number[] {
  if (arr.length === 0) return new Array(numBins).fill(0) as number[];

  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = max - min;

  if (range === 0) {
    const bins = new Array(numBins).fill(0) as number[];
    bins[0] = arr.length;
    return bins;
  }

  const binWidth = range / numBins;
  const bins = new Array(numBins).fill(0) as number[];

  for (const v of arr) {
    let binIdx = Math.floor((v - min) / binWidth);
    if (binIdx >= numBins) binIdx = numBins - 1; // Edge case: v === max
    bins[binIdx]!++;
  }

  return bins;
}

function emptyResult(numSimulations: number): MonteCarloResult {
  return {
    numSimulations,
    terminalEquity: {
      mean: 0, median: 0, stdDev: 0,
      percentiles: {}, distribution: [],
    },
    maxDrawdown: {
      mean: 0, median: 0,
      percentiles: {}, distribution: [],
    },
    sharpeRatio: {
      mean: 0, median: 0, percentiles: {},
    },
    winRate: {
      mean: 0, percentiles: {},
    },
    profitProbability: 0,
    ruinProbability: 0,
  };
}
