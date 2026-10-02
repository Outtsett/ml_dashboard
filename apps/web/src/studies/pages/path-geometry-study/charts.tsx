/**
 * The page's hand-drawn charts: the two a chart library does not draw (price
 * with forward-reach arrows, candles with one label arrow each) and the
 * symmetric-log interval plot. Plain SVG measured to the panel's width, so the
 * text stays readable in a 380 px side panel. Orange is up/positive, blue is
 * down/negative, and every mark also differs in shape (triangle up, triangle
 * down, circle, diamond) so colour is never the only channel.
 */

import { useEffect, useRef, useState } from "react";
import { OKABE, fmt, fmtTime } from "@/studies/kit";
import { symlog } from "@shared/studies/path-geometry-study";

const TEXT = "#a3a3a3";
const GRID_LINE = "#262626";
const INK = "#e5e5e5";

export function useElementWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    setWidth(Math.round(node.getBoundingClientRect().width));
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(Math.round(next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceTicks(low: number, high: number, count: number): number[] {
  if (!(high > low)) return [low];
  const raw = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + 1e-9; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

function ArrowMarkers() {
  return (
    <defs>
      <marker id="arrow-up" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill={OKABE.orange} />
      </marker>
      <marker id="arrow-down" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill={OKABE.blue} />
      </marker>
    </defs>
  );
}

type Label = 0 | 1 | null;

interface HoverState {
  index: number;
  x: number;
}

function tooltipStyle(x: number, width: number) {
  return { left: Math.min(Math.max(x + 10, 0), Math.max(0, width - 210)), top: 6 } as const;
}

// ── price with forward-reach arrows ────────────────────────────────────────

export function PriceArrowsChart({
  times, closes, labels, deltas, count, horizon, arrowEvery, height = 300,
}: {
  times: readonly number[];
  /** Closes of the whole slice (at least `count + horizon` bars, so arrows can reach). */
  closes: readonly number[];
  labels: readonly Label[];
  deltas: ReadonlyArray<number | null>;
  /** Bars drawn (the segment). */
  count: number;
  horizon: number;
  arrowEvery: number;
  height?: number;
}) {
  const [ref, width] = useElementWidth();
  const [hover, setHover] = useState<HoverState | null>(null);
  const priceHeight = height - 52;
  const left = 58, right = 10, top = 8;
  const plotWidth = Math.max(10, width - left - right);
  const segment = closes.slice(0, count);
  if (segment.length < 2) return <div ref={ref} />;
  const low = Math.min(...segment), high = Math.max(...segment);
  const padding = (high - low) * 0.06 || 1;
  const x = (index: number) => left + (index / (count - 1)) * plotWidth;
  const y = (value: number) => top + (1 - (value - (low - padding)) / (high - low + 2 * padding)) * (priceHeight - top - 6);
  const stripTop = priceHeight + 6;
  const stripMid = stripTop + 18;
  const path = segment.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const yTicks = niceTicks(low - padding, high + padding, 4);
  const arrows: number[] = [];
  for (let index = 0; index + horizon <= count - 1 && index < count; index += Math.max(1, arrowEvery)) arrows.push(index);
  const hovered = hover ? hover.index : null;

  return (
    <div ref={ref} className="relative w-full min-w-0">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Close price over ${count} bars with the direction label marked on each bar and arrows to the close ${horizon} bars ahead`}
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const px = event.clientX - box.left;
            setHover({ index: Math.min(count - 1, Math.max(0, Math.round(((px - left) / plotWidth) * (count - 1)))), x: px });
          }}
          onMouseLeave={() => setHover(null)}
        >
          <ArrowMarkers />
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} stroke={GRID_LINE} />
              <text x={left - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill={TEXT}>{fmt(tick, 0)}</text>
            </g>
          ))}
          <path d={path} fill="none" stroke="#737373" strokeWidth={1} />
          {segment.map((value, index) => {
            const label = labels[index];
            if (label === null || label === undefined) return null;
            const cx = x(index), cy = y(value);
            return label === 1 ? (
              <path key={index} d={`M${cx} ${cy - 4} l3.5 6.5 h-7 z`} fill={OKABE.orange} />
            ) : (
              <path key={index} d={`M${cx} ${cy + 4} l3.5 -6.5 h-7 z`} fill={OKABE.blue} />
            );
          })}
          {arrows.map((index) => {
            const label = labels[index];
            if (label === null || label === undefined) return null;
            const end = index + horizon;
            return (
              <line
                key={`arrow-${index}`}
                x1={x(index)} y1={y(closes[index] as number)} x2={x(end)} y2={y(closes[end] as number)}
                stroke={label === 1 ? OKABE.orange : OKABE.blue} strokeWidth={1.6}
                markerEnd={label === 1 ? "url(#arrow-up)" : "url(#arrow-down)"}
              />
            );
          })}
          {hovered !== null && (
            <g>
              <line x1={x(hovered)} x2={x(hovered)} y1={top} y2={stripTop + 38} stroke={INK} strokeDasharray="3 3" />
              {hovered + horizon <= count - 1 && <line x1={x(hovered + horizon)} x2={x(hovered + horizon)} y1={top} y2={stripTop + 38} stroke={OKABE.purple} strokeDasharray="3 3" />}
            </g>
          )}
          <line x1={left} x2={left + plotWidth} y1={stripMid} y2={stripMid} stroke="#525252" />
          {segment.map((_, index) => {
            const label = labels[index];
            if (label === null || label === undefined) return null;
            const w = Math.max(1, plotWidth / count);
            return label === 1 ? (
              <rect key={index} x={x(index) - w / 2} y={stripMid - 14} width={w} height={14} fill={OKABE.orange} />
            ) : (
              <rect key={index} x={x(index) - w / 2} y={stripMid} width={w} height={14} fill={OKABE.blue} />
            );
          })}
          <text x={left - 6} y={stripMid - 5} textAnchor="end" fontSize={9} fill={OKABE.orange}>up ▲</text>
          <text x={left - 6} y={stripMid + 12} textAnchor="end" fontSize={9} fill={OKABE.blue}>down ▼</text>
          <text x={left + plotWidth} y={height - 2} textAnchor="end" fontSize={9} fill={TEXT}>bar within segment</text>
        </svg>
      )}
      {hover && hovered !== null && (
        <div className="pointer-events-none absolute rounded border border-neutral-700 bg-neutral-950/95 px-2 py-1 font-mono text-[10px] leading-tight text-neutral-200" style={tooltipStyle(hover.x, width)}>
          <div>{fmtTime(times[hovered])} (bar {hovered})</div>
          <div>close[t] {fmt(closes[hovered], 2)}</div>
          <div>close[t+{horizon}] {closes[hovered + horizon] === undefined ? "—" : fmt(closes[hovered + horizon], 2)}</div>
          <div>change {fmt(deltas[hovered] ?? null, 2)} pts</div>
          <div>label {labels[hovered] === null || labels[hovered] === undefined ? "none" : labels[hovered] === 1 ? "1 ▲ up" : "0 ▼ down"}</div>
        </div>
      )}
    </div>
  );
}

// ── candles, one arrow each ────────────────────────────────────────────────

export function CandleArrowsChart({
  times, opens, highs, lows, closes, labels, horizon, height = 340,
}: {
  times: readonly number[];
  opens: readonly number[];
  highs: readonly number[];
  lows: readonly number[];
  closes: readonly number[];
  labels: readonly Label[];
  /** The short horizon each arrow looks ahead. */
  horizon: number;
  height?: number;
}) {
  const [ref, width] = useElementWidth();
  const [hover, setHover] = useState<HoverState | null>(null);
  const count = opens.length;
  const left = 54, right = 8, top = 8, bottom = 24;
  const plotWidth = Math.max(10, width - left - right);
  if (count < 2) return <div ref={ref} />;
  const low = Math.min(...lows), high = Math.max(...highs);
  const range = high - low || 1;
  const pad = range * 0.16;
  const yLow = low - pad * 0.4, yHigh = high + pad * 1.15;
  const y = (value: number) => top + (1 - (value - yLow) / (yHigh - yLow)) * (height - top - bottom);
  const slot = plotWidth / count;
  const x = (index: number) => left + (index + 0.5) * slot;
  const bodyWidth = Math.max(1.5, slot * 0.64);
  const yTicks = niceTicks(low, high, 4);
  const hovered = hover ? hover.index : null;

  return (
    <div ref={ref} className="relative w-full min-w-0">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${count} one-minute candles, one arrow above each for the direction label ${horizon} bars ahead`}
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const px = event.clientX - box.left;
            setHover({ index: Math.min(count - 1, Math.max(0, Math.floor((px - left) / slot))), x: px });
          }}
          onMouseLeave={() => setHover(null)}
        >
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} stroke={GRID_LINE} />
              <text x={left - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill={TEXT}>{fmt(tick, 0)}</text>
            </g>
          ))}
          {hovered !== null && hovered + horizon < count && (
            <rect x={left + (hovered + horizon) * slot} y={top} width={slot} height={height - top - bottom} fill={OKABE.purple} opacity={0.18} />
          )}
          {hovered !== null && <rect x={left + hovered * slot} y={top} width={slot} height={height - top - bottom} fill={INK} opacity={0.12} />}
          {opens.map((open, index) => {
            const close = closes[index] as number;
            const up = close >= open;
            const colour = up ? OKABE.orange : OKABE.blue;
            const bodyTop = y(Math.max(open, close));
            const bodyHeight = Math.max(1, Math.abs(y(open) - y(close)));
            const label = labels[index];
            const arrowHigh = y(highs[index] as number);
            return (
              <g key={index}>
                <line x1={x(index)} x2={x(index)} y1={y(highs[index] as number)} y2={y(lows[index] as number)} stroke={colour} strokeWidth={1.1} />
                <rect x={x(index) - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={up ? colour : "#0a0a0a"} stroke={colour} strokeWidth={1} />
                {label !== null && label !== undefined && (label === 1 ? (
                  <path d={`M${x(index)} ${arrowHigh - 22} l${Math.max(3, slot * 0.3)} 10 h-${Math.max(6, slot * 0.6)} z`} fill={OKABE.orange} />
                ) : (
                  <path d={`M${x(index)} ${arrowHigh - 6} l${Math.max(3, slot * 0.3)} -10 h-${Math.max(6, slot * 0.6)} z`} fill={OKABE.blue} />
                ))}
              </g>
            );
          })}
          {opens.map((_, index) => {
            const step = Math.max(1, Math.floor(count / 9));
            if (index % step !== 0) return null;
            return <text key={index} x={x(index)} y={height - 8} textAnchor="middle" fontSize={9} fill={TEXT}>{fmtTime(times[index]).slice(11)}</text>;
          })}
        </svg>
      )}
      {hover && hovered !== null && (
        <div className="pointer-events-none absolute rounded border border-neutral-700 bg-neutral-950/95 px-2 py-1 font-mono text-[10px] leading-tight text-neutral-200" style={tooltipStyle(hover.x, width)}>
          <div>{fmtTime(times[hovered])}</div>
          <div>open {fmt(opens[hovered], 2)} close {fmt(closes[hovered], 2)} ({(closes[hovered] as number) >= (opens[hovered] as number) ? "candle up" : "candle down"})</div>
          <div>high {fmt(highs[hovered], 2)} low {fmt(lows[hovered], 2)}</div>
          <div>close[t+{horizon}] {closes[hovered + horizon] === undefined ? "beyond the chart" : fmt(closes[hovered + horizon], 2)}</div>
          <div>arrow {labels[hovered] === null || labels[hovered] === undefined ? "none" : labels[hovered] === 1 ? "up ▲ (label 1)" : "down ▼ (label 0)"}</div>
        </div>
      )}
    </div>
  );
}

