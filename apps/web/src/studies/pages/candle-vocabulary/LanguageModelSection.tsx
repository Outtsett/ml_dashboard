/**
 * Section C: predicting the next symbol, and why it fails once symbols stop
 * overlapping. The stride column is the whole story: at stride 1 consecutive
 * symbols share width-1 of their bars, so a bigram reads the structure off for free.
 */

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SliderControl, Stat, TOOLTIP,
  fmt, fmtInt, useStudyControls,
} from "@/studies/kit";
import {
  LANGUAGE_MODEL_LABELS, sharedBarFraction, type LanguageModelDirectionRow, type LanguageModelRow,
} from "@shared/studies/candle-vocabulary";
import { SortableTable, type TableColumn } from "./SortableTable";

type Metric = "nats" | "nll" | "accuracy";

const METRICS: Array<{ value: Metric; label: string; hint: string }> = [
  { value: "nats", label: "nats better than unigram", hint: "unigram NLL minus the model's NLL, same run: above zero beats guessing the commonest symbol" },
  { value: "nll", label: "negative log-likelihood", hint: "held-out nats per next symbol; lower is better" },
  { value: "accuracy", label: "next-symbol accuracy", hint: "share of held-out positions where the most likely symbol was right" },
];

function metricOf(row: LanguageModelRow, metric: Metric): number | null {
  if (metric === "nats") return row.nats_better_than_unigram;
  if (metric === "nll") return row.negative_log_likelihood_next_symbol_nats;
  return row.accuracy_next_symbol;
}

