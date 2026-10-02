/**
 * MAEMFEHistogram — distribution of Maximum Adverse Excursion (rose) and
 * Maximum Favorable Excursion (emerald) across closed trades.
 *
 * Bins both series symmetrically around 0 so MAE (always ≤ 0) and MFE
 * (always ≥ 0) share the same x axis. Recharts BarChart, 20 bins.
 */
import { useMemo } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { useTradeLab } from '@/contexts/TradeLabContext';
import type { BacktestTradeRow } from '../hooks/useTradeLabRun';
import { Tile } from './ConfPnLScatter';

interface Props {
  trades: BacktestTradeRow[];
}

interface Bin {
  bucket: number;     // bin midpoint
  bucketLabel: string;
  mae: number;        // count
  mfe: number;        // count
}

const BIN_COUNT = 20;

export function MAEMFEHistogram({ trades }: Props) {
  const { filters, visibleRange } = useTradeLab();

  const bins = useMemo<Bin[]>(() => {
    const filtered = trades.filter((t) => {
      if (filters.side !== 'all' && t.side !== filters.side) return false;
      if (filters.minConfidence > 0 && (t.signalConfidence ?? 0) < filters.minConfidence) return false;
      if (visibleRange) {
        const ts = t.exitTimestamp ? Math.floor(t.exitTimestamp / 1000) : null;
        if (ts == null || ts < visibleRange.from || ts > visibleRange.to) return false;
      }
      return true;
    });

    const maeVals = filtered.map((t) => t.maxAdverseExcursion ?? 0).filter((v) => Number.isFinite(v));
    const mfeVals = filtered.map((t) => t.maxFavorableExcursion ?? 0).filter((v) => Number.isFinite(v));
    if (maeVals.length === 0 && mfeVals.length === 0) return [];

    const allAbs = [...maeVals, ...mfeVals].map(Math.abs);
    const maxAbs = Math.max(1, ...allAbs);
    const step = (maxAbs * 2) / BIN_COUNT;

    const out: Bin[] = [];
    for (let i = 0; i < BIN_COUNT; i++) {
      const low = -maxAbs + i * step;
      const high = low + step;
      const mid = (low + high) / 2;
      out.push({
        bucket: mid,
        bucketLabel: mid.toFixed(0),
        mae: 0,
        mfe: 0,
      });
    }

    const place = (v: number, key: 'mae' | 'mfe') => {
      // Bin index, clamped to [0, BIN_COUNT-1]
      const idx = Math.max(0, Math.min(BIN_COUNT - 1, Math.floor((v + maxAbs) / step)));
      out[idx]![key] += 1;
    };

    for (const v of maeVals) place(v, 'mae');
    for (const v of mfeVals) place(v, 'mfe');
    return out;
  }, [trades, filters, visibleRange]);

  return (
    <Tile label="MAE / MFE" count={bins.length > 0 ? bins.reduce((s, b) => s + b.mae + b.mfe, 0) : 0}>
      {bins.length === 0 ? (
        <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/40 font-mono">
          no excursion data
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: 6, right: 8, bottom: 4, left: 0 }} barCategoryGap={1}>
            <XAxis
              dataKey="bucketLabel"
              tick={{ fontSize: 8, fill: 'rgb(120,120,120)' }}
              stroke="rgba(255,255,255,0.06)"
              interval={Math.floor(BIN_COUNT / 5)}
            />
            <YAxis
              tick={{ fontSize: 9, fill: 'rgb(120,120,120)' }}
              stroke="rgba(255,255,255,0.06)"
              width={28}
              allowDecimals={false}
            />
            <ReferenceLine x={bins[Math.floor(BIN_COUNT / 2)]!.bucketLabel} stroke="rgba(255,255,255,0.12)" />
            <Tooltip content={<HistTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="mae" stackId="x" fill="rgb(244,63,94)" fillOpacity={0.7} isAnimationActive={false} />
            <Bar dataKey="mfe" stackId="x" fill="rgb(16,185,129)" fillOpacity={0.7} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Tile>
  );
}

function HistTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Bin; dataKey: string; value: number }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const b = payload[0]?.payload;
  if (!b) return null;
  return (
    <div className="rounded-md border border-white/10 bg-black/85 backdrop-blur px-2.5 py-1.5 text-[10px] font-mono shadow-lg">
      <div className="text-muted-foreground/70">~ {b.bucketLabel}pt</div>
      {b.mae > 0 && <div className="text-[hsl(var(--data-neg))]">MAE: {b.mae}</div>}
      {b.mfe > 0 && <div className="text-[hsl(var(--data-pos))]">MFE: {b.mfe}</div>}
    </div>
  );
}
