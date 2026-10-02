/**
 * The page's formulas as objects to operate: a running Sharpe ratio you scrub
 * bar by bar, the expected calibration error you step bin by bin, and the
 * price-forecast skill with the run's own two errors. Every symbol is defined
 * beside the formula with the value it holds now.
 */

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, FormulaCard, GRID, OKABE, SliderControl, TOOLTIP, fmt, fmtInt, fmtUsd, ControlBar } from "@/studies/kit";
import { calibrationTerms, runningSharpe, type CalibrationBin, type RunRecord } from "@shared/studies/model-cycle-runs";
import type { Controls, SetControl } from "./common";

/** Sharpe ratio of the first n bars' net profit: scrub n and watch the mean, the spread and the ratio move. */
export function SharpeStepper({ profits, record, controls, set }: { profits: readonly number[]; record: RunRecord | null; controls: Controls; set: SetControl }) {
  const barsPerYear = typeof record?.bars_per_year === "number" ? record.bars_per_year : null;
  if (profits.length < 2 || barsPerYear === null) {
    return <p className="text-xs text-neutral-500">The running Sharpe ratio needs the run's per-bar net profit and its bars per year; this run did not record both.</p>;
  }
  const n = controls.sharpeBars > 0 ? Math.min(controls.sharpeBars, profits.length) : profits.length;
  const now = runningSharpe(profits, barsPerYear, n);
  const landed = typeof record?.sharpe_ratio === "number" ? record.sharpe_ratio : null;
  return (
    <div className="space-y-2">
      <ControlBar>
        <SliderControl
          label="Bars read, n" value={n} min={2} max={profits.length} step={Math.max(1, Math.floor(profits.length / 200))}
          onChange={(value) => set("sharpeBars", value >= profits.length ? 0 : value)} format={(value) => fmtInt(value)}
          hint="Scrub: the Sharpe ratio of the first n processed bars"
        />
      </ControlBar>
      <FormulaCard
        tex={"\\mathrm{SR}=\\frac{\\bar r}{s_r}\\,\\sqrt{B},\\qquad \\bar r=\\frac1n\\sum_{i=1}^{n} r_i,\\qquad s_r=\\sqrt{\\frac{1}{n-1}\\sum_{i=1}^{n}\\left(r_i-\\bar r\\right)^2}"}
        caption={landed === null ? undefined : `At n = ${fmtInt(profits.length)} (every bar) the ratio is the landed ${fmt(landed, 4)}; fewer bars show how unsteady it is early on.`}
        symbols={[
          { tex: "\\mathrm{SR}", name: "Sharpe ratio over the first n bars (annualised, unitless)", value: fmt(now.sharpe, 4) },
          { tex: "r_i", name: "net profit of processed bar i after costs, marked to market (USD)", value: `${fmtUsd(profits[n - 1] ?? null)} at i = n` },
          { tex: "n", name: "bars read so far", value: fmtInt(n) },
          { tex: "\\bar r", name: "mean per-bar net profit (USD)", value: fmt(now.mean, 4) },
          { tex: "s_r", name: "sample standard deviation of per-bar net profit, divisor n - 1 (USD)", value: fmt(now.standardDeviation, 4) },
          { tex: "B", name: "bars per year: how many bars of this run fit in a year of trading", value: fmt(barsPerYear, 1) },
          { tex: "\\sqrt{B}", name: "scales a per-bar ratio up to a yearly one", value: fmt(Math.sqrt(barsPerYear), 3) },
        ]}
      />
    </div>
  );
}

