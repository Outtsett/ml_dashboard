/**
 * The notebook's two-panel figure: candles on a LOG price axis with a marker
 * per labelled bar (^ at high * 1.0004 for forward direction +1, v at
 * low * 0.9996 for -1), and the bar's log return in basis points beneath.
 * Up is orange, down is blue; direction is also carried by the marker shape,
 * the candle body fill and the sign of the return bar, never by colour alone.
 */

import { useState } from "react";
import { OKABE, fmt, fmtInt } from "@/studies/kit";
import { MARKER_OFFSET_ABOVE, MARKER_OFFSET_BELOW, type Timeframe, type WindowBar } from "@shared/studies/eurusd-bars-and-labels";

const WIDTH = 920;
const LEFT = 64;
const RIGHT = 10;
const TOP = 8;
const PRICE_HEIGHT = 300;
const GAP = 10;
const RETURN_HEIGHT = 96;
const AXIS_HEIGHT = 24;
const HEIGHT = TOP + PRICE_HEIGHT + GAP + RETURN_HEIGHT + AXIS_HEIGHT;
const PRICE_TICKS = 5;

function stamp(timestamp: number, timeframe: Timeframe): string {
  const iso = new Date(timestamp).toISOString();
  return timeframe === "1d" ? iso.slice(0, 10) : `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

function fullStamp(timestamp: number): string {
  return `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const DIRECTION_TEXT: Record<string, string> = { "1": "▲ up", "0": "ranging", "-1": "▼ down" };

function Triangle({ x, y, up, color }: { x: number; y: number; up: boolean; color: string }) {
  const size = 4.5;
  const points = up
    ? `${x},${y - size} ${x - size},${y + size * 0.7} ${x + size},${y + size * 0.7}`
    : `${x},${y + size} ${x - size},${y - size * 0.7} ${x + size},${y - size * 0.7}`;
  return <polygon points={points} fill={color} stroke="#0a0a0a" strokeWidth={0.6} />;
}

export function CandleChart({ bars, timeframe, horizonLabel, showMarkers }: { bars: readonly WindowBar[]; timeframe: Timeframe; horizonLabel: string | null; showMarkers: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  if (bars.length === 0) return null;

  const lows = bars.map((bar) => bar.low);
  const highs = bars.map((bar) => bar.high);
  const logLow = Math.log(Math.min(...lows));
  const logHigh = Math.log(Math.max(...highs));
  const padding = Math.max((logHigh - logLow) * 0.06, 1e-6);
  const domainLow = logLow - padding;
  const domainHigh = logHigh + padding;
  const plotWidth = WIDTH - LEFT - RIGHT;
  const step = plotWidth / bars.length;
  const bodyWidth = Math.max(step * 0.62, 1);
  const xOf = (index: number) => LEFT + (index + 0.5) * step;
  const yOf = (price: number) => TOP + PRICE_HEIGHT * (1 - (Math.log(price) - domainLow) / (domainHigh - domainLow));

  const returns = bars.map((bar) => bar.logReturnBasisPoints ?? 0);
  const returnExtent = Math.max(...returns.map(Math.abs), 1e-9);
  const returnTop = TOP + PRICE_HEIGHT + GAP;
  const returnMiddle = returnTop + RETURN_HEIGHT / 2;
  const returnScale = (RETURN_HEIGHT / 2 - 4) / returnExtent;

  const priceTicks = Array.from({ length: PRICE_TICKS }, (_, index) => {
    const logPrice = domainLow + ((domainHigh - domainLow) * index) / (PRICE_TICKS - 1);
    return { y: yOf(Math.exp(logPrice)), label: Math.exp(logPrice).toFixed(5) };
  });
  const timeTicks = Array.from({ length: 6 }, (_, index) => {
    const at = Math.round(((bars.length - 1) * index) / 5);
    return { x: xOf(at), label: stamp((bars[at] as WindowBar).timestamp, timeframe), at };
  });

  const active = hover !== null ? bars[hover] : undefined;

  return (
    <div className="space-y-1">
      <div className="min-h-[2.6rem] rounded border border-neutral-800 bg-neutral-900/50 px-2 py-1 font-mono text-[11px] text-neutral-300">
        {active ? (
          <>
            <span className="text-neutral-100">{fullStamp(active.timestamp)}</span>
            {"  "}open {active.open.toFixed(5)} · high {active.high.toFixed(5)} · low {active.low.toFixed(5)} · close {active.close.toFixed(5)} · volume {fmtInt(active.volume)}
            {" · "}log return {active.logReturnBasisPoints === null ? "—" : `${active.logReturnBasisPoints >= 0 ? "▲ +" : "▼ "}${fmt(active.logReturnBasisPoints, 2)} bp`}
            {horizonLabel && (
              <>
                {" · "}
                {horizonLabel} {active.forwardDirection === null ? "unlabelled" : DIRECTION_TEXT[String(active.forwardDirection)]}
              </>
            )}
          </>
        ) : (
          <span className="text-neutral-500">Hover a bar for its prices, volume, log return and forward label.</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full select-none"
        role="img"
        aria-label="EURUSD candlesticks on a log price axis with forward direction markers and log returns"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - box.left) / box.width) * WIDTH;
          const index = Math.floor((x - LEFT) / step);
          setHover(index >= 0 && index < bars.length ? index : null);
        }}
      >
        <rect x={LEFT} y={TOP} width={plotWidth} height={PRICE_HEIGHT} fill="none" stroke="#2a2a2a" />
        {priceTicks.map((tick) => (
          <g key={tick.label}>
            <line x1={LEFT} x2={WIDTH - RIGHT} y1={tick.y} y2={tick.y} stroke="#262626" strokeWidth={0.6} />
            <text x={LEFT - 6} y={tick.y + 3} textAnchor="end" fontSize={10} fill="#a3a3a3">
              {tick.label}
            </text>
          </g>
        ))}
        <text x={12} y={TOP + PRICE_HEIGHT / 2} fontSize={10} fill="#a3a3a3" transform={`rotate(-90 12 ${TOP + PRICE_HEIGHT / 2})`} textAnchor="middle">
          price (log axis)
        </text>

        {bars.map((bar, index) => {
          const x = xOf(index);
          const up = bar.close > bar.open;
          const down = bar.close < bar.open;
          const color = up ? OKABE.orange : down ? OKABE.blue : OKABE.grey;
          const bodyTop = yOf(Math.max(bar.open, bar.close));
          const bodyBottom = yOf(Math.min(bar.open, bar.close));
          return (
            <g key={bar.timestamp}>
              <line x1={x} x2={x} y1={yOf(bar.high)} y2={yOf(bar.low)} stroke="#6b6b6b" strokeWidth={0.9} />
              {bodyBottom - bodyTop < 0.8 ? (
                <line x1={x - bodyWidth / 2} x2={x + bodyWidth / 2} y1={bodyTop} y2={bodyTop} stroke={color} strokeWidth={1.4} />
              ) : (
                <rect x={x - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyBottom - bodyTop} fill={up ? "#0a0a0a" : color} stroke={color} strokeWidth={1} />
              )}
            </g>
          );
        })}

        {showMarkers &&
          bars.map((bar, index) =>
            bar.forwardDirection === 1 ? (
              <Triangle key={`m${bar.timestamp}`} x={xOf(index)} y={yOf(bar.high * MARKER_OFFSET_ABOVE)} up color={OKABE.orange} />
            ) : bar.forwardDirection === -1 ? (
              <Triangle key={`m${bar.timestamp}`} x={xOf(index)} y={yOf(bar.low * MARKER_OFFSET_BELOW)} up={false} color={OKABE.blue} />
            ) : null,
          )}

        <rect x={LEFT} y={returnTop} width={plotWidth} height={RETURN_HEIGHT} fill="none" stroke="#2a2a2a" />
        <line x1={LEFT} x2={WIDTH - RIGHT} y1={returnMiddle} y2={returnMiddle} stroke="#6b6b6b" strokeWidth={0.7} />
        {returns.map((value, index) => {
          const height = Math.abs(value) * returnScale;
          return (
            <rect
              key={bars[index]?.timestamp}
              x={xOf(index) - bodyWidth / 2}
              y={value >= 0 ? returnMiddle - height : returnMiddle}
              width={bodyWidth}
              height={Math.max(height, 0)}
              fill={value > 0 ? OKABE.orange : value < 0 ? OKABE.blue : OKABE.grey}
            />
          );
        })}
        <text x={LEFT - 6} y={returnTop + 10} textAnchor="end" fontSize={10} fill="#a3a3a3">
          +{fmt(returnExtent, 1)}
        </text>
        <text x={LEFT - 6} y={returnMiddle + 3} textAnchor="end" fontSize={10} fill="#a3a3a3">
          0
        </text>
        <text x={LEFT - 6} y={returnTop + RETURN_HEIGHT - 2} textAnchor="end" fontSize={10} fill="#a3a3a3">
          −{fmt(returnExtent, 1)}
        </text>
        <text x={12} y={returnMiddle} fontSize={10} fill="#a3a3a3" transform={`rotate(-90 12 ${returnMiddle})`} textAnchor="middle">
          log return (bp)
        </text>

        {timeTicks.map((tick) => (
          <text key={tick.at} x={tick.x} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill="#a3a3a3">
            {tick.label}
          </text>
        ))}

        {hover !== null && (
          <line x1={xOf(hover)} x2={xOf(hover)} y1={TOP} y2={returnTop + RETURN_HEIGHT} stroke="#d4d4d4" strokeWidth={0.6} strokeDasharray="3 3" pointerEvents="none" />
        )}
      </svg>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-400">
        <span><span style={{ color: OKABE.orange }}>▮</span> up bar (hollow body, orange)</span>
        <span><span style={{ color: OKABE.blue }}>▮</span> down bar (filled body, blue)</span>
        {showMarkers && horizonLabel && (
          <>
            <span><span style={{ color: OKABE.orange }}>▲</span> {horizonLabel} = up, above the high</span>
            <span><span style={{ color: OKABE.blue }}>▼</span> {horizonLabel} = down, below the low</span>
            <span>no marker = ranging or unlabelled</span>
          </>
        )}
      </p>
    </div>
  );
}
