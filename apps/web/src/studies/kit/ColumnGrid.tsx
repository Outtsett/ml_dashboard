/**
 * Every numeric column of a frame, each as its own histogram with its eight
 * numbers (mean, median, standard deviation, skewness, kurtosis, 25th and 75th
 * percentiles, min, max) — the dashboard rule that nothing is summarised
 * without also being seen. Controls re-bin, log-scale the counts, filter
 * panels by name and sort them.
 */

import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { histogram } from "@shared/analytics/compute";
import { eightNumberSummary } from "@shared/lens/stats";
import type { EightNumberSummary } from "@shared/analytics/types";
import { OKABE, TOOLTIP, fmt, fmtInt } from "@/analytics/common";
import { ControlBar, SegmentControl, SliderControl, SwitchControl } from "./controls";

/** Any row object: a page's own interface works without an index signature. */
type Row = object;

function numericColumns(rows: readonly Row[], exclude: readonly string[]): string[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).filter((key) => {
    if (exclude.includes(key)) return false;
    let seen = 0;
    const distinct = new Set<number>();
    for (const row of rows) {
      const value = (row as Record<string, unknown>)[key];
      if (value === null || value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      seen += 1;
      if (distinct.size < 3) distinct.add(value);
    }
    return seen > 0 && distinct.size > 2;
  });
}

function valuesOf(rows: readonly Row[], column: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const value = (row as Record<string, unknown>)[column];
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}

const SUMMARY_KEYS: Array<[keyof EightNumberSummary, string]> = [
  ["mean", "mean"], ["median", "median"], ["standardDeviation", "sd"], ["skewness", "skew"],
  ["kurtosis", "kurt"], ["percentile25", "p25"], ["percentile75", "p75"], ["minimum", "min"], ["maximum", "max"],
];

function Panel({ name, values, bins, logScale }: { name: string; values: number[]; bins: number; logScale: boolean }) {
  const summary = eightNumberSummary(values);
  const data = histogram(values, bins).map((bin) => ({
    middle: (bin.lower + bin.upper) / 2,
    count: bin.count,
    shown: logScale ? Math.log10(bin.count + 1) : bin.count,
    lower: bin.lower,
    upper: bin.upper,
  }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={name}>
        {name}
      </div>
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
          <XAxis dataKey="middle" hide />
          <YAxis hide />
          <Tooltip
            {...TOOLTIP}
            formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "rows"]}
            labelFormatter={(_label, payload) => {
              const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return bin ? `${fmt(bin.lower, 4)} to ${fmt(bin.upper, 4)}` : "";
            }}
          />
          <Bar dataKey="shown" fill={OKABE.sky} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <dl className="mt-1 grid grid-cols-3 gap-x-2 text-[10px] font-mono tnum">
        <dt className="col-span-3 text-neutral-500">n {fmtInt(summary.count)}</dt>
        {SUMMARY_KEYS.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-1">
            <span className="text-neutral-500">{label}</span>
            <span className="text-neutral-200">{fmt(summary[key] as number | null, 3)}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ColumnGrid({ rows, exclude = [], title = "Every column" }: { rows: readonly Row[]; exclude?: readonly string[]; title?: string }) {
  const [bins, setBins] = useState(30);
  const [logScale, setLogScale] = useState(false);
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<"name" | "spread">("name");

  const columns = numericColumns(rows, exclude)
    .filter((column) => column.toLowerCase().includes(filter.toLowerCase()))
    .map((column) => ({ column, values: valuesOf(rows, column) }));
  if (order === "spread") {
    columns.sort((a, b) => (eightNumberSummary(b.values).standardDeviation ?? 0) - (eightNumberSummary(a.values).standardDeviation ?? 0));
  } else {
    columns.sort((a, b) => a.column.localeCompare(b.column));
  }

  return (
    <div className="space-y-2">
      <ControlBar>
        <span className="self-center text-xs font-semibold text-neutral-200">{title}</span>
        <SliderControl label="Bins" value={bins} min={5} max={100} onChange={setBins} />
        <SwitchControl label="Log counts" checked={logScale} onChange={setLogScale} />
        <SegmentControl label="Sort" value={order} options={[{ value: "name", label: "name" }, { value: "spread", label: "spread" }]} onChange={setOrder} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Filter</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="column name"
            className="h-7 w-40 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
          />
        </label>
      </ControlBar>
      {columns.length === 0 ? (
        <p className="text-xs text-neutral-500">No numeric column with more than two distinct values.</p>
      ) : (
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
          {columns.map(({ column, values }) => (
            <Panel key={column} name={column} values={values} bins={bins} logScale={logScale} />
          ))}
        </div>
      )}
    </div>
  );
}
