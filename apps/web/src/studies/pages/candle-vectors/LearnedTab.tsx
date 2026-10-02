/**
 * Section 9: the shape learned without labels. Autoencoders, vector-quantised
 * encoders and a masked-candle model never see a TA-Lib name; the names come
 * back only afterwards to check whether hammer-shaped and engulfing-shaped
 * windows ended up together on their own.
 */

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, Stat, StudyNotes, StudyState, TOOLTIP,
  fmt, fmtInt, fmtPercent, useStudyQuery,
} from "@/studies/kit";
import {
  EMBEDDING_METHODS, MASKED_PRESETS, MASKED_PRESET_FIRINGS, PATTERNS, SHAPE_MODELS, VOCABULARIES, middleSpan,
  type LearnedBody, type LearnedMapBody, type ReconstructionBody, type Row,
} from "@shared/studies/candle-vectors";
import { CandleChart, CandleKey, DataTable, IntervalPlot, Legend, PATTERN_STYLE, ScatterCanvas, type CandleMark, type IntervalItem, type SeriesStyle } from "./charts";
import type { TabProps } from "./controls";

const WHITE = "#e5e5e5";
const METHODS: Array<{ name: string } & SeriesStyle> = [
  { name: "last-three-candle autoencoder (8)", color: OKABE.vermillion, glyph: "diamond", label: "last-three-candle autoencoder (8)" },
  { name: "last-three-candle vector-quantised encoder (8)", color: OKABE.orange, glyph: "square", label: "last-three-candle vector-quantised encoder (8)" },
  { name: "the 15 last-three-candle part numbers", color: OKABE.sky, glyph: "circle", label: "the 15 last-three-candle part numbers" },
  { name: "PCA of the last three candles to 8 numbers", color: OKABE.grey, glyph: "cross", label: "PCA of the last three candles to 8 numbers" },
  { name: "random untrained last-three-candle encoder (8)", color: WHITE, glyph: "triangle-down", label: "random untrained last-three-candle encoder (8)" },
  { name: "autoencoder (16)", color: OKABE.vermillion, glyph: "diamond", label: "autoencoder (16)", hollow: true },
  { name: "vector-quantised encoder (16)", color: OKABE.orange, glyph: "square", label: "vector-quantised encoder (16)", hollow: true },
  { name: "masked-candle model (16)", color: OKABE.purple, glyph: "triangle-up", label: "masked-candle model (16)", hollow: true },
  { name: "the 80 candle-part numbers", color: OKABE.sky, glyph: "circle", label: "the 80 candle-part numbers", hollow: true },
  { name: "the 64 raw window numbers", color: OKABE.blue, glyph: "circle", label: "the 64 raw window numbers", hollow: true },
  { name: "PCA to 16 numbers", color: OKABE.grey, glyph: "cross", label: "PCA to 16 numbers", hollow: true },
  { name: "random untrained encoder (16)", color: WHITE, glyph: "triangle-down", label: "random untrained encoder (16)", hollow: true },
];
const LEARNED_THREE = ["last-three-candle autoencoder (8)", "last-three-candle vector-quantised encoder (8)"];
const WHOLE = ["autoencoder (16)", "vector-quantised encoder (16)", "masked-candle model (16)"];
const VOCABULARY_METHOD = "last-three-candle vector-quantised codes (the learned vocabulary)";
const PCA_THREE = "PCA of the last three candles to 8 numbers";
const RAW_THREE = "the 15 last-three-candle part numbers";
const RANDOM_THREE = "random untrained last-three-candle encoder (8)";

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const words = (text: unknown) => String(text ?? "").replace(/_/g, " ");

