/**
 * Every numeric column of the measurement, one panel each, with the eight
 * numbers beneath it and one table of all of them. A column that spans orders
 * of magnitude is binned over log10 |value| (the unstable corner reaches
 * values no price series could justify), and the eight numbers are always of
 * the raw values. Controls re-bin, force or forbid log bins, filter and sort.
 */

import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ControlBar, OKABE, SegmentControl, SliderControl, TOOLTIP, fmtInt } from "@/studies/kit";
import {
  GRID_NUMERIC_COLUMNS, columnHistogram, columnSummary, columnValues,
  type GridNumericColumn, type HwmaGridRow,
} from "@shared/studies/hwma-stability";
import { COLUMN_LABELS, fmtWide } from "./format";

type LogMode = "auto" | "always" | "never";

const SUMMARY_KEYS = [
  ["mean", "mean"], ["median", "median"], ["standardDeviation", "sd"], ["skewness", "skew"],
  ["kurtosis", "kurt"], ["percentile25", "p25"], ["percentile75", "p75"], ["minimum", "min"], ["maximum", "max"],
] as const;

const TABLE_ROWS = [
  ["count", "count"], ["mean", "mean"], ["median", "median"], ["standardDeviation", "standard deviation"],
  ["skewness", "skewness"], ["kurtosis", "excess kurtosis"], ["percentile25", "25th percentile"],
  ["percentile75", "75th percentile"], ["minimum", "minimum"], ["maximum", "maximum"],
] as const;

function Panel({ column, rows, bins, logMode }: { column: GridNumericColumn; rows: readonly HwmaGridRow[]; bins: number; logMode: LogMode }) {
  const values = columnValues(rows, column);
  const summary = columnSummary(values);
  const histogram = columnHistogram(values, bins, logMode);
  const data = histogram.bins.map((bin) => ({ middle: (bin.left + bin.right) / 2, ...bin }));
  const label = COLUMN_LABELS[column] ?? column;
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={`${column}: ${label}`}>
        {label}
        {histogram.logScale && <span className="ml-1 font-normal text-neutral-500">(log10 |value|)</span>}
      </div>
      <ResponsiveContainer width="100%" height={96}>
        <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
          <XAxis dataKey="middle" hide />
          <YAxis hide />
          <Tooltip
            {...TOOLTIP}
            formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "combinations"]}
            labelFormatter={(_label, payload) => {
              const bin = payload?.[0]?.payload as { left: number; right: number } | undefined;
              if (!bin) return "";
              const show = (v: number) => (histogram.logScale ? `1e${v.toFixed(2)}` : fmtWide(v, 4));
              return `${show(bin.left)} to ${show(bin.right)}`;
            }}
          />
          <Bar dataKey="count" fill={OKABE.sky} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 text-[10px] font-mono tnum">
        <dt className="col-span-2 text-neutral-500">n {fmtInt(summary.count)}</dt>
        {SUMMARY_KEYS.map(([key, short]) => (
          <div key={key} className="flex justify-between gap-1">
            <span className="text-neutral-500">{short}</span>
            <span className="text-neutral-200">{fmtWide(summary[key] as number | null, 3)}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ColumnPanels({ rows }: { rows: readonly HwmaGridRow[] }) {
  const [bins, setBins] = useState(40);
  const [logMode, setLogMode] = useState<LogMode>("auto");
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<"table" | "spread">("table");

  const shown = GRID_NUMERIC_COLUMNS
    .filter((column) => `${column} ${COLUMN_LABELS[column] ?? ""}`.toLowerCase().includes(filter.toLowerCase()))
    .map((column) => ({ column, spread: columnSummary(columnValues(rows, column)).standardDeviation ?? 0 }));
  if (order === "spread") shown.sort((a, b) => b.spread - a.spread);

  const summaries = GRID_NUMERIC_COLUMNS.map((column) => ({
    name: column,
    summary: columnSummary(columnValues(rows, column)),
  }));

  return (
    <div className="space-y-3">
      <ControlBar>
        <SliderControl label="Bins" value={bins} min={5} max={100} onChange={setBins} />
        <SegmentControl
          label="Log10 bins"
          value={logMode}
          options={[{ value: "auto", label: "auto" }, { value: "always", label: "always" }, { value: "never", label: "never" }]}
          onChange={setLogMode}
          hint="auto: a column whose positive values span more than four orders of magnitude"
        />
        <SegmentControl label="Order" value={order} options={[{ value: "table", label: "table" }, { value: "spread", label: "spread" }]} onChange={setOrder} />
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
      {shown.length === 0 ? (
        <p className="text-xs text-neutral-500">No column matches that filter.</p>
      ) : (
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
          {shown.map(({ column }) => (
            <Panel key={column} column={column} rows={rows} bins={bins} logMode={logMode} />
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono tnum">
          <thead>
            <tr className="text-neutral-500">
              <th className="py-0.5 text-left font-normal">statistic</th>
              {summaries.map((entry) => (
                <th key={entry.name} className="py-0.5 text-right font-normal" title={COLUMN_LABELS[entry.name]}>{entry.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TABLE_ROWS.map(([key, label]) => (
              <tr key={key} className="border-t border-neutral-900">
                <td className="py-0.5 text-neutral-400">{label}</td>
                {summaries.map((entry) => (
                  <td key={entry.name} className="py-0.5 text-right text-neutral-200">
                    {key === "count" ? fmtInt(entry.summary.count) : fmtWide(entry.summary[key] as number | null, 4)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-neutral-500">
        Standard deviation uses n - 1; skewness is g1 and kurtosis is excess g2 over the population moments (the notebook's scipy defaults); percentiles interpolate linearly. A dash marks a moment that is undefined (under 3 or 4 values, or no spread).
      </p>
    </div>
  );
}
