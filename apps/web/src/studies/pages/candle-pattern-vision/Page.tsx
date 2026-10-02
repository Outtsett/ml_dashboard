/**
 * Candle pattern vision. One landed run at a time (picker, newest first); the server sends every
 * table of the run and the exemplar images of the selected class; all filtering happens here.
 */

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, Stat,
  StudyNotes, StudyState, TOOLTIP, Finding, fmt, fmtInt, fmtPercent, fmtTime, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import type { ClassMetric, ConfusionCell, Exemplar, VisionBody } from "@shared/studies/candle-pattern-vision";

const KIND_ORDER: Exemplar["kind"][] = ["real hit", "real near miss", "real miss", "real false alarm", "synthetic hit"];
const KIND_NOTE: Record<Exemplar["kind"], string> = {
  "real hit": "TA-Lib fired, the model called it",
  "real near miss": "TA-Lib's exact rule just missed, but the pattern holds within the tolerance — the model called it",
  "real miss": "TA-Lib fired, the model did not call it",
  "real false alarm": "the model called it, TA-Lib did not fire",
  "synthetic hit": "a TA-Lib-confirmed synthetic chart the model called",
};

function num(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Rows = the pattern TA-Lib fired, columns = every pattern the model called; cividis by share, a
 *  printed value where it is large enough to read, the full names in each cell's tooltip. */
function ConfusionMatrix({ cells, rows, columns, selected, onSelect }: {
  cells: ConfusionCell[]; rows: string[]; columns: string[]; selected: string; onSelect: (pattern: string) => void;
}) {
  const size = 14, left = 130, top = 120;
  const lookup = new Map(cells.map((cell) => [`${cell.true_pattern}|${cell.called_pattern}`, cell]));
  const colour = (share: number) => {
    const t = Math.sqrt(Math.min(1, share / 100));
    const stops = [[0, 32, 77], [124, 123, 120], [255, 234, 70]];
    const [a, b, u] = t < 0.5 ? [stops[0], stops[1], t * 2] : [stops[1], stops[2], (t - 0.5) * 2];
    return `rgb(${(a as number[]).map((v, k) => Math.round(v + (((b as number[])[k] as number) - v) * (u as number))).join(",")})`;
  };
  return (
    <div className="overflow-x-auto">
      <svg width={left + columns.length * size + 10} height={top + rows.length * size + 10} role="img" aria-label="pattern confusion matrix">
        {columns.map((name, c) => (
          <text key={name} transform={`translate(${left + c * size + size / 2 + 3},${top - 4}) rotate(-60)`} fontSize={9}
            fill={name === selected ? OKABE.orange : "#a3a3a3"}>{name}</text>
        ))}
        {rows.map((rowName, r) => (
          <g key={rowName}>
            <text x={left - 4} y={top + r * size + size - 3} fontSize={9} textAnchor="end" className="cursor-pointer"
              fill={rowName === selected ? OKABE.orange : "#a3a3a3"} onClick={() => onSelect(rowName)}>{rowName}</text>
            {columns.map((columnName, c) => {
              const cell = lookup.get(`${rowName}|${columnName}`);
              const share = cell?.model_share_percent ?? 0;
              return (
                <rect key={columnName} x={left + c * size} y={top + r * size} width={size - 1} height={size - 1}
                  fill={share > 0 ? colour(share) : "#141414"} stroke={rowName === columnName ? "#e5e5e5" : "none"} strokeWidth={0.6}>
                  <title>{`TA-Lib fired ${rowName} on ${fmtInt(cell?.bars_with_true_pattern ?? lookup.get(`${rowName}|${rowName}`)?.bars_with_true_pattern)} real test bars; the model called ${columnName} on ${fmt(share, 2)}% of them (TA-Lib itself fired ${columnName} on ${fmt(cell?.talib_share_percent ?? 0, 2)}%)`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    run: "",
    className: "engulfing:bearish",
    source: "real",
    minimumFirings: 10,
    metric: "f1",
    labels: "tolerant",
  });
  const query = useStudyQuery<VisionBody>("candle-pattern-vision", { run: controls.run, className: controls.className });
  const body = query.data?.data;
  const run = body?.run ?? null;
  const metrics = body?.classMetrics ?? [];
  const hasTolerant = metrics.some((row) => row.labels === "tolerant");
  const labelKind = hasTolerant ? controls.labels : "exact";
  const ofKind = (row: ClassMetric) => (row.labels ?? "exact") === labelKind;
  const testRows = metrics.filter((row) => row.split === "test" && row.source === controls.source && ofKind(row));
  const shown = testRows
    .filter((row) => row.positives >= (controls.source === "real" ? controls.minimumFirings : 1))
    .map((row) => ({ ...row, value: num(row[controls.metric as "f1" | "average_precision" | "recall" | "precision"]) ?? 0 }))
    .sort((a, b) => b.value - a.value);
  const selected: ClassMetric | undefined = metrics.find((row) => row.class_name === controls.className && row.split === "test" && row.source === "real" && ofKind(row));
  const selectedSynthetic = metrics.find((row) => row.class_name === controls.className && row.split === "test" && row.source === "synthetic" && ofKind(row));
  const classNames = [...new Set(metrics.map((row) => row.class_name))].sort();
  const pattern = controls.className.split(":")[0] ?? "";
  const confusionRow = (body?.confusion ?? [])
    .filter((cell) => cell.true_pattern === pattern)
    .sort((a, b) => b.model_share_percent - a.model_share_percent)
    .slice(0, 14);
  const truePatterns = [...new Set((body?.confusion ?? []).map((cell) => cell.true_pattern))].sort();
  const calledPatterns = [...new Set((body?.confusion ?? []).flatMap((cell) => [cell.true_pattern, cell.called_pattern]))].sort();
  const sampleRows = classNames.map((name) => {
    const count = (split: string, source: string) => (body?.samples ?? []).find((s) => s.class_name === name && s.split === split && s.source === source)?.windows ?? 0;
    return { class_name: name, train_real: count("train", "real"), train_synthetic: count("train", "synthetic"), test_real: count("test", "real"), test_synthetic: count("test", "synthetic") };
  });
  const exemplars = body?.exemplars ?? [];
  const toPercent = (v: number | null) => (v === null ? null : v * 100);
  const percentRows = testRows.map(({ precision, recall, f1, area_under_roc_curve, average_precision, ...rest }) => ({
    ...rest,
    precision_percent: toPercent(precision), recall_percent: toPercent(recall), f1_percent: toPercent(f1),
    area_under_roc_curve_percent: toPercent(area_under_roc_curve), average_precision_percent: toPercent(average_precision),
  }));

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        <ControlBar onReset={reset}>
          <SelectControl label="Run" value={controls.run || run?.recipe || ""} onChange={(v) => set("run", v)}
            options={(body?.runs ?? []).map((r) => ({ value: r.recipe, label: `${r.architecture.toUpperCase()} · ${r.recipe.slice(-15)} · real F1 ${fmtPercent(r.test_real_macro_f1)}` }))} />
          <SelectControl label="Pattern" value={controls.className} onChange={(v) => set("className", v)}
            options={classNames.map((name) => ({ value: name, label: name }))} />
        </ControlBar>

        <div className="grid gap-2 grid-cols-2 xl:grid-cols-6">
          <Stat label="Model" value={run ? `${run.architecture.toUpperCase()} · ${fmtInt(run.parameters)} weights` : "—"} hint={run ? `best epoch ${run.best_epoch} of ${run.epochs}; ${fmt(run.duration_seconds / 60, 1)} min` : undefined} />
          <Stat label="Chart windows" value={run ? `${fmtInt(run.real_windows)} real` : "—"} hint={run ? `+ ${fmtInt(run.synthetic_windows)} synthetic, TA-Lib-confirmed` : undefined} />
          <Stat label="Real test · macro F1" value={fmtPercent(run?.test_real_macro_f1)} tone={OKABE.orange} hint={`averaged over the ${run?.classes_measurable_on_real_test ?? "—"} classes with at least 10 real test firings`} />
          <Stat label="Real test · macro AP" value={fmtPercent(run?.test_real_macro_average_precision)} hint="average precision: 100% = every firing ranked above every non-firing" />
          <Stat label="Synthetic test · macro F1" value={fmtPercent(run?.test_synthetic_macro_f1)} hint="the only test for the rarest patterns" />
          <Stat label={run?.tolerance_percent ? `Tolerance · exact F1` : "TA-Lib 0.8.1 vs lake 0.7.1"}
            value={run?.tolerance_percent ? `±${run.tolerance_percent}% · ${fmtPercent(run.test_real_exact_macro_f1)}` : run ? `${fmtInt(run.talib_disagreeing_bar_patterns)} differences` : "—"}
            hint={run?.tolerance_percent ? `every price nudged by up to ${run.tolerance_percent}% of the window's average bar range, ${run.tolerance_draws} versions per chart; ${fmtInt(run.near_miss_positives)} near-miss positives added. Exact F1 = the same model scored against TA-Lib's exact rule.` : "labels recomputed and compared on every bar"} />
        </div>

        <Section title="A. From candles to a picture" question="The last 20 bars are scaled to their own low..high and drawn 128 pixels tall, 6 pixels per candle, in three layers: the whole candle, rising bodies, falling bodies.">
          <div className="grid gap-3 xl:grid-cols-[auto_1fr]">
            <div className="flex flex-wrap gap-2">
              {exemplars.filter((e) => e.kind === "real hit").slice(0, 2).map((e, k) => (
                <figure key={k} className="text-[10px] text-neutral-400">
                  <img src={`data:image/png;base64,${e.model_input_png_base64}`} alt={`${e.class_name} chart the model reads`} className="rounded border border-neutral-800 bg-white" width={240} />
                  <figcaption>{e.bar_timestamp ? fmtTime(e.bar_timestamp) + " UTC" : "synthetic"} · model confidence {fmtPercent(e.score)}</figcaption>
                </figure>
              ))}
            </div>
            <div className="space-y-2 text-[12px] text-neutral-300">
              <Finding>
                Every TA-Lib pattern is decided by the last 15 bars at most (checked: a 20-bar window gives TA-Lib's answer on all 1.59 million bars),
                so the picture holds everything the label depends on. The model answers 88 yes/no questions at once — one per pattern and direction —
                because several fire together (a doji is often also a long-legged doji, a spinning top and a high wave).
              </Finding>
              <table className="text-[11px]">
                <tbody>
                  {(body?.splits ?? []).map((span) => (
                    <tr key={span.split} className="border-t border-neutral-800">
                      <td className="pr-3 capitalize text-neutral-100">{span.split}</td>
                      <td className="pr-3 font-mono">{fmtTime(span.first_bar).slice(0, 10)} → {fmtTime(span.last_bar).slice(0, 10)}</td>
                      <td className="pr-3 text-right font-mono">{fmtInt(span.trading_days)} days</td>
                      <td className="text-right font-mono">{fmtInt(span.bars)} bars</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        <Section title="B. Training" question="Loss per epoch on the training draws and on every validation chart; validation macro average precision picks the epoch kept.">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={body?.epochs ?? []} margin={{ top: 4, right: 40, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="epoch" {...AXIS} />
              <YAxis yAxisId="loss" {...AXIS} scale="log" domain={["auto", "auto"]} tickFormatter={(v: number) => v.toExponential(0)} />
              <YAxis yAxisId="ap" orientation="right" {...AXIS} domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
              <Tooltip {...TOOLTIP} formatter={(value, name) => (String(name).includes("AP") ? fmtPercent(Number(value), 2) : fmt(Number(value), 5))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="loss" dataKey="train_loss" name="train loss" stroke={OKABE.orange} dot isAnimationActive={false} />
              <Line yAxisId="loss" dataKey="validation_loss" name="validation loss" stroke={OKABE.blue} strokeDasharray="5 3" dot isAnimationActive={false} />
              <Line yAxisId="ap" dataKey="validation_macro_average_precision" name="validation macro AP (%)" stroke={OKABE.green} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Section>

        <Section title="C. Every pattern, scored on the test charts" question="The test split is the last 10 % of trading days, read once. Thresholds were chosen on validation.">
          <ControlBar>
            {hasTolerant && (
              <SegmentControl label="Counts as the pattern" value={controls.labels} onChange={(v) => set("labels", v)}
                options={[{ value: "tolerant", label: "Within tolerance" }, { value: "exact", label: "Exact TA-Lib" }]}
                hint="Within tolerance: TA-Lib fires on the bars as they are, or on most versions with every price nudged a little" />
            )}
            <SegmentControl label="Test charts" value={controls.source} onChange={(v) => set("source", v)}
              options={[{ value: "real", label: "Real bars" }, { value: "synthetic", label: "Synthetic" }, { value: "all", label: "Both" }]} />
            <SegmentControl label="Score" value={controls.metric} onChange={(v) => set("metric", v)}
              options={[{ value: "f1", label: "F1" }, { value: "precision", label: "Precision" }, { value: "recall", label: "Recall" }, { value: "average_precision", label: "AP" }]} />
            <SliderControl label="Minimum real test firings" value={controls.minimumFirings} min={1} max={500} onChange={(v) => set("minimumFirings", v)} hint="A score on a handful of firings is noise" />
          </ControlBar>
          <Finding>{shown.length} classes shown · click a bar to open that pattern below.</Finding>
          <ResponsiveContainer width="100%" height={Math.max(240, shown.length * 15)}>
            <BarChart data={shown} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}
              onClick={(state) => { const name = (state?.activePayload?.[0]?.payload as { class_name?: string } | undefined)?.class_name; if (name) set("className", name); }}>
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis type="number" domain={[0, 1]} {...AXIS} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
              <YAxis type="category" dataKey="class_name" width={170} {...AXIS} interval={0} />
              <Tooltip {...TOOLTIP} formatter={(value, _n, item) => {
                const row = item.payload as ClassMetric;
                return [`${fmtPercent(Number(value))} · ${fmtInt(row.positives)} firings · TP ${fmtInt(row.true_positives)} FP ${fmtInt(row.false_positives)} FN ${fmtInt(row.false_negatives)}`, controls.metric];
              }} />
              <Bar dataKey="value" fill={OKABE.sky} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <Section title={`D. ${controls.className}`} question="Its score, the charts it got right and wrong, and what it is confused with.">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,420px)_1fr]">
            <FormulaCard
              tex={String.raw`F_1=\frac{2\,TP}{2\,TP+FP+FN}`}
              symbols={[
                { tex: "TP", name: "real test bars where TA-Lib fired it and the model called it", value: fmtInt(selected?.true_positives) },
                { tex: "FP", name: "bars the model called it and TA-Lib did not fire", value: fmtInt(selected?.false_positives) },
                { tex: "FN", name: "bars TA-Lib fired it and the model missed", value: fmtInt(selected?.false_negatives) },
                { tex: "F_1", name: "harmonic mean of precision and recall (100% = perfect)", value: fmtPercent(selected?.f1) },
                { tex: String.raw`\tau`, name: "confidence threshold chosen on validation", value: fmtPercent(selected?.threshold, 0) },
                { tex: String.raw`F_1^{\text{syn}}`, name: "the same on synthetic test charts", value: `${fmtPercent(selectedSynthetic?.f1)} on ${fmtInt(selectedSynthetic?.positives)}` },
              ]}
              caption={`Real test firings: ${fmtInt(selected?.positives)} of ${fmtInt(selected?.windows)} bars · precision ${fmtPercent(selected?.precision)} · recall ${fmtPercent(selected?.recall)} · AUROC ${fmtPercent(selected?.area_under_roc_curve, 2)} · AP ${fmtPercent(selected?.average_precision, 2)}`}
            />
            <div>
              <p className="mb-1 text-[11px] text-neutral-400">On real test bars where TA-Lib fired {pattern}: share the model called each pattern (orange) beside the share TA-Lib itself fired it too (blue) — a gap is confusion, equal bars are genuine co-firing.</p>
              <ResponsiveContainer width="100%" height={Math.max(160, confusionRow.length * 18)}>
                <BarChart data={confusionRow} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                  <CartesianGrid {...GRID} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} {...AXIS} unit="%" />
                  <YAxis type="category" dataKey="called_pattern" width={120} {...AXIS} interval={0} />
                  <Tooltip {...TOOLTIP} formatter={(value) => `${fmt(Number(value), 1)}%`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="model_share_percent" name="model called" fill={OKABE.orange} isAnimationActive={false} />
                  <Bar dataKey="talib_share_percent" name="TA-Lib fired" fill={OKABE.blue} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {KIND_ORDER.map((kind) => {
            const items = exemplars.filter((e) => e.kind === kind);
            if (items.length === 0) return null;
            return (
              <div key={kind} className="mt-3">
                <p className="mb-1 text-[11px] text-neutral-300"><span className="text-neutral-100">{kind}</span> — {KIND_NOTE[kind]}</p>
                <div className="flex flex-wrap gap-3">
                  {items.map((e, k) => (
                    <figure key={k} className="w-[250px] text-[10px] text-neutral-400">
                      <img src={`data:image/png;base64,${e.model_input_png_base64}`} alt={`${kind}: ${e.class_name}`} className="rounded border border-neutral-800 bg-white" width={240} />
                      <figcaption className="space-y-0.5">
                        <div className="font-mono text-neutral-200">{e.bar_timestamp ? `${fmtTime(e.bar_timestamp)} UTC` : "synthetic"} · confidence {fmtPercent(e.score)} (τ {fmtPercent(e.threshold, 0)})</div>
                        <div>TA-Lib: {e.talib_classes || "nothing"}</div>
                        {e.tolerant_classes && e.tolerant_classes !== e.talib_classes && <div>Within tolerance: {e.tolerant_classes}</div>}
                        <div>Model: {e.model_classes || "nothing"}</div>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            );
          })}
        </Section>

        <Section title="E. Pattern against pattern" question="Real test bars: row = the pattern TA-Lib fired, column = the pattern the model called, colour = percent of the row's bars. The diagonal is recall; hover a cell for its value.">
          <ConfusionMatrix cells={body?.confusion ?? []} rows={truePatterns} columns={calledPatterns} selected={pattern} onSelect={(p) => {
            const match = classNames.find((name) => name.startsWith(`${p}:`));
            if (match) set("className", match);
          }} />
        </Section>

        <Section title="F. Charts per pattern" question="Real windows and the synthetic top-up per class; the train floor is the runner's train_minimum.">
          <ResponsiveContainer width="100%" height={Math.max(240, sampleRows.length * 14)}>
            <BarChart data={sampleRows} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis type="number" scale="log" domain={[1, "auto"]} allowDataOverflow {...AXIS} />
              <YAxis type="category" dataKey="class_name" width={170} {...AXIS} interval={0} />
              <Tooltip {...TOOLTIP} formatter={(value) => fmtInt(Number(value))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="train_real" name="train · real" fill={OKABE.blue} isAnimationActive={false} />
              <Bar dataKey="train_synthetic" name="train · synthetic" fill={OKABE.orange} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <ColumnGrid rows={percentRows} exclude={["threshold"]} title="G. Every column of the per-class test scores (scores in percent)" />
      </StudyState>
    </div>
  );
}