/** The prose numbers of the notebook's section 9 findings, computed from the landed tables. */
function findings(body: LearnedBody) {
  const lifts = (methods: string[], timeframes = ["1m"], pattern?: string) =>
    body.purity.filter((row) => methods.includes(String(row.method)) && timeframes.includes(String(row.timeframe)) && (pattern === undefined || row.pattern === pattern));
  const span = (rows: Row[]) => {
    const values = rows.map((row) => num(row.lift_over_chance)).filter((v): v is number => v !== null);
    if (!values.length) return "—";
    const low = fmt(Math.min(...values), 1), high = fmt(Math.max(...values), 1);
    return low === high ? `${low}×` : `${low}–${high}×`;
  };
  const ami = (timeframe: string, method: string) => num(body.clusters.find((row) => row.timeframe === timeframe && row.method === method)?.adjusted_mutual_information);
  const one = lifts(LEARNED_THREE).sort((a, b) => (num(a.lift_over_chance) ?? 0) - (num(b.lift_over_chance) ?? 0));
  const byPattern = (method: string) => lifts([method]).sort((a, b) => String(a.pattern).localeCompare(String(b.pattern))).map((row) => num(row.lift_over_chance) ?? 0);
  const raw = byPattern(RAW_THREE), pca = byPattern(PCA_THREE);
  const tracking = body.tracking.filter((row) => row.timeframe === "1m")
    .sort((a, b) => (num(b.largest_absolute_spearman_with_atr_14_trailing_percentile_rank) ?? 0) - (num(a.largest_absolute_spearman_with_atr_14_trailing_percentile_rank) ?? 0));
  const masked = num(tracking.find((row) => row.method === "masked-candle model (16)")?.largest_absolute_spearman_with_atr_14_trailing_percentile_rank);
  const next = num(tracking.find((row) => row.method !== "masked-candle model (16)")?.largest_absolute_spearman_with_atr_14_trailing_percentile_rank);
  const code = body.codes.filter((row) => row.vocabulary === "last-three-candle vector-quantised")
    .sort((a, b) => (num(b.share_bullish_engulfing) ?? 0) - (num(a.share_bullish_engulfing) ?? 0))[0];
  const share = (value: unknown) => {
    const v = num(value);
    return v === null ? "n/a" : v >= 0.999 && v < 1 ? fmtPercent(v, 2) : fmtPercent(v, 1);
  };
  const lift = (method: string, pattern: string) => num(lifts([method], ["1m"], pattern)[0]?.lift_over_chance);
  const vq = body.trainingLog.find((row) => row.model_name === "last-three-candle vector-quantised" && row.selected_epoch === true);
  return {
    lifts, span, ami, one, raw, pca, masked, next, code, share, lift,
    perplexity: num(vq?.validation_codebook_perplexity),
    lowest: words(one[0]?.pattern), highest: words(one[one.length - 1]?.pattern),
  };
}

