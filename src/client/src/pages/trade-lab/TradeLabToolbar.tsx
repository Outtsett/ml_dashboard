/**
 * TradeLabToolbar — slim run-picker strip layered above the MarketToolbar.
 *
 * Holds: backtest-run picker, side filter chip, min-confidence chip, and a
 * clear-run button. Filter chips drive TradeLabContext.filters which the
 * trade list / stat strip / drawer subscribe to.
 */
import { useQuery } from '@tanstack/react-query';
import { useTradeLab, type TradeSideFilter } from '@/contexts/TradeLabContext';

interface BacktestRunSummary {
  id: number;
  symbol?: string;
  modelId?: number | null;
  modelName?: string | null;
  status?: string;
  createdAt?: string | number;
  totalTrades?: number | null;
  netPnl?: number | null;
  profitFactor?: number | null;
}

export function TradeLabToolbar() {
  const { selectedRunId, setSelectedRunId, filters, setFilters } = useTradeLab();

  const { data: runs = [], isLoading } = useQuery<BacktestRunSummary[]>({
    queryKey: ['/api/backtest/runs', 'trade-lab'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/backtest/runs?limit=50', { signal });
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    },
    staleTime: 30_000,
  });

  const cycleSide = () => {
    const order: TradeSideFilter[] = ['all', 'long', 'short'];
    const next = order[(order.indexOf(filters.side) + 1) % order.length] ?? 'all';
    setFilters((p) => ({ ...p, side: next }));
  };

  const cycleConfidence = () => {
    const order = [0, 0.5, 0.65, 0.75, 0.85];
    const idx = order.findIndex((c) => Math.abs(c - filters.minConfidence) < 1e-6);
    const next = order[((idx === -1 ? 0 : idx) + 1) % order.length] ?? 0;
    setFilters((p) => ({ ...p, minConfidence: next }));
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.06] bg-gradient-to-r from-violet-500/[0.04] via-card/30 to-violet-500/[0.04] shrink-0 text-[11px] font-mono">
      <span className="text-[9px] uppercase tracking-widest text-violet-400/70 font-semibold">trade lab</span>
      <span className="mx-1 h-3 w-px bg-white/10" />

      <label className="flex items-center gap-2">
        <span className="text-muted-foreground/60 uppercase tracking-widest text-[9px]">run</span>
        <select
          value={selectedRunId ?? ''}
          onChange={(e) => setSelectedRunId(e.target.value === '' ? null : Number(e.target.value))}
          className="bg-background/80 border border-white/10 rounded px-2 py-0.5 text-foreground min-w-[260px] h-7"
        >
          <option value="">{isLoading ? 'loading runs…' : '— select backtest run —'}</option>
          {runs.map((r) => {
            const pnl = r.netPnl != null ? `${r.netPnl >= 0 ? '+' : ''}${r.netPnl.toFixed(0)}` : '—';
            const pf = r.profitFactor != null && Number.isFinite(r.profitFactor) ? `pf ${r.profitFactor.toFixed(2)}` : '';
            const tr = r.totalTrades != null ? `${r.totalTrades}t` : '';
            const sym = r.symbol ?? '?';
            const mdl = r.modelName ?? (r.modelId != null ? `m${r.modelId}` : 'manual');
            return (
              <option key={r.id} value={r.id}>
                #{r.id} · {sym} · {mdl} · {tr} · {pnl} {pf}
              </option>
            );
          })}
        </select>
      </label>

      <button
        onClick={cycleSide}
        className={chipClass(filters.side !== 'all')}
        aria-label="Toggle side filter"
      >
        side: {filters.side}
      </button>
      <button
        onClick={cycleConfidence}
        className={chipClass(filters.minConfidence > 0)}
        aria-label="Cycle min confidence"
      >
        conf ≥ {filters.minConfidence.toFixed(2)}
      </button>

      {selectedRunId != null && (
        <button
          onClick={() => setSelectedRunId(null)}
          className="ml-auto text-[10px] text-muted-foreground/60 hover:text-[hsl(var(--data-neg))] uppercase tracking-widest"
        >
          clear run
        </button>
      )}
    </div>
  );
}

function chipClass(active: boolean): string {
  const base = 'px-2 py-0.5 h-7 rounded border transition-colors text-[10px] uppercase tracking-widest';
  return active
    ? `${base} border-violet-400/40 text-violet-300 bg-violet-500/10`
    : `${base} border-white/10 text-muted-foreground/70 hover:text-foreground hover:border-white/20`;
}
