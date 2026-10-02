/**
 * Recognising TA-Lib's 13 single-candle patterns. The study table (104 rows)
 * comes to the browser whole and every control re-derives the pictures from
 * it; the calculator runs TA-Lib's arithmetic in the browser
 * (packages/shared/src/studies/single-candle-recognizer.ts, checked against the C
 * library), and a real MNQ firing is one more request.
 */

import {
  ControlBar, Finding, OKABE, Section, SelectControl, Stat, StudyNotes, StudyState, SwitchControl, fmt, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  METRICS, bestPerPattern, contextWinners, leaderboard, selectModels, sortPatternBest, summariseContext,
  FEATURE_SET_LABEL, type MetricKey, type RecognizerBody, type SettingName,
} from "@shared/studies/single-candle-recognizer";
import { CalculatorControls, CalculatorReadout, CandleFigure, FiredTable } from "./Calculator";
import { GapChart, ModelDotPlot } from "./Charts";
import { ColumnPanels, EightNumberTable, StudyTable } from "./Columns";
import { CONTROL_DEFAULTS, candleView } from "./controls";
import { RuleFormula, RulesTable, SettingsTable } from "./Rule";

const SLUG = "single-candle-recognizer";

function signed(value: number | null, decimals = 4): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : "−"}${fmt(Math.abs(value), decimals)}`;
}

export default function Page() {
  const [controls, set, reset] = useStudyControls(CONTROL_DEFAULTS);
  const study = useStudyQuery<RecognizerBody>(SLUG);
  const real = useStudyQuery<RecognizerBody>(
    SLUG,
    { candlePattern: controls.candlePattern, candleTimeframe: controls.candleTimeframe, candleIndex: controls.candleIndex },
    { enabled: controls.source === "real" },
  );

  const rows = study.data?.data.rows ?? [];
  const realCandle = real.data?.data.real ?? null;
  const notes = [...(study.data?.notes ?? []), ...(controls.source === "real" ? (real.data?.notes ?? []) : [])];

  const metric: MetricKey = METRICS.some((option) => option.value === controls.metric) ? (controls.metric as MetricKey) : "balanced_accuracy";
  const metricLabel = METRICS.find((option) => option.value === metric)?.label ?? metric;
  const allModels = [...new Set(rows.map((row) => row.model_name))].sort();
  const chosenModels = controls.models ? controls.models.split(",").filter((model) => allModels.includes(model)) : [];
  const activeModels = chosenModels.length > 0 ? chosenModels : allModels;
  const selected = selectModels(rows, activeModels);

  const best = bestPerPattern(selected, metric);
  const ordered = sortPatternBest(best, controls.sortByGap);
  const summary = summariseContext(best);
  const board = leaderboard(selected, metric);
  const { winner, runnerUp } = contextWinners(board);
  const patterns = [...new Set(rows.map((row) => row.pattern_name))].sort();

  const view = candleView(controls, realCandle);
  const lastReal = view.realShown && realCandle ? (realCandle.bars[realCandle.bars.length - 1]?.stored ?? null) : null;

  const toggleModel = (model: string) => {
    const next = activeModels.includes(model) ? activeModels.filter((name) => name !== model) : [...activeModels, model];
    set("models", next.length === 0 || next.length === allModels.length ? "" : next.sort().join(","));
  };

  return (
    <div className="space-y-3">
      <StudyState isLoading={study.isLoading} error={study.error}>
        <StudyNotes notes={notes} />

        <p className="max-w-prose text-[12px] leading-relaxed text-neutral-300">
          Their shape spans one candle. Their decision does not. Every one of the 13 compares the bar against <span className="font-mono">TA_CANDLEAVERAGE(setting)</span>,
          and TA-Lib's default settings put a 10-bar trailing average behind every body test and every short-shadow test:
          <span className="font-mono"> talib.abstract.Function(name).lookback</span> is 10 for all thirteen, <span className="font-mono">CDLDOJI</span> included,
          whose entire rule is "the body is small". Small compared to the last ten bars. The same four prices are a doji in a quiet ten minutes and not in a violent ten minutes.
        </p>

        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Stat label="Study rows" value={fmtInt(rows.length)} hint="13 patterns x 4 model families x 2 feature sets, one fit each" />
          <Stat label={`${metricLabel}: the candle alone`} value={fmt(summary.aloneMean, 4)} tone={OKABE.blue} hint="Best of the selected models per pattern, averaged over the 13" />
          <Stat label={`${metricLabel}: with 10-bar context`} value={fmt(summary.contextMean, 4)} tone={OKABE.orange} />
          <Stat label="What the context is worth" value={signed(summary.gapMean)} hint="Mean over the 13 patterns of (with context) - (candle alone)" />
        </div>

        <Section title="What one candle can tell you, and what ten bars of context add" question="Each model family is fitted twice on the same bars: on the candle's geometry alone, and with the trailing averages TA-Lib itself reads.">
          <ControlBar onReset={reset}>
            <SelectControl label="Metric" value={metric} options={METRICS.map((option) => ({ value: option.value, label: option.label }))} onChange={(value) => set("metric", value)} />
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">Models</span>
              <div className="flex flex-wrap gap-1">
                {allModels.map((model) => {
                  const on = activeModels.includes(model);
                  return (
                    <button
                      key={model}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleModel(model)}
                      className={`rounded border px-2 py-0.5 text-[11px] font-mono ${on ? "border-neutral-500 bg-neutral-700 text-neutral-50" : "border-neutral-800 text-neutral-500 hover:bg-neutral-800"}`}
                    >
                      {on ? "✓ " : ""}{model}
                    </button>
                  );
                })}
              </div>
            </div>
            <SwitchControl label="Sort patterns by how much the context is worth" checked={controls.sortByGap} onChange={(value) => set("sortByGap", value)} />
          </ControlBar>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <GapChart data={ordered} metricLabel={metricLabel} />
            <div className="min-w-0 space-y-2">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-neutral-500"><th className="py-0.5 font-normal" /><th className="py-0.5 text-right font-normal">{metricLabel}</th></tr>
                </thead>
                <tbody className="font-mono tnum">
                  <tr className="border-t border-neutral-900"><td className="py-0.5 font-sans text-neutral-400">Best from the candle alone, averaged over the 13</td><td className="py-0.5 text-right text-neutral-100">{fmt(summary.aloneMean, 4)}</td></tr>
                  <tr className="border-t border-neutral-900"><td className="py-0.5 font-sans text-neutral-400">Best with the 10-bar trailing averages</td><td className="py-0.5 text-right text-neutral-100">{fmt(summary.contextMean, 4)}</td></tr>
                  <tr className="border-t border-neutral-900"><td className="py-0.5 font-sans text-neutral-400">What the context is worth</td><td className="py-0.5 text-right text-neutral-100">{signed(summary.gapMean)}</td></tr>
                  <tr className="border-t border-neutral-900"><td className="py-0.5 font-sans text-neutral-400">Hardest pattern from the candle alone</td><td className="py-0.5 text-right text-neutral-100">{summary.hardest ? `${summary.hardest.pattern} at ${fmt(summary.hardest.alone, 4)}` : "—"}</td></tr>
                </tbody>
              </table>
              <Finding>
                Takeaway: feed the model the same trailing averages TA-Lib reads, or it is guessing at the threshold. The geometry of one candle is fully described by three numbers
                (signed body fraction, upper shadow fraction, lower shadow fraction) and the models get all three; what they cannot get is how big the last ten bars were, which is the other half of every one of the 13 rules.
              </Finding>
            </div>
          </div>
        </Section>

        <Section title="The rule, written out" question="Every one of the 13 is a comparison against this, and it is the whole reason context matters.">
          <RuleFormula view={view} setting={controls.setting} onSetting={(value: SettingName) => set("setting", value)} />
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <div className="min-w-0 overflow-x-auto"><SettingsTable view={view} /></div>
            <div className="min-w-0 overflow-x-auto"><RulesTable view={view} /></div>
          </div>
        </Section>

        <Section
          title="Move the candle, then move the ten bars behind it"
          question="The shape sliders draw the candle; the context slider changes nothing about the candle, only how big the previous ten bars were. The arithmetic is TA-Lib's own (TA_CANDLEAVERAGE at the default settings), run on the ten bars explicitly."
        >
          <CalculatorControls controls={controls} set={set} real={{ data: realCandle, isLoading: real.isLoading, error: real.error }} />
          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="min-w-0 space-y-2">
              <CandleFigure bars={view.bars} unit={view.unit} evaluation={view.evaluation} real={view.realShown ? realCandle : null} />
              <p className="text-[11px] text-neutral-400">
                <span style={{ color: OKABE.orange }}>■ up candle</span> · <span style={{ color: OKABE.blue }}>■ down candle</span> · dashed grey: the thresholds the ten bars set, measured from this candle's low · hover a bar for its numbers
              </p>
            </div>
            <div className="min-w-0 space-y-3">
              <CalculatorReadout view={view} real={realCandle} />
              <FiredTable view={view} stored={lastReal} />
            </div>
          </div>
          {view.shortcut && (
            <Finding>
              The notebook drew this with a shortcut: the previous bodies are range x |signed body| and the short-shadow yardstick is half the trailing range, as if the previous bars had no body.
              TA-Lib averages the real bodies and shadows of the ten bars, so the two columns agree at the default sliders and part ways where the half-range shortcut matters (a ≠ marks each one).
            </Finding>
          )}
        </Section>

        <Section title="Every model, every pattern, every metric" question="Each dot is one fit; shape marks the feature set.">
          <ControlBar>
            <SwitchControl label="Zoom the axis to the data" checked={controls.zoomDots} onChange={(value) => set("zoomDots", value)} />
          </ControlBar>
          <ModelDotPlot rows={selected} models={allModels} patterns={patterns} metric={metric} metricLabel={metricLabel} zoom={controls.zoomDots} />
          <div className="mt-3 max-w-2xl">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="py-0.5 font-normal">model</th><th className="py-0.5 font-normal">features</th>
                  <th className="py-0.5 text-right font-normal">mean {metricLabel}</th><th className="py-0.5 text-right font-normal">seconds per pattern</th>
                </tr>
              </thead>
              <tbody>
                {board.map((row) => (
                  <tr key={`${row.model}|${row.featureSet}`} className="border-t border-neutral-900">
                    <td className="py-0.5 font-mono text-neutral-200">{winner && row.model === winner.model && row.featureSet === winner.featureSet ? "★ " : ""}{row.model}</td>
                    <td className="py-0.5 text-neutral-300">{FEATURE_SET_LABEL[row.featureSet as keyof typeof FEATURE_SET_LABEL] ?? row.featureSet}</td>
                    <td className="py-0.5 text-right font-mono tnum text-neutral-100">{fmt(row.meanMetric, 4)}</td>
                    <td className="py-0.5 text-right font-mono tnum">{fmt(row.meanSeconds, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {winner && (
            <Finding>
              Takeaway: fit <span className="font-mono">{winner.model}</span> on the shape plus the trailing averages, one binary head per pattern. It leads the context feature set at {fmt(winner.meanMetric, 4)}
              {runnerUp ? <> against {fmt(runnerUp.meanMetric, 4)} for <span className="font-mono">{runnerUp.model}</span></> : null}, and the rules it has to recover are axis-aligned threshold comparisons,
              which is exactly what a tree split is. A network can reach the same place, but it pays more parameters for a boundary that is already a box.
            </Finding>
          )}
        </Section>

        <Section title="Every column in the study, one panel each" question="The study table is one row per (model, feature set, pattern).">
          <ColumnPanels rows={rows} bins={controls.binCount} onBins={(value) => set("binCount", value)} />
        </Section>

        <Section title="The eight numbers for every numeric column" question="Standard deviation with n − 1; skewness and excess kurtosis from the z-scores; n below 4 or a constant column gives no shape number.">
          <EightNumberTable rows={rows} />
        </Section>

        <Section title="The study table" question="Sorted by feature set, model and pattern; click a heading to sort.">
          <StudyTable rows={rows} />
        </Section>
      </StudyState>
    </div>
  );
}
