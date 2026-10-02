/**
 * useEquityCurve — derives equity / drawdown / peak time series from a
 * sorted-by-exit array of closed trades. Pure derivation, memoized on the
 * trades array reference.
 *
 * Equity is cumulative netPnl (or pnl if netPnl absent), peak is running
 * max-equity, drawdown is current minus peak (always <= 0).
 */
import { useMemo } from 'react';

export interface EquityPoint {
  /** seconds-epoch (matches lightweight-charts time axis) */
  time: number;
  equity: number;
  peak: number;
  drawdown: number;          // <= 0
  drawdownPct: number;       // drawdown / peak (0 when peak === 0)
  tradeId: number;
}

export interface EquityCurve {
  points: EquityPoint[];
  finalEquity: number;
  maxDrawdown: number;       // most-negative drawdown across all points
  maxDrawdownPct: number;
  peakEquity: number;
}

interface MinimalTrade {
  id: number;
  exitTimestamp?: number | null;     // ms-epoch (may be null while open)
  pnl?: number | null;
  netPnl?: number | null;
}

export function useEquityCurve(trades: MinimalTrade[] | undefined): EquityCurve {
  return useMemo(() => {
    if (!trades || trades.length === 0) {
      return { points: [], finalEquity: 0, maxDrawdown: 0, maxDrawdownPct: 0, peakEquity: 0 };
    }

    const closed = trades
      .filter((t): t is MinimalTrade & { exitTimestamp: number } => {
        return typeof t.exitTimestamp === 'number' && t.exitTimestamp > 0;
      })
      .sort((a, b) => a.exitTimestamp - b.exitTimestamp);

    let equity = 0;
    let peak = 0;
    let maxDD = 0;
    let maxDDPct = 0;

    const points: EquityPoint[] = closed.map((t) => {
      const p = typeof t.netPnl === 'number' ? t.netPnl : (typeof t.pnl === 'number' ? t.pnl : 0);
      equity += p;
      if (equity > peak) peak = equity;
      const drawdown = equity - peak;            // 0 or negative
      const drawdownPct = peak > 0 ? drawdown / peak : 0;
      if (drawdown < maxDD) maxDD = drawdown;
      if (drawdownPct < maxDDPct) maxDDPct = drawdownPct;
      return {
        time: Math.floor(t.exitTimestamp / 1000),
        equity,
        peak,
        drawdown,
        drawdownPct,
        tradeId: t.id,
      };
    });

    return {
      points,
      finalEquity: equity,
      maxDrawdown: maxDD,
      maxDrawdownPct: maxDDPct,
      peakEquity: peak,
    };
  }, [trades]);
}
