/**
 * Section 2: where each pattern sits in the space (raw 64 numbers, or the
 * recogniser's 32 internal numbers). Section 3: pointing it out, on held-out
 * 2025 one-minute windows and on 1h / 4h candles the models never saw.
 */

import {
  Bar, BarChart, CartesianGrid, Legend as ChartLegend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, GRID, OKABE, Section, SelectControl, SliderControl, StudyNotes, StudyState, TOOLTIP,
  fmt, fmtInt, fmtPercent, useStudyQuery,
} from "@/studies/kit";
import {
  EVALUATION_SETS, MAP_PROJECTIONS, PATTERNS, RECOGNIZER_MODELS, confusionAtThreshold, middleSpan, type MapBody, type RecogniserBody,
} from "@shared/studies/candle-vectors";
import { IntervalPlot, Legend, MatrixHeatmap, PATTERN_STYLE, ScatterCanvas, cividis, type IntervalItem, type SeriesStyle } from "./charts";
import type { TabProps } from "./controls";

const MAP_GROUPS = [...PATTERNS, "no pattern"];
const MODEL_STYLE: Record<string, SeriesStyle> = {
  "neural network": { color: OKABE.vermillion, glyph: "diamond", label: "neural network" },
  "gradient-boosted trees": { color: OKABE.blue, glyph: "square", label: "gradient-boosted trees" },
  "logistic regression": { color: OKABE.grey, glyph: "circle", label: "logistic regression" },
};

function MapSection({ controls, set }: TabProps) {
  const query = useStudyQuery<MapBody>("candle-vectors", { section: "map", projection: controls.projection, perPattern: controls.perPattern });
  const body = query.data?.data;
  const hidden = new Set(controls.mapShown === "all" ? [] : MAP_GROUPS.filter((group) => !controls.mapShown.split(",").includes(group)));
  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    const shown = MAP_GROUPS.filter((group) => !next.has(group));
    set("mapShown", shown.length === MAP_GROUPS.length ? "all" : shown.join(","));
  };
  const points = (body?.points ?? []).filter((point) => !hidden.has(point.pattern));
  const xDomain = middleSpan(points.map((p) => p.horizontal), controls.mapZoom) ?? [0, 1];
  const yDomain = middleSpan(points.map((p) => p.vertical), controls.mapZoom) ?? [0, 1];
  const variance = body?.explainedVariance;
  return (
    <Section title="2 · Where each pattern sits in the space" question="Every point is one held-out 2025 one-minute window flattened onto its two main directions (principal components). In the recogniser's space each pattern should gather in its own region: the picture of the model knowing what a hammer is.">
      <ControlBar>
        <SelectControl label="Space" value={controls.projection} options={MAP_PROJECTIONS.map((p) => ({ value: p, label: p }))} onChange={(v) => set("projection", v)} />
        <SliderControl label="Point opacity" value={controls.mapOpacity} min={0.05} max={1} step={0.05} onChange={(v) => set("mapOpacity", v)} format={(v) => v.toFixed(2)} />
        <SliderControl label="Windows per pattern" value={controls.perPattern} min={200} max={2500} step={100} onChange={(v) => set("perPattern", v)} hint="ordinary windows get four times this" />
        <SliderControl label="Axes span the middle %" value={controls.mapZoom} min={90} max={100} step={0.5} onChange={(v) => set("mapZoom", v)} format={(v) => `${v}%`} hint="the rest pinned to the edge (a few windows beside a weekend gap sit far out)" />
      </ControlBar>
      <Legend items={MAP_GROUPS.map((group) => ({ key: group, ...(PATTERN_STYLE[group] as SeriesStyle) }))} onToggle={toggle} hidden={hidden} />
      <StudyState isLoading={query.isLoading} error={query.error}>
        {!body?.landed ? <Empty>The recogniser's window map is not in the lake.</Empty> : (
          <>
            <div className="text-[11px] text-neutral-400">{fmtInt(points.length)} held-out 2025 1m windows · hover a point for the network's probability of each pattern</div>
            <ScatterCanvas
              points={points.map((point) => ({
                x: point.horizontal, y: point.vertical, group: point.pattern,
                tip: () => [point.time_label, `on the bar: ${point.every_pattern_on_the_bar ?? "no pattern"}`,
                  ...PATTERNS.map((p) => `probability of ${PATTERN_STYLE[p]?.label}: ${fmt(point[`neural_network_probability_${p}`] as number, 3)}`)],
              }))}
              styles={PATTERN_STYLE} opacity={controls.mapOpacity} xDomain={xDomain} yDomain={yDomain}
              xLabel={`first component (${fmtPercent(variance?.[0], 0)} of variance)`} yLabel={`second component (${fmtPercent(variance?.[1], 0)} of variance)`}
            />
          </>
        )}
      </StudyState>
    </Section>
  );
}