/** Expected calibration error, stepped one probability bin at a time. */
export function CalibrationStepper({ bins, metricValue, controls, set }: { bins: readonly CalibrationBin[]; metricValue: number | null; controls: Controls; set: SetControl }) {
  const { terms, scoredBars, total } = calibrationTerms(bins);
  if (terms.length === 0) return <p className="text-xs text-neutral-500">The calibration stepper needs scored run-scope bins.</p>;
  const k = controls.calibrationBin > 0 ? Math.min(controls.calibrationBin, terms.length) : terms.length;
  const current = terms[k - 1];
  const data = terms.map((term, index) => ({ index: index + 1, binNumber: term.binNumber, term: term.term, running: term.running, included: index < k }));
  return (
    <div className="space-y-2">
      <ControlBar>
        <SliderControl
          label="Bins summed, k" value={k} min={1} max={terms.length}
          onChange={(value) => set("calibrationBin", value >= terms.length ? 0 : value)} format={(value) => `${value} of ${terms.length}`}
          hint="Step: add one probability bin at a time to the sum"
        />
      </ControlBar>
      <FormulaCard
        tex={"\\mathrm{ECE}=\\sum_{k=1}^{K}\\frac{n_k}{N}\\,\\bigl|\\,o_k-\\bar p_k\\,\\bigr|"}
        caption={`Summed through bin ${k}: ${fmt(current?.running, 6)}. All ${terms.length} bins give ${fmt(total, 6)}${metricValue === null ? "" : `; the metric table lands ${fmt(metricValue, 6)}`}.`}
        symbols={[
          { tex: "\\mathrm{ECE}", name: "expected calibration error: the bar-weighted average gap between what P(up) says and what happened", value: fmt(current?.running, 6) },
          { tex: "k", name: "probability bin, counted from the lowest P(up)", value: `${k} (bin ${current?.binNumber ?? "—"})` },
          { tex: "K", name: "number of bins holding scored bars", value: String(terms.length) },
          { tex: "n_k", name: "scored bars in bin k", value: fmtInt(Math.round((current?.weight ?? 0) * scoredBars)) },
          { tex: "N", name: "all scored bars of the run", value: fmtInt(scoredBars) },
          { tex: "o_k", name: "observed share of bin k that went up", value: fmt(current?.observedFraction, 4) },
          { tex: "\\bar p_k", name: "mean P(up) the model gave the bars of bin k", value: fmt(current?.meanProbability, 4) },
          { tex: "\\tfrac{n_k}{N}\\left|o_k-\\bar p_k\\right|", name: "this bin's term in the sum", value: fmt(current?.term, 6) },
        ]}
      />
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="index" {...AXIS} />
          <YAxis {...AXIS} width={52} tickFormatter={(value: number) => value.toExponential(0)} />
          <ReferenceLine x={k} stroke={OKABE.purple} />
          <Tooltip {...TOOLTIP} formatter={(value) => [fmt(Number(value), 6), "term"]} labelFormatter={(label) => `bin ${label}`} />
          <Bar dataKey="term" isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.index} fill={OKABE.sky} fillOpacity={row.included ? 1 : 0.25} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Price-forecast skill with this run's own two errors. */
export function SkillCard({ record }: { record: RunRecord | null }) {
  const forecast = typeof record?.price_forecast_mean_absolute_error_points === "number" ? record.price_forecast_mean_absolute_error_points : null;
  const persistence = typeof record?.persistence_mean_absolute_error_points === "number" ? record.persistence_mean_absolute_error_points : null;
  if (forecast === null || persistence === null) return null;
  return (
    <FormulaCard
      tex={"\\text{skill}=1-\\frac{\\mathrm{MAE}_{\\text{forecast}}}{\\mathrm{MAE}_{\\text{no-change}}}"}
      caption="Above zero the price model beats the guess that the next price equals the last; below zero it does worse."
      symbols={[
        { tex: "\\text{skill}", name: "price-forecast skill against no change (unitless)", value: fmt(1 - forecast / persistence, 5) },
        { tex: "\\mathrm{MAE}_{\\text{forecast}}", name: "mean absolute error of the model's price forecast (index points)", value: fmt(forecast, 4) },
        { tex: "\\mathrm{MAE}_{\\text{no-change}}", name: "mean absolute error of the no-change guess (index points)", value: fmt(persistence, 4) },
      ]}
    />
  );
}
