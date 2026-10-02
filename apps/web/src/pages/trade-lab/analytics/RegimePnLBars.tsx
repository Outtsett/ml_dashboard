/**
 * RegimePnLBars — Recharts bar chart of aggregate netPnl per regime.
 *
 * Buckets trades by `regimeId` (or "—" when unset). Bar color reflects
 * sign. Respects TradeLabContext filters + visibleRange.
 */
import { useMemo } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTradeLab } from '@/contexts/TradeLabContext';
import type { BacktestTradeRow } from '../hooks/useTradeLabRun';
import { Tile } from './ConfPnLScatter';

interface Props {
  trades: BacktestTradeRow[];
}

interface Bucket {
  regime: string;
  pnl: number;
  count: number;
}

export function RegimePnLBars({ trades }: Props) {
  const { filters, visibleRange } = useTradeLab();

  const buckets = useMemo<Bucket[]>(() => {
    const map = new Map<string, Bucket>();
    for (const t of trades) {
      if (filters.side !== 'all' && t.side !== filters.side) continue;
      if (filters.minConfidence > 0 && (t.signalConfidence ?? 0) < filters.minConfidence) continue;
      if (visibleRange) {
        const ts = t.exitTimestamp ? Math.floor(t.exitTimestamp / 1000) : null;
        if (ts == null || ts < visibleRange.from || ts > visibleRange.to) continue;
      }
      const key = t.regimeId != null ? `R${t.regimeId}` : '—';
      const b = map.get(key) ?? { regime: key, pnl: 0, count: 0 };
      b.pnl += t.netPnl ?? t.pnl ?? 0;
      b.count += 1;
      map.set(key, b);
    }
    return Array.from(map.values()).sort((a, b) => a.regime.localeCompare(b.regime));
  }, [trades, filters, visibleRange]);

  return (
    <Tile label="PnL by Regime" count={buckets.length}>
      {buckets.length === 0 ? (
        <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/40 font-mono">
          no regimes in window
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
            <XAxis
              dataKey="regime"
              tick={{ fontSize: 9, fill: 'rgb(120,120,120)' }}
              stroke="rgba(255,255,255,0.06)"
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 9, fill: 'rgb(120,120,120)' }}
              stroke="rgba(255,255,255,0.06)"
              width={36}
              tickFormatter={(v) => `${(v as number) >= 0 ? '+' : ''}${Math.round(v as number)}`}
            />
            <Tooltip content={<RegimeTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="pnl" isAnimationActive={false} radius={[2, 2, 0, 0]}>
              {buckets.map((b) => (
                <Cell key={b.regime} fill={b.pnl >= 0 ? 'rgb(16,185,129)' : 'rgb(244,63,94)'} fillOpacity={0.7} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Tile>
  );
}

function RegimeTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Bucket }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const b = payload[0]?.payload;
  if (!b) return null;
  return (
    <div className="rounded-md border border-white/10 bg-black/85 backdrop-blur px-2.5 py-1.5 text-[10px] font-mono shadow-lg">
      <div className="text-foreground/90">{b.regime}</div>
      <div className={b.pnl >= 0 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'}>
        pnl {b.pnl >= 0 ? '+' : ''}{b.pnl.toFixed(2)}
      </div>
      <div className="text-muted-foreground/60">{b.count} trades</div>
    </div>
  );
}
