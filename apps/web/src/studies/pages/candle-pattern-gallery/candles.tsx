/**
 * Candles drawn from example bars. Hollow body = up bar (close at or above
 * open), filled body = down bar, the notebook's own convention; colour
 * repeats it (orange up, blue down) and is never the only signal. Every bar
 * carries its exact values in a hover title.
 */

import { OKABE, fmt, fmtInt } from "@/studies/kit";
import { formatStamp, type GalleryBar } from "@shared/studies/candle-pattern-gallery";

export const UP_COLOR = OKABE.orange;
export const DOWN_COLOR = OKABE.blue;

function barTitle(bar: GalleryBar): string {
  const when = bar.bar_timestamp_ms === null ? "constructed bar" : formatStamp(bar.bar_timestamp_ms);
  return `bar ${bar.bar_offset} · ${when}\nopen ${fmt(bar.open, 2)}  high ${fmt(bar.high, 2)}\nlow ${fmt(bar.low, 2)}  close ${fmt(bar.close, 2)}\nvolume ${fmtInt(bar.volume)}\n${bar.close >= bar.open ? "up bar (hollow)" : "down bar (filled)"}`;
}

export interface CandleStripProps {
  bars: readonly GalleryBar[];
  /** Candle columns on the canvas; bars are centred when fewer (the pattern view is five wide). */
  slots?: number;
  slotWidth: number;
  priceHeight: number;
  /** 0 hides the volume pane. */
  volumeHeight?: number;
  /** Shade the bars the pattern is made of. */
  shadePattern?: boolean;
  /** Index (into `bars`) of the bar the reader is inspecting, drawn as a guide line. */
  marker?: number | null;
  onSelectBar?: (index: number) => void;
}

export function CandleStrip({ bars, slots, slotWidth, priceHeight, volumeHeight = 0, shadePattern = false, marker = null, onSelectBar }: CandleStripProps) {
  const columns = slots ?? bars.length;
  const width = columns * slotWidth;
  const padding = 4;
  const height = padding + priceHeight + (volumeHeight > 0 ? volumeHeight + 6 : 0) + padding;
  if (bars.length === 0) return null;
  let low = Infinity;
  let high = -Infinity;
  let maximumVolume = 0;
  for (const bar of bars) {
    if (bar.low < low) low = bar.low;
    if (bar.high > high) high = bar.high;
    if (bar.volume > maximumVolume) maximumVolume = bar.volume;
  }
  const range = Math.max(high - low, 1e-9);
  const y = (price: number) => padding + (priceHeight - 1) - ((price - low) / range) * (priceHeight - 1);
  const first = Math.floor((columns - bars.length) / 2);
  const bodyWidth = Math.max(2, slotWidth - Math.max(2, slotWidth * 0.3));
  const volumeTop = padding + priceHeight + 6;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="candlestick example" className="block max-w-full rounded bg-neutral-950">
      {bars.map((bar, index) => {
        const slot = first + index;
        const left = slot * slotWidth;
        const middle = left + slotWidth / 2;
        const up = bar.close >= bar.open;
        const color = up ? UP_COLOR : DOWN_COLOR;
        const top = y(Math.max(bar.open, bar.close));
        const bottom = y(Math.min(bar.open, bar.close));
        return (
          <g key={`${bar.bar_offset}`} onClick={onSelectBar ? () => onSelectBar(index) : undefined} className={onSelectBar ? "cursor-pointer" : undefined}>
            <title>{barTitle(bar)}</title>
            {shadePattern && bar.is_pattern_bar && <rect x={left} y={0} width={slotWidth} height={height} fill={OKABE.sky} opacity={0.13} />}
            <rect x={left} y={0} width={slotWidth} height={height} fill="transparent" />
            <line x1={middle} x2={middle} y1={y(bar.high)} y2={y(bar.low)} stroke={color} strokeWidth={Math.max(1, slotWidth / 12)} />
            <rect
              x={middle - bodyWidth / 2}
              y={top}
              width={bodyWidth}
              height={Math.max(1, bottom - top)}
              fill={up ? "#0a0a0a" : color}
              stroke={color}
              strokeWidth={Math.max(1, slotWidth / 14)}
            />
            {volumeHeight > 0 && maximumVolume > 0 && (
              <rect
                x={middle - bodyWidth / 2}
                y={volumeTop + volumeHeight - Math.max(1, (bar.volume / maximumVolume) * volumeHeight)}
                width={bodyWidth}
                height={Math.max(1, (bar.volume / maximumVolume) * volumeHeight)}
                fill={OKABE.sky}
                opacity={0.8}
              />
            )}
          </g>
        );
      })}
      {marker !== null && marker >= 0 && marker < bars.length && (
        <line x1={(first + marker) * slotWidth + slotWidth / 2} x2={(first + marker) * slotWidth + slotWidth / 2} y1={0} y2={height} stroke={OKABE.yellow} strokeDasharray="3 2" strokeWidth={1} />
      )}
    </svg>
  );
}
