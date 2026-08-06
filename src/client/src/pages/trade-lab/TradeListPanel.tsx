/**
 * TradeListPanel — sortable trade list, syncs with TradeLabContext selection.
 *
 * MVP: simple table with click-to-select. Virtualization deferred until
 * runs > 1k trades become routine.
 */
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTradeLab } from '@/contexts/TradeLabContext';
import type { BacktestTradeRow } from './hooks/useTradeLabRun';

interface Props {
  trades: BacktestTradeRow[];
}

type SortKey = 'id' | 'entryTimestamp' | 'side' | 'pnl' | 'conf' | 'barsHeld';
type SortDir = 'asc' | 'desc';

export function TradeListPanel({ trades }: Props) {
  const { selectedTradeId, setSelectedTradeId, filters, visibleRange } = useTradeLab();
  const [sortKey, setSortKey] = useState<SortKey>('entryTimestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (filters.side !== 'all' && t.side !== filters.side) return false;
      if (filters.minConfidence > 0 && (t.signalConfidence ?? 0) < filters.minConfidence) return false;
      if (visibleRange) {
        const entrySec = Math.floor(t.entryTimestamp / 1000);
        if (entrySec < visibleRange.from || entrySec > visibleRange.to) return false;
      }
      return true;
    });
  }, [trades, filters, visibleRange]);

  const sorted = useMemo(() => {
    const key = sortKey;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = readKey(a, key);
      const bv = readKey(b, key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'pnl' || k === 'entryTimestamp' ? 'desc' : 'asc'); }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-card/20">
      <div className="px-3 py-1 border-b border-white/5 text-[10px] font-mono uppercase tracking-widest text-primary/80 flex items-center gap-3 shrink-0">
        <span>Trades</span>
        <span className="text-muted-foreground/50 normal-case tracking-normal">
          {filtered.length} of {trades.length}
        </span>
      </div>
      <div className="grid grid-cols-[40px_28px_120px_28px_60px_50px_45px] text-[9px] font-mono uppercase tracking-wider text-muted-foreground/60 px-3 py-1 border-b border-white/5 shrink-0">
        <Header k="id" cur={sortKey} dir={sortDir} onClick={toggleSort}>#</Header>
        <Header k="side" cur={sortKey} dir={sortDir} onClick={toggleSort}>S</Header>
        <Header k="entryTimestamp" cur={sortKey} dir={sortDir} onClick={toggleSort}>entry</Header>
        <Header k="barsHeld" cur={sortKey} dir={sortDir} onClick={toggleSort}>bars</Header>
        <Header k="pnl" cur={sortKey} dir={sortDir} onClick={toggleSort}>pnl</Header>
        <Header k="conf" cur={sortKey} dir={sortDir} onClick={toggleSort}>conf</Header>
        <span>reason</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {sorted.length === 0 ? (
          <div className="px-3 py-6 text-[11px] font-mono text-muted-foreground/50 text-center">
            no trades match current filters
          </div>
        ) : (
          sorted.map((t) => {
            const pnl = t.netPnl ?? t.pnl ?? 0;
            const isSelected = t.id === selectedTradeId;
            return (
              <button
                key={t.id}
                onClick={() => setSelectedTradeId(isSelected ? null : t.id)}
                className={`w-full grid grid-cols-[40px_28px_120px_28px_60px_50px_45px] gap-0 items-center px-3 py-1 text-[10px] font-mono text-left transition-colors ${
                  isSelected
                    ? 'bg-primary/15 border-l-2 border-l-primary text-foreground'
                    : 'border-l-2 border-l-transparent hover:bg-white/[0.03] text-muted-foreground/90'
                }`}
              >
                <span className="tabular-nums">{t.id}</span>
                <span className={t.side === 'long' ? 'text-emerald-400' : 'text-rose-400'}>
                  {t.side === 'long' ? 'L' : 'S'}
                </span>
                <span className="tabular-nums text-muted-foreground/70">
                  {fmtTimeShort(t.entryTimestamp)}
                </span>
                <span className="tabular-nums text-muted-foreground/60">{t.barsHeld ?? '—'}</span>
                <span className={`tabular-nums ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}
                </span>
                <span className="tabular-nums text-muted-foreground/70">
                  {t.signalConfidence != null ? t.signalConfidence.toFixed(2) : '—'}
                </span>
                <span className="text-muted-foreground/50 truncate">{t.exitReason ?? '—'}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function Header({
  k, cur, dir, onClick, children,
}: {
  k: SortKey;
  cur: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  const active = k === cur;
  return (
    <button
      onClick={() => onClick(k)}
      className={`flex items-center gap-0.5 text-left ${active ? 'text-primary' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}
    >
      {children}
      {active && (dir === 'asc' ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />)}
    </button>
  );
}

function readKey(t: BacktestTradeRow, k: SortKey): number | string | null {
  switch (k) {
    case 'id': return t.id;
    case 'entryTimestamp': return t.entryTimestamp;
    case 'side': return t.side;
    case 'pnl': return t.netPnl ?? t.pnl ?? 0;
    case 'conf': return t.signalConfidence ?? 0;
    case 'barsHeld': return t.barsHeld ?? 0;
  }
}

function fmtTimeShort(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}