function Intro({ body }: { body: LearnedBody }) {
  const f = findings(body);
  const amiLine = (other: string) => ["1m", "1h", "4h"].map((tf) => `${fmt(f.ami(tf, VOCABULARY_METHOD), 3)} against ${fmt(f.ami(tf, other), 3)} on ${tf}`).join(", ");
  const code = f.code;
  return (
    <>
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="bullish engulfing, 1m" value={`${fmt(f.lift(LEARNED_THREE[0]!, "bullish_engulfing"), 1)}× · ${fmt(f.lift(PCA_THREE, "bullish_engulfing"), 1)}× · ${fmt(f.lift(RANDOM_THREE, "bullish_engulfing"), 1)}×`} hint="nearest-window lift: learned · PCA · untrained" />
        <Stat label="hammer, 1m" value={`${fmt(f.lift(LEARNED_THREE[0]!, "hammer"), 1)}× · ${fmt(f.lift(PCA_THREE, "hammer"), 1)}× · ${fmt(f.lift(RANDOM_THREE, "hammer"), 1)}×`} hint="nearest-window lift: learned · PCA · untrained" />
        <Stat label="agreement with TA-Lib's names, 1m" value={`${fmt(f.ami("1m", VOCABULARY_METHOD), 3)} · ${fmt(f.ami("1m", PCA_THREE), 3)} · ${fmt(f.ami("1m", RAW_THREE), 3)}`} hint="adjusted mutual information: learned vocabulary · PCA clusters · raw clusters" />
        <Stat label="three-candle words in use" value={f.perplexity === null ? "n/a" : `${fmt(f.perplexity, 0)} of 64`} hint="codebook perplexity on 2024" />
      </div>
      <Finding>
        <b>What it found.</b> Taught on whole 16-candle windows, the models spend their numbers on the path: trend, range, where the window sits.
        A hammer's 10 nearest windows are hammers only {f.span(f.lifts(WHOLE, ["1m"], "hammer"))} more often than chance at 1m, beside {f.span(f.lifts(["PCA to 16 numbers"], ["1m"], "hammer"))} for
        PCA of the same 80 numbers. The masked-candle model sorted its space by volatility: one of its numbers has a rank correlation of {fmt(f.masked, 2)} with
        the average true range percentile, where no other method passes {fmt(f.next, 2)}.
      </Finding>
      <Finding>
        Pointed at the last three candles, still without labels, the names emerge. A firing's 10 nearest learned windows share its name {f.span(f.one)} more often
        than chance at 1m ({f.lowest} lowest, {f.highest} highest), and {f.span(f.lifts(LEARNED_THREE, ["1h", "4h"]))} on 1h and 4h candles the models never saw; an untrained
        network gets {f.span(f.lifts([RANDOM_THREE]))}. Plain PCA of the same 15 numbers gets {f.span(f.lifts([PCA_THREE]))}, and the raw 15 numbers beat PCA on{" "}
        {f.raw.filter((value, index) => value > (f.pca[index] ?? Infinity)).length} of {f.raw.length} names: at this scale the shapes are close to linear in the candle parts.
        The invented vocabulary's agreement with TA-Lib's names (adjusted mutual information, 0 = none, 1 = the codes are the names) against 64 k-means clusters of PCA's
        numbers: {amiLine(PCA_THREE)}; against clusters of the raw 15 numbers: {amiLine(RAW_THREE)}.
      </Finding>
      {code && (
        <Finding>
          <b>Not a copy of TA-Lib:</b> code {String(code.code)} is {fmtPercent(num(code.share_bullish_engulfing), 0)} bullish engulfings and {fmtPercent(num(code.share_bearish_engulfing), 1)} bearish
          ones. The other {fmtInt(num(code.unnamed_window_count_2021_2024))} windows have no TA-Lib name, yet {f.share(code.unnamed_share_last_candle_up)} of them end in an up
          candle with a body a median {fmt(num(code.unnamed_median_last_body_over_previous_body), 1)}× the previous body; {f.share(code.unnamed_share_up_candle_after_down_candle)} are an up
          candle after a down candle, and {f.share(code.up_after_down_share_missing_bullish_engulfing_only_by_opening_above_previous_close)} of those miss TA-Lib's rule for one reason
          only: the up candle opened a median {fmt(num(code.median_open_above_previous_close_in_average_ranges), 2)} average ranges above the previous close instead of at or below it.
          TA-Lib draws a hard line; the model grouped by likeness.
        </Finding>
      )}
    </>
  );
}

