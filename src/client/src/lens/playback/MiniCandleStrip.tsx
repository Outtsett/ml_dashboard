/**
 * MiniCandleStrip — a small inline-SVG candle strip (no chart instance) for
 * the playback panel's "market state" pane: the previous N bars ending at
 * the cursor, cursor bar highlighted.
 */

import type { LensBar } from "@shared/lens/types";
import { CANDLE_UP_COLOR, CANDLE_DOWN_COLOR } from "@/market/components/chartConfig";

export interface MiniCandleStripProps {
  bars: LensBar[];
  /** rowIndex of the highlighted (cursor) bar. */
  cursorRowIndex: number;
  height?: number;
}

export function MiniCandleStrip({ bars, cursorRowIndex, height = 72 }: MiniCandleStripProps) {
  if (bars.length === 0) return null;

  const width = 320;
  const slot = width / bars.length;
  const bodyWidth = Math.max(1, slot * 0.6);
  let min = Infinity;
  let max = -Infinity;
  for (const bar of bars) {
    if (bar.low < min) min = bar.low;
    if (bar.high > max) max = bar.high;
  }
  const range = max - min || 1;
  const pad = height * 0.08;
  const plotHeight = height - pad * 2;
  const y = (price: number) => pad + (1 - (price - min) / range) * plotHeight;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={`Candle strip, ${bars.length} bars ending at the cursor`}
      data-testid="mini-candle-strip"
    >
      {bars.map((bar, i) => {
        const up = bar.close >= bar.open;
        const color = up ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR;
        const cx = i * slot + slot / 2;
        const isCursor = bar.rowIndex === cursorRowIndex;
        const bodyTop = y(Math.max(bar.open, bar.close));
        const bodyBottom = y(Math.min(bar.open, bar.close));
        return (
          <g key={bar.rowIndex} opacity={isCursor ? 1 : 0.75}>
            {isCursor && <rect x={cx - slot / 2} y={0} width={slot} height={height} fill="currentColor" opacity={0.08} />}
            <line x1={cx} x2={cx} y1={y(bar.high)} y2={y(bar.low)} stroke={color} strokeWidth={1} />
            <rect
              x={cx - bodyWidth / 2}
              y={Math.min(bodyTop, bodyBottom)}
              width={bodyWidth}
              height={Math.max(1, Math.abs(bodyBottom - bodyTop))}
              fill={color}
              stroke={isCursor ? "currentColor" : "none"}
              strokeWidth={isCursor ? 1 : 0}
            />
          </g>
        );
      })}
    </svg>
  );
}
