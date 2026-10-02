/**
 * One small panel per column of a frame, so nothing in a table is summarised
 * without also being seen. The panel follows the column's data: a number gets a
 * histogram and its eight numbers; a label column gets a count per value; a
 * long-text column gets the characters written per row. The bins, the values
 * shown and the log scale are the page's controls.
 */

import { scaleSymlog } from "d3";
import type { ReactNode } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildColumnPanel, type ColumnPanel, type PanelBin } from "@shared/studies/data-lifecycle-audit";
import { OKABE, TOOLTIP, fmtInt } from "@/studies/kit";
import { compact, compactPanel } from "./style";

export interface PanelColumn {
  name: string;
  numeric: boolean;
}

const SUMMARY_KEYS = [
  ["mean", "mean"], ["median", "median"], ["standardDeviation", "sd"], ["skewness", "skew"],
  ["kurtosis", "kurt"], ["percentile25", "p25"], ["percentile75", "p75"], ["minimum", "min"], ["maximum", "max"],
] as const;

function Frame({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="truncate text-[11px] font-medium text-neutral-100" title={title}>{title}</div>
      {note && <p className="text-[10px] text-neutral-500">{note}</p>}
      {children}
    </div>
  );
}

function Histogram({ bins, logScale, color, unit }: { bins: PanelBin[]; logScale: boolean; color: string; unit: string }) {
  const data = bins.map((bin) => ({ middle: (bin.lower + bin.upper) / 2, count: bin.count, lower: bin.lower, upper: bin.upper }));
  return (
    <ResponsiveContainer width="100%" height={130}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={0}>
        <XAxis dataKey="middle" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => compactPanel(value)} tick={{ fontSize: 9, fill: "#8a8a8a" }} tickCount={3} height={16} />
        <YAxis scale={logScale ? scaleSymlog() : "linear"} domain={[0, "auto"]} tick={{ fontSize: 9, fill: "#8a8a8a" }} width={30} allowDecimals={false} />
        <Tooltip
          {...TOOLTIP}
          formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "rows"]}
          labelFormatter={(_label, payload) => {
            const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
            return bin ? `${compact(bin.lower)} to ${compact(bin.upper)} ${unit}` : "";
          }}
        />
        <Bar dataKey="count" fill={color} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function shorten(value: string, limit = 18): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function CategoryBars({ panel, logScale }: { panel: Extract<ColumnPanel, { kind: "category" }>; logScale: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(72, 17 * panel.values.length + 18)}>
      <BarChart data={panel.values} layout="vertical" margin={{ top: 2, right: 26, left: 0, bottom: 0 }}>
        <XAxis type="number" scale={logScale ? scaleSymlog() : "linear"} domain={[0, "auto"]} tick={{ fontSize: 9, fill: "#8a8a8a" }} allowDecimals={false} height={16} />
        <YAxis type="category" dataKey="value" width={104} tick={{ fontSize: 9, fill: "#d4d4d4" }} interval={0} tickFormatter={(value: string) => shorten(value)} />
        <Tooltip
          {...TOOLTIP}
          formatter={(value) => [fmtInt(Number(value)), "rows"]}
          labelFormatter={(label) => String(label)}
        />
        <Bar dataKey="count" fill={OKABE.blue} isAnimationActive={false} label={{ position: "right", fontSize: 9, fill: "#a3a3a3" }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Numbers({ panel }: { panel: Extract<ColumnPanel, { kind: "number" | "text" }> }) {
  const summary = panel.summary;
  return (
    <dl className="mt-1 grid grid-cols-3 gap-x-2 text-[10px] font-mono tnum">
      <dt className="col-span-3 text-neutral-500">n {fmtInt(summary.count)}</dt>
      {SUMMARY_KEYS.map(([key, label]) => (
        <div key={key} className="flex justify-between gap-1">
          <span className="text-neutral-500">{label}</span>
          <span className="min-w-0 truncate text-neutral-200" title={String(summary[key] ?? "")}>{compactPanel(summary[key] as number | null)}</span>
        </div>
      ))}
    </dl>
  );
}

function PanelBody({ panel, logScale }: { panel: ColumnPanel; logScale: boolean }) {
  const title = panel.column.replace(/_/g, " ");
  if (panel.kind === "number") {
    return (
      <Frame title={title}>
        <Histogram bins={panel.bins} logScale={logScale} color={OKABE.blue} unit="" />
        <Numbers panel={panel} />
      </Frame>
    );
  }
  if (panel.kind === "category") {
    return (
      <Frame title={`${title} (${fmtInt(panel.distinct)} distinct)`}>
        <CategoryBars panel={panel} logScale={logScale} />
      </Frame>
    );
  }
  return (
    <Frame title={`${title}: characters written per row`} note={`${fmtInt(panel.distinct)} distinct values, nearly every row different`}>
      <Histogram bins={panel.bins} logScale={logScale} color={OKABE.orange} unit="characters" />
      <Numbers panel={panel} />
    </Frame>
  );
}

export function ColumnPanels({ rows, columns, top, bins, logScale }: {
  /** Any row objects: a page's own interface works without an index signature. */
  rows: readonly object[];
  columns: readonly PanelColumn[];
  top: number;
  bins: number;
  logScale: boolean;
}) {
  if (rows.length === 0) return <p className="text-xs text-neutral-500">No rows, so no column to draw.</p>;
  const panels = columns
    .map((column) => buildColumnPanel(column.name, rows.map((row) => (row as Record<string, unknown>)[column.name]), column.numeric, top, bins))
    .filter((panel): panel is ColumnPanel => panel !== null);
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
      {panels.map((panel) => (
        <PanelBody key={panel.column} panel={panel} logScale={logScale} />
      ))}
    </div>
  );
}
