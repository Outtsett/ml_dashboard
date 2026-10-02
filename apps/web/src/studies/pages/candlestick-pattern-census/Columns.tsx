/**
 * Every column of the census as its own graphic: the 14 numeric columns as
 * histograms (symmetric-log on the count columns), the 9 categorical columns
 * as counts, each labelled with the column's full name, and the eight numbers
 * for every numeric column beside them.
 */

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DenseTable } from "@/backtest/components";
import { AXIS, ControlBar, GRID, OKABE, SegmentControl, SliderControl, SwitchControl, TOOLTIP, eightNumberSummary, fmt, fmtInt } from "@/studies/kit";
import {
  CATEGORICAL_COLUMNS, COUNT_COLUMNS, NUMERIC_COLUMNS, categoricalValue, histogramBins, populationMoments, valueCounts,
  type CensusRow,
} from "@shared/studies/candlestick-pattern-census";

function numbersOf(rows: readonly CensusRow[], column: (typeof NUMERIC_COLUMNS)[number]): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const value = row[column];
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}

function NumericPanel({ column, values, bins, logScale }: { column: (typeof NUMERIC_COLUMNS)[number]; values: number[]; bins: number; logScale: boolean }) {
  const useSymlog = logScale && COUNT_COLUMNS.has(column);
  const data = histogramBins(values, bins, useSymlog).map((bin, index) => ({ index, ...bin }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={column}>{column}</div>
      {data.length === 0 ? (
        <p className="py-6 text-center text-[11px] text-neutral-500">no values</p>
      ) : (
        <ResponsiveContainer width="100%" height={100}>
          <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
            <XAxis dataKey="index" hide />
            <YAxis hide />
            <Tooltip
              {...TOOLTIP}
              content={({ payload }) => {
                const bin = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!bin) return null;
                return (
                  <div style={TOOLTIP.contentStyle} className="px-2 py-1 text-[11px]">
                    <div>{fmt(bin.lower, useSymlog ? 0 : 3)} to {fmt(bin.upper, useSymlog ? 0 : 3)}</div>
                    <div>{fmtInt(bin.count)} rows</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="count" fill={OKABE.blue} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
      <div className="flex justify-between font-mono text-[10px] text-neutral-500">
        <span>{fmt(data[0]?.lower, useSymlog ? 0 : 2)}</span>
        <span>{useSymlog ? "symlog" : "linear"} · n {fmtInt(values.length)}</span>
        <span>{fmt(data[data.length - 1]?.upper, useSymlog ? 0 : 2)}</span>
      </div>
    </div>
  );
}

function CategoricalPanel({ column, rows }: { column: (typeof CATEGORICAL_COLUMNS)[number]; rows: readonly CensusRow[] }) {
  const data = valueCounts(rows.map((row) => categoricalValue(row, column)));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={column}>{column}</div>
      <ResponsiveContainer width="100%" height={Math.max(80, 24 * data.length + 14)}>
        <BarChart data={data} layout="vertical" margin={{ top: 2, right: 28, left: 2, bottom: 2 }} barCategoryGap={3}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="value" width={88} interval={0} {...AXIS} />
          <Tooltip {...TOOLTIP} formatter={(value) => [fmtInt(Number(value)), "rows"]} />
          <Bar dataKey="count" fill={OKABE.orange} isAnimationActive={false}>
            <LabelList dataKey="count" position="right" fill="#d4d4d4" fontSize={10} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface EightRow {
  column: string;
  count: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  skewness: number | null;
  excessKurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  minimum: number | null;
  maximum: number | null;
}

function eightRow(column: (typeof NUMERIC_COLUMNS)[number], values: number[], estimator: "notebook" | "dashboard"): EightRow | null {
  if (estimator === "notebook") {
    const moments = populationMoments(values);
    return moments ? { column, ...moments } : null;
  }
  const summary = eightNumberSummary(values);
  if (summary.count === 0) return null;
  return {
    column,
    count: summary.count,
    mean: summary.mean,
    median: summary.median,
    standardDeviation: summary.standardDeviation,
    skewness: summary.skewness,
    excessKurtosis: summary.kurtosis,
    percentile25: summary.percentile25,
    percentile75: summary.percentile75,
    minimum: summary.minimum,
    maximum: summary.maximum,
  };
}

function numberCell(decimals: number) {
  return ({ getValue }: { getValue: () => unknown }) => {
    const value = getValue();
    return <span className="font-mono tnum">{typeof value === "number" ? fmt(value, decimals) : "—"}</span>;
  };
}

const EIGHT_COLUMNS: ColumnDef<EightRow, unknown>[] = [
  { accessorKey: "column", header: "column", cell: ({ getValue }) => <span className="font-mono text-[11px]">{String(getValue())}</span> },
  { accessorKey: "count", header: "count", meta: { align: "right" }, cell: numberCell(0) },
  { accessorKey: "mean", header: "mean", meta: { align: "right" }, cell: numberCell(3) },
  { accessorKey: "median", header: "median", meta: { align: "right" }, cell: numberCell(3) },
  { accessorKey: "standardDeviation", header: "standard deviation", meta: { align: "right" }, cell: numberCell(3) },
  { accessorKey: "skewness", header: "skewness", meta: { align: "right" }, cell: numberCell(3) },
  { accessorKey: "excessKurtosis", header: "excess kurtosis", meta: { align: "right" }, cell: numberCell(3) },
  { accessorKey: "percentile25", header: "25th percentile", meta: { align: "right" }, cell: numberCell(3) },
  { accessorKey: "percentile75", header: "75th percentile", meta: { align: "right" }, cell: numberCell(3) },
  { accessorKey: "minimum", header: "minimum", meta: { align: "right" }, cell: numberCell(3) },
  { accessorKey: "maximum", header: "maximum", meta: { align: "right" }, cell: numberCell(3) },
];

export function CensusColumns({
  rows, bins, logScale, dropNever, estimator, onBins, onLogScale, onDropNever, onEstimator,
}: {
  rows: readonly CensusRow[];
  bins: number;
  logScale: boolean;
  dropNever: boolean;
  estimator: "notebook" | "dashboard";
  onBins: (value: number) => void;
  onLogScale: (value: boolean) => void;
  onDropNever: (value: boolean) => void;
  onEstimator: (value: "notebook" | "dashboard") => void;
}) {
  const [filter, setFilter] = useState("");
  const frame = dropNever ? rows.filter((row) => row.fires_anywhere_in_the_data) : rows;
  const match = (name: string) => name.toLowerCase().includes(filter.toLowerCase());
  const eight = NUMERIC_COLUMNS.map((column) => eightRow(column, numbersOf(frame, column), estimator)).filter((row): row is EightRow => row !== null);

  return (
    <div className="space-y-3">
      <ControlBar>
        <SliderControl label="Histogram bins" value={bins} min={5} max={60} onChange={onBins} />
        <SwitchControl label="Symmetric-log x-axis on count columns" checked={logScale} onChange={onLogScale} />
        <SwitchControl label="Exclude the patterns that never fire" checked={dropNever} onChange={onDropNever} hint="Drops every row of a pattern that fires on no timeframe" />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Filter panels</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="column name"
            className="h-7 w-40 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
          />
        </label>
      </ControlBar>
      <p className="text-[11px] text-neutral-400">
        {fmtInt(frame.length)} rows, one per (pattern, timeframe). {NUMERIC_COLUMNS.length} numeric columns as histograms, {CATEGORICAL_COLUMNS.length} categorical columns as counts; the derived
        <span className="font-mono"> sides_observed</span> says which sides TA-Lib actually emitted.
      </p>
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
        {NUMERIC_COLUMNS.filter(match).map((column) => (
          <NumericPanel key={column} column={column} values={numbersOf(frame, column)} bins={bins} logScale={logScale} />
        ))}
        {CATEGORICAL_COLUMNS.filter(match).map((column) => (
          <CategoricalPanel key={column} column={column} rows={frame} />
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h4 className="text-[11px] font-semibold text-neutral-300">The eight numbers for every numeric column</h4>
          <SegmentControl
            label="Skewness and kurtosis estimator"
            value={estimator}
            options={[{ value: "notebook", label: "the notebook's" }, { value: "dashboard", label: "sample-adjusted" }]}
            onChange={onEstimator}
            hint="The notebook averaged the standardised cube and fourth power; the dashboard's kit uses the sample-adjusted G1 and G2 (pandas). Mean, median, standard deviation and percentiles are identical."
          />
        </div>
        <div className="h-[430px] rounded border border-neutral-900">
          <DenseTable<EightRow> columns={EIGHT_COLUMNS} data={eight} getRowId={(row) => row.column} dense />
        </div>
      </div>
    </div>
  );
}
