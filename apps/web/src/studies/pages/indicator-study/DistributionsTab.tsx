/**
 * Section 8 (every indicator column seen: one histogram each, with the eight
 * numbers) and section 9 (the catalogue: what every column is and how it was scored).
 */

import { useState } from "react";
import { ControlBar, Empty, Finding, SegmentControl, Section, SelectControl, StudyNotes, StudyState, SwitchControl, fmt, fmtInt, useStudyQuery } from "@/studies/kit";
import type { CatalogueRow, DistributionsBody, HistogramBinRow } from "@shared/studies/indicator-study";
import { timeframeOf } from "./controls";
import type { TabProps } from "./Page";
import { DataTable, MiniHistogram, type Column } from "./widgets";

function isDistributions(data: unknown): data is DistributionsBody {
  return typeof data === "object" && data !== null && "bins" in data && "statistics" in data;
}

const EIGHT = ["finite_count", "mean", "median", "standard_deviation", "skewness", "excess_kurtosis", "percentile_25", "percentile_75", "minimum", "maximum"] as const;

export function DistributionsTab({ controls, set, overview }: TabProps) {
  const timeframe = timeframeOf(controls);
  const groups = [...new Set((overview?.catalogue ?? []).map((row) => row.talib_group))].sort();
  const group = groups.includes(controls.distributionGroup) ? controls.distributionGroup : (groups[0] ?? controls.distributionGroup);
  const query = useStudyQuery<unknown>("indicator-study", { part: "distributions", timeframe, variant: controls.distributionVariant, group }, { enabled: groups.length > 0 });
  const body = isDistributions(query.data?.data) ? query.data.data : null;
  const byColumn = new Map<string, HistogramBinRow[]>();
  for (const bin of body?.bins ?? []) {
    const list = byColumn.get(bin.column_name) ?? [];
    list.push(bin);
    byColumn.set(bin.column_name, list);
  }
  const statistics = new Map((body?.statistics ?? []).map((row) => [row.column_name, row]));
  return (
    <Section title="8 · Every column, seen" question="One histogram per indicator in the chosen TA-Lib group, with the eight numbers beside them (mean, median, standard deviation, skewness, excess kurtosis, 25th and 75th percentiles, minimum, maximum).">
      <div className="space-y-2">
        <ControlBar>
          <SelectControl label="TA-Lib group" value={group} options={groups.map((value) => ({ value, label: value }))} onChange={(value) => set("distributionGroup", value)} />
          <SegmentControl label="Values" value={controls.distributionVariant} options={[{ value: "transformed", label: "transformed" }, { value: "raw", label: "raw" }]} onChange={(value) => set("distributionVariant", value)} />
          <SwitchControl label="Log-scale the bar counts (+1)" checked={controls.logCounts} onChange={(value) => set("logCounts", value)} />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={query.data?.notes ?? []} />
          {byColumn.size > 0 ? (
            <>
              <Finding>
                {fmtInt(byColumn.size)} indicators in {group} at {timeframe}, {controls.distributionVariant} values; bins as the study built them. Hover a bin for its range and count.
              </Finding>
              <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
                {[...byColumn.entries()].map(([column, bins]) => {
                  const sorted = [...bins].sort((a, b) => a.bin_index - b.bin_index);
                  const edges = [...sorted.map((bin) => bin.bin_lower), sorted[sorted.length - 1]?.bin_upper ?? 0];
                  const summary = statistics.get(column);
                  return (
                    <MiniHistogram
                      key={column}
                      title={column}
                      subtitle={summary ? `n ${fmtInt(summary.finite_count)} · mean ${fmt(summary.mean, 3)} · median ${fmt(summary.median, 3)} · sd ${fmt(summary.standard_deviation, 3)} · skew ${fmt(summary.skewness, 2)} · kurt ${fmt(summary.excess_kurtosis, 2)}` : undefined}
                      edges={edges}
                      series={[{ heights: sorted.map((bin) => bin.bar_count), color: "#56B4E9", style: "fill", label: "bars" }]}
                      logScale={controls.logCounts}
                      formatEdge={(value) => (Math.abs(value) >= 1e4 || (Math.abs(value) < 1e-3 && value !== 0) ? value.toExponential(2) : fmt(value, 3))}
                      formatHeight={(value) => fmtInt(value)}
                      height={100}
                    />
                  );
                })}
              </div>
              <DataTable
                rows={body?.statistics ?? []}
                rowKey={(row) => row.column_name}
                pageSize={20}
                columns={[
                  { key: "column_name", label: "column_name", value: (row) => row.column_name },
                  ...EIGHT.map((key) => ({
                    key,
                    label: key,
                    value: (row: DistributionsBody["statistics"][number]) => row[key],
                    numeric: true,
                    format: (value: unknown) => (key === "finite_count" ? fmtInt(value as number) : fmt(value as number | null, 4)),
                  })),
                ]}
              />
            </>
          ) : (
            <Empty>Nothing finite to draw in this group.</Empty>
          )}
        </StudyState>
      </div>
    </Section>
  );
}

const CATALOGUE_KEYS: Array<keyof CatalogueRow> = [
  "timeframe", "column_name", "talib_function", "talib_output", "talib_group", "parameters", "lookback_bars", "feature_kind", "transformation_formula",
  "pattern_semantics", "semantics_description", "null_count", "infinite_count", "excluded_reason", "duplicate_of",
];

export function CatalogueTab({ controls, overview }: TabProps) {
  const [filter, setFilter] = useState("");
  const rows = (overview?.catalogue ?? []).filter((row) => !filter || CATALOGUE_KEYS.some((key) => String(row[key] ?? "").toLowerCase().includes(filter.toLowerCase())));
  const columns: Array<Column<CatalogueRow>> = CATALOGUE_KEYS.map((key) => ({
    key,
    label: key,
    value: (row) => row[key] as string | number | null,
    numeric: key === "lookback_bars" || key === "null_count" || key === "infinite_count",
  }));
  const excluded = (overview?.catalogue ?? []).filter((row) => row.excluded_reason !== null).length;
  const duplicates = (overview?.catalogue ?? []).filter((row) => row.duplicate_of !== null).length;
  return (
    <Section title="9 · The catalogue: what every column is and how it was scored" question={`Every TA-Lib output at ${timeframeOf(controls)}, its function, parameters, warm-up, kind, the transformation applied before scoring, and why a column was excluded or scored as a duplicate.`}>
      <div className="space-y-2">
        <ControlBar>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">Filter any field</span>
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="rsi, Momentum, price_level…" className="h-7 w-56 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" />
          </label>
        </ControlBar>
        <Finding>
          {fmtInt(overview?.catalogue.length ?? 0)} columns at this timeframe; {fmtInt(excluded)} excluded (null, infinite or constant here) and {fmtInt(duplicates)} scored once under
          another name.
        </Finding>
        <DataTable rows={rows} columns={columns} rowKey={(row) => row.column_name} pageSize={25} />
      </div>
    </Section>
  );
}
