/**
 * Chart and control pieces the indicator study needs beyond the kit: a slider
 * that commits on release, a searchable multi-picker, SVG glyphs, a
 * dot-and-whisker chart, small histograms, a canvas matrix, a canvas scatter
 * and a sortable, paged table. Okabe-Ito only; every colour also carries a
 * glyph or a label.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Slider } from "@/shared/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { OKABE, fmt } from "@/studies/kit";

// ── layout ──────────────────────────────────────────────────────────────────

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// ── controls ────────────────────────────────────────────────────────────────

/** A slider that shows its value while dragging and reports it on release (each release is one lake query). */
export function CommitSlider({
  label, value, min, max, step = 1, onCommit, format = (v) => String(v), hint, wide = false,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  onCommit: (value: number) => void; format?: (value: number) => string; hint?: string; wide?: boolean;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? value;
  return (
    <label className={`flex flex-col gap-1 ${wide ? "min-w-0 flex-1 basis-64" : "w-44"}`} title={hint}>
      <span className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-neutral-500">
        <span>{label}</span>
        <span className="font-mono normal-case tracking-normal text-neutral-200">{format(shown)}</span>
      </span>
      <Slider
        value={[shown]}
        min={min}
        max={Math.max(min, max)}
        step={step}
        onValueChange={(next) => setDragging(next[0] ?? value)}
        onValueCommit={(next) => {
          setDragging(null);
          onCommit(next[0] ?? value);
        }}
      />
    </label>
  );
}

/** Pick several of many (indicator columns, TA-Lib groups, pattern kinds). */
export function MultiPicker({
  label, options, selected, onChange, hint,
}: {
  label: string; options: ReadonlyArray<{ value: string; label: string }>; selected: readonly string[];
  onChange: (next: string[]) => void; hint?: string;
}) {
  const [filter, setFilter] = useState("");
  const chosen = new Set(selected);
  const visible = options.filter((option) => option.label.toLowerCase().includes(filter.toLowerCase()));
  const summary = selected.length === 0 ? "none" : selected.length === options.length ? `all ${options.length}` : `${selected.length} of ${options.length}`;
  return (
    <div className="flex min-w-0 flex-col gap-1" title={hint}>
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="h-7 max-w-full truncate rounded border border-neutral-700 bg-neutral-950 px-2 text-left text-xs text-neutral-200 hover:border-neutral-500">
            {summary}
            {selected.length > 0 && selected.length <= 4 && <span className="text-neutral-500"> · {selected.join(", ")}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-2" align="start">
          <div className="mb-2 flex gap-1">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="filter"
              className="h-7 min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
            />
            <button type="button" className="rounded border border-neutral-700 px-2 text-[11px] text-neutral-300 hover:bg-neutral-800" onClick={() => onChange(options.map((option) => option.value))}>
              all
            </button>
            <button type="button" className="rounded border border-neutral-700 px-2 text-[11px] text-neutral-300 hover:bg-neutral-800" onClick={() => onChange([])}>
              none
            </button>
          </div>
          <div className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
            {visible.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-neutral-200 hover:bg-neutral-800">
                <input
                  type="checkbox"
                  checked={chosen.has(option.value)}
                  onChange={(event) => {
                    const next = new Set(chosen);
                    if (event.target.checked) next.add(option.value);
                    else next.delete(option.value);
                    onChange(options.map((entry) => entry.value).filter((value) => next.has(value)));
                  }}
                />
                <span className="truncate">{option.label}</span>
              </label>
            ))}
            {visible.length === 0 && <p className="px-1 text-[11px] text-neutral-500">Nothing matches.</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Radio-style choice rendered as buttons, for option sets whose labels are long. */
export function ChoiceControl<V extends string>({
  label, value, options, onChange, hint,
}: {
  label: string; value: V; options: ReadonlyArray<{ value: V; label: string }>; onChange: (value: V) => void; hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1" title={hint}>
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            className={`rounded border px-2 py-0.5 text-[11px] ${option.value === value ? "border-neutral-400 bg-neutral-700 text-neutral-50" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function csv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

// ── glyphs ──────────────────────────────────────────────────────────────────

export type GlyphShape = "triangle-up" | "triangle-down" | "square" | "diamond" | "circle" | "cross";

export function glyphPath(shape: GlyphShape, x: number, y: number, size: number): string {
  const r = size / 2;
  switch (shape) {
    case "triangle-up":
      return `M${x},${y - r} L${x + r},${y + r} L${x - r},${y + r} Z`;
    case "triangle-down":
      return `M${x},${y + r} L${x + r},${y - r} L${x - r},${y - r} Z`;
    case "square":
      return `M${x - r * 0.8},${y - r * 0.8} h${r * 1.6} v${r * 1.6} h${-r * 1.6} Z`;
    case "diamond":
      return `M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`;
    case "cross":
      return `M${x - r},${y - r} L${x + r},${y + r} M${x + r},${y - r} L${x - r},${y + r}`;
    default:
      return `M${x - r},${y} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
  }
}

export function Glyph({ shape, color, hollow = false, size = 10 }: { shape: GlyphShape; color: string; hollow?: boolean; size?: number }) {
  const cross = shape === "cross";
  return (
    <svg width={size + 2} height={size + 2} className="inline-block align-middle" aria-hidden="true">
      <path
        d={glyphPath(shape, (size + 2) / 2, (size + 2) / 2, size)}
        fill={hollow || cross ? "none" : color}
        stroke={color}
        strokeWidth={cross || hollow ? 1.6 : 0.8}
      />
    </svg>
  );
}

export function LegendRow({ items }: { items: ReadonlyArray<{ label: string; color: string; shape?: GlyphShape; hollow?: boolean; dash?: boolean }> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-300">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1">
          {item.shape ? (
            <Glyph shape={item.shape} color={item.color} hollow={item.hollow} />
          ) : (
            <svg width="18" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="18" y2="4" stroke={item.color} strokeWidth="2" strokeDasharray={item.dash ? "4 3" : undefined} />
            </svg>
          )}
          {item.label}
        </span>
      ))}
    </div>
  );
}

// ── hover readout ───────────────────────────────────────────────────────────

export function Readout({ lines }: { lines: ReadonlyArray<ReactNode> }) {
  return (
    <div className="pointer-events-none rounded border border-neutral-700 bg-neutral-950/95 px-2 py-1 font-mono text-[11px] leading-snug text-neutral-200 shadow-lg">
      {lines.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </div>
  );
}

// ── dot and whisker ─────────────────────────────────────────────────────────

export interface WhiskerRow {
  key: string;
  label: string;
  value: number | null;
  low: number | null;
  high: number | null;
  color: string;
  shape: GlyphShape;
  hollow?: boolean;
  /** Short vertical marks on the row (a threshold, a base rate). */
  ticks?: Array<{ value: number; color: string }>;
  /** A second dot on the same row, drawn below the first (present vs absent). */
  second?: { value: number | null; low: number | null; high: number | null; color: string; shape: GlyphShape; hollow?: boolean };
  details: ReactNode[];
}

export function DotWhisker({
  rows, domain, axisLabel, references = [], band, rowHeight = 16, labelWidth = 220, format = (v) => fmt(v, 3),
}: {
  rows: readonly WhiskerRow[];
  domain?: [number, number];
  axisLabel: string;
  references?: Array<{ value: number; color: string; dash?: boolean }>;
  band?: [number, number];
  rowHeight?: number;
  labelWidth?: number;
  format?: (value: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ row: WhiskerRow; y: number } | null>(null);
  const values: number[] = [];
  for (const row of rows) {
    for (const value of [row.value, row.low, row.high, row.second?.value, row.second?.low, row.second?.high, ...(row.ticks ?? []).map((tick) => tick.value)]) {
      if (value !== null && value !== undefined && Number.isFinite(value)) values.push(value);
    }
  }
  for (const reference of references) values.push(reference.value);
  if (band) values.push(band[0], band[1]);
  let [low, high] = domain ?? [Math.min(...values, 0), Math.max(...values, 0)];
  if (!Number.isFinite(low) || !Number.isFinite(high) || low === high) [low, high] = [low - 1, high + 1];
  const pad = domain ? 0 : (high - low) * 0.04;
  low -= pad;
  high += pad;
  const label = Math.min(labelWidth, Math.max(90, width * 0.38));
  const plot = Math.max(40, width - label - 12);
  const x = (value: number) => label + ((Math.min(Math.max(value, low), high) - low) / (high - low)) * plot;
  const height = rows.length * rowHeight + 30;
  const ticks = Array.from({ length: 5 }, (_, index) => low + ((high - low) * index) / 4);

  return (
    <div ref={ref} className="relative min-w-0" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={axisLabel}>
          {band && <rect x={x(band[0])} y={0} width={Math.max(1, x(band[1]) - x(band[0]))} height={rows.length * rowHeight} fill={OKABE.grey} opacity={0.2} />}
          {references.map((reference) => (
            <line key={`${reference.value}-${reference.color}`} x1={x(reference.value)} x2={x(reference.value)} y1={0} y2={rows.length * rowHeight} stroke={reference.color} strokeDasharray={reference.dash ? "4 3" : undefined} />
          ))}
          {rows.map((row, index) => {
            const y = index * rowHeight + rowHeight / 2;
            const offset = row.second ? rowHeight * 0.2 : 0;
            return (
              <g key={row.key} onMouseEnter={() => setHover({ row, y })}>
                <rect x={0} y={index * rowHeight} width={width} height={rowHeight} fill={hover?.row.key === row.key ? "rgba(255,255,255,0.05)" : "transparent"} />
                <text x={label - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="#cfcfcf">
                  {row.label.length > 48 ? `${row.label.slice(0, 47)}…` : row.label}
                </text>
                {(row.ticks ?? []).map((tick, tickIndex) => (
                  <line key={tickIndex} x1={x(tick.value)} x2={x(tick.value)} y1={y - rowHeight * 0.4} y2={y + rowHeight * 0.4} stroke={tick.color} strokeWidth={2} />
                ))}
                {row.low !== null && row.high !== null && <line x1={x(row.low)} x2={x(row.high)} y1={y - offset} y2={y - offset} stroke={row.color} strokeWidth={2} opacity={0.9} />}
                {row.value !== null && (
                  <path d={glyphPath(row.shape, x(row.value), y - offset, 9)} fill={row.hollow ? "#111" : row.color} stroke={row.color} strokeWidth={1.4} />
                )}
                {row.second && row.second.low !== null && row.second.high !== null && (
                  <line x1={x(row.second.low)} x2={x(row.second.high)} y1={y + offset} y2={y + offset} stroke={row.second.color} strokeWidth={2} opacity={0.9} />
                )}
                {row.second && row.second.value !== null && (
                  <path d={glyphPath(row.second.shape, x(row.second.value), y + offset, 8)} fill={row.second.hollow ? "#111" : row.second.color} stroke={row.second.color} strokeWidth={1.4} />
                )}
              </g>
            );
          })}
          <line x1={label} x2={label + plot} y1={rows.length * rowHeight + 2} y2={rows.length * rowHeight + 2} stroke="#555" />
          {ticks.map((tick) => (
            <text key={tick} x={x(tick)} y={rows.length * rowHeight + 14} fontSize={9} fill="#9a9a9a" textAnchor="middle">
              {format(tick)}
            </text>
          ))}
          <text x={label + plot / 2} y={rows.length * rowHeight + 27} fontSize={10} fill="#bdbdbd" textAnchor="middle">
            {axisLabel}
          </text>
        </svg>
      )}
      {hover && (
        <div className="absolute z-10" style={{ left: Math.min(label + 8, Math.max(0, width - 300)), top: hover.y + 10 }}>
          <Readout lines={[<strong key="label">{hover.row.label}</strong>, ...hover.row.details]} />
        </div>
      )}
    </div>
  );
}

// ── small histograms ────────────────────────────────────────────────────────

export interface HistogramSeries {
  /** Heights, one per bin (counts or shares). */
  heights: readonly number[];
  color: string;
  style: "fill" | "outline";
  label: string;
}

/**
 * One small histogram: bins between `edges` (length bins + 1), one or more
 * series drawn filled or as an outline, an optional shaded band and a dashed
 * rule. Hover names the bin and every series' height.
 */
export function MiniHistogram({
  edges, series, band, rule, height = 110, logScale = false, formatEdge = (v) => fmt(v, 3), formatHeight = (v) => fmt(v, 3), title, subtitle,
}: {
  edges: readonly number[];
  series: readonly HistogramSeries[];
  band?: [number, number] | null;
  rule?: number | null;
  height?: number;
  logScale?: boolean;
  formatEdge?: (value: number) => string;
  formatHeight?: (value: number) => string;
  title?: string;
  subtitle?: ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hoverBin, setHoverBin] = useState<number | null>(null);
  const bins = Math.max(0, edges.length - 1);
  const low = edges[0] ?? 0;
  const high = edges[bins] ?? 1;
  const span = high - low || 1;
  const transform = (value: number) => (logScale ? Math.log10(value + 1) : value);
  const top = Math.max(1e-12, ...series.flatMap((entry) => entry.heights.map(transform)));
  const plotHeight = height - 18;
  const x = (value: number) => ((Math.min(Math.max(value, low), high) - low) / span) * width;
  const y = (value: number) => plotHeight - (transform(value) / top) * (plotHeight - 4);
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      {title && <div className="truncate text-[11px] font-medium text-neutral-200" title={title}>{title}</div>}
      {subtitle && <div className="text-[10px] leading-snug text-neutral-400">{subtitle}</div>}
      <div ref={ref} className="relative mt-1" onMouseLeave={() => setHoverBin(null)}>
        {width > 0 && bins > 0 && (
          <svg
            width={width}
            height={height}
            onMouseMove={(event) => {
              const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
              const position = low + ((event.clientX - box.left) / width) * span;
              let bin = bins - 1;
              for (let index = 0; index < bins; index += 1) {
                if (position < (edges[index + 1] as number)) {
                  bin = index;
                  break;
                }
              }
              setHoverBin(bin);
            }}
          >
            {band && <rect x={x(band[0])} y={0} width={Math.max(0, x(band[1]) - x(band[0]))} height={plotHeight} fill={OKABE.yellow} opacity={0.3} />}
            {series.map((entry) =>
              entry.heights.map((value, index) => {
                const left = x(edges[index] as number);
                const right = x(edges[index + 1] as number);
                const top = y(value);
                return (
                  <rect
                    key={`${entry.label}-${index}`}
                    x={left}
                    y={top}
                    width={Math.max(0.5, right - left - (entry.style === "fill" ? 0.5 : 0))}
                    height={Math.max(0, plotHeight - top)}
                    fill={entry.style === "fill" ? entry.color : "none"}
                    fillOpacity={entry.style === "fill" ? 0.55 : 0}
                    stroke={entry.style === "outline" ? entry.color : "none"}
                    strokeWidth={entry.style === "outline" ? 1.4 : 0}
                  />
                );
              }),
            )}
            {rule !== null && rule !== undefined && Number.isFinite(rule) && (
              <line x1={x(rule)} x2={x(rule)} y1={0} y2={plotHeight} stroke="#f5f5f5" strokeWidth={1.8} strokeDasharray="5 3" />
            )}
            {hoverBin !== null && <rect x={x(edges[hoverBin] as number)} y={0} width={Math.max(1, x(edges[hoverBin + 1] as number) - x(edges[hoverBin] as number))} height={plotHeight} fill="#fff" opacity={0.07} />}
            <line x1={0} x2={width} y1={plotHeight} y2={plotHeight} stroke="#555" />
            <text x={0} y={height - 3} fontSize={9} fill="#9a9a9a">{formatEdge(low)}</text>
            <text x={width} y={height - 3} fontSize={9} fill="#9a9a9a" textAnchor="end">{formatEdge(high)}</text>
          </svg>
        )}
        {hoverBin !== null && (
          <div className="absolute right-0 top-0 z-10">
            <Readout
              lines={[
                `${formatEdge(edges[hoverBin] as number)} to ${formatEdge(edges[hoverBin + 1] as number)}`,
                ...series.map((entry) => `${entry.label}: ${formatHeight(entry.heights[hoverBin] ?? 0)}`),
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function uniformEdges(low: number, high: number, bins: number): number[] {
  return Array.from({ length: bins + 1 }, (_, index) => low + ((high - low) * index) / bins);
}

// ── canvas matrix ───────────────────────────────────────────────────────────

/** Blue (−) → near-white (0) → orange (+), for a value already scaled to [−1, 1]. */
export function divergingColor(scaled: number): string {
  const t = Math.max(-1, Math.min(1, scaled));
  const mix = (a: number[], b: number[], s: number) => a.map((value, index) => Math.round(value + ((b[index] as number) - value) * s));
  const white = [247, 247, 247];
  const [r, g, b] = t < 0 ? mix(white, [0, 114, 178], -t) : mix(white, [230, 159, 0], t);
  return `rgb(${r},${g},${b})`;
}

/** cividis, sampled at five stops and interpolated, for a value in [0, 1]. */
export function cividisColor(t: number): string {
  const stops = [[0, 34, 78], [65, 77, 107], [124, 123, 120], [187, 175, 113], [255, 234, 70]];
  const position = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  const s = position - index;
  const a = stops[index] as number[];
  const b = stops[index + 1] as number[];
  return `rgb(${a.map((value, channel) => Math.round(value + ((b[channel] as number) - value) * s)).join(",")})`;
}

export interface MatrixCell {
  color: string | null;
  opacity?: number;
  glyph?: GlyphShape | null;
}

/**
 * A canvas matrix (a 165 × 165 correlation matrix is 27,225 cells, too many
 * SVG nodes for a side panel). Hover reports the cell, click selects it.
 */
export function MatrixCanvas({
  rowLabels, columnLabels, cell, onHover, onSelect, selected, labelSpace = 150, maximumCell = 22, rotateColumns = true, columnLabelSpace,
}: {
  rowLabels: readonly string[];
  columnLabels: readonly string[];
  cell: (row: number, column: number) => MatrixCell;
  onHover?: (position: { row: number; column: number } | null) => void;
  onSelect?: (position: { row: number; column: number }) => void;
  selected?: { row: number; column: number } | null;
  labelSpace?: number;
  maximumCell?: number;
  rotateColumns?: boolean;
  columnLabelSpace?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rows = rowLabels.length;
  const columns = columnLabels.length;
  const size = Math.max(2, Math.min(maximumCell, Math.floor((width - labelSpace - 4) / Math.max(1, columns))));
  const top = columnLabelSpace ?? (rotateColumns ? labelSpace : 20);
  const canvasWidth = labelSpace + columns * size + 4;
  const canvasHeight = top + rows * size + 4;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * ratio;
    canvas.height = canvasHeight * ratio;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const value = cell(row, column);
        if (!value.color) continue;
        context.globalAlpha = value.opacity ?? 1;
        context.fillStyle = value.color;
        context.fillRect(labelSpace + column * size, top + row * size, size - (size > 6 ? 0.5 : 0), size - (size > 6 ? 0.5 : 0));
        if (value.glyph) {
          context.globalAlpha = 1;
          context.fillStyle = "#000";
          context.strokeStyle = "#fff";
          context.lineWidth = 0.8;
          const path = new Path2D(glyphPath(value.glyph, labelSpace + column * size + size / 2, top + row * size + size / 2, Math.max(4, size * 0.6)));
          context.fill(path);
          context.stroke(path);
        }
      }
    }
    context.globalAlpha = 1;
    const font = Math.max(6, Math.min(11, size - 1));
    context.font = `${font}px sans-serif`;
    context.fillStyle = "#cfcfcf";
    context.textAlign = "right";
    context.textBaseline = "middle";
    if (size >= 5) {
      rowLabels.forEach((label, row) => context.fillText(label.length > 34 ? `${label.slice(0, 33)}…` : label, labelSpace - 4, top + row * size + size / 2));
      columnLabels.forEach((label, column) => {
        context.save();
        context.translate(labelSpace + column * size + size / 2, top - 4);
        if (rotateColumns) context.rotate(-Math.PI / 2);
        context.textAlign = rotateColumns ? "left" : "center";
        context.fillText(label.length > 30 ? `${label.slice(0, 29)}…` : label, 0, 0);
        context.restore();
      });
    }
    if (selected) {
      context.strokeStyle = "#ffffff";
      context.lineWidth = 1.5;
      context.strokeRect(labelSpace + selected.column * size, top + selected.row * size, size, size);
    }
  });

  const locate = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const column = Math.floor((event.clientX - box.left - labelSpace) / size);
    const row = Math.floor((event.clientY - box.top - top) / size);
    if (row < 0 || column < 0 || row >= rows || column >= columns) return null;
    return { row, column };
  };

  return (
    <div ref={ref} className="min-w-0 overflow-x-auto">
      {width > 0 && (
        <canvas
          ref={canvasRef}
          style={{ width: canvasWidth, height: canvasHeight, cursor: onSelect ? "pointer" : "default" }}
          onMouseMove={(event) => onHover?.(locate(event))}
          onMouseLeave={() => onHover?.(null)}
          onClick={(event) => {
            const position = locate(event);
            if (position) onSelect?.(position);
          }}
        />
      )}
    </div>
  );
}

// ── canvas scatter ──────────────────────────────────────────────────────────

export function ScatterCanvas({
  points, xLabel, yLabel, color = OKABE.orange, height = 360, describe,
}: {
  points: ReadonlyArray<readonly [number, number, number]>;
  xLabel: string;
  yLabel: string;
  color?: string;
  height?: number;
  describe: (point: readonly [number, number, number]) => ReactNode[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ point: readonly [number, number, number]; left: number; top: number } | null>(null);
  const margin = { left: 56, right: 10, top: 8, bottom: 36 };
  let xLow = Infinity, xHigh = -Infinity, yLow = Infinity, yHigh = -Infinity;
  for (const [a, b] of points) {
    if (a < xLow) xLow = a;
    if (a > xHigh) xHigh = a;
    if (b < yLow) yLow = b;
    if (b > yHigh) yHigh = b;
  }
  if (!Number.isFinite(xLow)) [xLow, xHigh, yLow, yHigh] = [0, 1, 0, 1];
  if (xLow === xHigh) [xLow, xHigh] = [xLow - 1, xHigh + 1];
  if (yLow === yHigh) [yLow, yHigh] = [yLow - 1, yHigh + 1];
  const plotWidth = Math.max(10, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const px = (value: number) => margin.left + ((value - xLow) / (xHigh - xLow)) * plotWidth;
  const py = (value: number) => margin.top + plotHeight - ((value - yLow) / (yHigh - yLow)) * plotHeight;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = "#555";
    context.strokeRect(margin.left, margin.top, plotWidth, plotHeight);
    context.fillStyle = color;
    context.globalAlpha = points.length > 5000 ? 0.3 : 0.55;
    for (const [a, b] of points) {
      context.beginPath();
      context.arc(px(a), py(b), 1.6, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    context.fillStyle = "#9a9a9a";
    context.font = "9px sans-serif";
    for (let index = 0; index <= 4; index += 1) {
      const xv = xLow + ((xHigh - xLow) * index) / 4;
      const yv = yLow + ((yHigh - yLow) * index) / 4;
      context.textAlign = "center";
      context.fillText(fmt(xv, Math.abs(xv) < 1 ? 4 : 2), px(xv), margin.top + plotHeight + 12);
      context.textAlign = "right";
      context.fillText(fmt(yv, Math.abs(yv) < 1 ? 4 : 2), margin.left - 4, py(yv) + 3);
    }
    context.fillStyle = "#cfcfcf";
    context.font = "10px sans-serif";
    context.textAlign = "center";
    context.fillText(xLabel, margin.left + plotWidth / 2, height - 6);
    context.save();
    context.translate(10, margin.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(yLabel, 0, 0);
    context.restore();
  });

  return (
    <div ref={ref} className="relative min-w-0" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <canvas
          ref={canvasRef}
          style={{ width, height }}
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const mx = event.clientX - box.left;
            const my = event.clientY - box.top;
            let best: readonly [number, number, number] | null = null;
            let bestDistance = 64;
            for (const point of points) {
              const dx = px(point[0]) - mx;
              const dy = py(point[1]) - my;
              const distance = dx * dx + dy * dy;
              if (distance < bestDistance) {
                bestDistance = distance;
                best = point;
              }
            }
            setHover(best ? { point: best, left: mx, top: my } : null);
          }}
        />
      )}
      {hover && (
        <div className="absolute z-10" style={{ left: Math.min(hover.left + 10, Math.max(0, width - 260)), top: hover.top + 10 }}>
          <Readout lines={describe(hover.point)} />
        </div>
      )}
    </div>
  );
}

// ── table ───────────────────────────────────────────────────────────────────

export interface Column<Row> {
  key: string;
  label: string;
  value: (row: Row) => string | number | boolean | null | undefined;
  format?: (value: unknown, row: Row) => ReactNode;
  numeric?: boolean;
}

function defaultFormat(value: unknown): ReactNode {
  if (value === null || value === undefined) return <span className="text-neutral-600">—</span>;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (Number.isInteger(value)) return value.toLocaleString("en-US");
    const magnitude = Math.abs(value);
    return magnitude !== 0 && (magnitude < 0.001 || magnitude >= 1e7) ? value.toExponential(3) : value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

/** A sortable, paged table; every column named in full. */
export function DataTable<Row>({ rows, columns, pageSize = 15, initialSort, rowKey }: {
  rows: readonly Row[];
  columns: ReadonlyArray<Column<Row>>;
  pageSize?: number;
  initialSort?: { key: string; descending?: boolean };
  rowKey: (row: Row, index: number) => string;
}) {
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(initialSort ? { key: initialSort.key, descending: initialSort.descending ?? false } : null);
  const [page, setPage] = useState(0);
  const column = sort ? columns.find((entry) => entry.key === sort.key) : undefined;
  const sorted = column
    ? [...rows].sort((a, b) => {
        const va = column.value(a);
        const vb = column.value(b);
        if (va === vb) return 0;
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        const order = va < vb ? -1 : 1;
        return sort?.descending ? -order : order;
      })
    : [...rows];
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = sorted.slice(current * pageSize, current * pageSize + pageSize);
  return (
    <div className="min-w-0 space-y-1">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-500">
              {columns.map((entry) => (
                <th
                  key={entry.key}
                  className={`cursor-pointer whitespace-nowrap px-1.5 py-1 font-normal hover:text-neutral-200 ${entry.numeric ? "text-right" : "text-left"}`}
                  onClick={() => setSort((previous) => ({ key: entry.key, descending: previous?.key === entry.key ? !previous.descending : false }))}
                >
                  {entry.label}
                  {sort?.key === entry.key ? (sort.descending ? " ▼" : " ▲") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={rowKey(row, index)} className="border-b border-neutral-900 hover:bg-neutral-900/60">
                {columns.map((entry) => {
                  const value = entry.value(row);
                  return (
                    <td key={entry.key} className={`whitespace-nowrap px-1.5 py-0.5 ${entry.numeric ? "text-right font-mono tnum" : ""} text-neutral-200`}>
                      {entry.format ? entry.format(value, row) : defaultFormat(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border border-neutral-700 px-2 disabled:opacity-40">previous</button>
          <span>page {current + 1} of {pages} · {sorted.length.toLocaleString("en-US")} rows</span>
          <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="rounded border border-neutral-700 px-2 disabled:opacity-40">next</button>
        </div>
      )}
    </div>
  );
}

/** Columns for every key of the first row, names as the lake holds them. */
export function columnsOf(rows: ReadonlyArray<Record<string, unknown>>, formats: Record<string, (value: unknown) => ReactNode> = {}): Array<Column<Record<string, unknown>>> {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).map((key) => ({
    key,
    label: key,
    value: (row: Record<string, unknown>) => row[key] as string | number | boolean | null,
    numeric: typeof first[key] === "number",
    format: formats[key] ? (value: unknown) => (formats[key] as (value: unknown) => ReactNode)(value) : undefined,
  }));
}
