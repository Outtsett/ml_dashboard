/**
 * Backtest metrics computation — Sharpe, Sortino, drawdown, win rate, etc.
 */

import type { TradeRecord, BacktestMetrics } from './tradeSimulator';

export function computeMetrics(
  trades: TradeRecord[],
  initialCapital: number,
  equityCurve: { timestamp: number; equity: number }[]
): BacktestMetrics {
  const closedTrades = trades.filter(t => t.exitPrice !== null);
  const wins = closedTrades.filter(t => (t.netPnl ?? 0) > 0);
  const losses = closedTrades.filter(t => (t.netPnl ?? 0) <= 0);

  const totalTrades = closedTrades.length;
  const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;

  const grossWins = wins.reduce((s, t) => s + (t.netPnl ?? 0), 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + (t.netPnl ?? 0), 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  const avgWin = wins.length > 0 ? grossWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? -grossLosses / losses.length : 0;
  const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.netPnl ?? 0)) : 0;
  const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.netPnl ?? 0)) : 0;

  const totalReturn = closedTrades.reduce((s, t) => s + (t.netPnl ?? 0), 0);
  const totalReturnPct = (totalReturn / initialCapital) * 100;

  const totalCommissions = closedTrades.reduce((s, t) => s + t.commission, 0);
  const totalSlippage = closedTrades.reduce((s, t) => s + t.slippage, 0);
  const totalSpreadCost = closedTrades.reduce((s, t) => s + t.spreadCost, 0);

  const avgHoldingBars = totalTrades > 0
    ? closedTrades.reduce((s, t) => s + (t.barsHeld ?? 0), 0) / totalTrades
    : 0;
  const avgHoldingTimeMs = totalTrades > 0
    ? closedTrades.reduce((s, t) => s + ((t.exitTimestamp ?? 0) - t.entryTimestamp), 0) / totalTrades
    : 0;

  const expectancy = totalTrades > 0 ? totalReturn / totalTrades : 0;

  // Sharpe / Sortino from trade returns
  const returns = closedTrades.map(t => (t.netPnl ?? 0) / initialCapital);
  const meanReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

  const downsideReturns = returns.filter(r => r < 0);
  const downsideVariance = downsideReturns.length > 1
    ? downsideReturns.reduce((s, r) => s + r ** 2, 0) / (downsideReturns.length - 1)
    : 0;
  const downsideStdDev = Math.sqrt(downsideVariance);
  const sortinoRatio = downsideStdDev > 0 ? (meanReturn / downsideStdDev) * Math.sqrt(252) : 0;

  // Max drawdown from equity curve
  let peakEq = equityCurve.length > 0 ? equityCurve[0]!.equity : initialCapital;
  let maxDD = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peakEq) peakEq = pt.equity;
    const dd = peakEq - pt.equity;
    if (dd > maxDD) maxDD = dd;
  }
  const maxDrawdownPct = (maxDD / initialCapital) * 100;

  const calmarRatio = maxDD > 0 ? totalReturn / maxDD : 0;

  return {
    totalTrades,
    winningTrades: wins.length,
    losingTrades: losses.length,
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
    largestWin,
    largestLoss,
    avgHoldingTimeBars: avgHoldingBars,
    avgHoldingTimeMs,
    expectancy,
    totalCommissions,
    totalSlippage,
    totalSpreadCost,
    calmarRatio,
  };
}
