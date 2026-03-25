/**
 * Benchmark comparison — strategy vs buy-and-hold, alpha/beta computation.
 *
 * Computes buy-and-hold equity curve from OHLCV bars, then derives
 * alpha, beta, information ratio, tracking error, and capture ratios.
 */

import type { OHLCVBar } from './tradeSimulator';

// ============================================================
// TYPES
// ============================================================

export interface BenchmarkResult {
  buyAndHold: {
    totalReturn: number;
    totalReturnPct: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    sharpeRatio: number;
    equityCurve: { timestamp: number; equity: number }[];
  };
  comparison: {
    alpha: number;
    beta: number;
    informationRatio: number;
    trackingError: number;
    upCaptureRatio: number;
    downCaptureRatio: number;
  };
  rollingMetrics: {
    timestamp: number;
    strategySharpe: number;
    benchmarkSharpe: number;
    rollingAlpha: number;
  }[];
}

// ============================================================
// BENCHMARK ENGINE
// ============================================================

/**
 * Compute benchmark comparison: strategy equity curve vs buy-and-hold.
 *
 * Buy-and-hold equity = initialCapital × (close[i] / close[0])
 */
export function computeBenchmark(
  bars: OHLCVBar[],
  strategyEquityCurve: { timestamp: number; equity: number }[],
  initialCapital: number,
): BenchmarkResult {
  if (bars.length === 0 || strategyEquityCurve.length === 0 || initialCapital <= 0) {
    return emptyResult();
  }

  const sortedBars = [...bars].sort((a, b) => a.ts - b.ts);
  const firstClose = sortedBars[0]!.close;

  if (firstClose === 0) return emptyResult();

  // 1. Buy-and-hold equity curve
  const bhEquityCurve = sortedBars.map(bar => ({
    timestamp: bar.ts,
    equity: initialCapital * (bar.close / firstClose),
  }));

  const lastBhEquity = bhEquityCurve[bhEquityCurve.length - 1]!.equity;
  const bhTotalReturn = lastBhEquity - initialCapital;
  const bhTotalReturnPct = (bhTotalReturn / initialCapital) * 100;

  // Buy-and-hold max drawdown
  let bhPeak = initialCapital;
  let bhMaxDD = 0;
  for (const pt of bhEquityCurve) {
    if (pt.equity > bhPeak) bhPeak = pt.equity;
    const dd = bhPeak - pt.equity;
    if (dd > bhMaxDD) bhMaxDD = dd;
  }
  const bhMaxDDPct = initialCapital > 0 ? (bhMaxDD / initialCapital) * 100 : 0;

  // 2. Compute returns for both series
  // Align strategy and benchmark by timestamp
  const strategyMap = new Map<number, number>();
  for (const pt of strategyEquityCurve) {
    strategyMap.set(pt.timestamp, pt.equity);
  }

  const bhMap = new Map<number, number>();
  for (const pt of bhEquityCurve) {
    bhMap.set(pt.timestamp, pt.equity);
  }

  // Find common timestamps
  const commonTimestamps = sortedBars
    .map(b => b.ts)
    .filter(ts => strategyMap.has(ts) && bhMap.has(ts));

  // Per-bar returns for both
  const strategyReturns: number[] = [];
  const benchmarkReturns: number[] = [];

  for (let i = 1; i < commonTimestamps.length; i++) {
    const prevTs = commonTimestamps[i - 1]!;
    const currTs = commonTimestamps[i]!;

    const sPrev = strategyMap.get(prevTs)!;
    const sCurr = strategyMap.get(currTs)!;
    const bPrev = bhMap.get(prevTs)!;
    const bCurr = bhMap.get(currTs)!;

    if (sPrev > 0 && bPrev > 0) {
      strategyReturns.push((sCurr - sPrev) / sPrev);
      benchmarkReturns.push((bCurr - bPrev) / bPrev);
    }
  }

  // Buy-and-hold Sharpe
  const bhSharpe = computeSharpe(benchmarkReturns);

  // Strategy total return
  const sortedStrategy = [...strategyEquityCurve].sort((a, b) => a.timestamp - b.timestamp);
  const lastStrategyEquity = sortedStrategy[sortedStrategy.length - 1]!.equity;
  const strategyTotalReturn = lastStrategyEquity - initialCapital;
  const strategyTotalReturnPct = (strategyTotalReturn / initialCapital) * 100;

  // 3. Alpha = strategy_return - benchmark_return (simple excess return)
  const alpha = strategyTotalReturnPct - bhTotalReturnPct;

  // 4. Beta = Cov(strategy, benchmark) / Var(benchmark)
  const beta = computeBeta(strategyReturns, benchmarkReturns);

  // 5. Tracking error and information ratio
  const excessReturns = strategyReturns.map((sr, i) => sr - benchmarkReturns[i]!);
  const trackingError = standardDeviation(excessReturns) * Math.sqrt(252);
  const meanExcessReturn = excessReturns.length > 0
    ? excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length
    : 0;
  const informationRatio = trackingError > 0
    ? (meanExcessReturn * 252) / trackingError
    : 0;

  // 6. Up/Down capture ratios
  const { upCapture, downCapture } = computeCaptureRatios(strategyReturns, benchmarkReturns);

  // 7. Rolling metrics (30-bar rolling window)
  const rollingMetrics = computeRollingMetrics(
    commonTimestamps,
    strategyReturns,
    benchmarkReturns,
    30,
  );

  return {
    buyAndHold: {
      totalReturn: bhTotalReturn,
      totalReturnPct: bhTotalReturnPct,
      maxDrawdown: bhMaxDD,
      maxDrawdownPct: bhMaxDDPct,
      sharpeRatio: bhSharpe,
      equityCurve: bhEquityCurve,
    },
    comparison: {
      alpha,
      beta,
      informationRatio,
      trackingError,
      upCaptureRatio: upCapture,
      downCaptureRatio: downCapture,
    },
    rollingMetrics,
  };
}

