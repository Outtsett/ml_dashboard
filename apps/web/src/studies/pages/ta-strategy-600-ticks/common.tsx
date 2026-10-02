/**
 * Shared pieces of the TA-strategy study: the data hook, tables, the server-profiled column grid, the
 * cumulative-series chart, and three SVG charts drawn here because Recharts cannot put what the notebook
 * layered on one axis: horizontal interval bars with ticks and glyphs, grouped vertical bars with whiskers,
 * and a session price chart with bands, level segments and trade glyphs. Colours are Okabe-Ito and every
 * colour is paired with a glyph, a dash or a label.
 */

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Empty, GRID, OKABE, SliderControl, SwitchControl, TOOLTIP, fmt, fmtInt, useStudyQuery,
} from "@/studies/kit";
import type { ColumnProfile, Row, SeriesSet, TaStrategyPart } from "@shared/studies/ta-strategy-600-ticks";

export const SLUG = "ta-strategy-600-ticks";
export const BLACK = "#e5e5e5";          // the notebook's black marks, drawn light on the dark page
export const PALETTE = [OKABE.blue, OKABE.orange, OKABE.sky, OKABE.vermillion, OKABE.green, OKABE.purple, BLACK, OKABE.yellow] as const;
export const DASHES = ["", "6 3", "2 3", "8 3 2 3", "1 2", "10 4", "4 4", "3 6"] as const;

export type Params = Record<string, string | number | boolean | null | undefined>;

/** One part of the study's endpoint; the previous body stays on screen while a control moves. */
export function useTa<T>(part: TaStrategyPart, params: Params = {}, enabled = true) {
  return useStudyQuery<T>(SLUG, { part, ...params }, { enabled });
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function colourAt(index: number): string {
  return PALETTE[index % PALETTE.length] as string;
}

export function dashAt(index: number): string {
  return DASHES[Math.floor(index / PALETTE.length) % DASHES.length] as string;
}

export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && Math.abs(next - width) > 1) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  });
  return [ref, width];
}

