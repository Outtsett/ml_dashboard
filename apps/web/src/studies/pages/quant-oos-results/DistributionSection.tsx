/**
 * Fold-level distribution of the three headline metrics: all eight numbers,
 * a strip of the six folds for each, and the formulas stepped term by term.
 */

import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SelectControl, SliderControl, TOOLTIP, fmt } from "@/studies/kit";
import { type Distribution, distribution } from "@shared/studies/quant-oos-results";
import type { OosFoldRow } from "@shared/studies/quant-oos-results";
import { small } from "./format";

export const DISTRIBUTION_METRICS = [
  { key: "out_of_sample_r_squared", label: "out-of-sample R²" },
  { key: "directional_accuracy", label: "directional accuracy" },
  { key: "information_coefficient", label: "information coefficient" },
] as const satisfies ReadonlyArray<{ key: keyof OosFoldRow; label: string }>;

type MetricKey = (typeof DISTRIBUTION_METRICS)[number]["key"];

const STATISTICS: ReadonlyArray<{ key: keyof Distribution; label: string }> = [
  { key: "count", label: "count" },
  { key: "mean", label: "mean" },
  { key: "median", label: "median" },
  { key: "standard_deviation", label: "standard deviation" },
  { key: "skewness", label: "skewness" },
  { key: "kurtosis", label: "excess kurtosis" },
  { key: "percentile_25", label: "25th percentile" },
  { key: "percentile_75", label: "75th percentile" },
  { key: "minimum", label: "minimum" },
  { key: "maximum", label: "maximum" },
];

function isMetric(value: string): value is MetricKey {
  return DISTRIBUTION_METRICS.some((metric) => metric.key === value);
}

