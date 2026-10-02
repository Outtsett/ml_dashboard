/**
 * TradeDetailDrawer — right-side panel showing the currently selected trade.
 *
 * Reads `selectedTradeId` from TradeLabContext, looks up the trade in the
 * provided trades array, and renders entry/exit/PnL/MAE/MFE/regime fields.
 * If no trade selected, renders a hint instead.
 */
import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useTradeLab } from '@/contexts/TradeLabContext';
import type { BacktestTradeRow } from './hooks/useTradeLabRun';

interface Props {
  trades: BacktestTradeRow[];
  /** When the drawer wants to dismiss itself. */
  onDismiss?: () => void;
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(decimals);
}

function fmtSigned(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}`;
}

function fmtTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`;
}

export function TradeDetailDrawer({ trades, onDismiss }: Props) {
  const { selectedTradeId, setSelectedTradeId } = useTradeLab();

  const trade = useMemo<BacktestTradeRow | null>(() => {
    if (selectedTradeId == null) return null;
    return trades.find((t) => t.id === selectedTradeId) ?? null;
  }, [trades, selectedTradeId]);

  if (!trade) {
    return (
      <aside className="w-[260px] shrink-0 border-l border-white/5 bg-card/30 p-4 text-xs text-muted-foreground">
        <div className="font-mono uppercase tracking-widest text-[10px] text-muted-foreground/60 mb-2">
          Trade Detail
        </div>
        <p className="leading-relaxed">
          Click any entry or exit marker on the chart to inspect that trade.
        </p>
      </aside>
    );
  }

  const pnl = trade.netPnl ?? trade.pnl ?? 0;
  const pnlClass = pnl >= 0 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]';
  const sideClass = trade.side === 'long' ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]';

  const dismiss = () => {
    setSelectedTradeId(null);
    onDismiss?.();
  };

  return (
    <aside className="w-[280px] shrink-0 border-l border-white/5 bg-card/30 flex flex-col">
      <header className="flex items-center justify-between px-4 py-2 border-b border-white/5 shrink-0">
        <div className="font-mono uppercase tracking-widest text-[10px] text-primary">
          Trade #{trade.id}
        </div>
        <button
          onClick={dismiss}
          aria-label="Close trade detail"
          className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-auto px-4 py-3 text-xs space-y-3 font-mono">
        <Row label="symbol" value={trade.symbol} />
        <Row label="side" value={trade.side.toUpperCase()} valueClass={sideClass} />
        <Row label="qty" value={fmt(trade.quantity)} />

        <Section label="ENTRY" />
        <Row label="time" value={fmtTime(trade.entryTimestamp)} />
        <Row label="price" value={fmt(trade.entryPrice, 4)} />
        <Row label="conf" value={trade.signalConfidence != null ? trade.signalConfidence.toFixed(2) : '—'} />

        <Section label="EXIT" />
        <Row label="time" value={fmtTime(trade.exitTimestamp ?? null)} />
        <Row label="price" value={fmt(trade.exitPrice ?? null, 4)} />
        <Row label="reason" value={(trade.exitReason ?? '—').toUpperCase()} />
        <Row label="bars held" value={trade.barsHeld != null ? String(trade.barsHeld) : '—'} />

        <Section label="P&L" />
        <Row label="net pnl" value={fmtSigned(pnl)} valueClass={pnlClass} />
        <Row label="pnl %" value={trade.pnlPct != null ? `${fmtSigned(trade.pnlPct, 2)}%` : '—'} valueClass={pnlClass} />
        <Row label="commission" value={fmt(trade.commission ?? null)} />
        <Row label="slippage" value={fmt(trade.slippage ?? null)} />
        <Row label="spread cost" value={fmt(trade.spreadCost ?? null)} />

        <Section label="EXCURSION" />
        <Row label="MFE" value={fmtSigned(trade.maxFavorableExcursion ?? null)} valueClass="text-[hsl(var(--data-pos)/0.8)]" />
        <Row label="MAE" value={fmtSigned(trade.maxAdverseExcursion ?? null)} valueClass="text-[hsl(var(--data-neg)/0.8)]" />

        <Section label="MODEL" />
        <Row label="model id" value={trade.modelId != null ? String(trade.modelId) : '—'} />
        <Row label="regime id" value={trade.regimeId != null ? String(trade.regimeId) : '—'} />
        <Row label="status" value={trade.status ?? '—'} />
      </div>
    </aside>
  );
}

function Row({ label, value, valueClass }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
      <span className={`text-[11px] tabular-nums ${valueClass ?? 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function Section({ label }: { label: string }) {
  return (
    <div className="text-[9px] uppercase tracking-widest text-muted-foreground/40 pt-2 border-t border-white/5">
      {label}
    </div>
  );
}
