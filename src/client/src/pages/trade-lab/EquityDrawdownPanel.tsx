/**
 * EquityDrawdownPanel — equity curve + underwater drawdown band.
 *
 * Recharts area chart. Filtered to the visibleRange from TradeLabContext
 * when a range is set; otherwise shows the full curve.
 */
import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { useTradeLab } from '@/contexts/TradeLabContext';
import type { EquityCurve } from './hooks/useEquityCurve';

interface Props {
  curve: EquityCurve;
}

export function EquityDrawdownPanel({ curve }: Props) {
  const { visibleRange } = useTradeLab();

  const visible = useMemo(() => {
    if (curve.points.length === 0) return [];
    if (!visibleRange) return curve.points;
    return curve.points.filter((p) => p.time >= visibleRange.from && p.time <= visibleRange.to);
  }, [curve.points, visibleRange]);

  if (curve.points.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-[11px] text-muted-foreground/50 font-mono">
        no closed trades — equity curve will appear after the run completes
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-3 px-3 py-1 border-b border-white/5 text-[10px] font-mono uppercase tracking-widest shrink-0">
        <span className="text-primary/80">Equity</span>
        <span className="text-muted-foreground/60">final {fmtSigned(curve.finalEquity)}</span>
        <span className="text-rose-400/80">max DD {fmtSigned(curve.maxDrawdown)}</span>
        <span className="text-rose-400/60">{(curve.maxDrawdownPct * 100).toFixed(1)}%</span>
        {visibleRange && (
          <span className="text-muted-foreground/50 ml-auto">
            window: {visible.length} pts
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={visible} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id="eqGreen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(16,185,129)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="ddRed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(244,63,94)" stopOpacity={0.0} />
                <stop offset="100%" stopColor="rgb(244,63,94)" stopOpacity={0.25} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tickFormatter={(v) => new Date((v as number) * 1000).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
              tick={{ fontSize: 9, fill: 'rgb(120,120,120)' }}
              stroke="rgba(255,255,255,0.06)"
              minTickGap={50}
            />
            <YAxis
              tick={{ fontSize: 9, fill: 'rgb(120,120,120)' }}
              stroke="rgba(255,255,255,0.06)"
              width={50}
              tickFormatter={(v) => `${v >= 0 ? '+' : ''}${(v as number).toFixed(0)}`}
            />
            <Tooltip content={<EquityTooltip />} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
            <Area type="monotone" dataKey="drawdown" stroke="rgb(244,63,94)" strokeWidth={1} fill="url(#ddRed)" isAnimationActive={false} />
            <Area type="monotone" dataKey="equity" stroke="rgb(16,185,129)" strokeWidth={1.5} fill="url(#eqGreen)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function EquityTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { time: number; equity: number; drawdown: number; tradeId: number } }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-md border border-white/10 bg-black/85 backdrop-blur px-2.5 py-1.5 text-[10px] font-mono shadow-lg">
      <div className="text-muted-foreground/70">{new Date(p.time * 1000).toLocaleString()}</div>
      <div className="text-emerald-400">eq {fmtSigned(p.equity)}</div>
      <div className="text-rose-400">dd {fmtSigned(p.drawdown)}</div>
      <div className="text-muted-foreground/50">trade #{p.tradeId}</div>
    </div>
  );
}

function fmtSigned(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}`;
}
