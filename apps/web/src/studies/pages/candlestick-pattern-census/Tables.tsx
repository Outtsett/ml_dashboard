/**
 * The census page's tables: the patterns in view, named, and the full census
 * (one row per pattern per timeframe), both sortable.
 */

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DenseTable } from "@/backtest/components";
import { fmt, fmtInt } from "@/studies/kit";
import type { CensusRow, ProvenanceRow, SelectedPattern } from "@shared/studies/candlestick-pattern-census";

function integerCell({ getValue }: { getValue: () => unknown }) {
  const value = getValue();
  return <span className="font-mono tnum">{typeof value === "number" ? fmtInt(value) : "—"}</span>;
}

function decimalCell(decimals: number) {
  return ({ getValue }: { getValue: () => unknown }) => {
    const value = getValue();
    return <span className="font-mono tnum">{typeof value === "number" ? fmt(value, decimals) : "—"}</span>;
  };
}

function flagCell({ getValue }: { getValue: () => unknown }) {
  const value = getValue();
  return <span className="font-mono">{value === true ? "● yes" : value === false ? "○ no" : "—"}</span>;
}

interface NamedRow {
  pattern_name: string;
  talib_function: string;
  candle_count: number;
  pattern_type: string;
  firings: number;
  firings_bullish: number;
  firings_bearish: number;
  shape_condition_count: number | null;
  cnn_recognition_area_under_curve: number | null;
}

const NAMED_COLUMNS: ColumnDef<NamedRow, unknown>[] = [
  { accessorKey: "pattern_name", header: "pattern_name" },
  { accessorKey: "talib_function", header: "talib_function", cell: ({ getValue }) => <span className="font-mono text-[11px]">{String(getValue())}</span> },
  { accessorKey: "candle_count", header: "candle_count", meta: { align: "right" } },
  { accessorKey: "pattern_type", header: "pattern_type" },
  { accessorKey: "firings", header: "firings", meta: { align: "right" }, cell: integerCell },
  { accessorKey: "firings_bullish", header: "firings_bullish", meta: { align: "right" }, cell: integerCell },
  { accessorKey: "firings_bearish", header: "firings_bearish", meta: { align: "right" }, cell: integerCell },
  { accessorKey: "shape_condition_count", header: "shape_condition_count", meta: { align: "right" }, cell: integerCell },
  { accessorKey: "cnn_recognition_area_under_curve", header: "cnn_recognition_area_under_curve", meta: { align: "right" }, cell: decimalCell(3) },
];

export function NamedPatternsTable({ patterns }: { patterns: readonly SelectedPattern[] }) {
  const data: NamedRow[] = patterns.map((entry) => ({
    pattern_name: entry.pattern_name,
    talib_function: entry.talib_function,
    candle_count: entry.candle_count,
    pattern_type: entry.pattern_type,
    firings: entry.firingCountSelected,
    firings_bullish: entry.firingCountBullish,
    firings_bearish: entry.firingCountBearish,
    shape_condition_count: entry.shape_condition_count,
    cnn_recognition_area_under_curve: entry.recognitionAreaUnderCurve,
  }));
  return (
    <div className="h-[380px] rounded border border-neutral-900">
      <DenseTable<NamedRow> columns={NAMED_COLUMNS} data={data} getRowId={(row) => row.pattern_name} defaultSorting={[{ id: "firings", desc: true }]} dense />
    </div>
  );
}

const CENSUS_COLUMNS: ColumnDef<CensusRow, unknown>[] = [
  { accessorKey: "pattern_name", header: "pattern_name" },
  { accessorKey: "talib_function", header: "talib_function", cell: ({ getValue }) => <span className="font-mono text-[11px]">{String(getValue())}</span> },
  { accessorKey: "timeframe", header: "timeframe" },
  { accessorKey: "candle_count", header: "candle_count", meta: { align: "right" } },
  { accessorKey: "pattern_type", header: "pattern_type" },
  { accessorKey: "emitted_values", header: "emitted_values", cell: ({ getValue }) => <span className="block max-w-[260px] truncate text-[11px]" title={String(getValue() ?? "")}>{String(getValue() ?? "—")}</span> },
  { accessorKey: "shape_condition_count", header: "shape_condition_count", meta: { align: "right" }, cell: integerCell },
  { accessorKey: "firing_count_total", header: "firing_count_total", meta: { align: "right" }, cell: integerCell },
  { accessorKey: "firing_count_bullish", header: "firing_count_bullish", meta: { align: "right" }, cell: integerCell },
  { accessorKey: "firing_count_bearish", header: "firing_count_bearish", meta: { align: "right" }, cell: integerCell },
  { accessorKey: "firing_count_holdout_2025", header: "firing_count_holdout_2025", meta: { align: "right" }, cell: integerCell },
  { accessorKey: "firing_rate_percent", header: "firing_rate_percent", meta: { align: "right" }, cell: decimalCell(4) },
  { accessorKey: "fires_in_this_timeframe", header: "fires_in_this_timeframe", cell: flagCell },
  { accessorKey: "meets_minimum_firing_count_on_holdout", header: "meets_minimum_firing_count_on_holdout", cell: flagCell },
  { accessorKey: "also_defined_as_hand_written_arithmetic_rule", header: "also_defined_as_hand_written_arithmetic_rule", cell: flagCell },
  { accessorKey: "recognition_area_under_curve", header: "recognition_area_under_curve", meta: { align: "right" }, cell: decimalCell(3) },
  { accessorKey: "recognition_average_precision", header: "recognition_average_precision", meta: { align: "right" }, cell: decimalCell(3) },
  { accessorKey: "recognition_prevalence", header: "recognition_prevalence", meta: { align: "right" }, cell: decimalCell(4) },
  { accessorKey: "bar_count_scanned", header: "bar_count_scanned", meta: { align: "right" }, cell: integerCell },
];

export function CensusTable({ rows }: { rows: readonly CensusRow[] }) {
  const [search, setSearch] = useState("");
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-[11px] text-neutral-400">
        Search
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="pattern, function, timeframe"
          className="h-7 w-56 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
        />
        <span>{fmtInt(rows.length)} rows, sorted as the notebook sorted them: timeframe, then firings</span>
      </label>
      <div className="h-[480px] rounded border border-neutral-900">
        <DenseTable<CensusRow>
          columns={CENSUS_COLUMNS}
          data={[...rows]}
          getRowId={(row) => `${row.pattern_name}|${row.timeframe}`}
          defaultSorting={[{ id: "timeframe", desc: false }, { id: "firing_count_total", desc: true }]}
          globalFilter={search}
          dense
        />
      </div>
    </div>
  );
}

const PROVENANCE_COLUMNS: ColumnDef<ProvenanceRow, unknown>[] = [
  { accessorKey: "source_name", header: "source" },
  { accessorKey: "talib_version", header: "TA-Lib version", cell: ({ getValue }) => <span className="font-mono">{String(getValue())}</span> },
  { accessorKey: "library_function_count", header: "library functions", meta: { align: "right" }, cell: integerCell },
  { accessorKey: "candlestick_function_count", header: "candlestick functions", meta: { align: "right" }, cell: integerCell },
  { accessorKey: "detail", header: "what it is", cell: ({ getValue }) => <span className="text-[11px] text-neutral-400">{String(getValue())}</span> },
];

export function ProvenanceTable({ rows }: { rows: readonly ProvenanceRow[] }) {
  return (
    <div className="rounded border border-neutral-900">
      <DenseTable<ProvenanceRow> columns={PROVENANCE_COLUMNS} data={[...rows]} getRowId={(row) => row.source_name} dense />
    </div>
  );
}
