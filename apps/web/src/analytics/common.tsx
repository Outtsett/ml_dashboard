/**
 * Building blocks shared by the four Analytics tabs: section chrome, the
 * eight-number table, a histogram, probability bars with their 95 % interval,
 * and number formatting. Colours are Okabe-Ito: up/positive orange, down /
 * negative blue, never red against green.
 */

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EightNumberSummary, HistogramBin, Probability } from "@shared/analytics/types";
import { LENS_CHART_AXIS, LENS_CHART_GRID, LENS_CHART_TOOLTIP_STYLE } from "@/lens/panels/format";

export const OKABE = {
  orange: "#E69F00",
  blue: "#0072B2",
  sky: "#56B4E9",
  green: "#009E73",
  yellow: "#F0E442",
  vermillion: "#D55E00",
  purple: "#CC79A7",
  grey: "#8a8a8a",
} as const;

export const AXIS = LENS_CHART_AXIS;
export const GRID = LENS_CHART_GRID;
export const TOOLTIP = LENS_CHART_TOOLTIP_STYLE;

export function toneOf(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return OKABE.grey;
  return value > 0 ? OKABE.orange : OKABE.blue;
}

export function fmt(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function fmtPercent(fraction: number | null | undefined, decimals = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(decimals)}%`;
}

export function fmtUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The stamped instant as wall-clock digits (the lake stamps futures in Pacific wall clock). */
export function fmtTime(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined) return "—";
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

export function Section({ title, question, children, aside }: { title: string; question?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">{title}</h3>
          {question && <p className="text-[11px] text-neutral-400">{question}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2" title={hint}>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="font-mono tnum text-base" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

const SUMMARY_ROWS: Array<[keyof EightNumberSummary, string]> = [
  ["count", "count"],
  ["mean", "mean"],
  ["median", "median"],
  ["standardDeviation", "standard deviation"],
  ["skewness", "skewness"],
  ["kurtosis", "excess kurtosis"],
  ["percentile25", "25th percentile"],
  ["percentile75", "75th percentile"],
  ["minimum", "minimum"],
  ["maximum", "maximum"],
];

/** The eight numbers (plus the count) for one or more columns side by side. */
export function SummaryTable({ columns }: { columns: Array<{ name: string; summary: EightNumberSummary; decimals?: number }> }) {
  return (
    <table className="w-full text-[11px] font-mono tnum">
      <thead>
        <tr className="text-neutral-500">
          <th className="text-left font-normal py-0.5">statistic</th>
          {columns.map((column) => (
            <th key={column.name} className="text-right font-normal py-0.5">
              {column.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {SUMMARY_ROWS.map(([key, label]) => (
          <tr key={key} className="border-t border-neutral-900">
            <td className="py-0.5 text-neutral-400">{label}</td>
            {columns.map((column) => (
              <td key={column.name} className="py-0.5 text-right text-neutral-200">
                {key === "count" ? fmtInt(column.summary.count) : fmt(column.summary[key] as number | null, column.decimals ?? 4)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A histogram; bars left of zero are blue, right of zero orange. */
export function Histogram({ bins, unit, height = 180, markers = [] }: { bins: HistogramBin[]; unit: string; height?: number; markers?: Array<{ x: number; label: string; color: string }> }) {
  const data = bins.map((bin) => ({ middle: (bin.lower + bin.upper) / 2, count: bin.count, lower: bin.lower, upper: bin.upper }));
  if (data.length === 0) return <Empty>No values.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="middle" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => fmt(value, 2)} {...AXIS} />
        <YAxis {...AXIS} width={40} />
        <Tooltip
          {...TOOLTIP}
          formatter={(value: number) => [fmtInt(value), "bars"]}
          labelFormatter={(_, payload) => {
            const row = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
            return row ? `${fmt(row.lower, 3)} to ${fmt(row.upper, 3)} ${unit}` : "";
          }}
        />
        {markers.map((marker) => (
          <ReferenceLine key={marker.label} x={marker.x} stroke={marker.color} strokeDasharray="4 3" label={{ value: marker.label, fill: marker.color, fontSize: 9, position: "top" }} />
        ))}
        <Bar dataKey="count" isAnimationActive={false}>
          {data.map((row) => (
            <Cell key={row.middle} fill={row.middle < 0 ? OKABE.blue : OKABE.orange} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** A probability with its 95 % interval, drawn as a bar with a whisker. */
export function ProbabilityBar({ label, probability, color = OKABE.orange }: { label: string; probability: Probability; color?: string }) {
  const value = probability.value;
  return (
    <div className="space-y-0.5" title={`${probability.count} of ${probability.total} past cases`}>
      <div className="flex justify-between text-[11px]">
        <span className="text-neutral-300">{label}</span>
        <span className="font-mono tnum text-neutral-100">
          {fmtPercent(value)} <span className="text-neutral-500">[{fmtPercent(probability.low)} – {fmtPercent(probability.high)}]</span>
        </span>
      </div>
      <div className="relative h-2 rounded bg-neutral-800">
        {value !== null && <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${value * 100}%`, background: color }} />}
        {probability.low !== null && probability.high !== null && (
          <div
            className="absolute -inset-y-0.5 border-x-2 border-neutral-100/80"
            style={{ left: `${probability.low * 100}%`, width: `${Math.max(0.5, (probability.high - probability.low) * 100)}%` }}
          />
        )}
        <div className="absolute inset-y-[-3px] w-px bg-neutral-400" style={{ left: "50%" }} title="50%" />
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-xs text-neutral-500">{children}</div>;
}