function Reconstruction({ controls, set }: TabProps) {
  const query = useStudyQuery<ReconstructionBody>("candle-vectors", {
    section: "reconstruction", pattern: controls.pattern, occurrence: controls.shapeOccurrence, shapeModel: controls.shapeModel,
    hidden: controls.shapeModel === "masked candles" ? controls.hidden : "0",
  });
  const body = query.data?.data;
  const maximum = Math.max(2, body?.firingCount ?? 0);
  const hiddenSet = new Set(controls.shapeModel === "masked candles" ? controls.hidden.split(",").map(Number) : []);
  const candles: CandleMark[] = [];
  (body?.real ?? []).forEach((candle, index) => {
    const barsBack = 15 - index;
    const hiddenHere = hiddenSet.has(barsBack);
    candles.push({ x: -barsBack - 0.28, ...candle, widthFraction: 0.4, stroke: hiddenHere ? OKABE.vermillion : undefined, strokeWidth: hiddenHere ? 1.6 : undefined,
      tip: [`${barsBack} bars back · ${hiddenHere ? "hidden from the model (real)" : "real window"}`, `open ${fmt(candle.open, 3)} · high ${fmt(candle.high, 3)} · low ${fmt(candle.low, 3)} · close ${fmt(candle.close, 3)}`] });
  });
  const rebuilt = body?.rebuilt ?? [];
  rebuilt.forEach((candle, index) => {
    const barsBack = rebuilt.length - 1 - index;
    candles.push({ x: -barsBack + 0.28, ...candle, widthFraction: 0.4, fill: "#fafafa", stroke: OKABE.vermillion, strokeWidth: 1.4,
      tip: [`${barsBack} bars back · rebuilt by the model`, `open ${fmt(candle.open, 3)} · high ${fmt(candle.high, 3)} · low ${fmt(candle.low, 3)} · close ${fmt(candle.close, 3)}`] });
  });
  const available = new Set(body?.availableHidden ?? []);
  const title = body?.time_label
    ? `${body.time_label} · ${controls.shapeModel}, reconstruction loss ${fmt(body.reconstructionLoss, 3)}${controls.shapeModel === "masked candles" ? " on the hidden candles" : ""}${body.vocabularyCode !== null ? `, snapped to vocabulary code ${body.vocabularyCode}` : ""}`
    : "";
  return (
    <Section title="9.1 · Watch it rebuild a window, and fill in candles you hide" question="Filled candles are the real window; white candles outlined in vermillion are what the model rebuilt from its own numbers (8 for the last-three-candle models, 16 for the rest). A vector-quantised model rebuilds from one of its 64 words. The masked-candle model never sees the candles you hide.">
      <ControlBar>
        <SliderControl label={`2025 1m ${PATTERN_STYLE[controls.pattern]?.label} (of ${fmtInt(body?.firingCount ?? 0)})`} value={Math.min(controls.shapeOccurrence, maximum)} min={1} max={maximum} onChange={(v) => set("shapeOccurrence", v)} />
        <SelectControl label="Model" value={controls.shapeModel} options={SHAPE_MODELS.map((m) => ({ value: m, label: m }))} onChange={(v) => set("shapeModel", v)} />
        {controls.shapeModel === "masked candles" && (
          <SelectControl label="Candles hidden (bars back)" value={controls.hidden}
            options={MASKED_PRESETS.map((preset) => ({ value: preset, label: `${preset}${available.size && !available.has(preset) ? " (not run for this firing)" : ""}` }))}
            onChange={(v) => set("hidden", v)} hint={`every firing has 0; the first ${MASKED_PRESET_FIRINGS} firings of each pattern have every set`} />
        )}
      </ControlBar>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!body?.landed ? <Empty>The shape reconstructions are not in the lake.</Empty> : body.real.length === 0 ? <Empty>No 2025 firing of this pattern.</Empty> : (
          <>
            <CandleChart candles={candles} height={300} xDomain={[-15.7, 0.7]} format={(v) => fmt(v, 1)} title={title}
              xLabel="bars back from the last candle (real left, rebuilt right of each slot)" yLabel="average ranges from the last close" hLines={[{ y: 0, color: "#737373", dash: "3 3" }]} />
            <CandleKey extra={<> · <span style={{ color: OKABE.vermillion }}>▯ white with vermillion outline = rebuilt by the model</span> · vermillion outline on a real candle = hidden from the model</>} />
          </>
        )}
      </StudyState>
      <FormulaCard
        tex={"\\text{parts}_c=\\big(\\underbrace{C_c-O_c}_{\\text{body}},\\,\\underbrace{H_c-\\max(O_c,C_c)}_{\\text{upper shadow}},\\,\\underbrace{\\min(O_c,C_c)-L_c}_{\\text{lower shadow}},\\,\\underbrace{C_c}_{\\text{close position}},\\,\\underbrace{O_c-C_{c-1}}_{\\text{gap}}\\big),\\quad \\mathcal{L}=\\frac{1}{5N}\\sum_{c=1}^{N}\\sum_{p=1}^{5}\\left(\\hat x_{c,p}-x_{c,p}\\right)^2"}
        caption="Every candle is broken into the five parts every candlestick is made of; the model squeezes them through a few numbers and rebuilds them."
        symbols={[
          { tex: "N", name: "how many candles the model sees", value: String(body?.candlesRebuilt || (controls.shapeModel.startsWith("last") ? 3 : 16)) },
          { tex: "c", name: "candle number in what the model sees, oldest to newest", value: "1 … N" },
          { tex: "O_c, H_c, L_c, C_c", name: "that candle's open, high, low, close", value: "average ranges from the last close" },
          { tex: "p", name: "which of the 5 parts", value: "body, upper shadow, lower shadow, close position, gap" },
          { tex: "x_{c,p}", name: "the part, standardised by its 2021-2023 mean and spread", value: "unitless" },
          { tex: "\\hat x_{c,p}", name: "the model's rebuilt value of that part", value: "unitless" },
          { tex: "\\sum_{c=1}^{N}\\sum_{p=1}^{5}", name: "add up over every candle and every part (the masked model: its hidden candles only)", value: `${5 * (body?.candlesRebuilt || 16)} terms` },
          { tex: "\\mathcal{L}", name: "reconstruction loss: 0 = rebuilt exactly, 1 = no better than guessing the average", value: fmt(body?.reconstructionLoss, 3) },
        ]}
      />
    </Section>
  );
}

