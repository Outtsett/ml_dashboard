/**
 * ConfPnLScatter — visx scatter plot of signal confidence vs realized PnL.
 *
 * X axis: signalConfidence (0..1). Y axis: netPnl (centered on 0).
 * Each closed trade is a dot; green for net positive, red for net negative.
 * Respects TradeLabContext filters + visibleRange.
 */
import { useMemo } from 'react';
import { ParentSize } from '@visx/responsive';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { Circle, Line } from '@visx/shape';
import { useTradeLab } from '@/contexts/TradeLabContext';
import type { BacktestTradeRow } from '../hooks/useTradeLabRun';

interface Props {
  trades: BacktestTradeRow[];
}

interface Pt {
  x: number;
  y: number;
  win: boolean;
  id: number;
}

export function ConfPnLScatter({ trades }: Props) {
  const { filters, visibleRange, selectedTradeId, setSelectedTradeId } = useTradeLab();

  const points = useMemo<Pt[]>(() => {
    return trades
      .filter((t) => {
        if (filters.side !== 'all' && t.side !== filters.side) return false;
        if (filters.minConfidence > 0 && (t.signalConfidence ?? 0) < filters.minConfidence) return false;
        if (visibleRange) {
          const ts = t.exitTimestamp ? Math.floor(t.exitTimestamp / 1000) : null;
          if (ts == null || ts < visibleRange.from || ts > visibleRange.to) return false;
        }
        if (t.signalConfidence == null) return false;
        return true;
      })
      .map((t): Pt => {
        const pnl = t.netPnl ?? t.pnl ?? 0;
        return { x: t.signalConfidence ?? 0, y: pnl, win: pnl >= 0, id: t.id };
      });
  }, [trades, filters, visibleRange]);

  return (
    <Tile label="Conf vs PnL" count={points.length}>
      <ParentSize>
        {({ width, height }) => {
          if (width <= 8 || height <= 8 || points.length === 0) {
            return (
              <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.3)">
                {points.length === 0 ? 'no trades match' : ''}
              </text>
            );
          }
          const padding = { top: 8, right: 6, bottom: 14, left: 30 };
          const innerW = Math.max(1, width - padding.left - padding.right);
          const innerH = Math.max(1, height - padding.top - padding.bottom);

          const xMin = 0;
          const xMax = 1;
          const yVals = points.map((p) => p.y);
          const yAbs = Math.max(1, ...yVals.map(Math.abs));

          const xScale = scaleLinear<number>({ domain: [xMin, xMax], range: [0, innerW] });
          const yScale = scaleLinear<number>({ domain: [-yAbs, yAbs], range: [innerH, 0] });

          return (
            <svg width={width} height={height}>
              <Group left={padding.left} top={padding.top}>
                <Line from={{ x: 0, y: yScale(0) }} to={{ x: innerW, y: yScale(0) }} stroke="rgba(255,255,255,0.18)" />
                <Line from={{ x: 0, y: 0 }} to={{ x: 0, y: innerH }} stroke="rgba(255,255,255,0.08)" />
                {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
                  <text
                    key={tick}
                    x={xScale(tick)}
                    y={innerH + 10}
                    fontSize={8}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.35)"
                  >
                    {tick.toFixed(2)}
                  </text>
                ))}
                <text x={-2} y={yScale(yAbs)} fontSize={8} textAnchor="end" fill="rgba(16,185,129,0.6)">
                  +{yAbs.toFixed(0)}
                </text>
                <text x={-2} y={yScale(-yAbs)} fontSize={8} textAnchor="end" fill="rgba(244,63,94,0.6)">
                  {(-yAbs).toFixed(0)}
                </text>
                {points.map((p) => {
                  const isSelected = p.id === selectedTradeId;
                  return (
                    <Circle
                      key={p.id}
                      cx={xScale(p.x)}
                      cy={yScale(p.y)}
                      r={isSelected ? 3.2 : 2}
                      fill={p.win ? 'rgb(16,185,129)' : 'rgb(244,63,94)'}
                      fillOpacity={isSelected ? 1 : 0.55}
                      stroke={isSelected ? 'rgba(255,255,255,0.7)' : 'none'}
                      strokeWidth={isSelected ? 1 : 0}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedTradeId(p.id)}
                    />
                  );
                })}
              </Group>
            </svg>
          );
        }}
      </ParentSize>
    </Tile>
  );
}

export function Tile({
  label, count, children,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 min-w-0 flex flex-col bg-card/15 border-r border-white/5 last:border-r-0">
      <div className="px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest flex items-center gap-2 shrink-0 border-b border-white/5">
        <span className="text-primary/80">{label}</span>
        {count != null && <span className="text-muted-foreground/40 normal-case tracking-normal">{count}</span>}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
