/**
 * Panel B: which reading of volume relates to which part of the candle.
 * Spearman rank correlation per (reading, candle part), one small panel per
 * part with its five readings, on the chosen timeframe and bar population.
 */

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { interpolateCividis } from "d3-scale-chromatic";
import { AXIS, Finding, GRID, Section, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import { ENCODING_ORDER, MEASURE_ORDER, compareRankReading, type BoardOverallRow } from "@shared/studies/volume-candle-anatomy";
import { POPULATION_LABEL, SHORT_ENCODING, SHORT_MEASURE, shortName, type Controls } from "./controls";

export function selectRows(rows: readonly BoardOverallRow[], controls: Pick<Controls, "timeframe" | "population" | "hideTautology">): BoardOverallRow[] {
  return rows.filter((row) => row.timeframe === controls.timeframe && row.bar_population === controls.population && !(controls.hideTautology && row.pairing_shares_a_construction_term));
}

export function ReadingsPanel({ rows, controls }: { rows: readonly BoardOverallRow[]; controls: Controls }) {
  const view = selectRows(rows, controls).filter((row) => row.spearman_correlation !== null);
  const comparison = compareRankReading(rows);
  const best = [...view].sort((a, b) => (b.spearman_correlation as number) - (a.spearman_correlation as number))[0];
  return (
    <Section
      title="B. Which reading of volume relates to which part of the candle"
      question="Spearman rank correlation, so a fat tail cannot manufacture a result. Orange-to-yellow bars are positive, dark blue negative; the sign is also the bar's direction from zero."
    >
      <div className="space-y-2">
        <Finding>
          <strong>Solution line: use volume_rank_trailing as the volume column in any new candle feature block.</strong> Measured on the landed rows (bars closing inside their range, pairings that share no construction term), it ranks above both the raw count
          and the chart&apos;s own bar height in {comparison.rankBeatsBoth} of {comparison.cellCount} timeframe and candle-part cells
          {comparison.exceptions.length > 0 && (
            <>; the exceptions are {comparison.exceptions.map((entry) => `${entry.timeframe} ${SHORT_MEASURE[entry.anatomy_measure] ?? entry.anatomy_measure} (rank ${fmt(entry.rank, 3)} against ${fmt(Math.max(entry.raw, entry.height), 3)})`).join(", ")}</>
          )}.
        </Finding>
        <Finding>
          {controls.timeframe}, {POPULATION_LABEL[controls.population]?.replace(" (the control)", "")}.{" "}
          {best && (
            <>
              Strongest honest link: <strong>{best.volume_encoding}</strong> against <strong>{best.anatomy_measure}</strong> at Spearman{" "}
              <strong>{fmt(best.spearman_correlation, 4)}</strong> on {fmtInt(best.bar_count)} bars.
            </>
          )}
        </Finding>
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
          {MEASURE_ORDER.map((measure) => {
            const data = ENCODING_ORDER.map((encoding) => view.find((row) => row.anatomy_measure === measure && row.volume_encoding === encoding))
              .filter((row): row is BoardOverallRow => row !== undefined)
              .map((row) => ({ label: SHORT_ENCODING[row.volume_encoding] ?? row.volume_encoding, spearman: row.spearman_correlation as number, row }));
            return (
              <div key={measure} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={measure}>{shortName(measure)}</div>
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={data} layout="vertical" margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...GRID} horizontal={false} />
                    <XAxis type="number" domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} {...AXIS} />
                    <YAxis type="category" dataKey="label" width={70} {...AXIS} interval={0} />
                    <ReferenceLine x={0} stroke="#8a8a8a" />
                    <Tooltip
                      {...TOOLTIP}
                      content={({ payload }) => {
                        const row = (payload?.[0]?.payload as { row: BoardOverallRow } | undefined)?.row;
                        if (!row) return null;
                        return (
                          <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                            <div className="font-semibold">{row.volume_encoding} × {SHORT_MEASURE[row.anatomy_measure]}</div>
                            <div>Spearman {fmt(row.spearman_correlation, 4)} · Pearson {fmt(row.pearson_correlation, 4)}</div>
                            <div>{fmtInt(row.bar_count)} bars · mutual information excess {fmt(row.mutual_information_excess_ratio, 2)}</div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="spearman" isAnimationActive={false} stroke="#d4d4d4" strokeWidth={0.5}>
                      {data.map((entry) => (
                        <Cell key={entry.label} fill={interpolateCividis(0.3 + 0.7 * ((entry.spearman + 1) / 2))} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