function Vocabulary({ controls, set, body }: TabProps & { body: LearnedBody }) {
  const codes = body.codes.filter((row) => row.vocabulary === controls.vocabulary);
  const bestLift = (row: Row) => num(row.largest_lift) ?? 0;
  const sorted = [...codes].sort((a, b) => controls.vocabularyOrder === "most windows"
    ? (num(b.window_count_2021_2024) ?? 0) - (num(a.window_count_2021_2024) ?? 0)
    : controls.vocabularyOrder === "code number" ? Number(a.code) - Number(b.code) : bestLift(b) - bestLift(a));
  const candleCount = controls.vocabulary.startsWith("last") ? 3 : 16;
  const prototype = (code: number): CandleMark[] => {
    const rows = body.prototypes.filter((row) => Number(row.code) === code);
    return Array.from({ length: candleCount }, (_, index) => candleCount - 1 - index).map((barsBack) => {
      const of = (price: string) => num(rows.find((row) => Number(row.bars_back) === barsBack && row.price === price)?.value) ?? Number.NaN;
      return { x: -barsBack, open: of("open"), high: of("high"), low: of("low"), close: of("close") };
    });
  };
  const top = body.codes.filter((row) => row.vocabulary === "last-three-candle vector-quantised").sort((a, b) => bestLift(b) - bestLift(a))[0];
  const topPattern = String(top?.most_overrepresented_pattern ?? "");
  const selected = codes.find((row) => Number(row.code) === controls.vocabularyCode);
  const bars = PATTERNS.map((pattern) => {
    const lift = num(selected?.[`lift_${pattern}`]) ?? 0;
    return { pattern: PATTERN_STYLE[pattern]?.label ?? pattern, lift, share: num(selected?.[`share_${pattern}`]), shown: Math.log10(1 + lift) };
  });
  const maximumCode = Math.max(0, ...codes.map((row) => Number(row.code)));
  return (
    <Section title="9.2 · The shape vocabulary the model invented" question="The vector-quantised model had to describe every window with one of 64 codes, and nobody told it what any code should mean. Each small chart is one code decoded back into candles; the bars show which TA-Lib names landed in it (2021-2024) and by how much more than chance.">
      {top && (
        <Finding>
          In the three-candle vocabulary, code {String(top.code)} holds {fmt(num(top.largest_lift), 1)}× the usual share of {words(topPattern)}s ({fmtPercent(num(top[`share_${topPattern}`]), 0)} of its
          windows): a word the model coined for that shape without ever being told the name.
        </Finding>
      )}
      <ControlBar>
        <SegmentControl label="Vocabulary" value={controls.vocabulary} options={VOCABULARIES.map((v) => ({ value: v, label: v.startsWith("last") ? "last three candles" : "whole 16-candle window" }))} onChange={(v) => set("vocabulary", v)} />
        <SelectControl label="Order codes by" value={controls.vocabularyOrder} options={["most over-represented TA-Lib name", "most windows", "code number"].map((v) => ({ value: v, label: v }))} onChange={(v) => set("vocabularyOrder", v)} />
        <SliderControl label="Inspect code" value={Math.min(controls.vocabularyCode, maximumCode)} min={0} max={maximumCode} onChange={(v) => set("vocabularyCode", v)} />
      </ControlBar>
      <div className="grid gap-1 grid-cols-[repeat(auto-fill,minmax(130px,1fr))]">
        {sorted.map((row) => {
          const code = Number(row.code);
          return (
            <button key={code} type="button" onClick={() => set("vocabularyCode", code)}
              className={`min-w-0 rounded border p-1 text-left ${code === controls.vocabularyCode ? "border-[#56B4E9]" : "border-neutral-800 hover:border-neutral-600"}`}>
              <div className="truncate text-[9px] text-neutral-300">code {code} · {words(row.most_overrepresented_pattern ?? "none")} ×{fmt(bestLift(row), 1)} · {fmtPercent(num(row.share_of_all_windows), 1)}</div>
              <CandleChart candles={prototype(code)} height={70} xDomain={[-(candleCount - 0.5), 0.5]} format={() => ""} />
            </button>
          );
        })}
      </div>
      <CandleKey extra=" · click a code to inspect it" />
      {selected && (
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <div className="text-[11px] text-neutral-300">
              code {controls.vocabularyCode}: {fmtInt(num(selected.window_count_2021_2024))} windows in 2021-2024, {fmtInt(num(selected.window_count_2025))} in 2025;{" "}
              {fmtPercent(num(selected.share_with_no_pattern) ?? 0, 0)} carry no TA-Lib name
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 14 }}>
                <CartesianGrid {...GRID} horizontal={false} />
                <XAxis type="number" dataKey="shown" {...AXIS} tickFormatter={(v: number) => fmt(10 ** v - 1, 1)} label={{ value: "times its usual share (log of 1 + lift)", position: "insideBottom", offset: -6, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis type="category" dataKey="pattern" width={110} {...AXIS} interval={0} />
                <ReferenceLine x={Math.log10(2)} stroke="#e5e5e5" strokeDasharray="3 3" label={{ value: "1× (usual share)", fill: "#a3a3a3", fontSize: 9, position: "top" }} />
                <Tooltip {...TOOLTIP} formatter={(_value, _name, item) => {
                  const bar = item.payload as (typeof bars)[number];
                  return [`${fmt(bar.lift, 2)}× · ${fmtPercent(bar.share, 1)} of the code`, "lift"];
                }} />
                <Bar dataKey="shown" isAnimationActive={false}>
                  {bars.map((bar) => <Cell key={bar.pattern} fill={bar.lift >= 2 ? OKABE.orange : OKABE.grey} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-neutral-400"><span style={{ color: OKABE.orange }}>■ at least twice its usual share</span> · <span style={{ color: OKABE.grey }}>■ less</span></p>
          </div>
          <DataTable rows={PATTERNS.map((pattern) => ({ ta_lib_name: PATTERN_STYLE[pattern]?.label, share_of_this_code: num(selected[`share_${pattern}`]), times_its_usual_share: num(selected[`lift_${pattern}`]) ?? 0 }))}
            columns={[{ key: "ta_lib_name", label: "TA-Lib name" }, { key: "share_of_this_code", label: "share of this code's windows", format: (v) => fmtPercent(v as number, 2) }, { key: "times_its_usual_share", format: (v) => `${fmt(v as number, 1)}×` }]} />
        </div>
      )}
    </Section>
  );
}

function Emergence({ controls, set, body }: TabProps & { body: LearnedBody }) {
  const lift = controls.emergenceCheck === "nearest-window lift";
  const timeframe = controls.timeframe;
  const source = lift ? body.purity : body.probe;
  const rows = source.filter((row) => row.timeframe === timeframe);
  const items = rows.map((row): IntervalItem => {
    const share = num(row.pattern_share_of_all_windows) ?? 0;
    const value = lift ? num(row.lift_over_chance) : num(row.average_precision);
    const low = lift ? (share > 0 ? (num(row.same_pattern_share_day_block_lower_95) ?? 0) / share : null) : num(row.average_precision_day_block_lower_95);
    const high = lift ? (share > 0 ? (num(row.same_pattern_share_day_block_upper_95) ?? 0) / share : null) : num(row.average_precision_day_block_upper_95);
    const style = METHODS.find((method) => method.name === row.method) ?? METHODS[0]!;
    return {
      row: String(row.pattern), series: String(row.method), value, low, high, style, faded: row.sees === "all 16 candles",
      tip: [String(row.method), `sees ${String(row.sees)}`, `${words(row.pattern)} · ${timeframe}`, `${lift ? "lift" : "average precision"} ${fmt(value, 3)}`, `95% ${fmt(low, 3)} to ${fmt(high, 3)}`],
    };
  });
  const values = items.flatMap((item) => [item.low, item.high, item.value]).filter((v): v is number => typeof v === "number" && v > 0);
  const domain: [number, number] = lift ? [Math.max(0.1, Math.min(...values) * 0.8), Math.max(2, Math.max(...values) * 1.2)] : [0, 1];
  const at = (method: string, pattern: string) => num(body.purity.find((row) => row.timeframe === "1m" && row.method === method && row.pattern === pattern)?.lift_over_chance);
  return (
    <Section title="9.3 · Did the named shapes emerge without the names?" question="Three checks on 2025, which no model trained on. Nearest-window lift: of a firing's 10 nearest 2021-2024 windows, the share with the same name divided by that name's share of all windows. Linear probe: a straight-line classifier on the frozen numbers. A learned embedding only counts where it beats the controls at its own scale, above all the untrained network.">
      <Finding>
        At 1m the raw 15 numbers find a hammer's neighbours at {fmt(at(RAW_THREE, "hammer"), 1)}× chance, the learned 8 numbers at {fmt(at(LEARNED_THREE[0]!, "hammer"), 1)}× and PCA's 8 at{" "}
        {fmt(at(PCA_THREE, "hammer"), 1)}×: squeezing to 8 numbers loses some of the fine body-to-shadow ratio that defines a hammer. For bullish engulfing the learned 8 numbers reach{" "}
        {fmt(at(LEARNED_THREE[0]!, "bullish_engulfing"), 1)}× against PCA's {fmt(at(PCA_THREE, "bullish_engulfing"), 1)}× and the raw numbers' {fmt(at(RAW_THREE, "bullish_engulfing"), 1)}×.
      </Finding>
      <ControlBar>
        <SegmentControl label="Check" value={controls.emergenceCheck} options={[{ value: "nearest-window lift", label: "nearest-window lift" }, { value: "linear probe average precision", label: "linear probe average precision" }]} onChange={(v) => set("emergenceCheck", v)} />
        <span className="self-center text-[11px] text-neutral-400">timeframe {timeframe} (the picker at the top; 1h and 4h were never seen in training)</span>
      </ControlBar>
      <Legend items={METHODS.map((method) => ({ key: method.name, ...method }))} />
      <p className="text-[11px] text-neutral-400">filled = sees the last three candles · hollow and faded = sees all 16 candles · line = 95% trading-day block interval</p>
      {rows.length === 0 ? <Empty>No emergence check for this timeframe.</Empty> : (
        <IntervalPlot rows={[...PATTERNS]} series={METHODS.map((m) => m.name)} items={items} domain={domain} log={lift} rowHeight={96} labelWidth={110}
          xLabel={lift ? "times more often than chance a firing's 10 nearest windows share its name (log)" : "linear-probe average precision on 2025"}
          reference={lift ? { value: 1, color: "#737373" } : undefined} />
      )}
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <div className="text-[11px] text-neutral-300"><b>Clusters vs TA-Lib names</b> (64 clusters each; 1.0 = the clusters are exactly the names)</div>
          <DataTable rows={body.clusters.filter((row) => row.timeframe === timeframe)} columns={["method", "clusters", "adjusted_mutual_information", "normalized_mutual_information", "cluster_purity"].map((key) => ({ key }))} />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="text-[11px] text-neutral-300"><b>Is it learning volatility instead of shape?</b> Largest rank correlation of any embedding number with the average true range percentile and with relative volume: high means the space is sorted by how busy the market was, not by shape.</div>
          <DataTable rows={body.tracking.filter((row) => row.timeframe === timeframe).map(({ timeframe: _t, learned_without_labels: _l, control: _c, ...rest }) => rest)} />
        </div>
      </div>
    </Section>
  );
}

function LearnedMap({ controls, set }: TabProps) {
  const query = useStudyQuery<LearnedMapBody>("candle-vectors", { section: "learnedMap", method: controls.learnedMethod });
  const points = query.data?.data.points ?? [];
  const xDomain = middleSpan(points.map((p) => p.horizontal), controls.learnedZoom) ?? [0, 1];
  const yDomain = middleSpan(points.map((p) => p.vertical), controls.learnedZoom) ?? [0, 1];
  return (
    <Section title="9.4 · The learned space, coloured by names it never saw" question="2025 windows on the two main directions of each embedding. The colours are TA-Lib's names added after training: if shapes were learned, each name gathers somewhere of its own.">
      <ControlBar>
        <SelectControl label="Space" value={controls.learnedMethod} options={EMBEDDING_METHODS.map((m) => ({ value: m, label: m }))} onChange={(v) => set("learnedMethod", v)} />
        <SliderControl label="Axes span the middle %" value={controls.learnedZoom} min={90} max={100} step={0.5} onChange={(v) => set("learnedZoom", v)} format={(v) => `${v}%`} />
      </ControlBar>
      <Legend items={[...PATTERNS, "no pattern"].map((key) => ({ key, ...(PATTERN_STYLE[key] as SeriesStyle) }))} />
      <StudyState isLoading={query.isLoading} error={query.error}>
        {points.length === 0 ? <Empty>The learned map is not in the lake.</Empty> : (
          <>
            <div className="text-[11px] text-neutral-400">{controls.learnedMethod}: {fmtInt(points.length)} held-out 2025 1m windows</div>
            <ScatterCanvas points={points.map((point) => ({ x: point.horizontal, y: point.vertical, group: point.pattern, tip: () => [point.time_label, words(point.pattern), `vocabulary code ${point.vocabulary_code ?? "—"}`] }))}
              styles={PATTERN_STYLE} opacity={0.4} xDomain={xDomain} yDomain={yDomain} xLabel="first direction" yLabel="second direction" />
          </>
        )}
      </StudyState>
    </Section>
  );
}

export function LearnedTab(props: TabProps) {
  const query = useStudyQuery<LearnedBody>("candle-vectors", { section: "learned", vocabulary: props.controls.vocabulary });
  const body = query.data?.data;
  return (
    <>
      <Section title="9 · The shape learned without labels" question="Hammer and engulfing are names for shapes. Here the models are never shown a label: 1.06 million 2021-2023 one-minute windows, each broken into candle parts, and they must learn the shapes from the windows alone.">
        <DataTable pageSize={6} rows={[
          { model: "autoencoder", sees: "all 16 candles", how_it_learns_the_shape: "squeezes the 80 parts through 16 numbers and rebuilds all 80" },
          { model: "vector-quantised", sees: "all 16 candles", how_it_learns_the_shape: "the 16 numbers must snap to one of 64 code vectors it invents: a shape vocabulary of its own" },
          { model: "masked candles", sees: "all 16 candles", how_it_learns_the_shape: "30% of the candles are hidden and it must fill them in from the rest" },
          { model: "last-three-candle autoencoder", sees: "the last 3 candles", how_it_learns_the_shape: "squeezes their 15 parts through 8 numbers" },
          { model: "last-three-candle vector-quantised", sees: "the last 3 candles", how_it_learns_the_shape: "a 64-word vocabulary of three-candle shapes" },
          { model: "controls, per scale", sees: "same input", how_it_learns_the_shape: "the raw numbers, PCA to the same size, and the same network with random, untrained weights" },
        ]} />
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={query.data?.notes ?? []} />
          {body?.landed ? <Intro body={body} /> : <Empty>The learned-shape tables are not in the lake.</Empty>}
        </StudyState>
      </Section>
      <Reconstruction {...props} />
      {body?.landed && <Vocabulary {...props} body={body} />}
      {body?.landed && <Emergence {...props} body={body} />}
      <LearnedMap {...props} />
    </>
  );
}
