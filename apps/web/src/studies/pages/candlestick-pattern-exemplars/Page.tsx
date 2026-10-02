/**
 * Which candle actually is the pattern? Every firing of a TA-Lib candlestick
 * pattern on MNQ daily bars, ranked by the distance of its shape to the
 * pattern's median shape, and stamped with the trend that came before it
 * against the trend its meaning needs.
 *
 * The pattern and the context filter choose which rows the server sends; the
 * exemplar count, the context-table scope, the inspected exemplar and every
 * sort are applied here.
 */

import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, Stat, StudyNotes,
  StudyState, SummaryTable, SwitchControl, TOOLTIP, eightNumberSummary, fmt, fmtInt, useStudyControls, useStudyQuery, Finding,
} from "@/studies/kit";
import { selectBestMatchPerBar, firingKey, type PatternFiring } from "@/market/lib/bestPatternMatch";
import {
  EMPTY_BODY, MAXIMUM_EXEMPLARS, archetypeDistance, contextAgrees, gatedCounts, measurePriorTrend, patternNeedsTrend, scopeContextRows,
  sharePercent, type ContextFilter, type ContextRow, type ContextScope, type ExemplarsBody, type FiringRow, type ShapeColumns,
} from "@shared/studies/candlestick-pattern-exemplars";
import { ArchetypePanel, ExemplarPanel, shapeOf } from "./ExemplarPanel";
import { SortableTable, type TableColumn } from "./SortableTable";

const CONTEXT_OPTIONS: Array<{ value: ContextFilter; label: string }> = [
  { value: "all", label: "every firing" },
  { value: "confirmed", label: "prior trend agrees" },
  { value: "contradicted", label: "prior trend differs" },
];

const CLASS_STYLE: Record<string, { color: string; shape: "circle" | "triangle" | "diamond" | "square"; glyph: string }> = {
  reversal: { color: OKABE.blue, shape: "circle", glyph: "●" },
  continuation: { color: OKABE.orange, shape: "triangle", glyph: "▲" },
  indecision: { color: OKABE.sky, shape: "diamond", glyph: "◆" },
  colour_line: { color: OKABE.purple, shape: "square", glyph: "■" },
};
const FALLBACK_STYLE = { color: OKABE.grey, shape: "circle" as const, glyph: "●" };

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
}

function chartLabelWinners(shapes: ShapeColumns): Set<string> {
  const firings: PatternFiring[] = shapes.timestamp_ms.map((timestamp, position) => ({
    time: timestamp,
    patternColumn: shapes.patterns[shapes.pattern_index[position] as number] ?? "",
    bodyFraction: shapes.body[position] as number,
    upperShadowFraction: shapes.upper[position] as number,
    lowerShadowFraction: shapes.lower[position] as number,
  }));
  return selectBestMatchPerBar(firings);
}

function numericRows(rows: readonly FiringRow[]) {
  return rows.map((row) => ({
    prototypicality_rank: row.prototypicality_rank,
    emitted_value: row.emitted_value,
    body_fraction_of_range: row.body_fraction_of_range,
    upper_shadow_fraction_of_range: row.upper_shadow_fraction_of_range,
    lower_shadow_fraction_of_range: row.lower_shadow_fraction_of_range,
    archetype_distance: row.archetype_distance,
    body_size_points: row.body_size_points,
    total_range_points: row.total_range_points,
    volume: row.volume,
  }));
}