function Strip({ label, values, summary, highlight }: { label: string; values: number[]; summary: Distribution; highlight: number }) {
  const data = values.map((value, index) => ({ value, row: 0, fold: index, picked: index + 1 === highlight }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="text-[11px] font-medium text-neutral-200">{label}</div>
      <ResponsiveContainer width="100%" height={84}>
        <ScatterChart margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" dataKey="value" domain={["auto", "auto"]} {...AXIS} tickFormatter={(v: number) => small(v, 4)} />
          <YAxis type="number" dataKey="row" hide domain={[-1, 1]} />
          <ReferenceLine x={summary.mean} stroke={OKABE.orange} label={{ value: "mean", fill: OKABE.orange, fontSize: 9, position: "top" }} />
          <ReferenceLine x={summary.median} stroke={OKABE.sky} strokeDasharray="4 3" label={{ value: "median", fill: OKABE.sky, fontSize: 9, position: "insideBottom" }} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
              return point ? (
                <div style={TOOLTIP.contentStyle} className="px-2 py-1 text-[11px]">
                  fold {point.fold}: {fmt(point.value, 6)}
                </div>
              ) : null;
            }}
          />
          <Scatter
            data={data}
            isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number; payload?: { picked: boolean; fold: number } }) => {
              const { cx = 0, cy = 0, payload } = props;
              return (
                <g>
                  <circle cx={cx} cy={cy} r={payload?.picked ? 7 : 4.5} fill={payload?.picked ? OKABE.yellow : OKABE.blue} stroke="#0a0a0a" />
                  <text x={cx} y={cy - 9} textAnchor="middle" fontSize={9} fill="#d4d4d4">{payload?.fold}</text>
                </g>
              );
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DistributionSection({
  folds, metric, step, onMetric, onStep,
}: { folds: OosFoldRow[]; metric: string; step: number; onMetric: (value: string) => void; onStep: (value: number) => void }) {
  const summaries = DISTRIBUTION_METRICS.map((entry) => ({
    ...entry,
    values: folds.map((fold) => fold[entry.key]),
    summary: distribution(folds.map((fold) => fold[entry.key])),
  }));

  const chosen = summaries.find((entry) => entry.key === (isMetric(metric) ? metric : "out_of_sample_r_squared")) ?? (summaries[0] as (typeof summaries)[number]);
  const n = chosen.values.length;
  const i = Math.min(Math.max(1, step), Math.max(1, n));
  const { mean, standard_deviation: deviation, skewness, kurtosis } = chosen.summary;

  const terms = chosen.values.map((x, index) => {
    const d = x - mean;
    return { index: index + 1, x, d, d2: d * d, d3: d ** 3, d4: d ** 4 };
  });
  const upTo = terms.slice(0, i);
  const running = {
    x: upTo.reduce((a, t) => a + t.x, 0),
    d2: upTo.reduce((a, t) => a + t.d2, 0),
    d3: upTo.reduce((a, t) => a + t.d3, 0),
    d4: upTo.reduce((a, t) => a + t.d4, 0),
  };
  const current = terms[i - 1];

  return (
    <Section title="B. Fold-level distribution: all eight numbers, never a bare mean" question="Six folds are six observations, so the spread across folds matters as much as their average.">
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-[11px] font-mono tnum">
            <thead>
              <tr className="text-neutral-500">
                <th className="py-0.5 text-left font-normal">statistic</th>
                {summaries.map((entry) => (
                  <th key={entry.key} className="py-0.5 text-right font-normal">{entry.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STATISTICS.map((statistic) => (
                <tr key={statistic.key} className="border-t border-neutral-900">
                  <td className="py-0.5 text-neutral-400">{statistic.label}</td>
                  {summaries.map((entry) => (
                    <td key={entry.key} className="py-0.5 text-right text-neutral-200">
                      {statistic.key === "count" ? entry.summary.count : fmt(entry.summary[statistic.key], 8)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Finding>
          Out-of-sample R² has a mean of {fmt(summaries[0]?.summary.mean, 6)} with a maximum of {fmt(summaries[0]?.summary.maximum, 6)}: {(summaries[0]?.summary.maximum ?? 0) <= 0 ? "no fold is above zero, so the result cannot be blamed on one bad fold" : "at least one fold is above zero"}. Directional accuracy averages {fmt(summaries[1]?.summary.mean, 4)} with a range of {fmt(summaries[1]?.summary.minimum, 4)} to {fmt(summaries[1]?.summary.maximum, 4)}.
        </Finding>

        <div className="grid gap-2 md:grid-cols-3">
          {summaries.map((entry) => (
            <Strip key={entry.key} label={entry.label} values={entry.values} summary={entry.summary} highlight={entry.key === chosen.key ? i : 0} />
          ))}
        </div>

        <ControlBar>
          <SelectControl
            label="Metric to step through"
            value={chosen.key}
            options={DISTRIBUTION_METRICS.map((entry) => ({ value: entry.key, label: entry.label }))}
            onChange={onMetric}
          />
          <SliderControl label="Fold i" value={i} min={1} max={Math.max(1, n)} onChange={onStep} format={(v) => `${v} of ${n}`} hint="Adds the terms of the first i folds to each running sum" />
        </ControlBar>

        <div className="grid gap-2 xl:grid-cols-3">
          <FormulaCard
            tex={"\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_i \\qquad s=\\sqrt{\\frac{1}{n-1}\\sum_{i=1}^{n}(x_i-\\bar{x})^2}"}
            caption="Mean and sample standard deviation across folds."
            symbols={[
              { tex: "n", name: "number of folds", value: String(n) },
              { tex: "i", name: "fold being added (the slider)", value: String(i) },
              { tex: "x_i", name: `${chosen.label} of fold i`, value: fmt(current?.x, 6) },
              { tex: "\\textstyle\\sum_{1}^{i}x", name: "running sum of the first i folds", value: fmt(running.x, 6) },
              { tex: "\\bar{x}", name: "mean over all n folds", value: fmt(mean, 6) },
              { tex: "\\textstyle\\sum_{1}^{i}(x-\\bar{x})^2", name: "running sum of squared deviations", value: small(running.d2, 4) },
              { tex: "s", name: "sample standard deviation", value: fmt(deviation, 6) },
            ]}
          />
          <FormulaCard
            tex={"g_1=\\frac{\\frac{1}{n}\\sum_{i=1}^{n}(x_i-\\bar{x})^3}{s^3}"}
            caption="Skewness as the notebook computes it: population third moment over the sample s cubed. Negative means a longer left tail."
            symbols={[
              { tex: "(x_i-\\bar{x})^3", name: "cubed deviation of fold i", value: small(current?.d3, 4) },
              { tex: "\\textstyle\\sum_{1}^{i}(x-\\bar{x})^3", name: "running sum of cubed deviations", value: small(running.d3, 4) },
              { tex: "s^3", name: "standard deviation cubed", value: small(deviation ** 3, 4) },
              { tex: "g_1", name: "skewness over all n folds", value: fmt(skewness, 4) },
            ]}
          />
          <FormulaCard
            tex={"g_2=\\frac{\\frac{1}{n}\\sum_{i=1}^{n}(x_i-\\bar{x})^4}{s^4}-3"}
            caption="Excess kurtosis: zero for a Gaussian, positive for fat tails, near -2 when the points pile at two ends."
            symbols={[
              { tex: "(x_i-\\bar{x})^4", name: "fourth power of fold i's deviation", value: small(current?.d4, 4) },
              { tex: "\\textstyle\\sum_{1}^{i}(x-\\bar{x})^4", name: "running sum of fourth powers", value: small(running.d4, 4) },
              { tex: "s^4", name: "standard deviation to the fourth", value: small(deviation ** 4, 4) },
              { tex: "g_2", name: "excess kurtosis over all n folds", value: fmt(kurtosis, 4) },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}
