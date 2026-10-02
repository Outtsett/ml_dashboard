/**
 * Every column of the notebook's frame, each as its own histogram with its
 * eight numbers (mean, median, standard deviation, skewness, kurtosis, 25th and
 * 75th percentiles, minimum, maximum). The server computed both over the whole
 * window (the histogram spans the 1st to 99th percentile, the edge bins absorb
 * the tails); the bin count is a control of the page and re-asks the server.
 */

import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ControlBar, OKABE, SegmentControl, SwitchControl, TOOLTIP, fmtInt } from "@/studies/kit";
import type { ColumnSummary } from "@shared/studies/crossover-strategy";

function compact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude === 0) return "0";
  if (magnitude >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (magnitude >= 1) return value.toFixed(3);
  if (magnitude >= 0.001) return value.toFixed(5);
  return value.toExponential(2);
}

const EIGHT: Array<[keyof ColumnSummary["summary"], string]> = [
  ["mean", "mean"], ["median", "median"], ["standardDeviation", "std dev"],
  ["skewness", "skew"], ["kurtosis", "kurt"], ["percentile25", "p25"],
  ["percentile75", "p75"], ["minimum", "min"], ["maximum", "max"],
];

type SortKey = "frame" | "name" | "skewness" | "kurtosis";

function Panel({ column, logScale }: { column: ColumnSummary; logScale: boolean }) {
  const data = column.histogram.map((bin) => ({
    middle: (bin.lower + bin.upper) / 2,
    count: bin.count,
    shown: logScale ? Math.log10(bin.count + 1) : bin.count,
    lower: bin.lower,
    upper: bin.upper,
  }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="truncate text-[11px] font-medium text-neutral-100" title={column.name}>{column.name}</div>
      <div className="truncate text-[10px] text-neutral-500" title={column.description}>{column.description}</div>
      <ResponsiveContainer width="100%" height={84}>
        <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
          <XAxis dataKey="middle" hide />
          <YAxis hide />
          <Tooltip
            {...TOOLTIP}
            formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "rows"]}
            labelFormatter={(_label, payload) => {
              const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return bin ? `${compact(bin.lower)} to ${compact(bin.upper)}` : "";
            }}
          />
          <Bar dataKey="shown" fill={OKABE.sky} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <dl className="grid grid-cols-3 gap-x-2 gap-y-0.5 font-mono text-[10px] tnum">
        {EIGHT.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-1">
            <dt className="text-neutral-500">{label}</dt>
            <dd className="text-neutral-200">{compact(column.summary[key] as number | null)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-0.5 text-[10px] text-neutral-500">{fmtInt(column.summary.count)} usable rows</div>
    </div>
  );
}

export function ColumnPanels({ columns }: { columns: ColumnSummary[] }) {
  const [sort, setSort] = useState<SortKey>("frame");
  const [filter, setFilter] = useState("");
  const [logScale, setLogScale] = useState(false);
  const shown = columns
    .filter((column) => column.name.includes(filter.trim().toLowerCase()))
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "skewness" || sort === "kurtosis") return Math.abs(b.summary[sort] ?? 0) - Math.abs(a.summary[sort] ?? 0);
      return 0;
    });
  return (
    <div className="space-y-2">
      <ControlBar>
        <SegmentControl label="Sort panels" value={sort} onChange={setSort} options={[{ value: "frame", label: "frame order" }, { value: "name", label: "name" }, { value: "skewness", label: "|skew|" }, { value: "kurtosis", label: "|kurtosis|" }]} />
        <label className="flex w-44 flex-col gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
          Filter by name
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="e.g. macd" className="h-7 rounded border border-neutral-700 bg-neutral-900 px-2 font-mono text-xs normal-case tracking-normal text-neutral-100" />
        </label>
        <SwitchControl label="Log-scale counts" checked={logScale} onChange={setLogScale} hint="Shows the tails: each bar is log10(count + 1)" />
      </ControlBar>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
        {shown.map((column) => (
          <Panel key={column.name} column={column} logScale={logScale} />
        ))}
      </div>
      {shown.length === 0 && <p className="text-xs text-neutral-400">No column name contains "{filter}".</p>}
    </div>
  );
}
