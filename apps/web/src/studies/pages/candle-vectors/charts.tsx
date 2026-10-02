/**
 * Drawing primitives this study needs beyond the kit: candles in any unit
 * (SVG), a canvas scatter for tens of thousands of windows, a dot-and-whisker
 * interval plot, a matrix heatmap with its values written in, a sortable
 * table, and the pattern glyphs. Colours are Okabe-Ito and every colour also
 * carries a glyph or a word.
 */

import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { OKABE, fmt } from "@/studies/kit";

// ---------------------------------------------------------------------------
// Size and scales
// ---------------------------------------------------------------------------

/** The width of a container, following it as the side panel is dragged. */
export function useWidth<T extends HTMLElement>(fallback = 600): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? fallback);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width];
}

export function linear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

export function niceTicks(low: number, high: number, count = 5): number[] {
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return [low];
  const raw = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-9; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * Math.min(1, Math.max(0, t)));
  return `rgb(${c(ar, br)},${c(ag, bg)},${c(ab, bb)})`;
}

/** Blue below zero, light grey at zero, orange above; clamped at ±limit. */
export function diverging(value: number, limit: number): string {
  const t = Math.max(-1, Math.min(1, value / (limit || 1)));
  return t < 0 ? mix("#E8E8E8", OKABE.blue, -t) : mix("#E8E8E8", OKABE.orange, t);
}

const CIVIDIS = ["#00224E", "#123570", "#3B496C", "#575D6D", "#707173", "#8A8678", "#A59C74", "#C3B369", "#E1CC55", "#FEE838"];