// ============================================================
// STATISTICS HELPERS
// ============================================================

function computeSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const m = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - m) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  return std > 0 ? (m / std) * Math.sqrt(252) : 0;
}

function standardDeviation(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function computeBeta(strategyReturns: number[], benchmarkReturns: number[]): number {
  const n = Math.min(strategyReturns.length, benchmarkReturns.length);
  if (n < 2) return 0;

  const meanS = strategyReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanB = benchmarkReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;

  let covariance = 0;
  let varianceB = 0;

  for (let i = 0; i < n; i++) {
    const ds = strategyReturns[i]! - meanS;
    const db = benchmarkReturns[i]! - meanB;
    covariance += ds * db;
    varianceB += db * db;
  }

  covariance /= (n - 1);
  varianceB /= (n - 1);

  return varianceB > 0 ? covariance / varianceB : 0;
}

function computeCaptureRatios(
  strategyReturns: number[],
  benchmarkReturns: number[],
): { upCapture: number; downCapture: number } {
  const n = Math.min(strategyReturns.length, benchmarkReturns.length);

  let upStrategySum = 0;
  let upBenchmarkSum = 0;
  let upCount = 0;
  let downStrategySum = 0;
  let downBenchmarkSum = 0;
  let downCount = 0;

  for (let i = 0; i < n; i++) {
    const br = benchmarkReturns[i]!;
    const sr = strategyReturns[i]!;

    if (br > 0) {
      upStrategySum += sr;
      upBenchmarkSum += br;
      upCount++;
    } else if (br < 0) {
      downStrategySum += sr;
      downBenchmarkSum += br;
      downCount++;
    }
  }

  const upCapture = upBenchmarkSum !== 0
    ? (upStrategySum / upCount) / (upBenchmarkSum / upCount) * 100
    : 0;
  const downCapture = downBenchmarkSum !== 0
    ? (downStrategySum / downCount) / (downBenchmarkSum / downCount) * 100
    : 0;

  return {
    upCapture: isFinite(upCapture) ? upCapture : 0,
    downCapture: isFinite(downCapture) ? downCapture : 0,
  };
}

function computeRollingMetrics(
  timestamps: number[],
  strategyReturns: number[],
  benchmarkReturns: number[],
  windowSize: number,
): BenchmarkResult['rollingMetrics'] {
  const metrics: BenchmarkResult['rollingMetrics'] = [];

  // Returns array is 1 shorter than timestamps (return[i] corresponds to timestamps[i+1])
  for (let i = windowSize; i < strategyReturns.length; i++) {
    const sWindow = strategyReturns.slice(i - windowSize, i);
    const bWindow = benchmarkReturns.slice(i - windowSize, i);

    const sSharpe = computeSharpe(sWindow);
    const bSharpe = computeSharpe(bWindow);

    const sMean = sWindow.reduce((a, b) => a + b, 0) / sWindow.length;
    const bMean = bWindow.reduce((a, b) => a + b, 0) / bWindow.length;
    const rollingAlpha = (sMean - bMean) * 252 * 100; // Annualized alpha in pct

    // timestamps[i+1] because returns[i] maps to the bar at timestamps[i+1]
    const ts = i + 1 < timestamps.length ? timestamps[i + 1]! : timestamps[timestamps.length - 1]!;

    metrics.push({
      timestamp: ts,
      strategySharpe: isFinite(sSharpe) ? sSharpe : 0,
      benchmarkSharpe: isFinite(bSharpe) ? bSharpe : 0,
      rollingAlpha: isFinite(rollingAlpha) ? rollingAlpha : 0,
    });
  }

  return metrics;
}

function emptyResult(): BenchmarkResult {
  return {
    buyAndHold: {
      totalReturn: 0,
      totalReturnPct: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      equityCurve: [],
    },
    comparison: {
      alpha: 0,
      beta: 0,
      informationRatio: 0,
      trackingError: 0,
      upCaptureRatio: 0,
      downCaptureRatio: 0,
    },
    rollingMetrics: [],
  };
}