export function RecogniserTab({ controls, set }: TabProps) {
  const query = useStudyQuery<RecogniserBody>("candle-vectors", {
    section: "recogniser", model: controls.model, evaluationSet: controls.evaluationSet, pattern: controls.pattern,
  });
  const body = query.data?.data;
  const metrics = body?.metrics ?? [];
  const confusion = confusionAtThreshold(body?.histogram ?? [], controls.threshold);
  const bins = new Map<number, { bin: string; lower: number; pattern: number; other: number }>();
  for (const row of body?.histogram ?? []) {
    const entry = bins.get(row.bin_lower) ?? { bin: fmt(row.bin_lower, 2), lower: row.bin_lower, pattern: 1, other: 1 };
    if (row.population === "pattern") entry.pattern = row.window_count + 1; else entry.other = row.window_count + 1;
    bins.set(row.bin_lower, entry);
  }
  const histogram = [...bins.values()].sort((a, b) => a.lower - b.lower);
  const thresholdBin = [...histogram].reverse().find((bin) => bin.lower <= controls.threshold)?.bin;
  const importance = body?.importance ?? [];
  const importanceMaximum = Math.max(1e-6, ...importance.map((row) => row.average_precision_drop_when_shuffled));
  const importanceOf = (price: string, barsBack: string) => importance.find((row) => row.price === price && row.bars_back === Number(barsBack));
  const patternLabel = PATTERN_STYLE[controls.pattern]?.label ?? controls.pattern;

  return (
    <>
      <MapSection controls={controls} set={set} />
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        <Section title="3 · Pointing it out, and whether it learned the idea or the chart" question="Three models see only the 64 numbers. Trained on 2021-2023 1m windows, threshold picked on 2024, scored on 2025, then run unchanged on 1h and 4h candles they never saw. Average precision 1.0 = every alarm right and every pattern found.">
          {!body?.landed ? <Empty>The recogniser results are not in the lake.</Empty> : (
            <>
              <Legend items={Object.entries(MODEL_STYLE).map(([key, style]) => ({ key, ...style }))} />
              <p className="text-[11px] text-neutral-400">line = 95% trading-day block bootstrap interval · white tick = what guessing scores (the pattern's share of windows)</p>
              <div className="grid min-w-0 gap-3 xl:grid-cols-3">
                {EVALUATION_SETS.map((set_) => (
                  <div key={set_} className="min-w-0">
                    <div className="text-[11px] font-medium text-neutral-300">{set_}</div>
                    <IntervalPlot
                      rows={[...PATTERNS]} series={[...RECOGNIZER_MODELS]} domain={[0, 1]} xLabel="average precision" labelWidth={104}
                      items={metrics.filter((row) => row.evaluation_set === set_).map((row): IntervalItem => ({
                        row: row.pattern, series: row.model_name, value: row.average_precision, low: row.average_precision_day_block_lower_95,
                        high: row.average_precision_day_block_upper_95, style: MODEL_STYLE[row.model_name] as SeriesStyle,
                        extras: [{ value: row.prevalence, kind: "tick", color: "#e5e5e5" }],
                        tip: [`${row.model_name} · ${row.pattern} · ${row.evaluation_set}`, `average precision ${fmt(row.average_precision, 4)}`,
                          `area under the ROC curve ${fmt(row.area_under_roc_curve, 4)}`, `prevalence ${fmtPercent(row.prevalence, 2)}`, `precision ${fmt(row.precision, 3)} · recall ${fmt(row.recall, 3)}`,
                          `patterns ${fmtInt(row.pattern_count)}`],
                      }))}
                    />
                  </div>
                ))}
              </div>
              <Finding>
                Two limits, measured. On 1h and 4h candles the ranking carries over (area under the ROC curve 0.99–1.00), but the alarm threshold tuned on 1-minute
                data does not: it catches only 26% of 1h and 13% of 4h shooting stars, and harami alarms there are right about two times in
                three. Pick the 1h or 4h set below and drag the threshold to see what a timeframe-specific one would give. Separately, on a
                0.25-point tick grid some rule comparisons tie exactly and dividing by Rₜ breaks the tie, so 0.2–0.9% of 1m hammer, harami and
                doji labels sit on the wrong side of their boundary in the vector itself, which caps what any model can score on them.
              </Finding>

              <ControlBar>
                <SelectControl label="Model" value={controls.model} options={RECOGNIZER_MODELS.map((m) => ({ value: m, label: m }))} onChange={(v) => set("model", v)} />
                <SelectControl label="Evaluated on" value={controls.evaluationSet} options={EVALUATION_SETS.map((s) => ({ value: s, label: s }))} onChange={(v) => set("evaluationSet", v)} />
                <SliderControl label="Alarm when probability ≥" value={controls.threshold} min={0.005} max={0.995} step={0.005} onChange={(v) => set("threshold", v)} format={(v) => v.toFixed(3)} />
              </ControlBar>
              <div className="grid min-w-0 gap-3 xl:grid-cols-[2fr_1fr]">
                <div className="min-w-0">
                  <div className="text-[11px] text-neutral-300">{patternLabel}: {controls.model} on {controls.evaluationSet}</div>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={histogram} margin={{ top: 6, right: 8, left: 4, bottom: 16 }} barGap={0} barCategoryGap={1}>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="bin" {...AXIS} interval={4} label={{ value: "model probability", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                      <YAxis scale="log" domain={[1, "auto"]} allowDataOverflow {...AXIS} tickFormatter={(v: number) => fmtInt(v)} label={{ value: "windows + 1 (log)", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
                      <Tooltip {...TOOLTIP} formatter={(value, name) => [fmtInt(Number(value) - 1), name]} />
                      <ChartLegend wrapperStyle={{ fontSize: 11 }} />
                      {thresholdBin && <ReferenceLine x={thresholdBin} stroke={OKABE.sky} strokeWidth={2} label={{ value: `threshold ${controls.threshold.toFixed(3)}`, fill: OKABE.sky, fontSize: 10, position: "top" }} />}
                      <Bar dataKey="pattern" name="▲ the pattern" fill={OKABE.orange} fillOpacity={0.8} isAnimationActive={false} />
                      <Bar dataKey="other" name="● not the pattern" fill={OKABE.grey} fillOpacity={0.6} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <table className="self-start text-[11px] font-mono tnum">
                  <tbody>
                    {[
                      ["found (true alarms)", fmtInt(confusion.truePositive)], ["missed", fmtInt(confusion.falseNegative)],
                      ["false alarms", fmtInt(confusion.falsePositive)], ["correctly quiet", fmtInt(confusion.trueNegative)],
                      ["precision: share of alarms that were the pattern", fmt(confusion.precision, 3)], ["recall: share of patterns found", fmt(confusion.recall, 3)],
                    ].map(([label, value]) => (
                      <tr key={label} className="border-t border-neutral-900"><td className="py-0.5 pr-3 text-neutral-400">{label}</td><td className="text-right text-neutral-100">{value}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid min-w-0 gap-3 xl:grid-cols-[2fr_1fr]">
                <div className="min-w-0">
                  <div className="text-[11px] text-neutral-300">
                    Where the {body.importanceModel} looks to find a {patternLabel}: shuffle one number across windows and measure how much average precision falls (cividis, darker = less)
                  </div>
                  <MatrixHeatmap
                    rows={["open", "high", "low", "close"]} columns={Array.from({ length: 16 }, (_, i) => String(15 - i))}
                    value={(price, barsBack) => importanceOf(price, barsBack)?.average_precision_drop_when_shuffled ?? null}
                    color={(v) => cividis(v / importanceMaximum)} format={(v) => fmt(v, 2)} height={130} xLabel="bars back from the last candle"
                    tip={(price, barsBack) => {
                      const row = importanceOf(price, barsBack);
                      return [`${price}, ${barsBack} bars back`, `precision lost when shuffled ${fmt(row?.average_precision_drop_when_shuffled, 4)}`, `baseline average precision ${fmt(row?.baseline_average_precision, 4)}`];
                    }}
                  />
                  <Finding>
                    A model that learned the rule looks where the rule looks: a hammer is decided by the last candle's open, low and close and the
                    previous candle's low; an engulfing by the last two candles' opens and closes. Bright cells elsewhere would mean a shortcut.
                    {controls.model === "logistic regression" && " (Importance was measured for the network and the trees; the network's is shown.)"}
                  </Finding>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-neutral-300">Neural network training, every epoch</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={body.trainingLog} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="epoch" {...AXIS} />
                      <YAxis {...AXIS} domain={["auto", "auto"]} tickFormatter={(v: number) => fmt(v, 3)} />
                      <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 5)} />
                      <ChartLegend wrapperStyle={{ fontSize: 11 }} />
                      <Line dataKey="training_loss" name="training loss (solid)" stroke={OKABE.orange} dot={{ r: 1.5 }} isAnimationActive={false} />
                      <Line dataKey="validation_loss" name="validation loss (dashed)" stroke={OKABE.blue} strokeDasharray="5 3" dot={{ r: 1.5 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <ColumnGrid rows={metrics as unknown as Record<string, unknown>[]} title="Every column of the recogniser metrics (63 rows)" />
            </>
          )}
        </Section>
      </StudyState>
    </>
  );
}
