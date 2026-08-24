/**
 * Walk-Forward Backtesting — runs multiple backtests across rolling windows.
 * Uses existing computeWindows() for window generation.
 *
 * Each window runs the backtest engine on the out-of-sample (test) period,
 * then aggregates metrics across all windows for robustness assessment.
 */

import {
  computeWindows,
  generateGroupId,
  type WalkForwardConfig,
  type WalkForwardWindow,
} from '../../../training/walkforward';
import {
  runBacktest,
  type OHLCVBar,
  type Signal,
  type InstrumentSpec,
  type BacktestConfig,
  type BacktestMetrics,
} from './tradeSimulator';
import type { BrokerConfig } from '@shared/schema';

// ============================================================
// TYPES
// ============================================================

export interface WalkForwardRequest {
  bars: OHLCVBar[];
  signals: Signal[];
  instrument: InstrumentSpec;
  broker: BrokerConfig;
  config: BacktestConfig;
  walkForwardConfig: WalkForwardConfig;
}

export interface WalkForwardWindowResult {
  window: WalkForwardWindow;
  metrics: BacktestMetrics;
  tradeCount: number;
  equityCurve: { timestamp: number; equity: number }[];
}

export interface WalkForwardResult {
  groupId: string;
  windowResults: WalkForwardWindowResult[];
  aggregateMetrics: BacktestMetrics;
  oosMetrics: BacktestMetrics;
  consistency: number;
  degradation: number;
}

// ============================================================
// WALK-FORWARD ENGINE
// ============================================================

/**
 * Run walk-forward backtesting across rolling windows.
 *
 * 1. Compute date windows from the data range
 * 2. For each window, filter bars/signals to the test period
 * 3. Run the backtest engine on each window
 * 4. Aggregate metrics across all windows
 */
export function runWalkForwardBacktest(request: WalkForwardRequest): WalkForwardResult {
  const { bars, signals, instrument, broker, config, walkForwardConfig } = request;

  if (bars.length === 0) {
    return emptyResult();
  }

  const sortedBars = [...bars].sort((a, b) => a.ts - b.ts);

  // Derive date range from bars
  const dateStart = new Date(sortedBars[0]!.ts).toISOString().split('T')[0]!;
  const dateEnd = new Date(sortedBars[sortedBars.length - 1]!.ts).toISOString().split('T')[0]!;

  // Generate walk-forward windows
  const windows = computeWindows(dateStart, dateEnd, walkForwardConfig);

  if (windows.length === 0) {
    return emptyResult();
  }

  const groupId = generateGroupId();
  const windowResults: WalkForwardWindowResult[] = [];

  // Build signal lookup for fast filtering
  const signalMap = new Map<number, Signal>();
  for (const sig of signals) {
    signalMap.set(sig.timestamp, sig);
  }

  for (const window of windows) {
    const testStartMs = new Date(window.testStart).getTime();
    const testEndMs = new Date(window.testEnd).getTime();

    // Filter bars and signals to the test period
    const windowBars = sortedBars.filter(b => b.ts >= testStartMs && b.ts < testEndMs);
    const windowSignals = signals.filter(s => s.timestamp >= testStartMs && s.timestamp < testEndMs);

    if (windowBars.length < 2 || windowSignals.length === 0) {
      continue; // Skip windows with insufficient data
    }

    const result = runBacktest(windowBars, windowSignals, instrument, broker, config);

    windowResults.push({
      window,
      metrics: result.metrics,
      tradeCount: result.trades.length,
      equityCurve: result.equityCurve,
    });
  }

  if (windowResults.length === 0) {
    return emptyResult(groupId);
  }

  // Aggregate metrics — average across all windows
  const aggregateMetrics = averageMetrics(windowResults.map(w => w.metrics));

  // OOS metrics — combine all window equity curves and trades into one
  const oosMetrics = combineOosMetrics(windowResults, config.initialCapital);

  // Consistency — % of windows that are profitable
  const profitableWindows = windowResults.filter(w => w.metrics.totalReturn > 0).length;
  const consistency = windowResults.length > 0
    ? (profitableWindows / windowResults.length) * 100
    : 0;

  // Degradation — IS vs OOS Sharpe ratio difference
  // Since we only run OOS backtests here, use aggregate Sharpe dispersion as proxy
  const sharpes = windowResults.map(w => w.metrics.sharpeRatio).filter(s => isFinite(s));
  const meanSharpe = sharpes.length > 0 ? sharpes.reduce((a, b) => a + b, 0) / sharpes.length : 0;
  const bestSharpe = sharpes.length > 0 ? Math.max(...sharpes) : 0;
  const degradation = bestSharpe > 0 ? ((bestSharpe - meanSharpe) / bestSharpe) * 100 : 0;

  return {
    groupId,
    windowResults,
    aggregateMetrics,
    oosMetrics,
    consistency,
    degradation,
  };
}

