/**
 * The pipeline's formulas, typeset, each symbol defined in words and carrying
 * the value it holds for the window on screen: the feature a bar becomes, the
 * trailing z-score with a stepper that adds its terms one bar at a time, the
 * target and the purge, and the two baseline sums.
 */

import { useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ControlBar, FormulaCard, OKABE, SelectControl, SliderControl, TOOLTIP, fmtInt, type FormulaSymbol } from "@/studies/kit";
import { FEATURE_NAMES, type BaselineSummary, type FeatureName, type SplitSummary, type WindowBody } from "@shared/studies/quant-bars-to-tensor";
import { sig, stamp } from "./format";

interface FeatureFormula {
  tex: string;
  symbols: (bar: WindowBody["lastBar"]) => FormulaSymbol[];
}

const ohlc = (bar: WindowBody["lastBar"]): FormulaSymbol[] => [
  { tex: "O_t", name: "open of bar t", value: sig(bar.open) },
  { tex: "H_t", name: "high of bar t", value: sig(bar.high) },
  { tex: "L_t", name: "low of bar t", value: sig(bar.low) },
  { tex: "C_t", name: "close of bar t", value: sig(bar.close) },
];

const FEATURE_FORMULAS: Record<FeatureName, FeatureFormula> = {
  log_return_close: {
    tex: "x_t=\\ln\\frac{C_t}{C_{t-1}}",
    symbols: (bar) => [
      { tex: "C_t", name: "close of bar t", value: sig(bar.close) },
      { tex: "C_{t-1}", name: "close of the bar before it (the row above, even across a contract roll)", value: sig(bar.previousClose) },
    ],
  },
  body_fraction_of_range: {
    tex: "x_t=\\frac{C_t-O_t}{H_t-L_t}",
    symbols: ohlc,
  },
  upper_wick_fraction_of_range: {
    tex: "x_t=\\frac{H_t-\\max(O_t,\\,C_t)}{H_t-L_t}",
    symbols: ohlc,
  },
  lower_wick_fraction_of_range: {
    tex: "x_t=\\frac{\\min(O_t,\\,C_t)-L_t}{H_t-L_t}",
    symbols: ohlc,
  },
  normalized_range: {
    tex: "x_t=\\frac{H_t-L_t}{C_t}",
    symbols: (bar) => [
      { tex: "H_t", name: "high of bar t", value: sig(bar.high) },
      { tex: "L_t", name: "low of bar t", value: sig(bar.low) },
      { tex: "C_t", name: "close of bar t", value: sig(bar.close) },
    ],
  },
  log_volume_change: {
    tex: "x_t=\\ln\\frac{V_t+1}{V_{t-1}+1}",
    symbols: (bar) => [
      { tex: "V_t", name: "contracts traded in bar t", value: sig(bar.volume) },
      { tex: "V_{t-1}", name: "contracts traded in the bar before it (the +1 keeps a zero-volume bar finite)", value: sig(bar.previousVolume) },
    ],
  },
};

