/**
 * One-minute log return (basis points), brushed span against the rest of
 * history: the nine statistics plus the tails as a table, the two densities
 * overlaid, and the skewness and kurtosis formulas as operable objects (how
 * much does one return of a chosen size add to each sum?).
 */

import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, FormulaCard, GRID, OKABE, SliderControl, SwitchControl, ControlBar, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import type { DensityBin, DistributionSummary } from "@shared/studies/eurusd-reactivity";

type Statistic = Exclude<keyof DistributionSummary, "group">;

const ROWS: Array<[Statistic, string]> = [
  ["count", "count of one-minute returns"],
  ["mean", "mean"],
  ["median", "median"],
  ["standard_deviation", "standard deviation"],
  ["skewness", "skewness"],
  ["excess_kurtosis", "excess kurtosis"],
  ["percentile_1", "1st percentile"],
  ["percentile_5", "5th percentile"],
  ["percentile_25", "25th percentile"],
  ["percentile_75", "75th percentile"],
  ["percentile_95", "95th percentile"],
  ["percentile_99", "99th percentile"],
  ["minimum", "minimum"],
  ["maximum", "maximum"],
];

export function DistributionTable({ summaries }: { summaries: readonly DistributionSummary[] }) {
  return (
    <table className="w-full text-[11px] font-mono tnum">
      <thead>
        <tr className="text-neutral-500">
          <th className="py-0.5 text-left font-normal">statistic</th>
          {summaries.map((summary) => (
            <th key={summary.group} className="py-0.5 text-right font-normal">
              {summary.group === "brushed" ? "■ brushed" : "◆ rest of history"}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROWS.map(([key, label]) => (
          <tr key={key} className="border-t border-neutral-900">
            <td className="py-0.5 text-neutral-400">{label}</td>
            {summaries.map((summary) => (
              <td key={summary.group} className="py-0.5 text-right text-neutral-200">
                {key === "count" ? fmtInt(summary.count) : fmt(summary[key] as number | null, 4)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DensityChart({ density, range }: { density: readonly DensityBin[]; range: [number, number] | null }) {
  const [logScale, setLogScale] = useState(true);
  const floor = 1e-6;
  const data = density.map((bin) => ({
    middle: (bin.lower + bin.upper) / 2,
    brushed: Math.max(bin.brushed_density, floor),
    rest: Math.max(bin.rest_density, floor),
    brushedCount: bin.brushed_count,
    restCount: bin.rest_count,
  }));
  if (data.length === 0) return <p className="py-6 text-center text-xs text-neutral-500">No density: one group is empty or has no spread.</p>;
  return (
    <div className="space-y-2">
      <ControlBar>
        <SwitchControl label="Log density" checked={logScale} onChange={setLogScale} hint="The tails are where the two groups differ; a log axis shows them" />
        {range && <span className="self-center text-[11px] text-neutral-500">drawn between the 0.5th and 99.5th percentile: {fmt(range[0], 2)} to {fmt(range[1], 2)} bp</span>}
      </ControlBar>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="middle" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => fmt(value, 1)} {...AXIS} />
          <YAxis scale={logScale ? "log" : "linear"} domain={logScale ? [floor * 10, "auto"] : [0, "auto"]} allowDataOverflow {...AXIS} width={48} tickFormatter={(value: number) => (value >= 0.01 ? fmt(value, 2) : value.toExponential(0))} />
          <ReferenceLine x={0} stroke={OKABE.grey} strokeDasharray="4 3" />
          <Tooltip
            {...TOOLTIP}
            labelFormatter={(value) => `${fmt(Number(value), 3)} bp`}
            formatter={(value, name, item) => {
              const payload = item.payload as { brushedCount: number; restCount: number };
              const count = name === "brushed" ? payload.brushedCount : payload.restCount;
              return [`${Number(value).toExponential(2)} per bp (${fmtInt(count)} bars)`, name === "brushed" ? "■ brushed" : "◆ rest of history"];
            }}
          />
          <Area dataKey="brushed" name="brushed" type="monotone" stroke={OKABE.orange} fill={OKABE.orange} fillOpacity={0.3} strokeWidth={2} isAnimationActive={false} baseValue={floor} />
          <Line dataKey="rest" name="rest" type="monotone" stroke={OKABE.blue} strokeWidth={2} strokeDasharray="6 3" dot={{ r: 2, fill: OKABE.blue }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.orange }}>■ solid, filled: brushed span</span> · <span style={{ color: OKABE.blue }}>◆ dashed, dotted: rest of history</span> · each normalised to area 1
      </p>
    </div>
  );
}

/** Skewness and kurtosis, with one probe return standing in for any term of the sums. */
export function MomentFormulas({ summary }: { summary: DistributionSummary | undefined }) {
  const [probe, setProbe] = useState<number | null>(null);
  if (!summary || summary.standard_deviation === null || summary.mean === null || summary.count < 2) return null;
  const { mean, standard_deviation: deviation, count } = summary;
  const maximum = Math.max(Math.abs(summary.minimum ?? 0), Math.abs(summary.maximum ?? 0), deviation * 3);
  const value = probe === null ? Math.min(maximum, mean + deviation * 10) : probe;
  const z = (value - mean) / deviation;
  const cubeShare = z ** 3 / count;
  const fourthShare = z ** 4 / count;
  return (
    <div className="space-y-2">
      <SliderControl
        label="Probe: one return of"
        value={value}
        min={0}
        max={maximum}
        step={maximum / 400}
        onChange={setProbe}
        format={(v) => `${fmt(v, 2)} bp`}
        hint="Drag to see what a single return this size adds to the skewness and kurtosis sums"
      />
      <div className="grid gap-2 xl:grid-cols-2">
        <FormulaCard
          tex={"\\text{skewness}=\\frac{1}{n}\\sum_{i=1}^{n} z_i^{3},\\qquad z_i=\\frac{x_i-\\bar{x}}{s}"}
          caption={`Group ${summary.group}. The probe return is z = ${fmt(z, 1)} deviations from the mean and adds ${fmt(cubeShare, 5)} to the skewness.`}
          symbols={[
            { tex: "n", name: "one-minute returns in the group", value: fmtInt(count) },
            { tex: "x_i", name: "log return of minute i, basis points", value: `${fmt(value, 2)} (probe)` },
            { tex: "\\bar{x}", name: "mean return, basis points", value: fmt(mean, 5) },
            { tex: "s", name: "standard deviation with n − 1, basis points", value: fmt(deviation, 4) },
            { tex: "z_i", name: "deviations of x_i from the mean", value: fmt(z, 2) },
            { tex: "\\text{skewness}", name: "third standardised moment of the group", value: fmt(summary.skewness, 4) },
          ]}
        />
        <FormulaCard
          tex={"\\text{excess kurtosis}=\\frac{1}{n}\\sum_{i=1}^{n} z_i^{4}-3"}
          caption={`The same probe adds ${fmt(fourthShare, 3)} to the kurtosis sum; a normal distribution sums to 3, so 0 is normal.`}
          symbols={[
            { tex: "z_i^{4}", name: "fourth power of the deviations: a tail return counts for far more than a typical one", value: fmt(z ** 4, 0) },
            { tex: "\\frac{1}{n}z_i^{4}", name: "what this one return adds", value: fmt(fourthShare, 4) },
            { tex: "3", name: "fourth moment of a normal distribution, subtracted", value: "3" },
            { tex: "\\text{excess kurtosis}", name: "fourth standardised moment minus 3", value: fmt(summary.excess_kurtosis, 3) },
          ]}
        />
      </div>
    </div>
  );
}
