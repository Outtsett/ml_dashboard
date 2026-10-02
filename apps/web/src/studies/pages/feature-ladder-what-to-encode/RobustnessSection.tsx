/**
 * Panel F: does the ladder's order decide the answer? The same blocks under
 * two orderings, on the two magnitude targets. Orange solid bars are the
 * original order (derivatives before volume); sky striped bars are the
 * re-run with volume ahead of both derivatives.
 */

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Empty, Finding, GRID, OKABE, TOOLTIP, fmt } from "@/studies/kit";
import {
  ORDERING_LABEL,
  blockLabel,
  finalScore,
  robustnessRows,
  signed,
  targetLabel,
  type LadderRow,
} from "@shared/studies/feature-ladder-what-to-encode";

const FACETS = ["next_bar_range", "next_open_gap_magnitude"] as const;

function Facet({ rows, target }: { rows: readonly LadderRow[]; target: string }) {
  const comparison = robustnessRows(rows, target);
  const data = comparison.map((row) => ({
    block: blockLabel(row.block),
    derivatives_first: row.derivativesFirst,
    volume_first: row.volumeFirst,
    row,
  }));
  const patternId = `volume-first-stripes-${target}`;
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium text-neutral-200">{targetLabel(target)}</div>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 14, left: 6, bottom: 18 }} barGap={1}>
          <defs>
            <pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={OKABE.sky} fillOpacity={0.25} />
              <line x1="0" y1="0" x2="0" y2="6" stroke={OKABE.sky} strokeWidth="3" />
            </pattern>
          </defs>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={(value: number) => value.toFixed(3)} label={{ value: "increment this block adds, out of sample", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
          <YAxis type="category" dataKey="block" width={150} {...AXIS} interval={0} />
          <ReferenceLine x={0} stroke={OKABE.grey} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!point) return null;
              const row = point.row;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{point.block}</div>
                  <div>
                    ■ {ORDERING_LABEL.derivatives_first}: {signed(row.derivativesFirst)} {row.derivativesFirstEarned ? "✓" : "○"}
                  </div>
                  <div>
                    ▨ {ORDERING_LABEL.volume_first}: {signed(row.volumeFirst)} {row.volumeFirstEarned ? "✓" : "○"}
                  </div>
                  <div>difference {signed(row.difference)}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="derivatives_first" name={ORDERING_LABEL.derivatives_first} fill={OKABE.orange} isAnimationActive={false} />
          <Bar dataKey="volume_first" name={ORDERING_LABEL.volume_first} fill={`url(#${patternId})`} stroke={OKABE.sky} strokeWidth={1.5} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RobustnessSection({ rows }: { rows: readonly LadderRow[] }) {
  const hasBoth = rows.some((row) => row.ordering === "volume_first") && rows.some((row) => row.ordering === "derivatives_first");
  if (!hasBoth) return <Empty>Both ladder orderings are needed for this comparison and one is not landed.</Empty>;

  const tracked: Array<{ block: string; target: string }> = [
    { block: "volatility_rate_of_change", target: "next_bar_range" },
    { block: "momentum_rate_of_change", target: "next_bar_range" },
    { block: "volume_conditioned_body", target: "next_open_gap_magnitude" },
  ];

  const rangeRows = robustnessRows(rows, "next_bar_range");
  const volatilityRow = rangeRows.find((row) => row.block === "volatility_rate_of_change");
  const momentumRow = rangeRows.find((row) => row.block === "momentum_rate_of_change");
  const bodyRow = robustnessRows(rows, "next_open_gap_magnitude").find((row) => row.block === "volume_conditioned_body");

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.orange }}>■ solid orange</span> {ORDERING_LABEL.derivatives_first} · <span style={{ color: OKABE.sky }}>▨ striped sky</span> {ORDERING_LABEL.volume_first}. A block whose two bars match is order-robust; a block whose gain collapses when volume goes first was only ever borrowing volume's information.
      </p>
      <div className="grid gap-3 xl:grid-cols-2">
        {FACETS.map((target) => (
          <Facet key={target} rows={rows} target={target} />
        ))}
      </div>
      <table className="w-full text-[11px] font-mono tnum">
        <thead>
          <tr className="text-neutral-500">
            <th className="py-0.5 text-left font-normal">block</th>
            <th className="py-0.5 text-left font-normal">target</th>
            <th className="py-0.5 text-right font-normal">derivatives first</th>
            <th className="py-0.5 text-right font-normal">volume first</th>
            <th className="py-0.5 text-right font-normal">difference</th>
          </tr>
        </thead>
        <tbody>
          {tracked.map(({ block, target }) => {
            const row = robustnessRows(rows, target).find((entry) => entry.block === block);
            return (
              <tr key={`${block}-${target}`} className="border-t border-neutral-900">
                <td className="py-0.5 text-neutral-300">{blockLabel(block)}</td>
                <td className="py-0.5 text-neutral-400">{targetLabel(target)}</td>
                <td className="py-0.5 text-right text-neutral-200">{signed(row?.derivativesFirst)}</td>
                <td className="py-0.5 text-right text-neutral-200">{signed(row?.volumeFirst)}</td>
                <td className="py-0.5 text-right text-neutral-200">{signed(row?.difference)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Finding>
        Final score on next bar's range: {fmt(finalScore(rows, "derivatives_first", "next_bar_range"), 4)} one way, {fmt(finalScore(rows, "volume_first", "next_bar_range"), 4)} the other: the same total, split slightly differently. The volatility derivative adds {signed(volatilityRow?.derivativesFirst)} with derivatives first and {signed(volatilityRow?.volumeFirst)} with volume first, so it keeps its gain with the other already present: complementary, not redundant. The volume-conditioned body adds {signed(bodyRow?.derivativesFirst)} and {signed(bodyRow?.volumeFirst)} on the gap magnitude, which is order-robust. The rate of change of momentum adds {signed(momentumRow?.derivativesFirst)} and {signed(momentumRow?.volumeFirst)} on range: nothing in either order.
      </Finding>
      <Finding>
        A caution the notebook states: <code>analytics/volrange/forecast.py</code> reports a vol-of-vol term (<code>range_disp_z</code>) adding −0.0000194 out-of-sample R squared. That is a different construction (a dispersion z-score of range), whereas the block here is a log ratio of trailing ranges, the growth rate. Same English phrase, different quantity, opposite result: "rate of change of volatility" names a family of features, and which member you build decides the answer.
      </Finding>
    </div>
  );
}