function signed(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(decimals)}`;
}

function Hatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <rect width="6" height="6" fill={OKABE.blue} fillOpacity={0.22} />
        <line x1="0" y1="0" x2="0" y2="6" stroke={OKABE.blue} strokeWidth="3" />
      </pattern>
    </defs>
  );
}

export function LanguageModelSection({ rows, direction }: { rows: readonly LanguageModelRow[]; direction: readonly LanguageModelDirectionRow[] }) {
  const [controls, set, reset] = useStudyControls({ metric: "nats", stride: "both", strideSlider: 1 });
  const strides = [...new Set(rows.map((row) => row.symbol_stride_bars))].sort((a, b) => a - b);
  const overlapping = strides[0] ?? 1;
  const disjoint = strides[strides.length - 1] ?? 1;
  const models = [...new Set(rows.map((row) => row.model))];
  const metric = controls.metric as Metric;
  const showOverlapping = controls.stride !== "disjoint";
  const showDisjoint = controls.stride !== "overlapping";

  const chartData = models.map((model) => {
    const at = (stride: number | undefined) => rows.find((row) => row.model === model && row.symbol_stride_bars === stride);
    return {
      name: LANGUAGE_MODEL_LABELS[model] ?? model,
      overlapping: at(overlapping) ? metricOf(at(overlapping) as LanguageModelRow, metric) : null,
      disjoint: at(disjoint) ? metricOf(at(disjoint) as LanguageModelRow, metric) : null,
    };
  });

  const width = rows[0]?.width_bars ?? 16;
  const codeCount = rows[0]?.code_count ?? 64;
  const stride = Math.min(Math.max(controls.strideSlider, 1), width);
  const bigramOverlapping = rows.find((row) => row.model === "bigram" && row.symbol_stride_bars === overlapping);
  const bigramDisjoint = rows.find((row) => row.model === "bigram" && row.symbol_stride_bars === disjoint);
  const unigramOverlapping = rows.find((row) => row.model === "unigram" && row.symbol_stride_bars === overlapping);
  const trigramOverlapping = rows.find((row) => row.model === "trigram" && row.symbol_stride_bars === overlapping);
  const transformerNats = rows
    .filter((row) => row.symbol_stride_bars === overlapping && row.model.includes("transformer") && row.nats_better_than_unigram !== null)
    .map((row) => row.nats_better_than_unigram as number);
  const bestTransformerNats = transformerNats.length > 0 ? Math.max(...transformerNats) : null;

  const tableColumns: Array<TableColumn<LanguageModelRow>> = [
    { key: "stride", label: "symbol stride", align: "right", render: (row) => `${row.symbol_stride_bars} bar${row.symbol_stride_bars === 1 ? "" : "s"}`, value: (row) => row.symbol_stride_bars, hint: "bars between the starts of consecutive symbols; the width when the run has none" },
    { key: "model", label: "model", render: (row) => LANGUAGE_MODEL_LABELS[row.model] ?? row.model, value: (row) => row.model },
    { key: "accuracy", label: "accuracy, next", align: "right", render: (row) => fmt(row.accuracy_next_symbol, 4), value: (row) => row.accuracy_next_symbol },
    { key: "nll", label: "NLL, next (nats)", align: "right", render: (row) => fmt(row.negative_log_likelihood_next_symbol_nats, 4), value: (row) => row.negative_log_likelihood_next_symbol_nats },
    { key: "nats", label: "nats vs unigram", align: "right", render: (row) => signed(row.nats_better_than_unigram), value: (row) => row.nats_better_than_unigram },
    { key: "accuracyTwo", label: "accuracy, two ahead", align: "right", render: (row) => fmt(row.accuracy_two_symbols_ahead, 4), value: (row) => row.accuracy_two_symbols_ahead },
    { key: "nllTwo", label: "NLL, two ahead", align: "right", render: (row) => fmt(row.negative_log_likelihood_two_symbols_ahead_nats, 4), value: (row) => row.negative_log_likelihood_two_symbols_ahead_nats, hint: "blank where the model has no two-ahead prediction (the unigram and trigram)" },
    { key: "test", label: "test sequences", align: "right", render: (row) => fmtInt(row.test_sequence_count), value: (row) => row.test_sequence_count },
  ];
  const directionColumns: Array<TableColumn<LanguageModelDirectionRow>> = [
    { key: "stride", label: "symbol stride", align: "right", render: (row) => `${row.symbol_stride_bars} bar${row.symbol_stride_bars === 1 ? "" : "s"}`, value: (row) => row.symbol_stride_bars },
    { key: "model", label: "model", render: (row) => LANGUAGE_MODEL_LABELS[row.model] ?? row.model, value: (row) => row.model },
    { key: "accuracy", label: "direction accuracy", align: "right", render: (row) => fmt(row.direction_accuracy, 4), value: (row) => row.direction_accuracy },
    { key: "majority", label: "majority class", align: "right", render: (row) => fmt(row.majority_direction_accuracy, 4), value: (row) => row.majority_direction_accuracy },
    { key: "minus", label: "minus majority", align: "right", render: (row) => signed(row.accuracy_minus_majority), value: (row) => row.accuracy_minus_majority },
    { key: "n", label: "test positions", align: "right", render: (row) => fmtInt(row.test_count), value: (row) => row.test_count },
  ];
  const directionChart = direction.map((row) => ({
    name: `${LANGUAGE_MODEL_LABELS[row.model] ?? row.model} · stride ${row.symbol_stride_bars}`,
    accuracy: row.direction_accuracy,
    majority: row.majority_direction_accuracy,
    overlapping: row.symbol_stride_bars === overlapping,
  }));

  if (rows.length === 0) {
    return (
      <Section title="C. Next-symbol prediction, and why it fails">
        <p className="py-6 text-center text-xs text-neutral-500">No language-model result file was landed.</p>
      </Section>
    );
  }

  return (
    <Section title="C. Next-symbol prediction, and why it fails" question="A masked transformer asked for the next symbol from the previous 64, against unigram, bigram and trigram baselines.">
      <div className="space-y-3">
        <ControlBar onReset={reset}>
          <SegmentControl
            label="Measure"
            value={controls.metric}
            options={METRICS.map((entry) => ({ value: entry.value, label: entry.label }))}
            onChange={(v) => set("metric", v)}
            hint={METRICS.find((entry) => entry.value === metric)?.hint}
          />
          <SegmentControl
            label="Symbol stride"
            value={controls.stride}
            options={[{ value: "both", label: "both" }, { value: "overlapping", label: `△ ${overlapping} bar (overlapping)` }, { value: "disjoint", label: `▲ ${disjoint} bars (disjoint)` }]}
            onChange={(v) => set("stride", v)}
            hint="Bars between the starts of consecutive symbols"
          />
        </ControlBar>

        <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
          <Stat label={`Bigram, stride ${overlapping}`} value={signed(bigramOverlapping?.nats_better_than_unigram, 3)} tone={OKABE.orange} hint="nats per symbol better than the unigram" />
          <Stat label={`Bigram, stride ${disjoint}`} value={signed(bigramDisjoint?.nats_better_than_unigram, 3)} tone={OKABE.blue} hint="below zero is worse than guessing the commonest symbol" />
          <Stat label="Symbols K" value={fmtInt(codeCount)} hint={`${width} bars per symbol`} />
          <Stat label={`Unigram NLL, stride ${overlapping}`} value={fmt(unigramOverlapping?.negative_log_likelihood_next_symbol_nats, 3)} hint={`ln K = ${Math.log(codeCount).toFixed(3)} is the floor for a uniform guess`} />
        </div>

        <div className="min-w-0">
          <p className="mb-1 text-[11px] text-neutral-400">{METRICS.find((entry) => entry.value === metric)?.label} by model</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 16, right: 8, left: 0, bottom: 4 }}>
              <Hatch id="lm-overlap" />
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="name" {...AXIS} interval={0} fontSize={9} />
              <YAxis {...AXIS} domain={["auto", "auto"]} />
              <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 4), String(name)]} />
              <ReferenceLine y={0} stroke={OKABE.grey} />
              {showOverlapping && (
                <Bar dataKey="overlapping" name={`△ stride ${overlapping} (overlapping)`} fill="url(#lm-overlap)" stroke={OKABE.blue} isAnimationActive={false}>
                  <LabelList dataKey="overlapping" position="top" fontSize={9} fill={OKABE.blue} formatter={(v: unknown) => (typeof v === "number" ? v.toFixed(3) : "")} />
                </Bar>
              )}
              {showDisjoint && (
                <Bar dataKey="disjoint" name={`▲ stride ${disjoint} (disjoint)`} fill={OKABE.orange} isAnimationActive={false}>
                  <LabelList dataKey="disjoint" position="top" fontSize={9} fill={OKABE.orange} formatter={(v: unknown) => (typeof v === "number" ? v.toFixed(3) : "")} />
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-neutral-400">
            <span style={{ color: OKABE.blue }}>△ hatched: overlapping symbols</span> · <span style={{ color: OKABE.orange }}>▲ solid: disjoint symbols</span>
          </p>
        </div>

        <Finding>
          The masked encoder was asked to predict the next symbol from the previous 64. At stride {overlapping} consecutive symbols share {width - overlapping} of their {width} bars, so &quot;predict the next symbol&quot; is mostly
          restating the current one and a bigram reads {signed(bigramOverlapping?.nats_better_than_unigram, 2)} nats off for free; the best transformer reaches {signed(bestTransformerNats, 2)} (
          {bestTransformerNats !== null && bigramOverlapping?.nats_better_than_unigram != null && bestTransformerNats < bigramOverlapping.nats_better_than_unigram ? "behind the bigram" : "level with the bigram"}) and the trigram {signed(trigramOverlapping?.nats_better_than_unigram, 2)}, so a network adds nothing a count table does not. At stride {disjoint} the
          symbols describe disjoint bars and the structure evaporates: every model is {bigramDisjoint && (bigramDisjoint.nats_better_than_unigram ?? 0) < 0 ? "worse than" : "no better than"} guessing the commonest symbol. The
          test set also shrinks from {fmtInt(rows.find((row) => row.symbol_stride_bars === overlapping)?.test_sequence_count)} to {fmtInt(rows.find((row) => row.symbol_stride_bars === disjoint)?.test_sequence_count)} sequences, so the disjoint numbers are noisy as well as null.
        </Finding>
        <p className="max-w-prose rounded-md border border-[#E69F00]/40 bg-[#E69F00]/5 px-3 py-2 text-[12px] leading-relaxed text-neutral-300">
          <span style={{ color: OKABE.orange }}>▲ Beyond this study.</span> selforg/patterns.py::append_pattern_features builds its code stream one window per bar and fits fit_code_transitions on adjacent bars, so the production
          seq_surprise feature is computed on the overlapping construction: the structure it reads is the window overlap, not market sequence.
        </p>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <ControlBar>
              <SliderControl label="Symbol stride s (bars)" value={stride} min={1} max={width} onChange={(v) => set("strideSlider", v)} hint="Drag from 1 (a symbol per bar) to the window width (disjoint symbols)" />
            </ControlBar>
            <FormulaCard
              tex={"\\text{shared}(s) \\;=\\; \\frac{\\max(W-s,\\,0)}{W}"}
              caption={`At s = ${stride}, consecutive symbols share ${Math.max(width - stride, 0)} of their ${width} bars${stride === 1 ? ": the stride of the overlapping run, where a bigram looks skilled" : stride === width ? ": the stride of the disjoint run, where nothing carries over" : ""}.`}
              symbols={[
                { tex: "W", name: "window width: bars per symbol", value: String(width) },
                { tex: "s", name: "symbol stride: bars between the starts of consecutive symbols", value: String(stride) },
                { tex: "W-s", name: "bars the next symbol re-describes", value: String(Math.max(width - stride, 0)) },
                { tex: "\\text{shared}(s)", name: "fraction of a symbol already seen in the one before it", value: `${(sharedBarFraction(width, stride) * 100).toFixed(1)}%` },
              ]}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <FormulaCard
              tex={"\\Delta_{\\text{nats}} \\;=\\; \\text{NLL}_{\\text{unigram}} \\;-\\; \\text{NLL}_{\\text{model}}, \\qquad \\text{NLL}=-\\frac1N\\sum_{t=1}^{N}\\ln p_\\theta(x_t\\mid \\text{context})"}
              caption={`Bigram at stride ${overlapping}: ${fmt(unigramOverlapping?.negative_log_likelihood_next_symbol_nats, 4)} − ${fmt(bigramOverlapping?.negative_log_likelihood_next_symbol_nats, 4)} = ${signed(bigramOverlapping?.nats_better_than_unigram)} nats per symbol. Positive beats guessing the commonest symbol.`}
              symbols={[
                { tex: "N", name: "held-out positions scored", value: fmtInt(bigramOverlapping?.test_sequence_count) },
                { tex: "x_t", name: "the symbol that actually came next at position t", value: "a code 0 to K−1" },
                { tex: "p_\\theta(x_t\\mid\\text{context})", name: "the model's probability of it given the symbols before", value: "per model" },
                { tex: "\\text{NLL}_{\\text{unigram}}", name: "the unigram's NLL: the price of ignoring context", value: fmt(unigramOverlapping?.negative_log_likelihood_next_symbol_nats, 4) },
                { tex: "\\text{NLL}_{\\text{model}}", name: "the bigram's NLL at stride " + overlapping, value: fmt(bigramOverlapping?.negative_log_likelihood_next_symbol_nats, 4) },
                { tex: "\\Delta_{\\text{nats}}", name: "nats per symbol the model beats the unigram by", value: signed(bigramOverlapping?.nats_better_than_unigram) },
              ]}
            />
          </div>
        </div>

        <SortableTable rows={rows} columns={tableColumns} rowKey={(row) => `${row.run_name}|${row.model}`} />

        {direction.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-neutral-200">Does the predicted next symbol call the next move?</h4>
            <div className="grid gap-3 xl:grid-cols-2">
              <div className="min-w-0">
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={directionChart} margin={{ top: 16, right: 8, left: 0, bottom: 4 }}>
                    <Hatch id="dir-overlap" />
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="name" {...AXIS} interval={0} fontSize={8} />
                    <YAxis {...AXIS} domain={[0.4, 0.6]} />
                    <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 4), String(name)]} />
                    <ReferenceLine y={0.5} stroke={OKABE.grey} strokeDasharray="4 3" label={{ value: "coin flip", fill: OKABE.grey, fontSize: 10, position: "insideTopLeft" }} />
                    <Bar dataKey="accuracy" name="direction accuracy" isAnimationActive={false}>
                      {directionChart.map((entry) => (
                        <Cell key={entry.name} fill={entry.overlapping ? "url(#dir-overlap)" : OKABE.orange} stroke={entry.overlapping ? OKABE.blue : OKABE.orange} />
                      ))}
                      <LabelList dataKey="accuracy" position="top" fontSize={9} fill="#d4d4d4" formatter={(v: unknown) => (typeof v === "number" ? v.toFixed(3) : "")} />
                    </Bar>
                    <Bar dataKey="majority" name="majority class" fill={OKABE.purple} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-[11px] text-neutral-400">Bars in the model colour; the purple bar beside each is the majority-class rate on the same test positions: the number to beat.</p>
              </div>
              <SortableTable rows={direction} columns={directionColumns} rowKey={(row) => `${row.run_name}|${row.model}`} />
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