// ── intervals on a symmetric-log axis ──────────────────────────────────────

export interface IntervalRow {
  key: string;
  label: string;
  low: number;
  high: number;
  /** The interval's midpoint is drawn as a diamond; `mean` (when given) as a vertical tick. */
  mean?: number | null;
  note: string;
}

const LINEAR_THRESHOLD = 1e-4;

function tickLabel(value: number): string {
  if (value === 0) return "0";
  return value.toExponential(0).replace("e", "e");
}

export function SymlogIntervalChart({ rows, xLabel }: { rows: readonly IntervalRow[]; xLabel: string }) {
  const [ref, width] = useElementWidth();
  const [hover, setHover] = useState<string | null>(null);
  const left = 132, right = 14, top = 8, rowHeight = 34;
  const height = top + rows.length * rowHeight + 34;
  const plotWidth = Math.max(10, width - left - right);
  const coordinates = rows.flatMap((row) => [symlog(row.low, LINEAR_THRESHOLD), symlog(row.high, LINEAR_THRESHOLD), 0]);
  const lowCoordinate = Math.min(...coordinates, 0) - 0.25;
  const highCoordinate = Math.max(...coordinates, 0) + 0.25;
  const x = (value: number) => left + ((symlog(value, LINEAR_THRESHOLD) - lowCoordinate) / (highCoordinate - lowCoordinate)) * plotWidth;
  const tickValues = [-1, -1e-1, -1e-2, -1e-3, -1e-4, 0, 1e-4, 1e-3, 1e-2, 1e-1, 1].filter((value) => {
    const coordinate = symlog(value, LINEAR_THRESHOLD);
    return coordinate >= lowCoordinate && coordinate <= highCoordinate;
  });
  const hoveredRow = rows.find((row) => row.key === hover);

  return (
    <div ref={ref} className="relative w-full min-w-0">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={xLabel}>
          {tickValues.map((tick) => (
            <g key={tick}>
              <line x1={x(tick)} x2={x(tick)} y1={top} y2={top + rows.length * rowHeight} stroke={GRID_LINE} />
              <text x={x(tick)} y={top + rows.length * rowHeight + 13} textAnchor="middle" fontSize={9} fill={TEXT}>{tickLabel(tick)}</text>
            </g>
          ))}
          <line x1={x(0)} x2={x(0)} y1={top} y2={top + rows.length * rowHeight} stroke={INK} strokeDasharray="5 3" strokeWidth={1.3} />
          {rows.map((row, index) => {
            const cy = top + index * rowHeight + rowHeight / 2;
            const mid = (row.low + row.high) / 2;
            const below = row.high < 0;
            const above = row.low > 0;
            return (
              <g key={row.key} onMouseEnter={() => setHover(row.key)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
                <rect x={0} y={cy - rowHeight / 2} width={width} height={rowHeight} fill={hover === row.key ? "#ffffff" : "transparent"} opacity={0.05} />
                <text x={left - 8} y={cy + 3} textAnchor="end" fontSize={10} fill={INK}>{row.label}</text>
                <line x1={x(row.low)} x2={x(row.high)} y1={cy} y2={cy} stroke={below ? OKABE.blue : above ? OKABE.orange : OKABE.sky} strokeWidth={4} strokeLinecap="round" />
                <path d={`M${x(mid)} ${cy - 6} l6 6 l-6 6 l-6 -6 z`} fill={below ? OKABE.blue : above ? OKABE.orange : OKABE.sky} stroke="#0a0a0a" />
                {row.mean !== null && row.mean !== undefined && <line x1={x(row.mean)} x2={x(row.mean)} y1={cy - 9} y2={cy + 9} stroke={INK} strokeWidth={1.5} />}
              </g>
            );
          })}
          <text x={left + plotWidth / 2} y={height - 3} textAnchor="middle" fontSize={10} fill={TEXT}>{xLabel}</text>
        </svg>
      )}
      {hoveredRow && (
        <div className="pointer-events-none absolute right-2 top-1 rounded border border-neutral-700 bg-neutral-950/95 px-2 py-1 font-mono text-[10px] leading-tight text-neutral-200">
          <div className="font-semibold">{hoveredRow.label}</div>
          <div>interval [{hoveredRow.low.toExponential(3)}, {hoveredRow.high.toExponential(3)}]</div>
          {hoveredRow.mean !== null && hoveredRow.mean !== undefined && <div>mean loss differential {hoveredRow.mean.toExponential(3)}</div>}
          <div>{hoveredRow.note}</div>
        </div>
      )}
    </div>
  );
}
