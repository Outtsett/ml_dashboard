/**
 * Sums and fingerprints. Both engines accumulate float sums plainly and
 * order-dependently, so a sum is compared to a relative 1e-9; the fingerprint
 * (an exclusive-or over the raw IEEE-754 bits of every double) is exact and
 * order-independent, so it settles the floats rather than calling them close.
 */

import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { AXIS, ControlBar, FormulaCard, Finding, GRID, OKABE, SelectControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import {
  SUM_RELATIVE_TOLERANCE, nonNullBySlice,
  type CheckRow, type FingerprintRow, type SumDifference,
} from "@shared/studies/market-bars-validation";
import { compact, outcomeLabel } from "./format";

/** Exactly equal sums cannot sit on a log axis; they are drawn at this floor and labelled. */
const EXACT_FLOOR = 1e-17;

export function Sums({
  sums, fingerprints, checks, column, onColumn, slice, onSlice,
}: {
  sums: readonly SumDifference[];
  fingerprints: readonly FingerprintRow[];
  checks: readonly CheckRow[];
  column: string;
  onColumn: (value: string) => void;
  slice: string;
  onSlice: (value: string) => void;
}) {
  if (sums.length === 0 && fingerprints.length === 0) return <p className="text-xs text-neutral-500">The sum and fingerprint tiers have not been run in this pass.</p>;

  const slices = [...new Set(sums.map((row) => row.slice))].sort();
  const columnNames = [...new Set([...sums.map((row) => row.column), ...fingerprints.map((row) => row.column)])].sort();
  const chosenColumn = columnNames.includes(column) ? column : (columnNames[0] ?? "");
  const shown = column === "all" ? sums : sums.filter((row) => row.column === chosenColumn);
  const points = shown.map((row) => ({
    x: slices.indexOf(row.slice),
    y: Math.max(row.relativeDifference, EXACT_FLOOR),
    exact: row.relativeDifference === 0,
    column: row.column,
    slice: row.slice,
    difference: row.relativeDifference,
    matched: row.matched,
  }));
  const drifting = points.filter((point) => !point.exact);
  const exact = points.filter((point) => point.exact);
  const worst = sums[0];

  const sumRows = sums.filter((row) => row.column === chosenColumn);
  const chosenSlice = sumRows.find((row) => row.slice === slice) ?? sumRows[0];
  const fingerprintRows = fingerprints.filter((row) => row.column === chosenColumn);
  const fingerprint = fingerprintRows.find((row) => row.slice === (chosenSlice?.slice ?? slice)) ?? fingerprintRows[0];
  const rowsInSlice = fingerprint ? nonNullBySlice(checks, chosenColumn).find((entry) => entry.slice === fingerprint.slice)?.nonNullRows ?? null : null;
  const failingSums = sums.filter((row) => !row.matched).length;
  const failingFingerprints = fingerprints.filter((row) => !row.matched).length;

  return (
    <div className="min-w-0 space-y-3">
      <Finding>
        {sums.length} sums compared: {failingSums} outside tolerance. The largest relative difference is {worst ? `${worst.relativeDifference.toExponential(2)} (${worst.column}, ${worst.slice})` : "—"},
        against a tolerance of {SUM_RELATIVE_TOLERANCE.toExponential(0)}. {fingerprints.length} fingerprints compared bit for bit: {failingFingerprints} differ.
      </Finding>
      <ControlBar>
        <SelectControl label="Column" value={column === "all" ? "all" : chosenColumn} options={[{ value: "all", label: "all columns" }, ...columnNames.map((name) => ({ value: name, label: name }))]} onChange={onColumn} hint="Filters the chart; the formulas below use the column you pick, or the first when all is shown" />
        <SelectControl label="Slice" value={chosenSlice?.slice ?? ""} options={(sumRows.length > 0 ? sumRows.map((row) => row.slice) : slices).map((name) => ({ value: name, label: name }))} onChange={onSlice} />
      </ControlBar>
      <p className="flex flex-wrap gap-x-4 text-[11px] text-neutral-400">
        <span><span style={{ color: OKABE.orange }}>●</span> sums differ in the last bits</span>
        <span><span style={{ color: OKABE.blue }}>◆</span> sums exactly equal (drawn at the floor)</span>
        <span><span style={{ color: OKABE.vermillion }}>┄</span> tolerance {SUM_RELATIVE_TOLERANCE.toExponential(0)}</span>
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 28 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" dataKey="x" domain={[-0.5, Math.max(0, slices.length - 0.5)]} ticks={slices.map((_, index) => index)} tickFormatter={(value: number) => slices[value] ?? ""} interval={0} angle={-20} textAnchor="end" height={48} {...AXIS} />
          <YAxis type="number" dataKey="y" scale="log" domain={[1e-18, 1e-8]} allowDataOverflow {...AXIS} tickFormatter={(value: number) => value.toExponential(0)} width={52} />
          <ZAxis range={[40, 40]} />
          <ReferenceLine y={SUM_RELATIVE_TOLERANCE} stroke={OKABE.vermillion} strokeDasharray="5 3" label={{ value: "tolerance 1e-9", fill: OKABE.vermillion, fontSize: 10, position: "insideTopRight" }} />
          <Tooltip
            {...TOOLTIP}
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
              if (!point) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{point.column} · {point.slice}</div>
                  <div>relative difference {point.exact ? "0 (exactly equal)" : point.difference.toExponential(3)}</div>
                  <div>{outcomeLabel(point.matched)}</div>
                </div>
              );
            }}
          />
          <Scatter name="differs in the last bits" data={drifting} fill={OKABE.orange} shape="circle" isAnimationActive={false} />
          <Scatter name="exactly equal" data={exact} fill={OKABE.blue} shape="diamond" isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>

      {chosenSlice && (
        <FormulaCard
          tex={"\\delta=\\frac{\\lvert s_{\\text{lake}}-s_{\\text{pg}}\\rvert}{\\max\\left(\\lvert s_{\\text{lake}}\\rvert,\\ \\lvert s_{\\text{pg}}\\rvert,\\ 1\\right)}\\ \\le\\ \\varepsilon"}
          caption={`${chosenSlice.column} in ${chosenSlice.slice}: ${outcomeLabel(chosenSlice.matched)}. Integer columns are compared exactly, floats to ε.`}
          symbols={[
            { tex: "\\delta", name: "relative difference of the two sums", value: chosenSlice.relativeDifference === 0 ? "0" : chosenSlice.relativeDifference.toExponential(3) },
            { tex: "s_{\\text{lake}}", name: "sum of the column over the slice, in the lake (DuckDB)", value: compact(chosenSlice.lakeSum, 6) },
            { tex: "s_{\\text{pg}}", name: "the same sum in PostgreSQL", value: compact(chosenSlice.postgresSum, 6) },
            { tex: "\\lvert s_{\\text{lake}}-s_{\\text{pg}}\\rvert", name: "absolute difference", value: compact(Math.abs(chosenSlice.lakeSum - chosenSlice.postgresSum), 6) },
            { tex: "\\varepsilon", name: "tolerance: between the typical 6e-12 accumulation error and the worst case 1.6e-7", value: SUM_RELATIVE_TOLERANCE.toExponential(0) },
          ]}
        />
      )}

      {fingerprint && (
        <FormulaCard
          tex={"F_{\\text{side}}=\\bigoplus_{i=1}^{n}\\operatorname{bits}(x_i),\\qquad F_{\\text{lake}}=F_{\\text{pg}}"}
          caption={`${fingerprint.column} in ${fingerprint.slice}: ${outcomeLabel(fingerprint.matched)}. The exclusive-or is order-independent and exact, so one differing bit in any row would change it.`}
          symbols={[
            { tex: "F_{\\text{lake}}", name: "fingerprint of the column in the lake (signed 64-bit integer)", value: fingerprint.lakeBits ?? "—" },
            { tex: "F_{\\text{pg}}", name: "fingerprint of the column in PostgreSQL", value: fingerprint.postgresBits ?? "—" },
            { tex: "\\bigoplus", name: "bitwise exclusive-or, folded over every row", value: "bit_xor" },
            { tex: "i", name: "row index", value: rowsInSlice === null ? "1 … n" : `1 … ${fmtInt(rowsInSlice)}` },
            { tex: "n", name: "non-null rows of the column in the slice", value: fmtInt(rowsInSlice) },
            { tex: "\\operatorname{bits}(x_i)", name: "the 64 IEEE-754 bits of the double x_i, read as an integer", value: "64 bits" },
          ]}
        />
      )}

      {fingerprintRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-neutral-500">
                {["slice", "lake fingerprint", "PostgreSQL fingerprint", "outcome"].map((heading) => <th key={heading} className="px-2 py-1 font-normal">{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {fingerprintRows.map((row) => (
                <tr key={row.slice} className="border-t border-neutral-900">
                  <td className="px-2 py-0.5 text-neutral-300">{row.slice}</td>
                  <td className="px-2 py-0.5 font-mono tnum text-neutral-200">{row.lakeBits ?? "None"}</td>
                  <td className="px-2 py-0.5 font-mono tnum text-neutral-200">{row.postgresBits ?? "None"}</td>
                  <td className="px-2 py-0.5" style={{ color: row.matched ? OKABE.blue : OKABE.vermillion }}>{outcomeLabel(row.matched)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-neutral-500">Relative differences on a log axis: {fmt(points.length, 0)} sums shown.</p>
    </div>
  );
}
