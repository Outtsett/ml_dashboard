import { useMemo } from 'react';
import type { Trade } from "@/shared/utils/types";

export interface TradeMetrics {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  openTrades: number;
  winners: number;
  losers: number;
}

/**
 * Compute trade performance metrics from a list of trades.
 * Shared between Dashboard and BottomPanel.
 */
export function useTradeMetrics(trades: Trade[]): TradeMetrics {
  return useMemo(() => {
    const closed = trades.filter(t => t.status === 'closed');
    const winners = closed.filter(t => (t.pnl || 0) > 0);
    const losers = closed.filter(t => (t.pnl || 0) < 0);
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const grossWin = winners.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const grossLoss = Math.abs(losers.reduce((sum, t) => sum + (t.pnl || 0), 0));
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    const avgWin = winners.length > 0 ? grossWin / winners.length : 0;
    const avgLoss = losers.length > 0 ? grossLoss / losers.length : 0;
    const openTrades = trades.filter(t => t.status === 'open').length;

    return {
      totalTrades: closed.length,
      winRate,
      totalPnl,
      profitFactor,
      avgWin,
      avgLoss,
      openTrades,
      winners: winners.length,
      losers: losers.length,
    };
  }, [trades]);
}