const STAT_COLUMNS: Array<{ name: string; pick: (row: FiringRow) => number | null; decimals: number }> = [
  { name: "body_fraction_of_range", pick: (row) => row.body_fraction_of_range, decimals: 4 },
  { name: "upper_shadow_fraction_of_range", pick: (row) => row.upper_shadow_fraction_of_range, decimals: 4 },
  { name: "lower_shadow_fraction_of_range", pick: (row) => row.lower_shadow_fraction_of_range, decimals: 4 },
  { name: "archetype_distance", pick: (row) => row.archetype_distance, decimals: 4 },
  { name: "body_size_points", pick: (row) => row.body_size_points, decimals: 2 },
  { name: "total_range_points", pick: (row) => row.total_range_points, decimals: 2 },
];

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    pattern: "CDLHAMMER",
    context: "all",
    exemplarCount: 5,
    inspect: 1,
    termCount: 3,
    scope: "all",
    labelPoints: false,
  });
  const query = useStudyQuery<ExemplarsBody>("candlestick-pattern-exemplars", { pattern: controls.pattern, context: controls.context });
  const data = query.data?.data ?? EMPTY_BODY;
  const { headline, rule, archetype, firings } = data;
  const pattern = data.pattern ?? controls.pattern;

  const drawn = firings.slice(0, Math.min(controls.exemplarCount, MAXIMUM_EXEMPLARS));
  const inspectPosition = Math.min(Math.max(1, controls.inspect), Math.max(1, drawn.length));
  const inspected = drawn[inspectPosition - 1];
  const inspectedBars = inspected ? (data.windows[String(inspected.bar_timestamp_ms)] ?? []) : [];
  const archetypeShape = archetype
    ? { body: archetype.body_fraction_of_range, upper: archetype.upper_shadow_fraction_of_range, lower: archetype.lower_shadow_fraction_of_range }
    : null;

  const winners = chartLabelWinners(data.shapes);
  const isChartLabel = (row: FiringRow) => winners.has(firingKey(row.bar_timestamp_ms, pattern));
  const chartLabelCount = firings.filter(isChartLabel).length;

  const gatedHeadline = headline ? { gated: headline.gated_firing_count, held: headline.gated_held_count } : { gated: 0, held: 0 };
  const heldShare = gatedHeadline.gated > 0 ? (100 * gatedHeadline.held) / gatedHeadline.gated : 0;
  const selectedGated = gatedCounts(firings);

  const contextRows = scopeContextRows(data.contextRows, controls.scope as ContextScope);
  const needsTrendCount = data.contextRows.filter(patternNeedsTrend).length;

  const comparisons = [
    { comparison: "closed above its OWN open", percent: sharePercent(firings, (row) => row.close_versus_open === "above"), extra: false },
    { comparison: "closed above the PREVIOUS close", percent: sharePercent(firings, (row) => row.close_versus_previous_close === "above"), extra: false },
    { comparison: "prior trend agreed with the rule", percent: sharePercent(firings, contextAgrees), extra: false },
    {
      comparison: "… among firings that need a trend",
      percent: selectedGated.gated === 0 ? 0 : (100 * selectedGated.held) / selectedGated.gated,
      extra: true,
    },
  ];

  const scatter = data.contextRows
    .filter((row) => row.context_required >= 10 && row.context_held_percent !== null)
    .map((row) => ({ name: row.talib_function, x: row.context_required, y: row.context_held_percent as number, z: row.context_required, type: row.pattern_type ?? "other", firings: row.firings }));
  const scatterClasses = [...new Set(scatter.map((point) => point.type))];

  const topFirings = firings.slice(0, 40);
  const firingColumns: Array<TableColumn<FiringRow>> = [
    { key: "bar_date", label: "bar_date", title: "the lake's daily stamp: the calendar day the session opens" },
    { key: "prototypicality_rank", label: "prototypicality_rank", align: "right", title: "1 = closest to the archetype" },
    { key: "signal_direction", label: "signal_direction", render: (row) => (row.signal_direction === "bullish" ? "▲ bullish" : "▼ bearish") },
    { key: "body_fraction_of_range", label: "body_fraction_of_range", align: "right", render: (row) => fmt(row.body_fraction_of_range, 3) },
    { key: "upper_shadow_fraction_of_range", label: "upper_shadow_fraction_of_range", align: "right", render: (row) => fmt(row.upper_shadow_fraction_of_range, 3) },
    { key: "lower_shadow_fraction_of_range", label: "lower_shadow_fraction_of_range", align: "right", render: (row) => fmt(row.lower_shadow_fraction_of_range, 3) },
    { key: "close_versus_open", label: "close_versus_open" },
    { key: "close_versus_previous_close", label: "close_versus_previous_close" },
    { key: "prior_trend_direction", label: "prior_trend_direction" },
    { key: "required_prior_trend", label: "required_prior_trend" },
    { key: "archetype_distance", label: "archetype_distance", align: "right", render: (row) => fmt(row.archetype_distance, 3) },
    {
      key: "chart_label",
      label: "drawn_on_market_chart",
      title: "Whether the Market chart's one-label-per-bar choice (bestPatternMatch, spread-normalised) would name this firing's pattern on this bar",
      sortValue: (row) => (isChartLabel(row) ? 1 : 0),
      render: (row) => (isChartLabel(row) ? "● yes" : "○ no"),
    },
  ];
  const contextColumns: Array<TableColumn<ContextRow>> = [
    { key: "talib_function", label: "talib_function" },
    { key: "bars_the_rule_reads", label: "bars_the_rule_reads", align: "right" },
    { key: "pattern_type", label: "pattern_type" },
    { key: "required_prior_trend_for_bullish_signal", label: "required_prior_trend_for_bullish_signal" },
    { key: "required_prior_trend_for_bearish_signal", label: "required_prior_trend_for_bearish_signal" },
    { key: "talib_verifies_prior_trend", label: "talib_verifies_prior_trend", sortValue: (row) => (row.talib_verifies_prior_trend ? 1 : 0), render: (row) => (row.talib_verifies_prior_trend ? "yes" : "no") },
    { key: "firings", label: "firings", align: "right", render: (row) => fmtInt(row.firings) },
    { key: "context_required", label: "context_required", align: "right", render: (row) => fmtInt(row.context_required) },
    { key: "context_held", label: "context_held", align: "right", render: (row) => fmtInt(row.context_held) },
    { key: "context_held_percent", label: "context_held_percent", align: "right", render: (row) => (row.context_held_percent === null ? "—" : row.context_held_percent.toFixed(1)) },
  ];

  // The three formulas, for the exemplar being inspected.
  const offsetZero = inspectedBars.find((bar) => bar.bar_offset === 0);
  const open = offsetZero?.absolute_open_price ?? null;
  const high = offsetZero?.absolute_high_price ?? null;
  const low = offsetZero?.absolute_low_price ?? null;
  const close = offsetZero?.absolute_close_price ?? null;
  const span = high !== null && low !== null ? high - low : null;
  const rebuilt =
    span && span > 0 && open !== null && close !== null && high !== null && low !== null
      ? { body: Math.abs(close - open) / span, upper: (high - Math.max(open, close)) / span, lower: (Math.min(open, close) - low) / span }
      : null;
  const stored = inspected ? shapeOf(inspected) : null;
  const terms =
    inspected && archetypeShape && stored && stored.body !== null && stored.upper !== null && stored.lower !== null
      ? [
          { tex: "b", label: "body", value: stored.body, reference: archetypeShape.body },
          { tex: "u", label: "upper shadow", value: stored.upper, reference: archetypeShape.upper },
          { tex: "\\ell", label: "lower shadow", value: stored.lower, reference: archetypeShape.lower },
        ].map((term) => ({ ...term, square: (term.value - term.reference) ** 2 }))
      : [];
  const termsShown = Math.min(Math.max(1, controls.termCount), 3);
  const runningSquare = terms.slice(0, termsShown).reduce((total, term) => total + term.square, 0);
  const rebuiltDistance =
    stored && archetypeShape && stored.body !== null && stored.upper !== null && stored.lower !== null
      ? archetypeDistance({ body: stored.body, upper: stored.upper, lower: stored.lower }, archetypeShape)
      : null;
  const trend = measurePriorTrend(inspectedBars);

  const landed = data.landed;
  const fmtPrice = (value: number | null) => (value === null ? "—" : value.toFixed(2));

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!landed ? (
          <Empty>The exemplar tables are not in the lake yet. Run packages/ml-engine/src/studies/candlestick_pattern_exemplars/build.py, then refresh the derived views.</Empty>
        ) : (
          <>
            <Section
              title="The gap, in numbers"
              question={`Every firing of ${headline?.fired_pattern_count ?? 0} of the ${headline?.pattern_count ?? 61} TA-Lib patterns on ${headline?.symbol ?? ""} ${headline?.timeframe ?? ""} bars, ${headline?.first_bar_date ?? ""} to ${headline?.last_bar_date ?? ""}.`}
            >
              <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
                <Stat label="Patterns that depend on the prior trend" value={`${headline?.patterns_needing_prior_trend ?? 0} of ${headline?.pattern_count ?? 0}`} hint="rules whose bullish or bearish reading needs an up or down trend before it" />
                <Stat label="Patterns where TA-Lib verifies that trend" value={fmtInt(headline?.patterns_talib_verifies_prior_trend ?? 0)} hint="talib_checks_prior_trend in the rules file" />
                <Stat label="Firings that need a trend" value={fmtInt(gatedHeadline.gated)} />
                <Stat label="Trend was actually there" value={`${fmtInt(gatedHeadline.held)} (${percent(heldShare)})`} tone={OKABE.orange} />
                <Stat label="Shape only, context differs" value={`${fmtInt(gatedHeadline.gated - gatedHeadline.held)} (${percent(gatedHeadline.gated > 0 ? 100 - heldShare : 0)})`} tone={OKABE.blue} />
              </div>
              <div className="mt-2 h-10" role="img" aria-label={`${percent(heldShare)} of trend-dependent firings found their trend`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={[{ held: gatedHeadline.held, differs: gatedHeadline.gated - gatedHeadline.held }]} stackOffset="expand" margin={{ top: 0, right: 4, left: 4, bottom: 0 }}>
                    <XAxis type="number" hide domain={[0, 1]} />
                    <YAxis type="category" hide dataKey={() => "firings"} />
                    <Tooltip {...TOOLTIP} formatter={(value) => fmtInt(Number(value))} />
                    <Bar dataKey="held" name="trend agreed ●" stackId="a" fill={OKABE.orange} isAnimationActive={false}>
                      <LabelList dataKey="held" position="insideLeft" fill="#111" fontSize={11} formatter={(value: unknown) => `● agreed ${fmtInt(Number(value))}`} />
                    </Bar>
                    <Bar dataKey="differs" name="trend differed ◆" stackId="a" fill={OKABE.blue} isAnimationActive={false}>
                      <LabelList dataKey="differs" position="insideRight" fill="#fff" fontSize={11} formatter={(value: unknown) => `◆ differed ${fmtInt(Number(value))}`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <Finding>
                {heldShare < 50
                  ? "Most of what the chart calls a reversal is a shape whose context disagrees: "
                  : "On these bars the prior trend usually was there: "}
                {percent(heldShare)} of the {fmtInt(gatedHeadline.gated)} trend-dependent firings found the trend their meaning needs, and TA-Lib verified it for {fmtInt(headline?.patterns_talib_verifies_prior_trend ?? 0)} of the {headline?.pattern_count ?? 61} patterns.
                The prior trend is the move over ten closes ending at the bar before the firing, counted only when it clears the median bar range of that stretch.
              </Finding>
            </Section>

            <ControlBar onReset={reset}>
              <SelectControl
                label="Pattern"
                value={pattern}
                options={data.patterns.map((row) => ({ value: row.talib_function, label: `${row.talib_function} (${row.firings})` }))}
                onChange={(value) => set("pattern", value)}
                hint={`${data.patterns.length} patterns fired on these bars`}
              />
              <SliderControl label="Exemplars to draw" value={Math.min(controls.exemplarCount, MAXIMUM_EXEMPLARS)} min={1} max={MAXIMUM_EXEMPLARS} onChange={(value) => set("exemplarCount", value)} />
              <SegmentControl
                label="Context filter"
                value={controls.context as ContextFilter}
                options={CONTEXT_OPTIONS}
                onChange={(value) => set("context", value)}
                hint="'prior trend differs' is every firing whose prior trend is not the required one, including the patterns that require none"
              />
            </ControlBar>

            <Section title="What the rule actually tests" question={`${pattern}: ${fmtInt(firings.length)} firings under this filter of ${fmtInt(data.patterns.find((row) => row.talib_function === pattern)?.firings ?? 0)}.`}>
              {rule ? (
                <div className="space-y-1.5">
                  <p className="text-[12px] text-neutral-300">
                    <span className="font-mono text-neutral-100">{rule.talib_function}</span> reads <b>{rule.bars_the_rule_reads}</b> bar{rule.bars_the_rule_reads === 1 ? "" : "s"}, type <b>{rule.pattern_type ?? "?"}</b>, emits <span className="font-mono">{rule.emitted_values ?? "?"}</span>.
                    It needs a <b>{rule.required_prior_trend_for_bullish_signal ?? "?"}</b> trend before it to mean something bullish and a <b>{rule.required_prior_trend_for_bearish_signal ?? "?"}</b> trend to mean something bearish.
                    TA-Lib {rule.talib_verifies_prior_trend ? "verifies the prior trend" : "verifies neither"}.
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-neutral-400">
                    {(rule.shape_conditions ?? "").split("|").map((condition) => condition.trim()).filter(Boolean).map((condition) => (
                      <li key={condition}>{condition}</li>
                    ))}
                  </ul>
                  {rule.adaptive_settings_used && <p className="text-[10px] text-neutral-500">adaptive settings used: {rule.adaptive_settings_used}</p>}
                </div>
              ) : (
                <Empty>No rule row for {pattern}.</Empty>
              )}
            </Section>

            <Section title="The exemplars, drawn" question="Each panel is one candle with the bars around it, so the context is visible rather than described. Rank 1 is the closest to this pattern's archetype. Click a panel to inspect it below.">
              {drawn.length === 0 ? (
                <Empty>No firing of {pattern} matches this context filter.</Empty>
              ) : (
                <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
                  {archetypeShape && <ArchetypePanel archetype={archetypeShape} title={`${pattern} archetype`} />}
                  {drawn.map((row, position) => (
                    <ExemplarPanel
                      key={row.bar_timestamp_ms}
                      firing={row}
                      bars={data.windows[String(row.bar_timestamp_ms)] ?? []}
                      patternBars={rule?.bars_the_rule_reads ?? 1}
                      archetype={archetypeShape}
                      selected={position + 1 === inspectPosition}
                      onSelect={() => set("inspect", position + 1)}
                    />
                  ))}
                </div>
              )}
              <p className="mt-1 text-[10px] text-neutral-500">
                Candles: <span style={{ color: OKABE.orange }}>orange filled = closed up</span>, <span style={{ color: OKABE.blue }}>blue hollow = closed down</span>; the shaded band is the pattern's own {rule?.bars_the_rule_reads ?? 1} bar(s), faded bars came before it. Bars: upper shadow (sky), body (orange), lower shadow (blue) as fractions of the bar's own range.
                Dates are the lake's daily stamps, the calendar day the session opens (so Monday's session is stamped Sunday).
              </p>
            </Section>

            <Section title="The formulas, on the exemplar you picked" question={inspected ? `Exemplar #${inspected.prototypicality_rank} of ${pattern}, ${inspected.bar_date}. Step through the drawn exemplars and watch every number move.` : "Draw at least one exemplar."}>
              <ControlBar>
                <SliderControl label="Inspect exemplar" value={inspectPosition} min={1} max={Math.max(1, drawn.length)} onChange={(value) => set("inspect", value)} format={(value) => `${value} of ${drawn.length}`} />
                <SegmentControl label="Sum terms shown" value={termsShown} options={[{ value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3" }]} onChange={(value) => set("termCount", value)} hint="Step the index j through the three shape components" />
              </ControlBar>
              {inspected && archetypeShape ? (
                <div className="grid gap-2 xl:grid-cols-2">
                  <FormulaCard
                    tex={"b=\\frac{|c-o|}{h-L},\\qquad u=\\frac{h-\\max(o,c)}{h-L},\\qquad \\ell=\\frac{\\min(o,c)-L}{h-L}"}
                    caption={`The shape is three fractions of the bar's own range, so a 2019 bar and a 2025 bar are comparable. Rebuilt from the bar the lake holds: ${rebuilt ? `b ${fmt(rebuilt.body, 4)}, u ${fmt(rebuilt.upper, 4)}, ℓ ${fmt(rebuilt.lower, 4)}` : "no bar"}; stored: ${stored ? `b ${fmt(stored.body, 4)}, u ${fmt(stored.upper, 4)}, ℓ ${fmt(stored.lower, 4)}` : "—"}.`}
                    symbols={[
                      { tex: "o", name: "open of the firing bar (absolute price, points)", value: fmtPrice(open) },
                      { tex: "h", name: "high of the firing bar", value: fmtPrice(high) },
                      { tex: "L", name: "low of the firing bar", value: fmtPrice(low) },
                      { tex: "c", name: "close of the firing bar", value: fmtPrice(close) },
                      { tex: "b", name: "body as a fraction of the range", value: fmt(stored?.body, 4) },
                      { tex: "u", name: "upper shadow as a fraction of the range", value: fmt(stored?.upper, 4) },
                      { tex: "\\ell", name: "lower shadow as a fraction of the range", value: fmt(stored?.lower, 4) },
                    ]}
                  />
                  <FormulaCard
                    tex={"d=\\sqrt{\\sum_{j\\in\\{b,u,\\ell\\}}\\left(x_j-x_j^{*}\\right)^{2}},\\qquad r=1+\\#\\{k:\\ d_k<d\\}"}
                    caption={`Terms (x_j − x*_j)²: ${terms.map((term, index) => `${index < termsShown ? "" : "("}${fmt(term.square, 5)}${index < termsShown ? "" : ")"}`).join(" + ")}. Running sum through term ${termsShown} is ${fmt(runningSquare, 5)}, so d = √${fmt(runningSquare, 5)} = ${fmt(Math.sqrt(runningSquare), 4)}${termsShown === 3 ? `; stored archetype_distance ${fmt(inspected.archetype_distance, 4)}.` : " (terms in parentheses not yet added)."}`}
                    symbols={[
                      { tex: "j", name: "shape component: body, upper shadow, lower shadow", value: `1…${termsShown} of 3` },
                      ...terms.slice(0, termsShown).flatMap((term) => [
                        { tex: `x_{${term.tex}}`, name: `this firing's ${term.label} fraction`, value: fmt(term.value, 4) },
                        { tex: `x_{${term.tex}}^{*}`, name: `archetype ${term.label} fraction (median of every firing)`, value: fmt(term.reference, 4) },
                      ]),
                      { tex: "d", name: "archetype distance (Euclidean, in range fractions)", value: fmt(rebuiltDistance, 4) },
                      { tex: "r", name: "prototypicality rank (ties share the lowest rank)", value: fmtInt(inspected.prototypicality_rank) },
                    ]}
                  />
                  <FormulaCard
                    tex={"M=c_{t-1}-c_{t-11},\\quad R=\\operatorname*{median}_{k=t-11}^{t-1}(h_k-L_k),\\quad \\text{trend}=\\begin{cases}\\text{up}&M\\ge R\\\\\\text{down}&M\\le -R\\\\\\text{sideways}&|M|<R\\end{cases}"}
                    caption={`Only bars before the firing are read, so nothing looks ahead. Recomputed from the ${inspectedBars.filter((bar) => bar.bar_offset < 0).length} bars before it: ${trend.direction}; stamped in the lake: ${inspected.prior_trend_direction}${trend.direction === inspected.prior_trend_direction ? " (they agree)." : " (they differ)."}`}
                    symbols={[
                      { tex: "t", name: "the firing bar", value: inspected.bar_date },
                      { tex: "M", name: "move: close before the firing minus the close ten bars earlier (points)", value: fmt(trend.move, 2) },
                      { tex: "R", name: "median bar range over those eleven bars (points); the move must clear 1.0 × R", value: fmt(trend.typicalRange, 2) },
                      { tex: "\\text{trend}", name: "prior trend direction", value: trend.direction },
                      { tex: "\\text{needs}", name: `trend this signal's meaning requires (${inspected.signal_direction})`, value: inspected.required_prior_trend },
                    ]}
                  />
                  <FormulaCard
                    tex={"P=100\\,\\frac{H}{G}"}
                    caption={`Across all ${headline?.patterns_needing_prior_trend ?? 0} trend-dependent patterns, and for ${pattern} under the filter.`}
                    symbols={[
                      { tex: "G", name: "gated firings: firings whose meaning needs an up or down trend", value: fmtInt(gatedHeadline.gated) },
                      { tex: "H", name: "held: gated firings where the prior trend was the required one", value: fmtInt(gatedHeadline.held) },
                      { tex: "P", name: "context held, all patterns (percent)", value: percent(heldShare) },
                      { tex: "P_{\\text{pattern}}", name: `the same for ${pattern} under this filter (${selectedGated.held} of ${selectedGated.gated})`, value: selectedGated.gated ? percent((100 * selectedGated.held) / selectedGated.gated) : "—" },
                    ]}
                  />
                </div>
              ) : (
                <Empty>Nothing to inspect.</Empty>
              )}
            </Section>

            <Section title={`Top ${Math.min(40, firings.length)} firings of ${pattern}`} question={`Ranked by prototypicality. ${fmtInt(chartLabelCount)} of the ${fmtInt(firings.length)} firings also carry the pattern's label on the Market chart, which picks one label per bar with its own spread-normalised score. Click a header to sort.`}>
              {topFirings.length === 0 ? (
                <Empty>No firings under this filter.</Empty>
              ) : (
                <SortableTable rows={topFirings} columns={firingColumns} rowKey={(row) => String(row.bar_timestamp_ms)} initialSort={{ key: "prototypicality_rank", descending: false }} />
              )}
            </Section>

            <Section title="The context for every one of the 61" question="What each rule reads, what trend it needs before it to mean what it claims, and how often that trend was there. A dash means no firing needed a trend: a Doji is a statement about one bar and nothing else.">
              <ControlBar>
                <SegmentControl
                  label="Show"
                  value={controls.scope as ContextScope}
                  options={[
                    { value: "all", label: `all ${data.contextRows.length}` },
                    { value: "needs_context", label: `the ${needsTrendCount} that need a prior trend` },
                    { value: "fired", label: "only the ones that fired here" },
                  ]}
                  onChange={(value) => set("scope", value)}
                />
              </ControlBar>
              <SortableTable rows={contextRows} columns={contextColumns} rowKey={(row) => row.talib_function} maxHeight={420} initialSort={{ key: "bars_the_rule_reads", descending: false }} />
            </Section>

            <Section title="Close versus open and close versus previous close are different things" question="The first decides the candle's colour and the sign TA-Lib emits. The second is context, and it is the one a trend is made of. Conflating them is the most common way a pattern rule goes wrong.">
              <div role="img" aria-label="Share of this pattern's firings by comparison">
                <ResponsiveContainer width="100%" height={170}>
                  <BarChart data={comparisons} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                    <CartesianGrid {...GRID} horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} {...AXIS} tickFormatter={(value: number) => `${value}%`} />
                    <YAxis type="category" dataKey="comparison" width={210} {...AXIS} interval={0} />
                    <Tooltip {...TOOLTIP} formatter={(value) => `${Number(value).toFixed(1)}% of ${fmtInt(firings.length)} firings`} />
                    <ReferenceLine x={50} stroke={OKABE.grey} strokeDasharray="4 3" label={{ value: "50%", fill: OKABE.grey, fontSize: 10 }} />
                    <Bar dataKey="percent" isAnimationActive={false}>
                      {comparisons.map((row) => (
                        <Cell key={row.comparison} fill={row.extra ? OKABE.sky : OKABE.orange} />
                      ))}
                      <LabelList dataKey="percent" position="right" fill="#d4d4d4" fontSize={11} formatter={(value: unknown) => `${Number(value).toFixed(1)}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <Finding>
                The third bar is the notebook's: it counts a firing as agreeing only when its prior trend equals the required one, so a pattern that requires no trend can never agree.
                The fourth (sky) restricts to the {fmtInt(selectedGated.gated)} firings that do need one.
              </Finding>
            </Section>

            <Section title="Every pattern, ranked by how often its context holds" question="One point per pattern with at least 10 trend-dependent firings: how many, and what share found their trend. Below the dashed line the shape fired more often without its context than with it.">
              <ControlBar>
                <SwitchControl label="Label every point" checked={controls.labelPoints} onChange={(value) => set("labelPoints", value)} />
                <span className="self-center text-[11px] text-neutral-400">
                  {scatterClasses.map((name) => (
                    <span key={name} className="mr-3" style={{ color: (CLASS_STYLE[name] ?? FALLBACK_STYLE).color }}>
                      {(CLASS_STYLE[name] ?? FALLBACK_STYLE).glyph} {name.replace("_", " ")}
                    </span>
                  ))}
                </span>
              </ControlBar>
              {scatter.length === 0 ? (
                <Empty>No pattern has 10 trend-dependent firings.</Empty>
              ) : (
                <div role="img" aria-label="Context held percent against trend-dependent firings, one point per pattern">
                  <ResponsiveContainer width="100%" height={340}>
                    <ScatterChart margin={{ top: 8, right: 24, left: 4, bottom: 16 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis type="number" dataKey="x" name="firings that need a trend" scale="log" domain={["auto", "auto"]} allowDataOverflow {...AXIS} label={{ value: "firings that need a trend (log)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                      <YAxis type="number" dataKey="y" name="context held (%)" domain={[0, 100]} {...AXIS} label={{ value: "context held (%)", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
                      <ZAxis type="number" dataKey="z" range={[40, 360]} name="firings" />
                      <ReferenceLine y={50} stroke={OKABE.grey} strokeDasharray="4 3" />
                      <Tooltip
                        {...TOOLTIP}
                        content={({ payload }) => {
                          const point = payload?.[0]?.payload as (typeof scatter)[number] | undefined;
                          if (!point) return null;
                          return (
                            <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                              <div className="font-semibold">{point.name} · {point.type.replace("_", " ")}</div>
                              <div>{fmtInt(point.x)} firings needed a trend</div>
                              <div>context held {point.y.toFixed(1)}% · {fmtInt(point.firings)} firings in all</div>
                            </div>
                          );
                        }}
                      />
                      {scatterClasses.map((name) => {
                        const style = CLASS_STYLE[name] ?? FALLBACK_STYLE;
                        return (
                          <Scatter key={name} name={name} data={scatter.filter((point) => point.type === name)} fill={style.color} shape={style.shape} isAnimationActive={false}>
                            {controls.labelPoints && <LabelList dataKey="name" position="top" fill="#d4d4d4" fontSize={9} formatter={(value: unknown) => String(value).replace(/^CDL/, "")} />}
                          </Scatter>
                        );
                      })}
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>

            <Section title={`The eight numbers for ${pattern}`} question={`Six columns of the ${fmtInt(firings.length)} firings under this filter: count, mean, median, standard deviation, skewness, excess kurtosis, 25th and 75th percentiles, minimum and maximum.`}>
              {firings.length === 0 ? (
                <Empty>No firings under this filter.</Empty>
              ) : (
                <SummaryTable
                  columns={STAT_COLUMNS.map((column) => ({
                    name: column.name,
                    decimals: column.decimals,
                    summary: eightNumberSummary(firings.map(column.pick).filter((value): value is number => value !== null)),
                  }))}
                />
              )}
            </Section>

            <Section title={`Every column of the ${pattern} firings`}>
              <ColumnGrid rows={numericRows(firings)} title={`${pattern} firings`} />
            </Section>

            <Section title="Every column of the 61-pattern context table">
              <ColumnGrid rows={data.contextRows} title="Patterns" />
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