// ============================================================
// HELPERS
// ============================================================

function emptyResult(groupId?: string): WalkForwardResult {
  return {
    groupId: groupId ?? generateGroupId(),
    windowResults: [],
    aggregateMetrics: emptyMetrics(),
    oosMetrics: emptyMetrics(),
    consistency: 0,
    degradation: 0,
  };
}

function emptyMetrics(): BacktestMetrics {
  return {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    profitFactor: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    totalReturn: 0,
    totalReturnPct: 0,
    avgWin: 0,
    avgLoss: 0,
    largestWin: 0,
    largestLoss: 0,
    avgHoldingTimeBars: 0,
    avgHoldingTimeMs: 0,
    expectancy: 0,
    totalCommissions: 0,
    totalSlippage: 0,
    totalSpreadCost: 0,
    calmarRatio: 0,
  };
}

/** Average all numeric metrics across multiple window results. */
function averageMetrics(metricsArr: BacktestMetrics[]): BacktestMetrics {
  if (metricsArr.length === 0) return emptyMetrics();

  const n = metricsArr.length;
  const sum = emptyMetrics();
  const keys = Object.keys(sum) as (keyof BacktestMetrics)[];

  for (const m of metricsArr) {
    for (const key of keys) {
      (sum as any)[key] += safeNumber(m[key] as number);
    }
  }

  const avg = { ...sum };
  for (const key of keys) {
    (avg as any)[key] = (sum as any)[key] / n;
  }

  // Some metrics make more sense summed than averaged
  avg.totalTrades = Math.round(metricsArr.reduce((s, m) => s + m.totalTrades, 0) / n);
  avg.winningTrades = Math.round(metricsArr.reduce((s, m) => s + m.winningTrades, 0) / n);
  avg.losingTrades = Math.round(metricsArr.reduce((s, m) => s + m.losingTrades, 0) / n);

  // Max drawdown should be the worst across windows
  avg.maxDrawdown = Math.max(...metricsArr.map(m => m.maxDrawdown));
  avg.maxDrawdownPct = Math.max(...metricsArr.map(m => m.maxDrawdownPct));
  avg.largestWin = Math.max(...metricsArr.map(m => m.largestWin));
  avg.largestLoss = Math.min(...metricsArr.map(m => m.largestLoss));

  return avg;
}

