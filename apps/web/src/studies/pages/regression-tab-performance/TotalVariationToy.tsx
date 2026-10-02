/**
 * The shape-error formula worked on a toy grid small enough to see: eight
 * cells instead of the plot's 600. Step the cell index i and the term
 * |p_i - q_i| lights up in the bars and in the running sum; drag the drift to
 * move the drawn picture away from the full one. The toy shares are made up
 * to show the mechanism; the page's real numbers come from the measurements.
 */

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, FormulaCard, GRID, OKABE, SliderControl, TOOLTIP, fmt } from "@/studies/kit";
import { totalVariationSteps } from "@shared/studies/regression-tab-performance";

/** Shares of ALL bars in eight toy cells (they need not sum to 1; they are normalised). */
const REFERENCE = [5, 10, 20, 25, 15, 12, 8, 5];

export function TotalVariationToy() {
  const [cellIndex, setCellIndex] = useState(3);
  const [driftPercent, setDriftPercent] = useState(30);

  const drift = driftPercent / 100;
  const total = REFERENCE.reduce((a, b) => a + b, 0);
  // The drawn picture: each cell keeps (1 - drift) of its true share, and the rest is spread evenly over every cell.
  const drawn = REFERENCE.map((value) => (1 - drift) * (value / total) + drift / REFERENCE.length);
  const steps = totalVariationSteps(REFERENCE, drawn);
  const current = steps[cellIndex - 1] ?? steps[0];
  const final = steps[steps.length - 1];

  const data = steps.map((step) => ({
    cell: step.index,
    "all bars (p)": step.reference,
    "drawn points (q)": step.drawn,
    lit: step.index <= cellIndex,
    current: step.index === cellIndex,
    term: step.term,
  }));

  return (
    <div className="space-y-2">
      <ControlBar>
        <SliderControl label="Cell index i" value={cellIndex} min={1} max={REFERENCE.length} onChange={setCellIndex} format={(v) => `${v} of ${REFERENCE.length}`} hint="Step through the sum one cell at a time" />
        <SliderControl label="Drawn picture drifts by" value={driftPercent} min={0} max={100} onChange={setDriftPercent} format={(v) => `${v}%`} hint="How much of the drawn cloud has moved away from where the bars really are" />
      </ControlBar>
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="min-w-0">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="cell" {...AXIS} label={{ value: "cell i", position: "insideBottom", offset: -2, fill: "#a3a3a3", fontSize: 10 }} />
              <YAxis {...AXIS} tickFormatter={(v: number) => v.toFixed(2)} />
              <Tooltip
                {...TOOLTIP}
                content={({ payload }) => {
                  const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                  if (!row) return null;
                  return (
                    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                      <div className="font-semibold">cell {row.cell}</div>
                      <div>p (all bars) {fmt(row["all bars (p)"], 4)}</div>
                      <div>q (drawn) {fmt(row["drawn points (q)"], 4)}</div>
                      <div>|p - q| {fmt(row.term, 4)}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="all bars (p)" name="all bars (p)" isAnimationActive={false}>
                {data.map((row) => (
                  <Cell key={row.cell} fill={OKABE.blue} fillOpacity={row.lit ? 1 : 0.3} stroke={row.current ? "#fff" : "none"} strokeWidth={row.current ? 2 : 0} />
                ))}
              </Bar>
              <Bar dataKey="drawn points (q)" name="drawn points (q)" isAnimationActive={false}>
                {data.map((row) => (
                  <Cell key={row.cell} fill={OKABE.orange} fillOpacity={row.lit ? 1 : 0.3} stroke={row.current ? "#fff" : "none"} strokeWidth={row.current ? 2 : 0} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-neutral-400">
            <span style={{ color: OKABE.blue }}>■ p, share of all bars</span> · <span style={{ color: OKABE.orange }}>■ q, share of drawn points</span> · unlit cells are not yet in the sum
          </p>
        </div>
        <FormulaCard
          tex={"\\mathrm{TV} = \\tfrac{1}{2}\\sum_{i=1}^{n}\\left|\\,p_i - q_i\\,\\right|"}
          caption={`Toy grid: ${REFERENCE.length} cells (the real plot has 600). Through cell ${cellIndex}, the running sum is ${fmt(current?.runningSum, 4)}; all ${REFERENCE.length} cells give TV = ${fmt(final?.runningTotalVariation, 4)}.`}
          symbols={[
            { tex: "\\mathrm{TV}", name: "total-variation distance: the share of the cloud drawn in the wrong place", value: fmt(final?.runningTotalVariation, 4) },
            { tex: "i", name: "cell index, currently stepped to", value: `${cellIndex}` },
            { tex: "n", name: "number of cells (toy; 600 in the real plot)", value: String(REFERENCE.length) },
            { tex: "p_i", name: "share of ALL bars in cell i", value: fmt(current?.reference, 4) },
            { tex: "q_i", name: "share of the DRAWN points in cell i", value: fmt(current?.drawn, 4) },
            { tex: "\\left|p_i-q_i\\right|", name: "this cell's term", value: fmt(current?.term, 4) },
            { tex: "\\sum", name: "running sum over cells 1 to i", value: fmt(current?.runningSum, 4) },
            { tex: "\\tfrac12", name: "one half: a misplaced point is counted where it is missing and where it is extra", value: "0.5" },
          ]}
        />
      </div>
    </div>
  );
}
