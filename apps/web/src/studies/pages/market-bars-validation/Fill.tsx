/**
 * How full each column is: the validation's own non-null counts read as a data
 * fact. A column that is entirely NULL passes every comparison, because both
 * sides agree there is nothing there, so the fill rate is looked at separately.
 * The formula card steps through the slices whose counts are summed.
 */

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, FormulaCard, Finding, GRID, OKABE, SegmentControl, SelectControl, SliderControl, TOOLTIP, fmt, fmtInt,
} from "@/studies/kit";
import { nonNullBySlice, type CheckRow, type FillRate } from "@shared/studies/market-bars-validation";

export type FillMeasure = "percent" | "rows";
export type FillOrder = "rows" | "name";

function status(entry: FillRate, lakeRowCount: number | null): string {
  if (entry.nonNullRows === 0) return "○ empty";
  if (lakeRowCount !== null && entry.nonNullRows >= lakeRowCount) return "● full";
  return "◐ partial";
}

export function Fill({
  fill, checks, lakeRowCount, measure, onMeasure, order, onOrder, column, onColumn, sliceStep, onSliceStep,
}: {
  fill: readonly FillRate[];
  checks: readonly CheckRow[];
  lakeRowCount: number | null;
  measure: FillMeasure;
  onMeasure: (value: FillMeasure) => void;
  order: FillOrder;
  onOrder: (value: FillOrder) => void;
  column: string;
  onColumn: (value: string) => void;
  sliceStep: number;
  onSliceStep: (value: number) => void;
}) {
  if (fill.length === 0) return <p className="text-xs text-neutral-500">The exact tier has not been run in this pass.</p>;

  const rows = [...fill];
  if (order === "name") rows.sort((a, b) => a.column.localeCompare(b.column));
  const empty = fill.filter((entry) => entry.nonNullRows === 0).map((entry) => entry.column);
  const partial = fill.filter((entry) => entry.nonNullRows > 0 && lakeRowCount !== null && entry.nonNullRows < lakeRowCount);
  const chosen = fill.find((entry) => entry.column === column) ?? fill[0]!;
  const slices = nonNullBySlice(checks, chosen.column);
  const step = Math.min(Math.max(1, sliceStep), Math.max(1, slices.length));
  const runningTotal = slices.slice(0, step).reduce((sum, slice) => sum + (slice.nonNullRows ?? 0), 0);
  const current = slices[step - 1];
  const chartData = rows.map((entry) => ({ ...entry, shown: measure === "percent" ? entry.fillPercent : Math.max(entry.nonNullRows, 1) }));

  return (
    <div className="min-w-0 space-y-3">
      <Finding>
        {empty.length > 0 && <>{empty.length} columns are entirely NULL ({empty.join(", ")}): both sides agree there is nothing in them, so they pass every comparison. </>}
        {partial.length > 0 && <>{partial.length} are partly filled ({partial.map((entry) => `${entry.column} ${fmt(entry.fillPercent, 2)}%`).slice(0, 3).join(", ")}{partial.length > 3 ? ", …" : ""}), which is the share of bars that carry a two-sided quote. </>}
        {fill.length - empty.length - partial.length} are 100% full.
      </Finding>
      <ControlBar>
        <SegmentControl label="Show" value={measure} options={[{ value: "percent", label: "percent filled" }, { value: "rows", label: "non-null rows (log)" }]} onChange={onMeasure} />
        <SegmentControl label="Sort" value={order} options={[{ value: "rows", label: "most filled" }, { value: "name", label: "name" }]} onChange={onOrder} />
      </ControlBar>
      <ResponsiveContainer width="100%" height={Math.max(260, 20 * chartData.length)}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
          <CartesianGrid {...GRID} horizontal={false} />
          {measure === "percent" ? (
            <XAxis type="number" domain={[0, 100]} {...AXIS} tickFormatter={(value: number) => `${value}%`} />
          ) : (
            <XAxis type="number" scale="log" domain={[1, "auto"]} allowDataOverflow {...AXIS} tickFormatter={(value: number) => value.toExponential(0)} />
          )}
          <YAxis type="category" dataKey="column" width={120} {...AXIS} interval={0} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as FillRate | undefined;
              if (!row) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{row.column}</div>
                  <div>{fmtInt(row.nonNullRows)} non-null rows of {fmtInt(lakeRowCount)}</div>
                  <div>fill {fmt(row.fillPercent, 4)}% · {status(row, lakeRowCount)}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="shown" fill={OKABE.orange} isAnimationActive={false} minPointSize={2}>
            <LabelList dataKey="fillPercent" position="right" formatter={(value: unknown) => `${fmt(Number(value), 2)}%`} fontSize={10} fill="#d4d4d4" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <ControlBar>
        <SelectControl label="Column" value={chosen.column} options={fill.map((entry) => ({ value: entry.column, label: entry.column }))} onChange={onColumn} />
        <SliderControl label="Slice s" value={step} min={1} max={Math.max(1, slices.length)} onChange={onSliceStep} format={(value) => `${value} of ${slices.length}`} hint="Step through the slices whose non-null counts are summed" />
      </ControlBar>
      <FormulaCard
        tex={"\\text{fill}_{c}=\\frac{\\sum_{s=1}^{S} n_{c,s}}{N}\\times 100"}
        caption={`Through slice ${step} the running sum is ${fmtInt(runningTotal)} of ${fmtInt(lakeRowCount)} rows.`}
        symbols={[
          { tex: "\\text{fill}_{c}", name: "share of rows where the column is not NULL, in percent", value: `${fmt(chosen.fillPercent, 4)}%` },
          { tex: "c", name: "the column", value: chosen.column },
          { tex: "s", name: "slice: an asset class and timeframe the validation ran separately", value: current ? current.slice : "—" },
          { tex: "S", name: "number of slices", value: String(slices.length) },
          { tex: "n_{c,s}", name: "non-null rows of column c in slice s (lake side)", value: fmtInt(current?.nonNullRows ?? null) },
          { tex: "\\sum_{s=1}^{S} n_{c,s}", name: "non-null rows summed over slices (all of them / through slice s)", value: `${fmtInt(chosen.nonNullRows)} / ${fmtInt(runningTotal)}` },
          { tex: "N", name: "rows in the lake table when it was validated", value: fmtInt(lakeRowCount) },
        ]}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-neutral-500">
              {["column", "non-null rows", "fill percent", "slices", "status"].map((heading) => <th key={heading} className="px-2 py-1 font-normal">{heading}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.column} className="border-t border-neutral-900">
                <td className="px-2 py-0.5 font-mono text-neutral-200">{entry.column}</td>
                <td className="px-2 py-0.5 font-mono tnum text-neutral-200">{fmtInt(entry.nonNullRows)}</td>
                <td className="px-2 py-0.5 font-mono tnum text-neutral-200">{fmt(entry.fillPercent, 4)}</td>
                <td className="px-2 py-0.5 font-mono tnum text-neutral-400">{entry.sliceCount}</td>
                <td className="px-2 py-0.5 text-neutral-300">{status(entry, lakeRowCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
