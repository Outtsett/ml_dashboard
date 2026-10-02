/**
 * Every profiled contract column as its own histogram with its eight numbers.
 * The kit's ColumnGrid bins rows in the browser; a 1-minute label set is 2.3
 * million rows, so here the server bins (the page's Bins control re-bins
 * there) and this grid draws the counts. Log counts, sort and filter act in
 * the browser.
 */

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ColumnProfile } from "@shared/studies/label-catalog";
import { AXIS, ControlBar, GRID, OKABE, SegmentControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";

const STATISTICS: Array<[keyof ColumnProfile["summary"], string]> = [
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

function Panel({ profile, logScale }: { profile: ColumnProfile; logScale: boolean }) {
  const data = profile.bins.map((bin) => ({
    middle: (bin.lower + bin.upper) / 2,
    lower: bin.lower,
    upper: bin.upper,
    rows: bin.rows,
    // A symmetric log (log10 of 1 + count), as the notebook's symlog axis: an empty bin stays at 0.
    shown: logScale ? Math.log10(1 + bin.rows) : bin.rows,
  }));
  const title = profile.column.replace(/_/g, " ");
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={profile.column}>
        {title}
      </div>
      {data.length === 0 ? (
        <p className="py-6 text-center text-[11px] text-neutral-500">No finite values.</p>
      ) : (
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={data} margin={{ top: 2, right: 4, left: 0, bottom: 0 }} barCategoryGap={0}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="middle" {...AXIS} tickFormatter={(value: number) => fmt(value, Math.abs(value) >= 10 ? 0 : 2)} minTickGap={24} />
            <YAxis {...AXIS} width={34} tickFormatter={(value: number) => fmtInt(logScale ? Math.pow(10, value) - 1 : value)} />
            <Tooltip
              {...TOOLTIP}
              formatter={(_value, _name, item) => [fmtInt((item.payload as { rows: number }).rows), "rows"]}
              labelFormatter={(_label, payload) => {
                const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
                return bin ? `${title}: ${fmt(bin.lower, 4)} to ${fmt(bin.upper, 4)}` : "";
              }}
            />
            <Bar dataKey="shown" fill={OKABE.sky} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
      <dl className="mt-1 grid grid-cols-2 gap-x-3 text-[10px] font-mono tnum">
        <div className="col-span-2 flex justify-between">
          <dt className="text-neutral-500">count</dt>
          <dd className="text-neutral-200">{fmtInt(profile.summary.count)}</dd>
        </div>
        {STATISTICS.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-1">
            <dt className="truncate text-neutral-500">{label}</dt>
            <dd className="text-neutral-200">{fmt(profile.summary[key] as number | null, 4)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function BinnedGrid({ columns, logScale }: { columns: readonly ColumnProfile[]; logScale: boolean }) {
  const [order, setOrder] = useState<"notebook" | "name" | "spread">("notebook");
  const [filter, setFilter] = useState("");
  const shown = columns.filter((profile) => profile.column.includes(filter.toLowerCase().replace(/ /g, "_")));
  if (order === "name") shown.sort((a, b) => a.column.localeCompare(b.column));
  if (order === "spread") {
    // Spread relative to scale (coefficient of variation) so points and fractions compare.
    const relative = (profile: ColumnProfile) => {
      const { standardDeviation, mean } = profile.summary;
      return standardDeviation === null || mean === null ? -1 : standardDeviation / Math.max(Math.abs(mean), 1e-12);
    };
    shown.sort((a, b) => relative(b) - relative(a));
  }
  return (
    <div className="space-y-2">
      <ControlBar>
        <SegmentControl
          label="Order"
          value={order}
          options={[{ value: "notebook", label: "contract" }, { value: "name", label: "name" }, { value: "spread", label: "relative spread" }]}
          onChange={setOrder}
        />
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
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
        {shown.map((profile) => (
          <Panel key={profile.column} profile={profile} logScale={logScale} />
        ))}
      </div>
    </div>
  );
}