/** A small labelled toggle group for several values (timeframes, families, events). */
export function ChipSelect({ label, options, selected, onChange }: {
  label: string; options: readonly string[]; selected: readonly string[]; onChange: (next: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const on = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((item) => item !== option) : [...selected, option])}
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${on ? "border-neutral-500 bg-neutral-700 text-neutral-50" : "border-neutral-800 text-neutral-500 hover:border-neutral-600"}`}
            >
              {on ? "✓ " : ""}{option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (Number.isInteger(value) && Math.abs(value) < 1e12) return value.toLocaleString("en-US");
    return Math.abs(value) >= 1000 ? fmt(value, 1) : fmt(value, Math.abs(value) < 1 ? 4 : 2);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** A paged table of rows, every column shown by its full name; long text is clipped with a hover title. */
export function DataTable({ rows, columns, pageSize = 12, caption }: { rows: readonly Row[]; columns?: readonly string[]; pageSize?: number; caption?: string }) {
  const [page, setPage] = useState(0);
  if (rows.length === 0) return <Empty>No rows.</Empty>;
  const names = columns ?? Object.keys(rows[0] as Row);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * pageSize, (current + 1) * pageSize);
  return (
    <div className="min-w-0 space-y-1">
      {caption && <p className="text-[11px] text-neutral-400">{caption}</p>}
      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-[11px]">
          <thead className="bg-neutral-900/80 text-neutral-400">
            <tr>
              {names.map((name) => (
                <th key={name} className="whitespace-nowrap px-2 py-1 text-left font-normal">{name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={index} className="border-t border-neutral-900 hover:bg-neutral-900/60">
                {names.map((name) => {
                  const text = cell(row[name]);
                  return (
                    <td key={name} title={text.length > 40 ? text : undefined}
                      className={`max-w-[28rem] truncate px-2 py-0.5 ${typeof row[name] === "number" ? "text-right font-mono tnum text-neutral-200" : "text-neutral-300"}`}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 text-[10px] text-neutral-500">
          <button type="button" className="rounded border border-neutral-800 px-1.5 hover:border-neutral-600" onClick={() => setPage(Math.max(0, current - 1))}>‹ previous</button>
          <span>page {current + 1} of {pages} · {fmtInt(rows.length)} rows</span>
          <button type="button" className="rounded border border-neutral-800 px-1.5 hover:border-neutral-600" onClick={() => setPage(Math.min(pages - 1, current + 1))}>next ›</button>
        </div>
      )}
    </div>
  );
}

const SUMMARY: Array<[keyof ColumnProfile, string]> = [
  ["mean", "mean"], ["median", "median"], ["standardDeviation", "standard deviation"], ["skewness", "skewness"], ["kurtosis", "excess kurtosis"],
  ["percentile25", "25th percentile"], ["percentile75", "75th percentile"], ["minimum", "minimum"], ["maximum", "maximum"],
];

/**
 * Every column of a large frame, profiled on the server (eight numbers + histogram, bin count from the page's
 * Bins control): one panel per column, full column name as its title. Skewness and excess kurtosis are the
 * sample-adjusted estimates (DuckDB's), not scipy's biased ones the notebook printed.
 */
export function ProfileGrid({ profiles, title, bins, onBins, rowCount }: {
  profiles: readonly ColumnProfile[]; title: string; bins: number; onBins: (bins: number) => void; rowCount?: number;
}) {
  const [logScale, setLogScale] = useState(false);
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<"name" | "spread">("name");
  const shown = profiles.filter((profile) => profile.column.toLowerCase().includes(filter.toLowerCase()));
  shown.sort((a, b) => (order === "name" ? a.column.localeCompare(b.column) : (b.standardDeviation ?? 0) - (a.standardDeviation ?? 0)));
  return (
    <div className="space-y-2">
      <ControlBar>
        <span className="self-center text-xs font-semibold text-neutral-200">{title}{rowCount !== undefined ? ` · ${fmtInt(rowCount)} rows` : ""}</span>
        <SliderControl label="Bins" value={bins} min={5} max={80} onChange={onBins} hint="Re-bins on the server" />
        <SwitchControl label="Log counts" checked={logScale} onChange={setLogScale} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Sort</span>
          <select value={order} onChange={(event) => setOrder(event.target.value as "name" | "spread")}
            className="h-7 rounded border border-neutral-700 bg-neutral-950 px-1 text-xs text-neutral-200">
            <option value="name">name</option>
            <option value="spread">spread</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Filter</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="column name"
            className="h-7 w-40 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" />
        </label>
      </ControlBar>
      <p className="text-[10px] text-neutral-500">Skewness and excess kurtosis are the sample-adjusted estimates (the notebook printed scipy's biased ones, so those two differ slightly); the other six numbers match.</p>
      {shown.length === 0 ? <Empty>No numeric column.</Empty> : (
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
          {shown.map((profile) => <ProfilePanel key={profile.column} profile={profile} logScale={logScale} />)}
        </div>
      )}
    </div>
  );
}

function ProfilePanel({ profile, logScale }: { profile: ColumnProfile; logScale: boolean }) {
  const height = 70;
  const peak = Math.max(1, ...profile.bins.map((bin) => (logScale ? Math.log10(bin.count + 1) : bin.count)));
  const width = 100 / Math.max(1, profile.bins.length);
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={profile.column}>{profile.column}</div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-[70px] w-full">
        {profile.bins.map((bin, index) => {
          const value = logScale ? Math.log10(bin.count + 1) : bin.count;
          const barHeight = (value / peak) * (height - 2);
          return (
            <rect key={index} x={index * width} y={height - barHeight} width={Math.max(width - 0.3, 0.2)} height={barHeight} fill={OKABE.sky}>
              <title>{`${fmt(bin.lower, 4)} to ${fmt(bin.upper, 4)}: ${fmtInt(bin.count)} rows`}</title>
            </rect>
          );
        })}
      </svg>
      <dl className="mt-1 grid grid-cols-1 text-[10px] font-mono tnum">
        <div className="flex justify-between gap-1">
          <dt className="text-neutral-500">count</dt>
          <dd className="text-neutral-200">{fmtInt(profile.count)}</dd>
        </div>
        {SUMMARY.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-1">
            <dt className="text-neutral-500">{label}</dt>
            <dd className="text-neutral-200">{fmt(profile[key] as number | null, 3)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Cumulative daily lines, one per series, colour and dash both varying so no line needs colour alone. */
export function SeriesLines({ set, height = 260, yLabel, extra }: {
  set: SeriesSet; height?: number; yLabel: string; extra?: { name: string; values: Array<number | null>; colour: string };
}) {
  if (set.dates.length === 0) return <Empty>No daily rows.</Empty>;
  const series = extra ? [...set.series, { name: extra.name, values: extra.values }] : set.series;
  const step = Math.max(1, Math.floor(set.dates.length / 1500));
  const data: Row[] = [];
  for (let index = 0; index < set.dates.length; index += step) {
    const row: Row = { session_date: set.dates[index] };
    for (const entry of series) row[entry.name] = entry.values[index] ?? null;
    data.push(row);
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="session_date" {...AXIS} minTickGap={40} />
        <YAxis {...AXIS} width={62} tickFormatter={(value: number) => fmtInt(value)} label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "#8a8a8a", fontSize: 10 }} />
        <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 1)} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {series.map((entry, index) => {
          const isExtra = extra && entry.name === extra.name;
          return (
            <Line key={entry.name} dataKey={entry.name} dot={false} isAnimationActive={false} connectNulls
              stroke={isExtra ? extra.colour : colourAt(index)} strokeWidth={isExtra ? 2.5 : 1.3} strokeDasharray={isExtra ? undefined : dashAt(index) || (index % 2 ? "5 2" : undefined)} />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── glyphs ───────────────────────────────────────────────────────────────────

export type Glyph = "circle" | "triangle-up" | "triangle-down" | "triangle-right" | "diamond" | "square" | "cross" | "tick" | "vtick";

export function GlyphMark({ glyph, x, y, size = 5, colour, filled = true, strokeWidth = 1.5, title }: {
  glyph: Glyph; x: number; y: number; size?: number; colour: string; filled?: boolean; strokeWidth?: number; title?: string;
}) {
  const fill = filled ? colour : "none";
  const common = { fill, stroke: colour, strokeWidth };
  const tip = title ? <title>{title}</title> : null;
  const s = size;
  switch (glyph) {
    case "triangle-up":
      return <polygon points={`${x},${y - s} ${x - s},${y + s * 0.8} ${x + s},${y + s * 0.8}`} {...common}>{tip}</polygon>;
    case "triangle-down":
      return <polygon points={`${x},${y + s} ${x - s},${y - s * 0.8} ${x + s},${y - s * 0.8}`} {...common}>{tip}</polygon>;
    case "triangle-right":
      return <polygon points={`${x + s},${y} ${x - s * 0.8},${y - s} ${x - s * 0.8},${y + s}`} {...common}>{tip}</polygon>;
    case "diamond":
      return <polygon points={`${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`} {...common}>{tip}</polygon>;
    case "square":
      return <rect x={x - s * 0.8} y={y - s * 0.8} width={s * 1.6} height={s * 1.6} {...common}>{tip}</rect>;
    case "cross":
      return <g stroke={colour} strokeWidth={strokeWidth + 0.5}><line x1={x - s} y1={y - s} x2={x + s} y2={y + s} /><line x1={x - s} y1={y + s} x2={x + s} y2={y - s} />{tip}</g>;
    case "tick":
      return <line x1={x} y1={y - s * 1.4} x2={x} y2={y + s * 1.4} stroke={colour} strokeWidth={3}>{tip}</line>;
    case "vtick":
      return <line x1={x - s * 1.4} y1={y} x2={x + s * 1.4} y2={y} stroke={colour} strokeWidth={3}>{tip}</line>;
    default:
      return <circle cx={x} cy={y} r={s * 0.8} {...common}>{tip}</circle>;
  }
}

export function Key({ items }: { items: Array<{ label: string; colour: string; glyph?: Glyph; filled?: boolean; dash?: string }> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-neutral-400">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1">
          <svg width={item.dash !== undefined ? 22 : 12} height={12} aria-hidden="true">
            {item.dash !== undefined
              ? <line x1={1} y1={6} x2={21} y2={6} stroke={item.colour} strokeWidth={2} strokeDasharray={item.dash || undefined} />
              : <GlyphMark glyph={item.glyph ?? "square"} x={6} y={6} size={4.5} colour={item.colour} filled={item.filled ?? true} />}
          </svg>
          {item.label}
        </span>
      ))}
    </div>
  );
}

// ── scales ───────────────────────────────────────────────────────────────────

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
  for (let tick = Math.ceil(low / step) * step; tick <= high + step * 1e-9; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return ticks;
}

function extent(values: Array<number | null | undefined>, padFraction = 0.05): [number, number] {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) return [0, 1];
  let low = Math.min(...finite);
  let high = Math.max(...finite);
  if (low === high) { low -= 1; high += 1; }
  const pad = (high - low) * padFraction;
  return [low - pad, high + pad];
}

// ── horizontal interval bars ─────────────────────────────────────────────────

export interface HBarRow {
  label: string;
  bars?: Array<{ value: number | null; colour: string; name: string }>;
  low?: number | null;
  high?: number | null;
  marks?: Array<{ value: number | null; glyph: Glyph; colour: string; name: string; filled?: boolean }>;
  tooltip?: string;
}

/**
 * One row per label: grouped bars from zero, an optional whisker (low..high), and glyph marks (ticks, triangles,
 * diamonds) at their own values; vertical reference lines with labels. Hover a row for its exact numbers.
 */
export function HBarChart({ rows, references = [], xLabel, rowHeight = 18, labelWidth = 200, domain }: {
  rows: readonly HBarRow[]; references?: Array<{ value: number; colour: string; label: string; dash?: string }>; xLabel: string;
  rowHeight?: number; labelWidth?: number; domain?: [number, number];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (rows.length === 0) return <Empty>No rows.</Empty>;
  const values: Array<number | null | undefined> = [0, ...references.map((reference) => reference.value)];
  for (const row of rows) {
    for (const bar of row.bars ?? []) values.push(bar.value);
    for (const mark of row.marks ?? []) values.push(mark.value);
    values.push(row.low, row.high);
  }
  const [x0, x1] = domain ?? extent(values);
  const plotLeft = Math.min(labelWidth, width * 0.45);
  const plotRight = width - 12;
  const x = linear([x0, x1], [plotLeft, plotRight]);
  const clamp = (value: number) => Math.min(Math.max(value, x0), x1);
  const top = 6;
  const height = top + rows.length * rowHeight + 30;
  const ticks = niceTicks(x0, x1, Math.max(3, Math.floor((plotRight - plotLeft) / 80)));
  return (
    <div ref={ref} className="w-full min-w-0">
      <svg width={width} height={height} className="block">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={top} y2={height - 26} stroke="#262626" />
            <text x={x(tick)} y={height - 14} textAnchor="middle" fontSize={9} fill="#8a8a8a">{fmt(tick, Math.abs(tick) < 1 && tick !== 0 ? 2 : 0)}</text>
          </g>
        ))}
        <text x={(plotLeft + plotRight) / 2} y={height - 2} textAnchor="middle" fontSize={10} fill="#a3a3a3">{xLabel}</text>
        {rows.map((row, index) => {
          const y = top + index * rowHeight;
          const bars = row.bars ?? [];
          const band = (rowHeight - 4) / Math.max(1, bars.length);
          const mid = y + rowHeight / 2;
          return (
            <g key={`${row.label}-${index}`}>
              <title>{row.tooltip ?? row.label}</title>
              <rect x={0} y={y} width={width} height={rowHeight} fill="transparent" />
              <text x={plotLeft - 6} y={mid + 3} textAnchor="end" fontSize={10} fill="#d4d4d4">
                {row.label.length > 38 ? `${row.label.slice(0, 36)}…` : row.label}
              </text>
              {bars.map((bar, barIndex) => (bar.value === null ? null : (
                <rect key={bar.name} x={Math.min(x(0), x(clamp(bar.value)))} y={y + 2 + barIndex * band}
                  width={Math.max(1, Math.abs(x(clamp(bar.value)) - x(0)))} height={Math.max(2, band - 1)} fill={bar.colour} opacity={0.85}>
                  <title>{`${row.label} · ${bar.name}: ${fmt(bar.value, 3)}`}</title>
                </rect>
              )))}
              {row.low !== null && row.low !== undefined && row.high !== null && row.high !== undefined && (
                <g stroke={BLACK} strokeWidth={1.2}>
                  <line x1={x(clamp(row.low))} x2={x(clamp(row.high))} y1={mid} y2={mid} />
                  <line x1={x(clamp(row.low))} x2={x(clamp(row.low))} y1={mid - 3} y2={mid + 3} />
                  <line x1={x(clamp(row.high))} x2={x(clamp(row.high))} y1={mid - 3} y2={mid + 3} />
                </g>
              )}
              {(row.marks ?? []).map((mark) => (mark.value === null ? null : (
                <GlyphMark key={mark.name} glyph={mark.glyph} x={x(clamp(mark.value))} y={mid} size={4.5} colour={mark.colour} filled={mark.filled ?? true}
                  title={`${row.label} · ${mark.name}: ${fmt(mark.value, 3)}`} />
              )))}
            </g>
          );
        })}
        {references.map((reference) => (
          <g key={reference.label}>
            <line x1={x(reference.value)} x2={x(reference.value)} y1={top} y2={height - 26} stroke={reference.colour} strokeWidth={1.5} strokeDasharray={reference.dash} />
            <text x={x(reference.value) + 3} y={top + 8} fontSize={9} fill={reference.colour}>{reference.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── grouped vertical bars ────────────────────────────────────────────────────

export interface GroupedBar {
  category: string;
  group: string;
  value: number | null;
  low?: number | null;
  high?: number | null;
  tick?: number | null;
  marker?: { glyph: Glyph; at: number | null; filled?: boolean } | null;
  tooltip?: string;
}

/** Bars by category, one per group side by side, with optional whiskers, a black tick and a glyph per bar. */
export function GroupedBars({ bars, groups, colourOf, yLabel, height = 240, references = [], percent = false, signColoured = false }: {
  bars: readonly GroupedBar[]; groups: readonly string[]; colourOf: (group: string) => string; yLabel: string; height?: number;
  references?: Array<{ value: number; colour: string; label: string; dash?: string }>; percent?: boolean; signColoured?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (bars.length === 0) return <Empty>No rows.</Empty>;
  const categories = [...new Set(bars.map((bar) => bar.category))];
  const [y0, y1] = extent([0, ...bars.flatMap((bar) => [bar.value, bar.low, bar.high, bar.tick, bar.marker?.at]), ...references.map((reference) => reference.value)]);
  const left = 54;
  const bottom = 36;
  const plotWidth = width - left - 8;
  const y = linear([y0, y1], [height - bottom, 8]);
  const slot = plotWidth / categories.length;
  const barWidth = Math.max(2, (slot * 0.8) / Math.max(1, groups.length));
  const format = (value: number) => (percent ? `${(value * 100).toFixed(Math.abs(value) < 0.1 ? 1 : 0)}%` : fmt(value, Math.abs(value) < 10 ? 2 : 0));
  return (
    <div ref={ref} className="w-full min-w-0">
      <svg width={width} height={height} className="block">
        {niceTicks(y0, y1, 5).map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - 8} y1={y(tick)} y2={y(tick)} stroke="#262626" />
            <text x={left - 4} y={y(tick) + 3} textAnchor="end" fontSize={9} fill="#8a8a8a">{format(tick)}</text>
          </g>
        ))}
        <line x1={left} x2={width - 8} y1={y(0)} y2={y(0)} stroke="#737373" />
        <text x={10} y={height / 2} transform={`rotate(-90 10 ${height / 2})`} textAnchor="middle" fontSize={10} fill="#a3a3a3">{yLabel}</text>
        {categories.map((category, categoryIndex) => {
          const centre = left + slot * (categoryIndex + 0.5);
          return (
            <g key={category}>
              <text x={centre} y={height - bottom + 12} textAnchor="middle" fontSize={9} fill="#d4d4d4">
                {category.length > 16 ? `${category.slice(0, 15)}…` : category}
              </text>
              {groups.map((group, groupIndex) => {
                const bar = bars.find((entry) => entry.category === category && entry.group === group);
                if (!bar || bar.value === null) return null;
                const xLeft = centre - (groups.length * barWidth) / 2 + groupIndex * barWidth;
                const xMid = xLeft + barWidth / 2;
                const colour = signColoured ? (bar.value >= 0 ? OKABE.orange : OKABE.blue) : colourOf(group);
                return (
                  <g key={group}>
                    <title>{bar.tooltip ?? `${category} · ${group}: ${format(bar.value)}`}</title>
                    <rect x={xLeft + 0.5} width={barWidth - 1} y={Math.min(y(0), y(bar.value))} height={Math.max(1, Math.abs(y(bar.value) - y(0)))} fill={colour} opacity={0.8} />
                    {signColoured && <text x={xMid} y={bar.value >= 0 ? y(bar.value) - 2 : y(bar.value) + 9} textAnchor="middle" fontSize={8} fill={colour}>{bar.value >= 0 ? "▲" : "▼"}</text>}
                    {bar.low !== null && bar.low !== undefined && bar.high !== null && bar.high !== undefined && (
                      <g stroke={BLACK} strokeWidth={1.3}>
                        <line x1={xMid} x2={xMid} y1={y(bar.low)} y2={y(bar.high)} />
                        <line x1={xMid - 3} x2={xMid + 3} y1={y(bar.low)} y2={y(bar.low)} />
                        <line x1={xMid - 3} x2={xMid + 3} y1={y(bar.high)} y2={y(bar.high)} />
                      </g>
                    )}
                    {bar.tick !== null && bar.tick !== undefined && <line x1={xLeft - 1} x2={xLeft + barWidth + 1} y1={y(bar.tick)} y2={y(bar.tick)} stroke={BLACK} strokeWidth={2.5} />}
                    {bar.marker && bar.marker.at !== null && <GlyphMark glyph={bar.marker.glyph} x={xMid} y={y(bar.marker.at)} size={4.5} colour={BLACK} filled={bar.marker.filled ?? true} />}
                  </g>
                );
              })}
            </g>
          );
        })}
        {references.map((reference) => (
          <g key={reference.label}>
            <line x1={left} x2={width - 8} y1={y(reference.value)} y2={y(reference.value)} stroke={reference.colour} strokeDasharray={reference.dash} strokeWidth={1.5} />
            <text x={width - 10} y={y(reference.value) - 3} textAnchor="end" fontSize={9} fill={reference.colour}>{reference.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── session price chart ──────────────────────────────────────────────────────

export interface Candle { t: number; open: number; high: number; low: number; close: number; widthMs: number; tooltip?: string }
export interface Band { x0: number; x1: number; y0: number; y1: number; colour: string; opacity?: number; tooltip?: string }
export interface Segment { x0: number; x1: number; y: number; colour: string; dash?: string; width?: number; tooltip?: string }
export interface Mark { x: number; y: number; glyph: Glyph; colour: string; filled?: boolean; size?: number; tooltip?: string; label?: string }
export interface VerticalBar { x: number; y0: number; y1: number; colour: string; width?: number; opacity?: number; tooltip?: string }

/** "HH:MM" of a stamp: the lake stamps futures in Pacific wall clock stored as UTC, so UTC digits are Pacific. */
export function clock(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(11, 16);
}

/**
 * The session views of sections 10, 13, 14 and 15: price (line or candles), shaded bands, level segments drawn
 * only while known and valid, vertical zone bars, trade and touch glyphs, and a cursor. The crosshair reads the
 * time (Pacific wall clock) and price under the pointer; every mark has a hover title with its exact values.
 */
export function SessionChart({ line = [], candles = [], bands = [], segments = [], marks = [], verticals = [], cursor, height = 380, yLabel = "price (back-adjusted points)", yPad = 0.05 }: {
  line?: Array<{ t: number; v: number }>; candles?: readonly Candle[]; bands?: readonly Band[]; segments?: readonly Segment[]; marks?: readonly Mark[];
  verticals?: readonly VerticalBar[]; cursor?: number | null; height?: number; yLabel?: string; yPad?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const clipId = `session-plot-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const times = [...line.map((point) => point.t), ...candles.flatMap((candle) => [candle.t, candle.t + candle.widthMs]),
    ...marks.map((mark) => mark.x), ...verticals.map((bar) => bar.x)];
  if (times.length === 0) return <Empty>No bars for this session.</Empty>;
  const prices = [...line.map((point) => point.v), ...candles.flatMap((candle) => [candle.low, candle.high]),
    ...marks.map((mark) => mark.y), ...verticals.flatMap((bar) => [bar.y0, bar.y1])];
  const [p0, p1] = extent(prices, yPad);
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const left = 58;
  const bottom = 24;
  const x = linear([t0, t1], [left, width - 8]);
  const y = linear([p0, p1], [height - bottom, 6]);
  const inTime = (value: number) => Math.min(Math.max(value, t0), t1);
  const visible = (value: number) => value >= p0 && value <= p1;
  const timeTicks = niceTicks(t0, t1, Math.max(3, Math.floor(width / 110)));
  const invertX = (px: number) => t0 + ((px - left) / Math.max(1, width - 8 - left)) * (t1 - t0);
  const invertY = (py: number) => p0 + ((height - bottom - py) / Math.max(1, height - bottom - 6)) * (p1 - p0);
  return (
    <div ref={ref} className="relative w-full min-w-0">
      <svg width={width} height={height} className="block"
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setPointer({ x: event.clientX - box.left, y: event.clientY - box.top });
        }}
        onMouseLeave={() => setPointer(null)}>
        <defs>
          <clipPath id={clipId}><rect x={left} y={0} width={Math.max(0, width - 8 - left)} height={height - bottom} /></clipPath>
        </defs>
        {niceTicks(p0, p1, 6).map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - 8} y1={y(tick)} y2={y(tick)} stroke="#1f1f1f" />
            <text x={left - 4} y={y(tick) + 3} textAnchor="end" fontSize={9} fill="#8a8a8a">{fmt(tick, 2)}</text>
          </g>
        ))}
        {timeTicks.map((tick) => (
          <text key={tick} x={x(tick)} y={height - 8} textAnchor="middle" fontSize={9} fill="#8a8a8a">{clock(tick)}</text>
        ))}
        <text x={10} y={(height - bottom) / 2} transform={`rotate(-90 10 ${(height - bottom) / 2})`} textAnchor="middle" fontSize={10} fill="#a3a3a3">{yLabel}</text>
        <g clipPath={`url(#${clipId})`}>
          {bands.map((band, index) => (
            <rect key={`band-${index}`} x={x(inTime(band.x0))} width={Math.max(0.5, x(inTime(band.x1)) - x(inTime(band.x0)))}
              y={y(Math.max(band.y0, band.y1))} height={Math.max(1, Math.abs(y(band.y0) - y(band.y1)))} fill={band.colour} opacity={band.opacity ?? 0.3}>
              {band.tooltip && <title>{band.tooltip}</title>}
            </rect>
          ))}
          {segments.filter((segment) => visible(segment.y)).map((segment, index) => (
            <line key={`segment-${index}`} x1={x(inTime(segment.x0))} x2={x(inTime(segment.x1))} y1={y(segment.y)} y2={y(segment.y)}
              stroke={segment.colour} strokeWidth={segment.width ?? 1.6} strokeDasharray={segment.dash} opacity={0.9}>
              {segment.tooltip && <title>{segment.tooltip}</title>}
            </line>
          ))}
          {candles.map((candle) => {
            const up = candle.close >= candle.open;
            const colour = up ? OKABE.orange : OKABE.blue;
            const xLeft = x(candle.t);
            const xRight = x(candle.t + candle.widthMs);
            const barWidth = Math.max(1, (xRight - xLeft) * 0.7);
            const mid = (xLeft + xRight) / 2;
            return (
              <g key={candle.t}>
                <title>{candle.tooltip ?? `${clock(candle.t)} O ${fmt(candle.open, 2)} H ${fmt(candle.high, 2)} L ${fmt(candle.low, 2)} C ${fmt(candle.close, 2)}`}</title>
                <line x1={mid} x2={mid} y1={y(candle.high)} y2={y(candle.low)} stroke={colour} />
                <rect x={mid - barWidth / 2} width={barWidth} y={y(Math.max(candle.open, candle.close))}
                  height={Math.max(1, Math.abs(y(candle.open) - y(candle.close)))} fill={up ? "none" : colour} stroke={colour} />
              </g>
            );
          })}
          {line.length > 1 && (
            <polyline fill="none" stroke={BLACK} strokeWidth={1} points={line.map((point) => `${x(point.t).toFixed(1)},${y(point.v).toFixed(1)}`).join(" ")} />
          )}
          {verticals.map((bar, index) => (
            <line key={`vertical-${index}`} x1={x(bar.x)} x2={x(bar.x)} y1={y(bar.y0)} y2={y(bar.y1)} stroke={bar.colour} strokeWidth={bar.width ?? 6} opacity={bar.opacity ?? 0.35}>
              {bar.tooltip && <title>{bar.tooltip}</title>}
            </line>
          ))}
          {marks.map((mark, index) => (
            <g key={`mark-${index}`}>
              <GlyphMark glyph={mark.glyph} x={x(mark.x)} y={y(mark.y)} size={mark.size ?? 5} colour={mark.colour} filled={mark.filled ?? true} title={mark.tooltip} />
              {mark.label && (
                <text x={x(mark.x) + (mark.size ?? 5) + 2} y={y(mark.y) + 3} fontSize={10} fontWeight="bold" fill={mark.colour} pointerEvents="none">{mark.label}</text>
              )}
            </g>
          ))}
          {cursor !== null && cursor !== undefined && (
            <line x1={x(cursor)} x2={x(cursor)} y1={6} y2={height - bottom} stroke={BLACK} strokeWidth={1.5} strokeDasharray="4 3" />
          )}
        </g>
        {pointer && pointer.x > left && pointer.y < height - bottom && (
          <g pointerEvents="none">
            <line x1={pointer.x} x2={pointer.x} y1={6} y2={height - bottom} stroke="#525252" />
            <line x1={left} x2={width - 8} y1={pointer.y} y2={pointer.y} stroke="#525252" />
            <text x={Math.min(pointer.x + 4, width - 110)} y={14} fontSize={10} fill="#e5e5e5">
              {`${new Date(invertX(pointer.x)).toISOString().slice(0, 16).replace("T", " ")} · ${fmt(invertY(pointer.y), 2)}`}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

/** A small stacked strip under a session chart (stage counter, volume), sharing its time axis. */
export function StripChart({ points, height = 90, yLabel, colourOf, step = false }: {
  points: Array<{ t: number; v: number }>; height?: number; yLabel: string; colourOf: (value: number) => string; step?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (points.length === 0) return null;
  const t0 = points[0]?.t ?? 0;
  const t1 = points[points.length - 1]?.t ?? 1;
  const [v0, v1] = extent([0, ...points.map((point) => point.v)], 0.02);
  const left = 58;
  const x = linear([t0, t1], [left, width - 8]);
  const y = linear([v0, v1], [height - 4, 4]);
  const barWidth = Math.max(1, (width - left - 8) / points.length);
  return (
    <div ref={ref} className="w-full min-w-0">
      <svg width={width} height={height} className="block">
        <text x={10} y={height / 2} transform={`rotate(-90 10 ${height / 2})`} textAnchor="middle" fontSize={9} fill="#a3a3a3">{yLabel}</text>
        <line x1={left} x2={width - 8} y1={y(0)} y2={y(0)} stroke="#525252" />
        {points.map((point) => (
          <rect key={point.t} x={x(point.t)} width={step ? barWidth + 0.5 : Math.max(1, barWidth - 0.5)} y={Math.min(y(0), y(point.v))}
            height={Math.abs(y(point.v) - y(0))} fill={colourOf(point.v)} opacity={0.75}>
            <title>{`${clock(point.t)}: ${fmt(point.v, 0)}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

/** Rows × columns of cells coloured on a cividis-like ramp, with an optional sign glyph in each cell. */
export function GridHeatmap({ rows, columns, value, signs = false, label, height }: {
  rows: readonly string[]; columns: readonly string[]; value: (row: string, column: string) => number | null; signs?: boolean; label: string; height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (rows.length === 0 || columns.length === 0) return <Empty>No cells.</Empty>;
  const all = rows.flatMap((row) => columns.map((column) => value(row, column)));
  const [low, high] = extent(all, 0);
  const left = 150;
  const top = 4;
  const cellWidth = (width - left - 4) / columns.length;
  const cellHeight = Math.max(12, ((height ?? rows.length * 22 + 40) - 40) / rows.length);
  const total = top + rows.length * cellHeight + 36;
  const ramp = (fraction: number) => {
    // cividis endpoints: dark blue to yellow, readable for deuteranopia
    const a = [0, 34, 78];
    const b = [253, 231, 55];
    const f = Math.min(Math.max(fraction, 0), 1);
    return `rgb(${a.map((channel, index) => Math.round(channel + ((b[index] as number) - channel) * f)).join(",")})`;
  };
  const labelEvery = Math.max(1, Math.ceil(columns.length / Math.max(1, Math.floor((width - left) / 42))));
  return (
    <div ref={ref} className="w-full min-w-0">
      <svg width={width} height={total} className="block">
        {rows.map((row, rowIndex) => (
          <g key={row}>
            <text x={left - 4} y={top + rowIndex * cellHeight + cellHeight / 2 + 3} textAnchor="end" fontSize={10} fill="#d4d4d4">{row}</text>
            {columns.map((column, columnIndex) => {
              const cellValue = value(row, column);
              const fraction = cellValue === null ? 0 : (cellValue - low) / (high - low || 1);
              return (
                <g key={column}>
                  <rect x={left + columnIndex * cellWidth} y={top + rowIndex * cellHeight} width={Math.max(0.5, cellWidth - 0.5)} height={cellHeight - 1}
                    fill={cellValue === null ? "#171717" : ramp(fraction)}>
                    <title>{`${row} · ${column}: ${cellValue === null ? "no value" : fmt(cellValue, 3)}`}</title>
                  </rect>
                  {signs && cellValue !== null && cellWidth > 9 && (
                    <text x={left + columnIndex * cellWidth + cellWidth / 2} y={top + rowIndex * cellHeight + cellHeight / 2 + 4} textAnchor="middle"
                      fontSize={11} fontWeight="bold" fill={fraction > 0.55 ? "#000" : "#fff"} pointerEvents="none">{cellValue > 0 ? "+" : "−"}</text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
        {columns.map((column, columnIndex) => (columnIndex % labelEvery === 0 ? (
          <text key={column} x={left + columnIndex * cellWidth + cellWidth / 2} y={top + rows.length * cellHeight + 12} textAnchor="middle" fontSize={9} fill="#8a8a8a">{column}</text>
        ) : null))}
        <text x={left} y={total - 4} fontSize={9} fill="#a3a3a3">{`${label}: ${fmt(low, 3)} (dark blue) to ${fmt(high, 3)} (yellow)`}</text>
      </svg>
    </div>
  );
}

/**
 * Shown when a response says a dataset is not in the lake's views yet: asks the dashboard to redefine its derived
 * views from the ingest manifests (POST /api/labels/catalog/refresh), then hands back a new nonce so the page
 * re-reads instead of reusing the cached "not landed" answer. The server's view list is cached for a minute.
 */
export function RefreshViews({ notes, onRefreshed }: { notes: readonly string[]; onRefreshed: (nonce: number) => void }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  if (!notes.some((note) => note.startsWith("Not in the lake yet"))) return null;
  const refresh = () => {
    setState("busy");
    fetch("/api/labels/catalog/refresh", { method: "POST" })
      .then((response) => {
        setState(response.ok ? "done" : "failed");
        if (response.ok) onRefreshed(Date.now());
      })
      .catch(() => setState("failed"));
  };
  return (
    <div className="flex items-center gap-2 text-[11px] text-neutral-400">
      <button type="button" onClick={refresh} disabled={state === "busy"}
        className="rounded border border-[#56B4E9]/60 px-2 py-0.5 text-[#56B4E9] hover:bg-[#56B4E9]/10 disabled:opacity-50">
        Refresh the lake views
      </button>
      {state === "done" && "Views redefined; the study re-reads now (the server's view list refreshes within a minute)."}
      {state === "failed" && "The refresh failed; the views are redefined at the dashboard's next start."}
    </div>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h4 className="mt-3 text-xs font-semibold text-neutral-200">{children}</h4>;
}

/** Eight numbers of one numeric array, shown as a row of labelled values. */
export function numbersOf(rows: readonly Row[], key: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}
