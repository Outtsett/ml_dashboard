/**
 * Chart-image CNN direction report. The tables are landed by
 * packages/ml-engine/src/studies/chart_cnn_direction_null_result/build.py; every control filters them in the browser.
 *
 * Sections: A the AUC of each model against the notebook's verdict bands; B up-rate and mean R by predicted-score
 * bin; C the top- and bottom-20% trades against always-long; D the AUC rebuilt bin by bin as a steppable sum;
 * E the 2D model's 32 first-layer filters; F every column; G how to read an AUC.
 */

import type { ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SliderControl, Stat, StudyNotes, StudyState,
  SwitchControl, TOOLTIP, fmt, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  MODEL_IMAGE, MODEL_SEQUENCE, VERDICT_BANDS, binsOutsideBaseRate, filterTiles, rocFromBins, spearman, topMinusBottom, verdictFor,
  type DirectionNullBody, type ModelResultRow, type ScoreBinRow,
} from "@shared/studies/chart-cnn-direction-null-result";
import { AucForest } from "./AucForest";
import { FilterLegend, FilterTiles } from "./FilterTiles";
import { RocTrapezoids } from "./RocTrapezoids";

const BIN_OPTIONS = [5, 10, 20] as const;
const VERDICT_GLYPH = { null: "≈ null", weak: "~ weak", real: "▲ real" } as const;

