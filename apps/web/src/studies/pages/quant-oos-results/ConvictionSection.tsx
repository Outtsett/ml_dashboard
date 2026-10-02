/** Conviction gating: trade only the predictions with the largest magnitude, and see what accuracy and net return do. */

import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, ControlBar, Finding, GRID, OKABE, Section, SwitchControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import type { OosConvictionFoldRow, OosConvictionRow } from "@shared/studies/quant-oos-results";
import { percentOf, sci, signGlyph } from "./format";

/** One colour per fold, each with its own dash pattern so the lines read without colour. */
const FOLD_STYLE = [
  { color: "#56B4E9", dash: "1 0" },
  { color: "#E69F00", dash: "6 3" },
  { color: "#009E73", dash: "2 2" },
  { color: "#CC79A7", dash: "8 2 2 2" },
  { color: "#F0E442", dash: "4 4" },
  { color: "#d4d4d4", dash: "10 3" },
] as const;

const BASIS_POINTS = 10_000;
const FRACTION_TICKS = [0.01, 0.05, 0.1, 0.25, 1];

export function ConvictionSection({
  conviction, byFold, perFold, onPerFold,
}: { conviction: OosConvictionRow[]; byFold: OosConvictionFoldRow[]; perFold: boolean; onPerFold: (value: boolean) => void }) {
  const rows = conviction.map((row) => {
    const cost = row.gross_mean_return_per_trade - row.net_mean_return_per_trade;
    return {
      ...row,
      cost,
      costOverGross: row.gross_mean_return_per_trade > 0 ? cost / row.gross_mean_return_per_trade : null,
      grossBasisPoints: row.gross_mean_return_per_trade * BASIS_POINTS,
      netBasisPoints: row.net_mean_return_per_trade * BASIS_POINTS,
    };
  });
  const ascending = [...rows].sort((a, b) => a.traded_fraction - b.traded_fraction);

  const folds = [...new Set(byFold.map((row) => row.fold_index))].sort((a, b) => a - b);
  const accuracyByFraction = ascending.map((row) => {
    const entry: Record<string, number> = { fraction: row.traded_fraction, pooled: row.directional_accuracy };
    for (const fold of folds) {
      const match = byFold.find((candidate) => candidate.fold_index === fold && candidate.traded_fraction === row.traded_fraction);
      if (match) entry[`fold_${fold}`] = match.directional_accuracy;
    }
    return entry;
  });

  const widest = rows[0];
  const narrowest = rows[rows.length - 1];
  const everyNetNegative = rows.every((row) => row.net_mean_return_per_trade < 0);
  const ratios = rows.map((row) => row.costOverGross).filter((value): value is number => value !== null);
  const ratioLow = ratios.length > 0 ? Math.min(...ratios) : null;
  const ratioHigh = ratios.length > 0 ? Math.max(...ratios) : null;

  return (
    <Section title="C. Conviction gating" question="Trade only the top share of predictions by magnitude. Does accuracy rise, and does net return ever turn positive?">
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[11px] font-mono tnum">
            <thead>
              <tr className="text-neutral-500">
                <th className="py-0.5 text-left font-normal">traded fraction</th>
                <th className="py-0.5 text-right font-normal">trade count</th>
                <th className="py-0.5 text-right font-normal">directional accuracy</th>
                <th className="py-0.5 text-right font-normal">gross mean return per trade</th>
                <th className="py-0.5 text-right font-normal">net mean return per trade</th>
                <th className="py-0.5 text-right font-normal" title="(gross - net) / gross, only where the gross return is positive">cost ÷ gross edge</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.traded_fraction} className="border-t border-neutral-900">
                  <td className="py-0.5 text-neutral-300">top {percentOf(row.traded_fraction)}</td>
                  <td className="py-0.5 text-right text-neutral-200">{fmtInt(row.trade_count)}</td>
                  <td className="py-0.5 text-right text-neutral-200">{fmt(row.directional_accuracy, 4)}</td>
                  <td className="py-0.5 text-right text-neutral-200">{signGlyph(row.gross_mean_return_per_trade)} {sci(row.gross_mean_return_per_trade, 3)}</td>
                  <td className="py-0.5 text-right text-neutral-200">{signGlyph(row.net_mean_return_per_trade)} {sci(row.net_mean_return_per_trade, 3)}</td>
                  <td className="py-0.5 text-right text-neutral-200">{row.costOverGross === null ? "gross ≤ 0" : `${fmt(row.costOverGross, 1)}×`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Finding>
          {widest && narrowest && (
            <>
              Directional accuracy goes from {fmt(widest.directional_accuracy, 4)} trading everything to {fmt(narrowest.directional_accuracy, 4)} on the top {percentOf(narrowest.traded_fraction)}, so the
              prediction&apos;s magnitude carries a little information.{" "}
              {everyNetNegative ? "Net return is negative at every level" : "Net return is positive at some level"}
              {ratioLow !== null && ratioHigh !== null ? `: the cost is ${fmt(ratioLow, 0)} to ${fmt(ratioHigh, 0)} times the gross edge where that edge is positive.` : "."}
            </>
          )}
        </Finding>

        <ControlBar>
          <SwitchControl label="One line per fold" checked={perFold} onChange={onPerFold} hint="Adds each fold's own accuracy curve behind the pooled one" />
        </ControlBar>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <h4 className="mb-1 text-xs font-semibold text-neutral-200">Directional accuracy against the traded fraction</h4>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={accuracyByFraction} margin={{ top: 8, right: 12, left: 4, bottom: 16 }}>
                <CartesianGrid {...GRID} />
                <XAxis
                  type="number" dataKey="fraction" scale="log" domain={[0.01, 1]} ticks={FRACTION_TICKS} {...AXIS}
                  tickFormatter={(v: number) => percentOf(v)}
                  label={{ value: "share of predictions traded (log scale)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }}
                />
                <YAxis domain={["auto", "auto"]} {...AXIS} tickFormatter={(v: number) => fmt(v, 2)} width={40} />
                <ReferenceLine y={0.5} stroke={OKABE.grey} strokeDasharray="4 3" />
                <Tooltip {...TOOLTIP} labelFormatter={(v) => `top ${percentOf(Number(v))}`} formatter={(value, name) => [fmt(Number(value), 4), String(name)]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {perFold &&
                  folds.map((fold) => {
                    const style = FOLD_STYLE[fold % FOLD_STYLE.length] as (typeof FOLD_STYLE)[number];
                    return (
                      <Line
                        key={fold} dataKey={`fold_${fold}`} name={`fold ${fold}`} stroke={style.color} strokeOpacity={0.6} strokeWidth={1.2} strokeDasharray={style.dash}
                        dot={{ r: 2.5, fill: style.color }} isAnimationActive={false}
                      />
                    );
                  })}
                <Line dataKey="pooled" name="pooled (mean over folds)" stroke={OKABE.orange} strokeWidth={2.5} dot={{ r: 4, fill: OKABE.orange }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="min-w-0">
            <h4 className="mb-1 text-xs font-semibold text-neutral-200">Mean return per trade, gross and net of cost (basis points of log return)</h4>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={ascending} margin={{ top: 8, right: 12, left: 4, bottom: 16 }}>
                <CartesianGrid {...GRID} />
                <XAxis
                  type="number" dataKey="traded_fraction" scale="log" domain={[0.01, 1]} ticks={FRACTION_TICKS} {...AXIS}
                  tickFormatter={(v: number) => percentOf(v)}
                  label={{ value: "share of predictions traded (log scale)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }}
                />
                <YAxis {...AXIS} tickFormatter={(v: number) => fmt(v, 1)} width={40} />
                <ReferenceLine y={0} stroke={OKABE.grey} />
                <Tooltip {...TOOLTIP} labelFormatter={(v) => `top ${percentOf(Number(v))}`} formatter={(value, name) => [`${fmt(Number(value), 3)} bp`, String(name)]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line dataKey="grossBasisPoints" name="gross ▲" stroke={OKABE.orange} strokeWidth={2} dot={{ r: 4, fill: OKABE.orange }} isAnimationActive={false} />
                <Line dataKey="netBasisPoints" name="net ■" stroke={OKABE.blue} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 4, fill: OKABE.blue }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Section>
  );
}
