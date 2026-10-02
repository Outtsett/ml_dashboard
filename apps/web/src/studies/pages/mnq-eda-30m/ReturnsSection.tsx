/**
 * Section 3: the return distribution. The notebook's histogram (60 bins, density, with a
 * normal fit) and Q-Q plot, the eight numbers in the notebook's convention (population
 * standard deviation, moment skewness and excess kurtosis) and the D'Agostino-Pearson test
 * spelled out: the two z scores that add to K-squared.
 */

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SliderControl, Stat, StudyNotes, StudyState, SummaryTable,
  SwitchControl, TOOLTIP, fmt, fmtInt, useStudyControls,
} from "@/studies/kit";
import type { Moments, ReturnsBody } from "@shared/studies/mnq-eda-30m";
import { pText, sci } from "./format";
import { useSection, type SeriesChoice } from "./use";

function percentMoments(moments: Moments): Moments {
  const scale = (value: number | null) => (value === null ? null : value * 100);
  return {
    ...moments,
    mean: scale(moments.mean), median: scale(moments.median), standardDeviation: scale(moments.standardDeviation),
    percentile25: scale(moments.percentile25), percentile75: scale(moments.percentile75), minimum: scale(moments.minimum), maximum: scale(moments.maximum),
  };
}

function normalPdf(x: number, mean: number, deviation: number): number {
  return Math.exp(-0.5 * ((x - mean) / deviation) ** 2) / (deviation * Math.sqrt(2 * Math.PI));
}