/** Combine all OOS window equity curves into one continuous stream and recompute metrics. */
function combineOosMetrics(
  windowResults: WalkForwardWindowResult[],
  initialCapital: number,
): BacktestMetrics {
  if (windowResults.length === 0) return emptyMetrics();

  // Combine all equity curves chronologically
  const allPoints: { timestamp: number; equity: number }[] = [];
  let cumulativeReturn = 0;

  for (const wr of windowResults) {
    if (wr.equityCurve.length === 0) continue;

    // Offset each window's equity to form a continuous curve
    const windowReturn = wr.metrics.totalReturn;
    for (const pt of wr.equityCurve) {
      const adjustedEquity = initialCapital + cumulativeReturn +
        (pt.equity - initialCapital);
      allPoints.push({ timestamp: pt.timestamp, equity: adjustedEquity });
    }
    cumulativeReturn += windowReturn;
  }

  allPoints.sort((a, b) => a.timestamp - b.timestamp);

  // Build synthetic trade list from per-window metrics for computeMetrics
  // Instead, we compute a summary directly
  const totalTrades = windowResults.reduce((s, w) => s + w.metrics.totalTrades, 0);
  const winningTrades = windowResults.reduce((s, w) => s + w.metrics.winningTrades, 0);
  const losingTrades = windowResults.reduce((s, w) => s + w.metrics.losingTrades, 0);

  const totalReturn = windowResults.reduce((s, w) => s + w.metrics.totalReturn, 0);
  const totalReturnPct = (totalReturn / initialCapital) * 100;

  const totalCommissions = windowResults.reduce((s, w) => s + w.metrics.totalCommissions, 0);
  const totalSlippage = windowResults.reduce((s, w) => s + w.metrics.totalSlippage, 0);
  const totalSpreadCost = windowResults.reduce((s, w) => s + w.metrics.totalSpreadCost, 0);

  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;

  // Weighted average win/loss by trade count
  const avgWin = winningTrades > 0
    ? windowResults.reduce((s, w) => s + w.metrics.avgWin * w.metrics.winningTrades, 0) / winningTrades
    : 0;
  const avgLoss = losingTrades > 0
    ? windowResults.reduce((s, w) => s + w.metrics.avgLoss * w.metrics.losingTrades, 0) / losingTrades
    : 0;

  const grossWins = avgWin * winningTrades;
  const grossLosses = Math.abs(avgLoss * losingTrades);
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  // Max drawdown from combined equity curve
  let peakEq = allPoints.length > 0 ? allPoints[0]!.equity : initialCapital;
  let maxDD = 0;
  for (const pt of allPoints) {
    if (pt.equity > peakEq) peakEq = pt.equity;
    const dd = peakEq - pt.equity;
    if (dd > maxDD) maxDD = dd;
  }
  const maxDrawdownPct = initialCapital > 0 ? (maxDD / initialCapital) * 100 : 0;

  // Sharpe from per-window returns
  const windowReturns = windowResults.map(w => w.metrics.totalReturn / initialCapital);
  const meanRet = windowReturns.length > 0
    ? windowReturns.reduce((a, b) => a + b, 0) / windowReturns.length
    : 0;
  const variance = windowReturns.length > 1
    ? windowReturns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (windowReturns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (meanRet / stdDev) * Math.sqrt(252) : 0;

  const downsideReturns = windowReturns.filter(r => r < 0);
  const downsideVar = downsideReturns.length > 1
    ? downsideReturns.reduce((s, r) => s + r ** 2, 0) / (downsideReturns.length - 1)
    : 0;
  const sortinoRatio = Math.sqrt(downsideVar) > 0
    ? (meanRet / Math.sqrt(downsideVar)) * Math.sqrt(252)
    : 0;

  const calmarRatio = maxDD > 0 ? totalReturn / maxDD : 0;
  const expectancy = totalTrades > 0 ? totalReturn / totalTrades : 0;

  const avgHoldingTimeBars = totalTrades > 0
    ? windowResults.reduce((s, w) => s + w.metrics.avgHoldingTimeBars * w.metrics.totalTrades, 0) / totalTrades
    : 0;
  const avgHoldingTimeMs = totalTrades > 0
    ? windowResults.reduce((s, w) => s + w.metrics.avgHoldingTimeMs * w.metrics.totalTrades, 0) / totalTrades
    : 0;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    profitFactor,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown: maxDD,
    maxDrawdownPct,
    totalReturn,
    totalReturnPct,
    avgWin,
    avgLoss,
    largestWin: Math.max(...windowResults.map(w => w.metrics.largestWin), 0),
    largestLoss: Math.min(...windowResults.map(w => w.metrics.largestLoss), 0),
    avgHoldingTimeBars,
    avgHoldingTimeMs,
    expectancy,
    totalCommissions,
    totalSlippage,
    totalSpreadCost,
    calmarRatio,
  };
}

function safeNumber(v: number): number {
  return isFinite(v) ? v : 0;
}
