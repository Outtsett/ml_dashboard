/**
 * TradeLabStatStrip — headline metrics for the visible window of trades.
 *
 * Recomputes on visibleRange + filter changes. When no run is selected it
 * shows dashes — no fake numbers.
 */
import { useMemo } from 'react';
import { useTradeLab } from '@/contexts/TradeLabContext';
import type { BacktestTradeRow } from './hooks/useTradeLabRun';
import type { EquityCurve } from './hooks/useEquityCurve';

interface Props {
  trades: BacktestTradeRow[];
  equity: EquityCurve;
}

export function TradeLabStatStrip({ trades, equity }: Props) {
  const { filters, visibleRange, selectedRunId } = useTradeLab();

  const stats = useMemo(() => {
    const filtered = trades.filter((t) => {
      if (filters.side !== 'all' && t.side !== filters.side) return false;
      if (filters.minConfidence > 0 && (t.signalConfidence ?? 0) < filters.minConfidence) return false;
      if (visibleRange) {
        const exitSec = t.exitTimestamp ? Math.floor(t.exitTimestamp / 1000) : null;
        if (exitSec == null) return false;
        if (exitSec < visibleRange.from || exitSec > visibleRange.to) return false;
      }
      return true;
    });

    const closed = filtered.filter((t) => t.exitTimestamp != null);
    const total = closed.length;
    if (total === 0) {
      return { total: 0, winRate: null, profitFactor: null, expectancy: null, netPnl: 0, sharpe: null };
    }
    const pnls = closed.map((t) => t.netPnl ?? t.pnl ?? 0);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p < 0);
    const grossWin = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
    const netPnl = pnls.reduce((a, b) => a + b, 0);
    const winRate = (wins.length / total) * 100;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    const expectancy = netPnl / total;
    const mean = expectancy;
    const variance = pnls.reduce((acc, p) => acc + (p - mean) ** 2, 0) / total;
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(total) : null;
    return { total, winRate, profitFactor, expectancy, netPnl, sharpe };
  }, [trades, filters, visibleRange]);

  if (selectedRunId == null) {
    return (
      <div className="flex items-center gap-6 px-3 py-2 border-b border-white/5 bg-card/20 shrink-0 text-[10px] font-mono text-muted-foreground/40">
        select a run from the toolbar to populate metrics
      </div>
    );
  }

  return (
    <div className="flex items-center gap-6 px-3 py-2 border-b border-white/5 bg-card/20 shrink-0">
      <Stat label="trades" value={String(stats.total)} />
      <Stat label="win%" value={fmt(stats.winRate, 1)} accent={stats.winRate != null && stats.winRate >= 50 ? 'pos' : null} />
      <Stat label="pf" value={fmt(stats.profitFactor, 2)} accent={stats.profitFactor != null && stats.profitFactor >= 1 ? 'pos' : 'neg'} />
      <Stat label="expectancy" value={fmtSigned(stats.expectancy)} accent={stats.expectancy != null && stats.expectancy >= 0 ? 'pos' : 'neg'} />
      <Stat label="sharpe" value={fmt(stats.sharpe, 2)} />
      <Stat label="max dd" value={fmtSigned(equity.maxDrawdown)} accent="neg" />
      <Stat label="net pnl" value={fmtSigned(stats.netPnl)} accent={stats.netPnl >= 0 ? 'pos' : 'neg'} />
      {visibleRange && (
        <span className="ml-auto text-[9px] uppercase tracking-widest text-muted-foreground/40 font-mono">
          window scoped
        </span>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'pos' | 'neg' | null }) {
  const cls =
    accent === 'pos' ? 'text-emerald-400' :
    accent === 'neg' ? 'text-rose-400' :
    'text-foreground';
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-mono">{label}</span>
      <span className={`text-sm tabular-nums font-mono ${cls}`}>{value}</span>
    </div>
  );
}

function fmt(n: number | null | undefined, decimals: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(decimals);
}

function fmtSigned(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}`;
}