export function ReturnsSection({ choice }: { choice: SeriesChoice }) {
  const [controls, set, reset] = useStudyControls({ histogramBins: 60, histogramRange: "full", logDensity: true });
  const { query, notes, body, unavailable } = useSection<ReturnsBody>("returns", choice, { histogramBins: controls.histogramBins, histogramRange: controls.histogramRange });

  const bins = (body?.histogram ?? []).map((bin) => {
    const middle = (bin.lower + bin.upper) / 2;
    const fit = body ? normalPdf(middle, body.normalFit.mean, body.normalFit.standardDeviation) : 0;
    return {
      middle,
      observed: controls.logDensity && bin.density <= 0 ? null : bin.density,
      normal: controls.logDensity && fit < 1e-12 ? null : fit,
      count: bin.count, lower: bin.lower, upper: bin.upper,
    };
  });
  const positive = bins.map((bin) => bin.observed).filter((value): value is number => value !== null && value > 0);
  const floor = positive.length ? Math.min(...positive) / 2 : 1e-6;

  const moments = body?.moments;
  const normality = body?.normality;
  const qqLine = body ? [body.qq.theoretical[0] as number, body.qq.theoretical[body.qq.theoretical.length - 1] as number].map((x) => ({ x, y: body.qq.slope * x + body.qq.intercept })) : [];
  const qqPoints = body ? body.qq.theoretical.map((x, i) => ({ x, y: body.qq.sample[i] as number })) : [];

  return (
    <Section title="3 · Return distribution" question="Are the log returns normal, and how fat are the tails the model's ±5 clamp has to tame?">
      <div className="space-y-3">
        <ControlBar onReset={reset}>
          <SliderControl label="Bins" value={controls.histogramBins} min={10} max={200} step={5} onChange={(v) => set("histogramBins", v)} />
          <SegmentControl label="Range" value={controls.histogramRange} options={[{ value: "full", label: "full range" }, { value: "core", label: "0.5–99.5 %" }]} onChange={(v) => set("histogramRange", v)} hint="Full range is the notebook's; the core range leaves the extreme bars out of the picture" />
          <SwitchControl label="Log density" checked={controls.logDensity} onChange={(v) => set("logDensity", v)} hint="A log axis makes the tails, where the normal curve and the data part ways, visible" />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={notes} />
          {unavailable || !body || !moments || !normality ? (
            <p className="text-xs text-neutral-500">The bars are not in the lake for this selection.</p>
          ) : (
            <>
              <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
                <Stat label="Returns" value={fmtInt(moments.count)} hint="diff(log close): one fewer than the bars" />
                <Stat label="Excess kurtosis" value={fmt(moments.kurtosis, 2)} hint="0 for a normal distribution" tone={OKABE.orange} />
                <Stat label="Skewness" value={fmt(moments.skewness, 3)} />
                <Stat label="Normality p (D'Agostino-Pearson)" value={pText(normality.pValue)} tone={OKABE.blue} hint="The null is normality" />
              </div>
              <Finding>
                Excess kurtosis {fmt(moments.kurtosis, 1)} against 0 for a normal, skewness {fmt(moments.skewness, 3)}, and a normality p of {pText(normality.pValue)}: the returns are not normal, and the gap is all in the tails ({fmt((moments.minimum ?? 0) / (moments.standardDeviation ?? 1), 1)} to {fmt((moments.maximum ?? 0) / (moments.standardDeviation ?? 1), 1)} standard deviations at the extremes). A network fed these needs the clamp; dividing by the standard deviation alone would leave single bars at 20 sigma.
              </Finding>
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0 space-y-1">
                  <h4 className="text-xs font-semibold text-neutral-200">Histogram of log return × 100 (percent), density</h4>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={bins} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid {...GRID} vertical={false} />
                      <XAxis dataKey="middle" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => fmt(v, 2)} {...AXIS} label={{ value: "log return (%)", position: "insideBottom", offset: -2, fill: "#9ca3af", fontSize: 10 }} />
                      <YAxis {...AXIS} width={48} scale={controls.logDensity ? "log" : "auto"} domain={controls.logDensity ? [floor, "auto"] : [0, "auto"]} allowDataOverflow tickFormatter={(v: number) => sci(v, 2)} />
                      <Tooltip
                        {...TOOLTIP}
                        labelFormatter={(_label, payload) => {
                          const row = payload?.[0]?.payload as { lower: number; upper: number; count: number } | undefined;
                          return row ? `${fmt(row.lower, 3)} to ${fmt(row.upper, 3)} % · ${fmtInt(row.count)} bars` : "";
                        }}
                        formatter={(value: number, name: string) => [sci(value, 3), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      {controls.logDensity ? (
                        <Line dataKey="observed" name="observed ●" stroke={OKABE.orange} strokeWidth={2} dot={{ r: 2.5, fill: OKABE.orange }} isAnimationActive={false} connectNulls={false} />
                      ) : (
                        <Bar dataKey="observed" name="observed ■" fill={OKABE.sky} isAnimationActive={false} />
                      )}
                      <Line dataKey="normal" name="normal fit - -" stroke={OKABE.purple} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p className="text-[11px] text-neutral-400">
                    {body.histogramRange.clippedCount > 0 ? `${fmtInt(body.histogramRange.clippedCount)} returns outside the plotted range are left out of the bars. ` : "Every return is in a bar. "}
                    The dashed curve is the normal with the sample mean {sci(body.normalFit.mean, 3)} % and standard deviation {fmt(body.normalFit.standardDeviation, 4)} %.
                  </p>
                </div>
                <div className="min-w-0 space-y-1">
                  <h4 className="text-xs font-semibold text-neutral-200">Q-Q plot against the normal</h4>
                  <ResponsiveContainer width="100%" height={280}>
                    <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis type="number" dataKey="x" name="theoretical quantile" {...AXIS} tickFormatter={(v: number) => fmt(v, 1)} label={{ value: "theoretical normal quantile", position: "insideBottom", offset: -2, fill: "#9ca3af", fontSize: 10 }} />
                      <YAxis type="number" dataKey="y" name="sample quantile (%)" {...AXIS} width={48} tickFormatter={(v: number) => fmt(v, 1)} />
                      <Tooltip {...TOOLTIP} cursor={{ strokeDasharray: "3 3" }} formatter={(value: number, name: string) => [fmt(value, 4), name]} />
                      <Scatter name="sample ●" data={qqPoints} fill={OKABE.orange} fillOpacity={0.75} isAnimationActive={false} />
                      <Scatter name="normal line - -" data={qqLine} line={{ stroke: OKABE.purple, strokeWidth: 2, strokeDasharray: "6 4" }} shape={() => <g />} legendType="none" isAnimationActive={false} />
                    </ScatterChart>
                  </ResponsiveContainer>
                  <p className="text-[11px] text-neutral-400">
                    {fmtInt(body.qq.theoretical.length)} of {fmtInt(body.qq.pointCount)} quantiles drawn (every tail point, the middle thinned). Line: sample = {fmt(body.qq.slope, 4)} × theory {body.qq.intercept < 0 ? "−" : "+"} {fmt(Math.abs(body.qq.intercept), 5)}, r = {fmt(body.qq.correlation, 4)}. Points bending away from the line at both ends are fat tails.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                  <SummaryTable columns={[{ name: "log return", summary: moments, decimals: 6 }, { name: "× 100 (percent)", summary: percentMoments(moments), decimals: 4 }]} />
                  <p className="mt-1 text-[10px] text-neutral-500">Population standard deviation, moment skewness and excess kurtosis: the notebook&apos;s numpy and scipy conventions.</p>
                </div>
                <div className="min-w-0 space-y-2">
                  <FormulaCard
                    tex={String.raw`r_t=\ln C_t-\ln C_{t-1}`}
                    caption="The log return: each bar's close against the previous bar's, across overnight and weekend gaps too (the notebook's np.diff(np.log(close)))."
                    symbols={[
                      { tex: "r_t", name: "log return of bar t", value: `mean ${sci(moments.mean, 3)}` },
                      { tex: "C_t", name: "close of bar t, in index points", value: "price" },
                      { tex: "n", name: "number of returns", value: fmtInt(moments.count) },
                    ]}
                  />
                  <FormulaCard
                    tex={String.raw`K^2=Z_s^2+Z_k^2,\qquad p=e^{-K^2/2}`}
                    caption="D'Agostino-Pearson: a skewness z score and a kurtosis z score, each from the sample moments, add to a statistic that is chi-square with 2 degrees of freedom when the data are normal."
                    symbols={[
                      { tex: "Z_s", name: "z score of the skewness", value: fmt(normality.skewnessZ, 2) },
                      { tex: "Z_k", name: "z score of the kurtosis", value: fmt(normality.kurtosisZ, 2) },
                      { tex: "K^2", name: "the test statistic", value: fmt(normality.statistic, 1) },
                      { tex: "p", name: "probability of a K² this large if the returns were normal", value: pText(normality.pValue) },
                    ]}
                  />
                </div>
              </div>
            </>
          )}
        </StudyState>
      </div>
    </Section>
  );
}