/** The cividis sequential scale (colour-vision safe), t in [0, 1]. */
export function cividis(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (CIVIDIS.length - 1);
  const i = Math.min(CIVIDIS.length - 2, Math.floor(x));
  return mix(CIVIDIS[i] as string, CIVIDIS[i + 1] as string, x - i);
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

export type GlyphName = "triangle-up" | "triangle-down" | "diamond" | "square" | "cross" | "wedge" | "circle" | "ring" | "x";

/** An SVG path for a glyph of radius r centred on (x, y); canvas draws it with Path2D. */
export function glyphPath(glyph: GlyphName, x: number, y: number, r: number): string {
  switch (glyph) {
    case "triangle-up": return `M${x},${y - r}L${x + r},${y + r * 0.8}L${x - r},${y + r * 0.8}Z`;
    case "triangle-down": return `M${x},${y + r}L${x + r},${y - r * 0.8}L${x - r},${y - r * 0.8}Z`;
    case "diamond": return `M${x},${y - r * 1.2}L${x + r},${y}L${x},${y + r * 1.2}L${x - r},${y}Z`;
    case "square": return `M${x - r * 0.85},${y - r * 0.85}h${r * 1.7}v${r * 1.7}h${-r * 1.7}Z`;
    case "cross": {
      const w = r * 0.38;
      return `M${x - w},${y - r}h${2 * w}v${r - w}h${r - w}v${2 * w}h${-(r - w)}v${r - w}h${-2 * w}v${-(r - w)}h${-(r - w)}v${-2 * w}h${r - w}Z`;
    }
    case "wedge": return `M${x + r},${y}L${x - r},${y - r * 0.7}L${x - r * 0.4},${y}L${x - r},${y + r * 0.7}Z`;
    case "x": {
      const w = r * 0.3;
      return `M${x - r},${y - r + w}L${x - r + w},${y - r}L${x},${y - w}L${x + r - w},${y - r}L${x + r},${y - r + w}L${x + w},${y}L${x + r},${y + r - w}L${x + r - w},${y + r}L${x},${y + w}L${x - r + w},${y + r}L${x - r},${y + r - w}L${x - w},${y}Z`;
    }
    default: return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
}

export function Glyph({ glyph, color, size = 10, hollow = false }: { glyph: GlyphName; color: string; size?: number; hollow?: boolean }) {
  const r = size / 2 - 1;
  return (
    <svg width={size} height={size} className="inline-block align-middle" aria-hidden="true">
      <path d={glyphPath(glyph, size / 2, size / 2, r)} fill={hollow || glyph === "ring" ? "none" : color} stroke={color} strokeWidth={hollow || glyph === "ring" ? 1.3 : 0.5} />
    </svg>
  );
}

export interface SeriesStyle { color: string; glyph: GlyphName; label: string; hollow?: boolean }

/** The notebook's pattern colours with a shape for each, so no pattern is told apart by colour alone. */
export const PATTERN_STYLE: Record<string, SeriesStyle> = {
  hammer: { color: OKABE.orange, glyph: "triangle-up", label: "hammer" },
  shooting_star: { color: OKABE.blue, glyph: "triangle-down", label: "shooting star" },
  bullish_engulfing: { color: OKABE.vermillion, glyph: "diamond", label: "bullish engulfing" },
  bearish_engulfing: { color: OKABE.sky, glyph: "square", label: "bearish engulfing" },
  bullish_harami: { color: OKABE.yellow, glyph: "cross", label: "bullish harami" },
  bearish_harami: { color: OKABE.purple, glyph: "wedge", label: "bearish harami" },
  doji: { color: OKABE.green, glyph: "circle", label: "doji" },
  "no pattern": { color: "#BBBBBB", glyph: "ring", label: "no pattern", hollow: true },
};

export function Legend({ items, onToggle, hidden }: { items: Array<SeriesStyle & { key: string }>; onToggle?: (key: string) => void; hidden?: ReadonlySet<string> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-300">
      {items.map((item) => {
        const off = hidden?.has(item.key) ?? false;
        const body = (
          <>
            <Glyph glyph={item.glyph} color={item.color} hollow={item.hollow} /> <span className={off ? "line-through opacity-50" : ""}>{item.label}</span>
          </>
        );
        return onToggle ? (
          <button key={item.key} type="button" onClick={() => onToggle(item.key)} aria-pressed={!off} className="flex items-center gap-1 rounded px-1 hover:bg-neutral-800" title={off ? "show" : "hide"}>
            {body}
          </button>
        ) : (
          <span key={item.key} className="flex items-center gap-1">{body}</span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------

const AXIS_TEXT = "#a3a3a3";
const GRID_LINE = "#2a2a2a";

function YAxisSvg({ ticks, y, left, width, format }: { ticks: number[]; y: (v: number) => number; left: number; width: number; format: (v: number) => string }) {
  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={left} x2={left + width} y1={y(tick)} y2={y(tick)} stroke={GRID_LINE} />
          <text x={left - 4} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={AXIS_TEXT}>{format(tick)}</text>
        </g>
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Candles
// ---------------------------------------------------------------------------

export interface CandleMark {
  x: number; open: number; high: number; low: number; close: number;
  /** Body fill; defaults to orange up / blue down. */
  fill?: string; stroke?: string; strokeWidth?: number; hollow?: boolean; widthFraction?: number; tip?: string[];
}

export interface Marker { x: number; y: number; glyph: GlyphName; color: string; tip?: string[] }

export function CandleChart({
  candles, height = 260, xDomain, yDomain, xLabel, yLabel, band, hLines = [], vLines = [], markers = [], format = (v) => fmt(v, 2), xTickFormat = (v) => String(v), title,
}: {
  candles: CandleMark[]; height?: number; xDomain: [number, number]; yDomain?: [number, number]; xLabel?: string; yLabel?: string;
  band?: { y1: number; y2: number; color: string; opacity?: number }; hLines?: Array<{ y: number; color: string; dash?: string }>;
  vLines?: Array<{ x: number; color: string; dash?: string }>; markers?: Marker[]; format?: (v: number) => string; xTickFormat?: (v: number) => string; title?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ left: number; top: number; lines: string[] } | null>(null);
  const margin = { left: 58, right: 10, top: 8, bottom: xLabel ? 32 : 18 };
  const plotWidth = Math.max(40, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const values = [...candles.flatMap((c) => [c.high, c.low]), ...markers.map((m) => m.y), ...(band ? [band.y1, band.y2] : [])].filter(Number.isFinite);
  const low = yDomain?.[0] ?? Math.min(...values);
  const high = yDomain?.[1] ?? Math.max(...values);
  const pad = yDomain ? 0 : (high - low) * 0.05 || 1;
  const y = linear([low - pad, high + pad], [margin.top + plotHeight, margin.top]);
  const x = linear(xDomain, [margin.left, margin.left + plotWidth]);
  const slot = plotWidth / Math.max(1, xDomain[1] - xDomain[0]);
  const yTicks = niceTicks(low - pad, high + pad, 5);
  const xTicks = niceTicks(xDomain[0], xDomain[1], Math.min(10, Math.round(plotWidth / 50))).filter((t) => Number.isInteger(t));
  const clampY = (v: number) => y(Math.max(low - pad, Math.min(high + pad, v)));
  return (
    <div ref={ref} className="relative min-w-0">
      {title && <div className="mb-1 text-[11px] text-neutral-300">{title}</div>}
      <svg width={width} height={height} onMouseLeave={() => setHover(null)}>
        <YAxisSvg ticks={yTicks} y={y} left={margin.left} width={plotWidth} format={format} />
        {band && <rect x={margin.left} width={plotWidth} y={clampY(Math.max(band.y1, band.y2))} height={Math.abs(clampY(band.y1) - clampY(band.y2))} fill={band.color} opacity={band.opacity ?? 0.25} />}
        {hLines.map((line) => <line key={`h${line.y}${line.color}`} x1={margin.left} x2={margin.left + plotWidth} y1={clampY(line.y)} y2={clampY(line.y)} stroke={line.color} strokeDasharray={line.dash} />)}
        {vLines.map((line) => <line key={`v${line.x}${line.color}`} x1={x(line.x)} x2={x(line.x)} y1={margin.top} y2={margin.top + plotHeight} stroke={line.color} strokeDasharray={line.dash} />)}
        {candles.map((c, index) => {
          if (![c.open, c.high, c.low, c.close].every(Number.isFinite)) return null;
          const up = c.close >= c.open;
          const color = c.fill ?? (up ? OKABE.orange : OKABE.blue);
          const bodyWidth = Math.max(2, slot * (c.widthFraction ?? 0.6));
          const top = clampY(Math.max(c.open, c.close));
          const bottom = clampY(Math.min(c.open, c.close));
          return (
            <g key={index} onMouseMove={(event) => c.tip && setHover({ left: event.nativeEvent.offsetX + 12, top: event.nativeEvent.offsetY + 8, lines: c.tip })}>
              <line x1={x(c.x)} x2={x(c.x)} y1={clampY(c.high)} y2={clampY(c.low)} stroke={c.stroke ?? "#d4d4d4"} strokeWidth={1} />
              <rect x={x(c.x) - bodyWidth / 2} width={bodyWidth} y={top} height={Math.max(1, bottom - top)}
                fill={c.hollow ? "#0a0a0a" : color} stroke={c.stroke ?? (c.hollow ? color : "#111")} strokeWidth={c.strokeWidth ?? (c.hollow ? 1.4 : 0.6)} />
            </g>
          );
        })}
        {markers.map((m, index) => (
          <path key={`m${index}`} d={glyphPath(m.glyph, x(m.x), clampY(m.y), 5)} fill={m.color} stroke="#111" strokeWidth={0.5}
            onMouseMove={(event) => m.tip && setHover({ left: event.nativeEvent.offsetX + 12, top: event.nativeEvent.offsetY + 8, lines: m.tip })} />
        ))}
        {xTicks.map((tick) => (
          <text key={tick} x={x(tick)} y={margin.top + plotHeight + 12} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>{xTickFormat(tick)}</text>
        ))}
        {xLabel && <text x={margin.left + plotWidth / 2} y={height - 4} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>{xLabel}</text>}
        {yLabel && <text transform={`translate(10 ${margin.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>{yLabel}</text>}
      </svg>
      {hover && <HoverCard left={hover.left} top={hover.top} lines={hover.lines} />}
    </div>
  );
}

function HoverCard({ left, top, lines }: { left: number; top: number; lines: string[] }) {
  return (
    <div className="pointer-events-none absolute z-10 max-w-xs rounded border border-neutral-700 bg-neutral-950/95 px-2 py-1 text-[11px] font-mono text-neutral-200 shadow" style={{ left, top }}>
      {lines.map((line) => <div key={line}>{line}</div>)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scatter (canvas)
// ---------------------------------------------------------------------------

export interface ScatterPoint { x: number; y: number; group: string; tip: () => string[] }

export function ScatterCanvas({
  points, styles, opacity, xDomain, yDomain, xLabel, yLabel, height = 460, size = 3.2,
}: {
  points: ScatterPoint[]; styles: Record<string, SeriesStyle>; opacity: number; xDomain: [number, number]; yDomain: [number, number];
  xLabel: string; yLabel: string; height?: number; size?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ left: number; top: number; lines: string[] } | null>(null);
  const margin = { left: 50, right: 10, top: 8, bottom: 34 };
  const plotWidth = Math.max(40, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const clamp = (value: number, domain: [number, number]) => Math.max(domain[0], Math.min(domain[1], value));
  const x = linear(xDomain, [margin.left, margin.left + plotWidth]);
  const y = linear(yDomain, [margin.top + plotHeight, margin.top]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = width * ratio;
    element.height = height * ratio;
    const context = element.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = GRID_LINE;
    context.fillStyle = AXIS_TEXT;
    context.font = "10px ui-monospace, monospace";
    for (const tick of niceTicks(yDomain[0], yDomain[1], 5)) {
      context.beginPath(); context.moveTo(margin.left, y(tick)); context.lineTo(margin.left + plotWidth, y(tick)); context.stroke();
      context.textAlign = "right"; context.fillText(fmt(tick, Math.abs(tick) < 10 ? 1 : 0), margin.left - 4, y(tick) + 3);
    }
    for (const tick of niceTicks(xDomain[0], xDomain[1], 6)) {
      context.textAlign = "center"; context.fillText(fmt(tick, Math.abs(tick) < 10 ? 1 : 0), x(tick), margin.top + plotHeight + 12);
    }
    context.fillText(xLabel, margin.left + plotWidth / 2, height - 4);
    context.save(); context.translate(10, margin.top + plotHeight / 2); context.rotate(-Math.PI / 2); context.fillText(yLabel, 0, 0); context.restore();
    context.globalAlpha = opacity;
    // "no pattern" first so the patterns sit on top of it
    const ordered = [...points].sort((a, b) => (a.group === "no pattern" ? 0 : 1) - (b.group === "no pattern" ? 0 : 1));
    for (const point of ordered) {
      const style = styles[point.group];
      if (!style) continue;
      const path = new Path2D(glyphPath(style.glyph, x(clamp(point.x, xDomain)), y(clamp(point.y, yDomain)), size));
      if (style.hollow || style.glyph === "ring") {
        context.strokeStyle = style.color; context.lineWidth = 1; context.stroke(path);
      } else {
        context.fillStyle = style.color; context.fill(path);
      }
    }
    context.globalAlpha = 1;
  });

  const onMove = (event: MouseEvent<HTMLCanvasElement>) => {
    const mx = event.nativeEvent.offsetX, my = event.nativeEvent.offsetY;
    let best: ScatterPoint | null = null;
    let bestDistance = 64;
    for (const point of points) {
      const dx = x(clamp(point.x, xDomain)) - mx, dy = y(clamp(point.y, yDomain)) - my;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; best = point; }
    }
    setHover(best ? { left: mx + 12, top: my + 8, lines: best.tip() } : null);
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <canvas ref={canvas} style={{ width, height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      {hover && <HoverCard left={hover.left} top={hover.top} lines={hover.lines} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dot and whisker
// ---------------------------------------------------------------------------

export interface IntervalItem {
  row: string; series: string; value: number | null; low?: number | null; high?: number | null;
  style: SeriesStyle; faded?: boolean; tip: string[];
  /** Extra marks on the same row: a tick (the guess / the null) or a glyph. */
  extras?: Array<{ value: number | null; kind: "tick" | GlyphName; color: string }>;
}

export function IntervalPlot({
  rows, series, items, domain, xLabel, log = false, rowHeight = 24, labelWidth = 128, reference,
}: {
  rows: string[]; series: string[]; items: IntervalItem[]; domain: [number, number]; xLabel: string; log?: boolean; rowHeight?: number; labelWidth?: number;
  reference?: { value: number; color: string; dash?: string };
}) {
  const [ref, width] = useWidth<HTMLDivElement>(400);
  const [hover, setHover] = useState<{ left: number; top: number; lines: string[] } | null>(null);
  const margin = { left: labelWidth, right: 10, top: 6, bottom: 30 };
  const plotWidth = Math.max(40, width - margin.left - margin.right);
  const height = margin.top + margin.bottom + rows.length * rowHeight;
  const transform = (v: number) => (log ? Math.log10(Math.max(v, 1e-9)) : v);
  const scale = linear([transform(domain[0]), transform(domain[1])], [margin.left, margin.left + plotWidth]);
  const x = (v: number) => scale(transform(Math.max(domain[0], Math.min(domain[1], v))));
  const offset = (name: string) => {
    const index = series.indexOf(name);
    return series.length <= 1 ? 0 : ((index + 0.5) / series.length - 0.5) * rowHeight * 0.8;
  };
  const ticks = log
    ? [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].filter((t) => t >= domain[0] && t <= domain[1])
    : niceTicks(domain[0], domain[1], Math.max(3, Math.round(plotWidth / 70)));
  return (
    <div ref={ref} className="relative min-w-0">
      <svg width={width} height={height} onMouseLeave={() => setHover(null)}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={margin.top} y2={height - margin.bottom} stroke={GRID_LINE} />
            <text x={x(tick)} y={height - margin.bottom + 12} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>{tick}</text>
          </g>
        ))}
        {reference && <line x1={x(reference.value)} x2={x(reference.value)} y1={margin.top} y2={height - margin.bottom} stroke={reference.color} strokeDasharray={reference.dash ?? "3 3"} />}
        {rows.map((row, index) => (
          <text key={row} x={margin.left - 6} y={margin.top + (index + 0.5) * rowHeight} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#d4d4d4">
            {row.replace(/_/g, " ")}
          </text>
        ))}
        {items.map((item, index) => {
          const rowIndex = rows.indexOf(item.row);
          if (rowIndex < 0) return null;
          const cy = margin.top + (rowIndex + 0.5) * rowHeight + offset(item.series);
          const opacity = item.faded ? 0.4 : 1;
          const show = (event: MouseEvent) => setHover({ left: event.nativeEvent.offsetX + 12, top: event.nativeEvent.offsetY + 8, lines: item.tip });
          return (
            <g key={`${item.row}|${item.series}|${index}`} opacity={opacity} onMouseMove={show}>
              {typeof item.low === "number" && typeof item.high === "number" && (
                <line x1={x(item.low)} x2={x(item.high)} y1={cy} y2={cy} stroke={item.style.color} strokeWidth={2} />
              )}
              {item.extras?.map((extra, extraIndex) => (typeof extra.value === "number" ? (
                extra.kind === "tick"
                  ? <line key={extraIndex} x1={x(extra.value)} x2={x(extra.value)} y1={cy - 6} y2={cy + 6} stroke={extra.color} strokeWidth={2} />
                  : <path key={extraIndex} d={glyphPath(extra.kind, x(extra.value), cy, 4.5)} fill={extra.kind === "x" || extra.kind === "cross" ? extra.color : "none"} stroke={extra.color} strokeWidth={1.2} />
              ) : null))}
              {typeof item.value === "number" && (
                <path d={glyphPath(item.style.glyph, x(item.value), cy, 4.5)} fill={item.style.hollow ? "#0a0a0a" : item.style.color} stroke={item.style.hollow ? item.style.color : "#111"} strokeWidth={item.style.hollow ? 1.3 : 0.5} />
              )}
              <rect x={margin.left} width={plotWidth} y={cy - 4} height={8} fill="transparent" />
            </g>
          );
        })}
        <text x={margin.left + plotWidth / 2} y={height - 4} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>{xLabel}</text>
      </svg>
      {hover && <HoverCard left={hover.left} top={hover.top} lines={hover.lines} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matrix heatmap
// ---------------------------------------------------------------------------

export function MatrixHeatmap({
  rows, columns, value, color, format, height, xLabel, tip, labelWidth = 60,
}: {
  rows: string[]; columns: string[]; value: (row: string, column: string) => number | null; color: (value: number) => string;
  format: (value: number) => string; height?: number; xLabel?: string; tip?: (row: string, column: string) => string[]; labelWidth?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(500);
  const [hover, setHover] = useState<{ left: number; top: number; lines: string[] } | null>(null);
  const margin = { left: labelWidth, right: 6, top: 4, bottom: xLabel ? 30 : 16 };
  const cellHeight = height ? (height - margin.top - margin.bottom) / Math.max(1, rows.length) : 18;
  const total = margin.top + margin.bottom + cellHeight * rows.length;
  const cellWidth = Math.max(4, (width - margin.left - margin.right) / Math.max(1, columns.length));
  return (
    <div ref={ref} className="relative min-w-0">
      <svg width={width} height={total} onMouseLeave={() => setHover(null)}>
        {rows.map((row, r) => (
          <g key={row}>
            <text x={margin.left - 4} y={margin.top + (r + 0.5) * cellHeight} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#d4d4d4">{row}</text>
            {columns.map((column, c) => {
              const v = value(row, column);
              const cx = margin.left + c * cellWidth;
              const cy = margin.top + r * cellHeight;
              return (
                <g key={column} onMouseMove={(event) => tip && setHover({ left: event.nativeEvent.offsetX + 12, top: event.nativeEvent.offsetY + 8, lines: tip(row, column) })}>
                  <rect x={cx} y={cy} width={cellWidth - 1} height={cellHeight - 1} fill={v === null ? "#1a1a1a" : color(v)} />
                  {v !== null && cellWidth > 26 && cellHeight > 11 && (
                    <text x={cx + cellWidth / 2} y={cy + cellHeight / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(10, cellHeight * 0.6)} fill="#111">{format(v)}</text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
        {columns.map((column, c) => (
          <text key={column} x={margin.left + (c + 0.5) * cellWidth} y={margin.top + rows.length * cellHeight + 11} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>{column}</text>
        ))}
        {xLabel && <text x={margin.left + (width - margin.left) / 2} y={total - 3} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>{xLabel}</text>}
      </svg>
      {hover && <HoverCard left={hover.left} top={hover.top} lines={hover.lines} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export interface Column { key: string; label?: string; format?: (value: unknown, row: Record<string, unknown>) => ReactNode }

function defaultFormat(value: unknown): ReactNode {
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString("en-US") : fmt(value, Math.abs(value) < 1 ? 4 : 3);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value === null || value === undefined) return "—";
  return String(value);
}

/** A sortable, paged table: the notebook's mo.ui.table. */
export function DataTable({ rows, columns, pageSize = 10 }: { rows: ReadonlyArray<Record<string, unknown>>; columns?: Column[]; pageSize?: number }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(0);
  const shown: Column[] = columns ?? Object.keys(rows[0] ?? {}).filter((key) => key !== "recipe").map((key) => ({ key }));
  const sorted = sortKey
    ? [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const order = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
      return descending ? -order : order;
    })
    : rows;
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);
  return (
    <div className="min-w-0 space-y-1">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono tnum">
          <thead>
            <tr className="text-neutral-500">
              {shown.map((column) => (
                <th key={column.key} className="whitespace-nowrap px-1 py-0.5 text-left font-normal">
                  <button type="button" className="hover:text-neutral-200" onClick={() => {
                    if (sortKey === column.key) setDescending(!descending);
                    else { setSortKey(column.key); setDescending(false); }
                  }}>
                    {column.label ?? column.key.replace(/_/g, " ")} {sortKey === column.key ? (descending ? "▼" : "▲") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={index} className="border-t border-neutral-900">
                {shown.map((column) => (
                  <td key={column.key} className="whitespace-nowrap px-1 py-0.5 text-neutral-200">{column.format ? column.format(row[column.key], row) : defaultFormat(row[column.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border border-neutral-700 px-1 disabled:opacity-40">◀</button>
          page {current + 1} of {pages} · {sorted.length.toLocaleString("en-US")} rows
          <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="rounded border border-neutral-700 px-1 disabled:opacity-40">▶</button>
        </div>
      )}
    </div>
  );
}

/** Up/down candle colour legend used under every candle chart. */
export function CandleKey({ extra }: { extra?: ReactNode }) {
  return (
    <p className="text-[11px] text-neutral-400">
      <span style={{ color: OKABE.orange }}>▮ up candle (close ≥ open)</span> · <span style={{ color: OKABE.blue }}>▮ down candle (close &lt; open)</span>
      {extra}
    </p>
  );
}