function signed(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(decimals)}`;
}

function DataTable({ head, rows }: { head: readonly string[]; rows: ReadonlyArray<{ key: string; emphasised?: boolean; cells: ReactNode[] }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-[11px]">
        <thead>
          <tr className="border-b border-neutral-700 text-left text-[10px] uppercase tracking-wider text-neutral-500">
            {head.map((label) => (
              <th key={label} className="whitespace-nowrap px-2 py-1 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={`border-b border-neutral-800 ${row.emphasised ? "bg-neutral-800/60" : ""}`}>
              {row.cells.map((cell, index) => (
                <td key={index} className="whitespace-nowrap px-2 py-1 font-mono tnum text-neutral-200">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One model's mean return (ATR multiples) by predicted-score bin, bars signed by colour and by glyph in the tooltip. */
function ReturnBars({ name, bins, intervals }: { name: string; bins: readonly ScoreBinRow[]; intervals: boolean }) {
  const data = bins.map((bin) => ({
    bin: bin.bin_number,
    mean: bin.mean_return_atr_multiples,
    error: 1.959963984540054 * bin.mean_return_standard_error_atr_multiples,
    count: bin.observation_count,
    lowScore: bin.score_minimum,
    highScore: bin.score_maximum,
  }));
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium text-neutral-200">{name}</div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="bin" {...AXIS} label={{ value: "predicted-score bin (1 = most bearish)", position: "insideBottom", offset: -2, fontSize: 10, fill: "#a3a3a3" }} height={34} />
          <YAxis {...AXIS} width={44} tickFormatter={(v: number) => signed(v, 2)} />
          <ReferenceLine y={0} stroke={OKABE.grey} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!row) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{name} · bin {row.bin}</div>
                  <div>{row.mean >= 0 ? "▲" : "▼"} mean R {signed(row.mean, 4)} ± {fmt(row.error, 4)} ATR</div>
                  <div>score {fmt(row.lowScore, 4)} to {fmt(row.highScore, 4)} · n {fmtInt(row.count)}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="mean" isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.bin} fill={row.mean >= 0 ? OKABE.orange : OKABE.blue} />
            ))}
            {intervals && <ErrorBar dataKey="error" direction="y" width={3} stroke="#d4d4d4" />}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="break-words font-mono text-[10px] leading-relaxed text-neutral-400">
        mean R (long) by bin: {bins.map((bin) => signed(bin.mean_return_atr_multiples)).join(" ")}
      </p>
    </div>
  );
}

function modelRows(rows: readonly ModelResultRow[], tag: string): ModelResultRow[] {
  return rows.filter((row) => row.dataset_tag === tag);
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    tag: "mnq5m",
    bins: 10,
    intervals: true,
    model: MODEL_IMAGE as string,
    rocStep: 99,
    filterClip: 100,
    filterGlyphs: true,
    filterOrder: "index",
  });
  const query = useStudyQuery<DirectionNullBody>("chart-cnn-direction-null-result");
  const body = query.data?.data;
  const results = body?.modelResults ?? [];
  const comparisons = body?.comparisons ?? [];
  const allBins = body?.scoreBins ?? [];

  const tags = [...new Set(results.map((row) => row.dataset_tag))].sort();
  const tag = tags.includes(controls.tag) ? controls.tag : (tags[0] ?? controls.tag);
  const model = controls.model === MODEL_SEQUENCE ? MODEL_SEQUENCE : MODEL_IMAGE;

  const selectedResults = modelRows(results, tag);
  const image = selectedResults.find((row) => row.model_name === MODEL_IMAGE);
  const sequence = selectedResults.find((row) => row.model_name === MODEL_SEQUENCE);
  const comparison = comparisons.find((row) => row.dataset_tag === tag);

  const binsFor = (modelName: string): ScoreBinRow[] =>
    allBins
      .filter((row) => row.dataset_tag === tag && row.model_name === modelName && row.bin_count_requested === controls.bins)
      .sort((a, b) => a.bin_number - b.bin_number);
  const imageBins = binsFor(MODEL_IMAGE);
  const sequenceBins = binsFor(MODEL_SEQUENCE);
  const baseRate = image?.base_up_rate ?? sequence?.base_up_rate ?? 0.5;

  // B: up-rate by bin, both models on one axis
  const upRateRows = [...new Set([...imageBins, ...sequenceBins].map((bin) => bin.bin_number))].sort((a, b) => a - b).map((binNumber) => {
    const a = imageBins.find((bin) => bin.bin_number === binNumber);
    const b = sequenceBins.find((bin) => bin.bin_number === binNumber);
    return {
      bin: binNumber,
      image: a?.up_rate ?? null,
      imageError: a ? ([a.up_rate - a.up_rate_interval_low, a.up_rate_interval_high - a.up_rate] as [number, number]) : undefined,
      sequence: b?.up_rate ?? null,
      sequenceError: b ? ([b.up_rate - b.up_rate_interval_low, b.up_rate_interval_high - b.up_rate] as [number, number]) : undefined,
      count: a?.observation_count ?? b?.observation_count ?? 0,
    };
  });
  const lows = [...imageBins, ...sequenceBins].map((bin) => (controls.intervals ? bin.up_rate_interval_low : bin.up_rate));
  const highs = [...imageBins, ...sequenceBins].map((bin) => (controls.intervals ? bin.up_rate_interval_high : bin.up_rate));
  const yLow = Math.min(baseRate, ...lows) - 0.004;
  const yHigh = Math.max(baseRate, ...highs) + 0.004;

  const imageSpread = topMinusBottom(imageBins);
  const sequenceSpread = topMinusBottom(sequenceBins);
  const imageTrend = spearman(imageBins.map((bin) => bin.bin_number), imageBins.map((bin) => bin.up_rate));
  const sequenceTrend = spearman(sequenceBins.map((bin) => bin.bin_number), sequenceBins.map((bin) => bin.up_rate));
  const overlapping = upRateRows.filter((row) => {
    const a = imageBins.find((bin) => bin.bin_number === row.bin);
    const b = sequenceBins.find((bin) => bin.bin_number === row.bin);
    return a && b && a.up_rate_interval_low <= b.up_rate_interval_high && b.up_rate_interval_low <= a.up_rate_interval_high;
  }).length;

  // C: long top 20%, short bottom 20%, naive long
  const excessRows = results.map((row) => {
    const excess = row.long_top_20_percent_mean_return_atr_multiples - row.naive_long_mean_return_atr_multiples;
    const half = 1.959963984540054 * row.return_standard_deviation_atr_multiples / Math.sqrt(0.2 * row.test_observation_count);
    return { ...row, label: `${row.dataset_tag} · ${row.model_name}`, excess, half };
  });

  // D: the AUC rebuilt bin by bin
  const rocBins = model === MODEL_IMAGE ? imageBins : sequenceBins;
  const roc = rocFromBins(rocBins.map((bin) => ({ binNumber: bin.bin_number, observationCount: bin.observation_count, upRate: bin.up_rate })));
  const step = Math.min(Math.max(1, controls.rocStep), Math.max(1, roc.steps.length));
  const current = roc.steps[step - 1];
  const exact = (model === MODEL_IMAGE ? image : sequence)?.area_under_curve;

  // E: filters
  const tiles = filterTiles(body?.filters ?? []);
  const maxAbsWeight = Math.max(0, ...(body?.filters ?? []).map((row) => Math.abs(row.weight)));
  const clip = maxAbsWeight * (controls.filterClip / 100);
  const shownTiles = controls.filterOrder === "norm" ? [...tiles].sort((a, b) => b.norm - a.norm) : tiles;
  const positiveShare = (body?.filters ?? []).length > 0 ? (body?.filters ?? []).filter((row) => row.weight > 0).length / (body?.filters ?? []).length : null;
  const strongest = [...tiles].sort((a, b) => b.norm - a.norm)[0];

  const verdictCounts = { null: 0, weak: 0, real: 0 };
  for (const row of results) verdictCounts[verdictFor(row.area_under_curve)] += 1;
  const upperBounds = results.map((row) => row.area_under_curve_interval_high);
  const excludesHalf = results.filter((row) => row.area_under_curve_interval_low > 0.5).length;
  const differencesInclude0 = comparisons.filter((row) => row.difference_interval_low <= 0 && row.difference_interval_high >= 0).length;

  const tagOptions = tags.map((value) => ({ value, label: value }));

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />

        {results.length === 0 ? (
          <p className="rounded-md border border-neutral-800 bg-neutral-900/50 px-3 py-2 text-xs text-neutral-300">
            The direction tables are not in the lake yet. They come from <span className="font-mono">packages/ml-engine/src/studies/chart_cnn_direction_null_result/build.py</span>,
            which reads the chart_cnn package's results, prediction files and first-layer weights and lands them as
            <span className="font-mono"> derived_study_chart_cnn_direction_null_result_*</span>.
          </p>
        ) : (
          <>
            <ControlBar onReset={reset}>
              <SegmentControl label="Dataset tag" value={tag} options={tagOptions} onChange={(value) => set("tag", value)} hint="Which timeframe's last 40% (never seen in training) the charts show" />
              <SegmentControl label="Score bins" value={controls.bins} options={BIN_OPTIONS.map((value) => ({ value, label: value === 10 ? "10 (deciles)" : String(value) }))} onChange={(value) => set("bins", value)} hint="Equal-count bins of the predicted probability; 10 is the notebook's deciles" />
              <SwitchControl label="95% intervals" checked={controls.intervals} onChange={(value) => set("intervals", value)} hint="Wilson interval on each up-rate, standard error on each mean R, DeLong on each AUC" />
            </ControlBar>

            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <Stat label={`${tag} test rows`} value={fmtInt(image?.test_observation_count)} hint="the last 40% of the tag in time, never seen in training" />
              <Stat label="2D image AUC" value={fmt(image?.area_under_curve, 4)} hint={`95% interval ${fmt(image?.area_under_curve_interval_low, 4)} to ${fmt(image?.area_under_curve_interval_high, 4)}`} />
              <Stat label="1D sequence AUC" value={fmt(sequence?.area_under_curve, 4)} hint={`95% interval ${fmt(sequence?.area_under_curve_interval_low, 4)} to ${fmt(sequence?.area_under_curve_interval_high, 4)}`} />
              <Stat
                label="Image minus sequence"
                value={signed(comparison?.area_under_curve_difference_image_minus_sequence, 4)}
                hint={`paired DeLong 95% interval ${fmt(comparison?.difference_interval_low, 4)} to ${fmt(comparison?.difference_interval_high, 4)}`}
              />
            </div>

            <Section title="A. Out-of-sample AUC against the verdict bands" question="Does the picture beat the numbers, and does either beat a coin?">
              <AucForest rows={results} selectedTag={tag} showIntervals={controls.intervals} />
              <Finding>
                All {results.length} AUCs sit between {fmt(Math.min(...results.map((row) => row.area_under_curve)), 3)} and {fmt(Math.max(...results.map((row) => row.area_under_curve)), 3)};
                {" "}{verdictCounts.null} of {results.length} read as a null result (below 0.53), and the highest interval ends at {fmt(Math.max(...upperBounds), 3)}{Math.max(...upperBounds) < 0.53 ? ", still below the 0.53 line" : ""}.
                {" "}{excludesHalf} of {results.length} intervals lie wholly above 0.50: a signal that small sits inside the null band, and the intervals treat overlapping barrier windows as independent, so they are narrower than the truth.
                {" "}The 2D image model is the lower of the two on {comparisons.filter((row) => row.area_under_curve_difference_image_minus_sequence < 0).length} of {comparisons.length} tags, and the paired difference interval includes zero on {differencesInclude0} of {comparisons.length}:
                {" "}drawing the bars as a picture adds nothing the numbers do not already carry.
              </Finding>
              <DataTable
                head={["tag", "model", "n", "AUC", "95% interval", "long top 20% R", "short bottom 20% R", "naive long R", "verdict"]}
                rows={results.map((row) => ({
                  key: `${row.dataset_tag}-${row.model_name}`,
                  emphasised: row.dataset_tag === tag,
                  cells: [
                    row.dataset_tag, row.model_name, fmtInt(row.test_observation_count), fmt(row.area_under_curve, 3),
                    `${fmt(row.area_under_curve_interval_low, 3)} to ${fmt(row.area_under_curve_interval_high, 3)}`,
                    signed(row.long_top_20_percent_mean_return_atr_multiples, 3), signed(row.short_bottom_20_percent_mean_return_atr_multiples, 3),
                    signed(row.naive_long_mean_return_atr_multiples, 3), VERDICT_GLYPH[verdictFor(row.area_under_curve)],
                  ],
                }))}
              />
              <p className="mt-1 text-[11px] text-neutral-500">R is the trade return in ATR multiples (the label's barrier is ±2 ATR, so R runs from −2 to +2). Summary of the last 40% of each tag, rounded as the notebook rounds it.</p>
            </Section>

            <Section title="B. Predicted score against what actually happened" question={`${tag}: up-rate and mean long R in each ${controls.bins === 10 ? "decile" : `${controls.bins}-bin group`} of the predicted probability.`}>
              <div className="min-w-0">
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={upRateRows} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="bin" {...AXIS} label={{ value: "predicted-probability bin (1 = most bearish, highest = most bullish)", position: "insideBottom", offset: -4, fontSize: 10, fill: "#a3a3a3" }} height={36} />
                    <YAxis domain={[yLow, yHigh]} {...AXIS} width={48} tickFormatter={(v: number) => v.toFixed(3)} label={{ value: "fraction that hit +2 ATR first", angle: -90, position: "insideLeft", fontSize: 10, fill: "#a3a3a3" }} />
                    <ReferenceLine y={baseRate} stroke="#d4d4d4" strokeDasharray="5 4" label={{ value: `base rate ${baseRate.toFixed(3)}`, position: "insideTopRight", fontSize: 10, fill: "#d4d4d4" }} />
                    <Tooltip
                      {...TOOLTIP}
                      content={({ payload }) => {
                        const row = payload?.[0]?.payload as (typeof upRateRows)[number] | undefined;
                        if (!row) return null;
                        return (
                          <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                            <div className="font-semibold">bin {row.bin} · n {fmtInt(row.count)} each</div>
                            <div>● 2D image: {fmt(row.image, 4)}{row.imageError && controls.intervals ? ` (${fmt(row.image !== null ? row.image - row.imageError[0] : null, 4)} to ${fmt(row.image !== null ? row.image + row.imageError[1] : null, 4)})` : ""}</div>
                            <div>■ 1D sequence: {fmt(row.sequence, 4)}{row.sequenceError && controls.intervals ? ` (${fmt(row.sequence !== null ? row.sequence - row.sequenceError[0] : null, 4)} to ${fmt(row.sequence !== null ? row.sequence + row.sequenceError[1] : null, 4)})` : ""}</div>
                            <div>base rate {fmt(baseRate, 4)}</div>
                          </div>
                        );
                      }}
                    />
                    <Line
                      dataKey="image"
                      name="2D image CNN"
                      stroke={OKABE.orange}
                      strokeWidth={2}
                      isAnimationActive={false}
                      dot={(props: { cx?: number; cy?: number; index?: number }) => (
                        <circle key={`i-${props.index}`} cx={props.cx} cy={props.cy} r={4} fill={OKABE.orange} stroke="#0a0a0a" strokeWidth={0.8} />
                      )}
                    >
                      {controls.intervals && <ErrorBar dataKey="imageError" direction="y" width={4} strokeWidth={1.2} stroke={OKABE.orange} />}
                    </Line>
                    <Line
                      dataKey="sequence"
                      name="1D sequence CNN (control)"
                      stroke={OKABE.blue}
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      isAnimationActive={false}
                      dot={(props: { cx?: number; cy?: number; index?: number }) => (
                        <rect key={`s-${props.index}`} x={(props.cx ?? 0) - 3.5} y={(props.cy ?? 0) - 3.5} width={7} height={7} fill={OKABE.blue} stroke="#0a0a0a" strokeWidth={0.8} />
                      )}
                    >
                      {controls.intervals && <ErrorBar dataKey="sequenceError" direction="y" width={4} strokeWidth={1.2} stroke={OKABE.blue} />}
                    </Line>
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="text-[11px] text-neutral-400">
                  <span style={{ color: OKABE.orange }}>● solid: 2D image CNN, AUC {fmt(image?.area_under_curve, 3)}</span> ·{" "}
                  <span style={{ color: OKABE.blue }}>■ dashed: 1D sequence CNN (control), AUC {fmt(sequence?.area_under_curve, 3)}</span> · dashed grey: base rate
                </p>
              </div>
              <Finding>
                If a model ranked direction, the up-rate would climb from bin 1 to the top bin. Rank correlation of up-rate with bin is{" "}
                {fmt(imageTrend, 2)} for the image model and {fmt(sequenceTrend, 2)} for the control; {binsOutsideBaseRate(imageBins)} of {imageBins.length} image bins and{" "}
                {binsOutsideBaseRate(sequenceBins)} of {sequenceBins.length} control bins have an interval that excludes the base rate. The two curves' intervals overlap in {overlapping} of{" "}
                {upRateRows.length} bins: where they overlap, any signal is not coming from shape, because the numbers carry it just as well.
              </Finding>
              <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
                <ReturnBars name={`2D image CNN · mean R (long) by bin`} bins={imageBins} intervals={controls.intervals} />
                <ReturnBars name={`1D sequence CNN · mean R (long) by bin`} bins={sequenceBins} intervals={controls.intervals} />
              </div>
              <p className="text-[11px] text-neutral-400"><span style={{ color: OKABE.orange }}>▲ orange: positive mean R</span> · <span style={{ color: OKABE.blue }}>▼ blue: negative</span> · whiskers ±1.96 standard errors</p>
              <Finding>
                Top bin minus bottom bin, in ATR multiples of R: image {signed(imageSpread?.difference, 3)} ± {fmt(imageSpread?.halfWidth, 3)}, control {signed(sequenceSpread?.difference, 3)} ± {fmt(sequenceSpread?.halfWidth, 3)}.
                A single bin's mean R carries ±{fmt(1.959963984540054 * (imageBins[0]?.mean_return_standard_error_atr_multiples ?? 0), 2)} R of its own (image model, bin 1).
              </Finding>
            </Section>

            <Section title="C. Trading the extremes against always buying" question="Long the top 20% of scores, short the bottom 20%, compared with going long every bar.">
              <ResponsiveContainer width="100%" height={Math.max(180, 30 * excessRows.length)}>
                <BarChart data={excessRows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid {...GRID} horizontal={false} />
                  <XAxis type="number" {...AXIS} tickFormatter={(v: number) => signed(v, 2)} />
                  <YAxis type="category" dataKey="label" width={120} {...AXIS} interval={0} />
                  <ReferenceLine x={0} stroke={OKABE.grey} />
                  <Tooltip
                    {...TOOLTIP}
                    content={({ payload }) => {
                      const row = payload?.[0]?.payload as (typeof excessRows)[number] | undefined;
                      if (!row) return null;
                      return (
                        <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                          <div className="font-semibold">{row.label}</div>
                          <div>{row.excess >= 0 ? "▲" : "▼"} long top 20% minus always-long: {signed(row.excess, 4)} ± {fmt(row.half, 4)} R</div>
                          <div>long top 20% {signed(row.long_top_20_percent_mean_return_atr_multiples, 4)} · always long {signed(row.naive_long_mean_return_atr_multiples, 4)}</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="excess" isAnimationActive={false}>
                    {excessRows.map((row) => (
                      <Cell key={row.label} fill={row.excess >= 0 ? OKABE.orange : OKABE.blue} fillOpacity={row.dataset_tag === tag ? 1 : 0.55} />
                    ))}
                    {controls.intervals && <ErrorBar dataKey="half" direction="x" width={4} stroke="#d4d4d4" />}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-neutral-400">
                mean R of the top-20% longs minus the mean R of going long on every bar (same rows) · whisker ≈ ±1.96 × sd / √(0.2 n), treating bars as independent
              </p>
              <Finding>
                Top-20% longs minus always-long run from {signed(Math.min(...excessRows.map((row) => row.excess)), 3)} to {signed(Math.max(...excessRows.map((row) => row.excess)), 3)} R across the {excessRows.length} runs, and
                {" "}{excessRows.filter((row) => Math.abs(row.excess) <= row.half).length} of {excessRows.length} of those gaps are inside their own interval. The bottom-20% shorts range from{" "}
                {signed(Math.min(...results.map((row) => row.short_bottom_20_percent_mean_return_atr_multiples)), 3)} to {signed(Math.max(...results.map((row) => row.short_bottom_20_percent_mean_return_atr_multiples)), 3)} R, before any trading cost.
              </Finding>
            </Section>

            <Section title="D. Where an AUC of 0.50 comes from, one bin at a time" question="Step the sum: each score bin adds one trapezoid under the ROC curve.">
              <ControlBar>
                <SegmentControl label="Model" value={model} options={[{ value: MODEL_IMAGE, label: "2D image" }, { value: MODEL_SEQUENCE, label: "1D sequence" }]} onChange={(value) => set("model", value)} />
                <SliderControl label="Step j" value={step} min={1} max={Math.max(1, roc.steps.length)} onChange={(value) => set("rocStep", value)} hint="How many score bins, from the highest-scoring down, have been added to the called-up set" />
              </ControlBar>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <FormulaCard
                  tex={"\\mathrm{AUC}\\;\\approx\\;\\sum_{j=1}^{k}\\,\\left(F_j-F_{j-1}\\right)\\,\\frac{T_{j-1}+T_j}{2}"}
                  caption={current
                    ? `Bin ${current.binNumber} adds ${fmt(current.area, 5)}; after ${step} of ${roc.steps.length} bins the running total is ${fmt(current.cumulativeArea, 5)}. All bins: ${fmt(roc.areaUnderCurve, 5)} against the exact ${fmt(exact, 5)}.`
                    : undefined}
                  symbols={[
                    { tex: "\\mathrm{AUC}", name: "area under the ROC curve: the chance a random up row scores above a random not-up row (exact value from every row)", value: fmt(exact, 5) },
                    { tex: "\\sum_{j=1}^{k}", name: "add one trapezoid per score bin, highest-scoring bin first", value: `${step} of ${roc.steps.length} added` },
                    { tex: "j", name: "step: the j-th highest-scoring bin", value: current ? `${step} (bin ${current.binNumber})` : "—" },
                    { tex: "k", name: "number of equal-count score bins", value: String(roc.steps.length) },
                    { tex: "T_j", name: "true-positive rate: share of all up rows scored in the top j bins", value: fmt(current?.truePositiveRate, 4) },
                    { tex: "F_j", name: "false-positive rate: share of all not-up rows scored in the top j bins", value: fmt(current?.falsePositiveRate, 4) },
                    { tex: "F_j-F_{j-1}", name: "width of the trapezoid: not-up rows this bin adds, as a share of all", value: fmt(current ? current.falsePositiveRate - current.previousFalsePositiveRate : null, 4) },
                    { tex: "\\frac{T_{j-1}+T_j}{2}", name: "mean height of the trapezoid", value: fmt(current ? (current.previousTruePositiveRate + current.truePositiveRate) / 2 : null, 4) },
                    { tex: "(F_j-F_{j-1})\\frac{T_{j-1}+T_j}{2}", name: "this step's term", value: fmt(current?.area, 5) },
                  ]}
                />
                <RocTrapezoids roc={roc} currentStep={step} />
              </div>
              <DataTable
                head={["step j", "bin", "up rows", "not-up rows", "T_j", "F_j", "term", "running total"]}
                rows={roc.steps.map((row) => ({
                  key: String(row.step),
                  emphasised: row.step === step,
                  cells: [row.step, row.binNumber, fmtInt(row.positiveCount), fmtInt(row.negativeCount), fmt(row.truePositiveRate, 4), fmt(row.falsePositiveRate, 4), fmt(row.area, 5), fmt(row.cumulativeArea, 5)],
                }))}
              />
              <Finding>
                A model with no ranking power traces the dashed diagonal, and the trapezoids then add up to 0.5. Here the curve stays on the diagonal within {fmt(Math.max(...roc.steps.map((row) => Math.abs(row.truePositiveRate - row.falsePositiveRate))), 3)} everywhere.
                {" "}The bin-by-bin area ({fmt(roc.areaUnderCurve, 4)}) differs from the exact AUC ({fmt(exact, 4)}) only by the ordering inside each bin, which the straight segment across a bin ignores.
              </Finding>
            </Section>

            <Section title="E. What the 2D model looks for: its 32 first-layer filters" question="Each filter is a 5 price-pixel by 3 time-pixel patch of weights slid across the chart image.">
              <ControlBar>
                <SegmentControl label="Order" value={controls.filterOrder} options={[{ value: "index", label: "filter number" }, { value: "norm", label: "strongest first" }]} onChange={(value) => set("filterOrder", value)} />
                <SliderControl label="Colour range" value={controls.filterClip} min={10} max={100} step={5} onChange={(value) => set("filterClip", value)} format={(value) => `${value}% of max weight`} hint="Saturate the colours at this share of the largest absolute weight" />
                <SwitchControl label="+/− glyphs" checked={controls.filterGlyphs} onChange={(value) => set("filterGlyphs", value)} hint="Mark strong weights with their sign, so colour is not the only signal" />
              </ControlBar>
              <FilterLegend clip={clip} />
              <FilterTiles tiles={shownTiles} clip={clip} glyphs={controls.filterGlyphs} />
              <Finding>
                {tiles.length} filters, {positiveShare === null ? "—" : `${(positiveShare * 100).toFixed(0)}%`} of their {fmtInt((body?.filters ?? []).length)} weights positive. The strongest filter is #{strongest?.filterNumber ?? "—"} (length {fmt(strongest?.norm, 3)}).
                {" "}They show what the first layer responds to; they are not evidence that the response predicts direction, since the model's AUC is {fmt(image?.area_under_curve, 3)}.
              </Finding>
            </Section>

            <Section title="F. Every column" question="Each numeric column of the landed tables, with its eight numbers.">
              <div className="space-y-4">
                <ColumnGrid rows={results} title="model_results" />
                <ColumnGrid rows={comparisons} title="model_comparison" />
                <ColumnGrid rows={allBins} title="score_bins" />
                <ColumnGrid rows={body?.filters ?? []} title="first_layer_filters" />
              </div>
            </Section>

            <Section title="G. How to read an AUC" question="The notebook's rule, with where each run falls.">
              <DataTable
                head={["out-of-sample AUC", "meaning", "runs here"]}
                rows={VERDICT_BANDS.map((band) => ({
                  key: band.verdict,
                  cells: [band.label, <span key="m" className="font-sans">{band.meaning}</span>, `${verdictCounts[band.verdict]} of ${results.length}`],
                }))}
              />
              <Finding>
                Method: a chronological split, the first 60% of each tag to train (the last 15% of that for early stopping) and the last 40% to test, never shuffled. The label is +2 ATR before −2 ATR within
                four times the median ZigZag leg, else the sign of the return. The 1D control sees the same 48 bars as normalised numbers, so if it matches the 2D model the gain is not from shape.
                {" "}Recipe landed: <span className="font-mono">{body?.recipe}</span>.
              </Finding>
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