/** Steps the terms of the trailing mean and variance sums one bar at a time. */
function SumStepper({ values, windowLength, feature }: { values: number[]; windowLength: number; feature: string }) {
  const [step, setStep] = useState(windowLength);
  const terms = Math.min(step, values.length);
  let runningSum = 0;
  for (let i = 0; i < terms; i += 1) runningSum += values[i] as number;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let runningSquares = 0;
  for (let i = 0; i < terms; i += 1) runningSquares += ((values[i] as number) - mean) ** 2;
  const data = values.map((value, index) => ({ index: index + 1, value, included: index < terms }));
  return (
    <div className="space-y-2">
      <ControlBar>
        <SliderControl label="Terms added, k" value={terms} min={1} max={Math.max(2, values.length)} onChange={setStep} format={fmtInt} hint="Bars of the trailing window added to the sums so far, oldest first" />
        <p className="max-w-md text-[11px] text-neutral-400">
          After k terms: Σx = <span className="font-mono text-neutral-200">{sig(runningSum)}</span> (÷W gives μ once k = W, here {sig(mean)}) and
          Σ(x−μ)² = <span className="font-mono text-neutral-200">{sig(runningSquares)}</span>.
        </p>
      </ControlBar>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap={0}>
          <XAxis dataKey="index" hide />
          <YAxis width={56} tick={{ fill: "#a3a3a3", fontSize: 9 }} tickFormatter={(value: number) => sig(value)} />
          <Tooltip {...TOOLTIP} formatter={(value) => sig(Number(value))} labelFormatter={(label) => `${feature}, term k = ${label}`} />
          <Bar dataKey="value" isAnimationActive={false}>
            {data.map((point) => (
              <Cell key={point.index} fill={point.included ? OKABE.orange : "#525252"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-neutral-500"><span style={{ color: OKABE.orange }}>■ added to the sums</span> · <span className="text-neutral-400">■ not yet</span> · the {fmtInt(values.length)} raw values of {feature} ending on the window's last bar</p>
    </div>
  );
}

export function Formulas({
  window, feature, onFeature, sequenceLength, normalizationWindow, windowCount, split, baseline,
}: {
  window: WindowBody; feature: FeatureName; onFeature: (feature: FeatureName) => void;
  sequenceLength: number; normalizationWindow: number; windowCount: number; split: SplitSummary | null; baseline: BaselineSummary | null;
}) {
  const bar = window.lastBar;
  const column = FEATURE_NAMES.indexOf(feature);
  const formula = FEATURE_FORMULAS[feature];
  const x = bar.featureValues[column] ?? null;
  const mean = bar.trailingMean[column] ?? null;
  const spread = bar.trailingStandardDeviation[column] ?? null;
  const z = bar.zscores[column] ?? null;
  const trailing = bar.trailingValues[column] ?? null;

  return (
    <div className="space-y-3">
      <ControlBar>
        <SelectControl label="Feature" value={feature} options={FEATURE_NAMES.map((name) => ({ value: name, label: name }))} onChange={onFeature} hint="Which of the six features the two cards below explain, for the window's last bar" />
        <p className="text-[11px] text-neutral-400">Values are for the last bar of window {fmtInt(window.windowIndex)}: {stamp(bar.timestampMs)} ({bar.contractSymbol}).</p>
      </ControlBar>

      <div className="grid gap-3 xl:grid-cols-2">
        <FormulaCard
          tex={formula.tex}
          caption="One scale-free number per bar. Prices enter only as ratios, so a 2015 bar at 4,000 points and a 2025 bar at 20,000 are comparable."
          symbols={[{ tex: "x_t", name: `${feature} of bar t, before the z-score`, value: sig(x) }, { tex: "t", name: "the window's last bar", value: stamp(bar.timestampMs) }, ...formula.symbols(bar)]}
        />
        <FormulaCard
          tex={"z_t=\\frac{x_t-\\mu_t}{\\sigma_t},\\quad \\mu_t=\\frac1W\\sum_{k=t-W+1}^{t}x_k,\\quad \\sigma_t=\\sqrt{\\frac1W\\sum_{k=t-W+1}^{t}(x_k-\\mu_t)^2}"}
          caption="Trailing and causal: bar t sees itself and the W - 1 bars before it. Unknown until the window is full, and when any value in it is unknown or the spread is 1e-12 or less."
          symbols={[
            { tex: "z_t", name: "the z-score the model receives for this feature", value: sig(z) },
            { tex: "x_t", name: "the feature before scaling", value: sig(x) },
            { tex: "\\mu_t", name: "trailing mean of the feature over W bars", value: sig(mean) },
            { tex: "\\sigma_t", name: "trailing population standard deviation (divide by W, not W - 1)", value: sig(spread) },
            { tex: "W", name: "normalization window, in bars", value: fmtInt(normalizationWindow) },
            { tex: "k", name: "index of a bar inside the trailing window", value: `${fmtInt(normalizationWindow)} terms` },
          ]}
        />
      </div>
      {trailing ? <SumStepper key={`${feature}-${window.windowIndex}-${normalizationWindow}`} values={trailing} windowLength={normalizationWindow} feature={feature} /> : (
        <p className="text-[11px] text-neutral-500">The trailing window of {feature} holds an unknown value, so its sums cannot be stepped.</p>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <FormulaCard
          tex={"y_i=\\ln\\frac{C_{e(i)+1}}{C_{e(i)}},\\qquad \\text{purge}=S+W"}
          caption="The target is the return realised on the bar after the window's last row, so nothing inside a window has seen its own target. The purge covers both overlaps: windows share S - 1 rows, and every z-score looked back W bars."
          symbols={[
            { tex: "y_i", name: "target of window i: the next bar's log return", value: sig(window.targetLogReturn) },
            { tex: "C_{e(i)}", name: "close of the window's last row", value: sig(window.endClose) },
            { tex: "C_{e(i)+1}", name: "close of the next usable row", value: sig(window.targetClose) },
            { tex: "S", name: "sequence length, in bars", value: fmtInt(sequenceLength) },
            { tex: "W", name: "normalization window, in bars", value: fmtInt(normalizationWindow) },
            { tex: "\\text{purge}", name: "windows dropped between train and validation", value: split ? fmtInt(split.purgeWindowCount) : "—" },
            { tex: "n", name: "windows in total", value: fmtInt(windowCount) },
            { tex: "\\lfloor 0.7\\,n\\rfloor", name: "first window after training", value: split ? fmtInt(split.trainEnd) : "—" },
          ]}
        />
        <FormulaCard
          tex={"\\mathrm{MSE}_0=\\frac1m\\sum_{i=1}^{m}y_i^{2},\\qquad \\mathrm{MSE}_c=\\frac1m\\sum_{i=1}^{m}(c\\,z_i-y_i)^2,\\qquad c=\\frac{\\operatorname{sd}(y)}{\\operatorname{sd}(z)}"}
          caption={window.errorTerms ? "This window is a validation window, so its terms of both sums are shown." : "This window is not a validation window: its terms are not in either sum. Move the window index into validation to see them."}
          symbols={[
            { tex: "m", name: "validation windows", value: baseline ? fmtInt(baseline.validationWindowCount) : "—" },
            { tex: "y_i", name: "target of window i", value: sig(window.targetLogReturn) },
            { tex: "z_i", name: "z-scored log return of the window's last row", value: sig(window.errorTerms?.lastReturnZscore ?? window.values[window.values.length - 1]?.[0]) },
            { tex: "c", name: "scale putting z back on the target's units, from the validation targets themselves", value: sig(baseline?.persistenceScale) },
            { tex: "y_i^{2}", name: "this window's term of MSE_0", value: sig(window.errorTerms?.zeroSquaredError) },
            { tex: "(c\\,z_i-y_i)^2", name: "this window's term of MSE_c", value: sig(window.errorTerms?.persistenceSquaredError) },
            { tex: "\\mathrm{MSE}_0", name: "predict-zero error over validation", value: sig(baseline?.zeroPredictionMeanSquaredError) },
            { tex: "\\mathrm{MSE}_c", name: "copy-the-last-return error over validation", value: sig(baseline?.persistenceMeanSquaredError) },
          ]}
        />
      </div>
    </div>
  );
}
