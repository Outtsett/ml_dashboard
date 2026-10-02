/**
 * Section 10: were the same market conditions there every time a pattern
 * formed? Two things get called "conditions": the shape rule (met every time
 * by construction, so the question is by how much: clause headroom), and the
 * market around the pattern (which TA-Lib never looks at: ten features at the
 * last bar before the pattern's first candle, firings against every bar).
 */

import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SelectControl, Stat, StudyNotes, StudyState, TOOLTIP, fmt, fmtInt, fmtPercent, fmtTime, useStudyQuery,
} from "@/studies/kit";
import {
  patternLabel, type ConditionsBody, type ConsistencyRow, type FiringBody, type FiringsPageBody, type FormationBody, type TrendOutcomeRow, type TrendShareRow,
} from "@shared/studies/indicator-study";
import { timeframeOf } from "./controls";
import type { TabProps } from "./Page";
import {
  ChoiceControl, CommitSlider, DataTable, DotWhisker, LegendRow, MatrixCanvas, MiniHistogram, Readout, cividisColor, columnsOf, divergingColor, uniformEdges,
  type GlyphShape, type WhiskerRow,
} from "./widgets";
import { useState } from "react";

const GRADE_GLYPH: Record<string, GlyphShape> = {
  tight: "diamond",
  narrower: "square",
  "shifted 5+ points": "triangle-up",
  "shifted under 5 points": "triangle-down",
};

const STATISTICS = [
  { value: "middle_half_width_percentile_points", label: "width of the middle half" },
  { value: "location_shift_percentile_points", label: "location shift" },
  { value: "mean_difference_in_all_bar_standard_deviations", label: "mean difference in every-bar standard deviations" },
] as const;

function has<K extends string>(data: unknown, key: K): data is Record<K, unknown> {
  return typeof data === "object" && data !== null && key in data;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function show(value: number | null | undefined, digits = 3, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "null (context window crosses the roll, or warm-up)";
  return `${signed && value > 0 ? "+" : ""}${fmt(value, digits)}`;
}

// ── 10 · header, tiles and the chosen firing ────────────────────────────────

function Tiles({ tiles, timeframe }: { tiles: NonNullable<ConditionsBody["tiles"]>; timeframe: string }) {
  const graded = Object.entries(tiles.grades).filter(([grade]) => grade !== "too few firings").reduce((total, [, count]) => total + count, 0);
  return (
    <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
      <Stat label={`${timeframe} firings`} value={fmtInt(tiles.firingCount)} hint={`${tiles.patternCount} patterns; clause headroom for ${fmtInt(tiles.firingsWithClauseHeadroom)} of them`} />
      <Stat label="pattern × feature pairs narrower than any bar" value={`${(tiles.grades.tight ?? 0) + (tiles.grades.narrower ?? 0)} of ${graded}`} hint={`${tiles.grades.tight ?? 0} tight (≤ 25 points), ${tiles.grades.narrower ?? 0} narrower (≤ 35), q < 0.10`} />
      <Stat label="shifted 5+ points / under 5" value={`${tiles.grades["shifted 5+ points"] ?? 0} / ${tiles.grades["shifted under 5 points"] ?? 0}`} hint="the average moves off 50, the spread does not narrow" />
      <Stat label="textbook prior trend: firings vs any bar" value={`${fmtPercent(tiles.medianShare)} vs ${fmtPercent(tiles.medianBase)}`} hint={`median over ${tiles.trendShareGraded} pattern-sign × definition rows; ${tiles.trendShareAbove} above, ${tiles.trendShareBelow} below any bar at q < 0.10`} />
      <Stat label="hit rates changed by that trend" value={`${tiles.outcomesChanged} of ${tiles.outcomesTested}`} hint="with against without it, q < 0.10" />
    </div>
  );
}

export function ConditionsTab({ controls, set, overview }: TabProps) {
  const timeframe = timeframeOf(controls);
  const patterns = overview?.formationPatterns ?? [];
  const chosenKey = patterns.some((row) => `${row.column_name}|${row.signal_side}` === controls.formationPattern)
    ? controls.formationPattern
    : patterns.some((row) => `${row.column_name}|${row.signal_side}` === "candlestick_hammer|positive")
      ? "candlestick_hammer|positive"
      : patterns[0] ? `${patterns[0].column_name}|${patterns[0].signal_side}` : controls.formationPattern;
  const [column = "", side = "positive"] = chosenKey.split("|");
  const features = overview?.marketFeatures ?? [];

  const conditionsQuery = useStudyQuery<unknown>("indicator-study", { part: "conditions", timeframe, horizon: controls.horizon, trendDefinition: controls.trendDefinition });
  const conditions = has(conditionsQuery.data?.data, "cells") ? (conditionsQuery.data.data as unknown as ConditionsBody) : null;
  const formationQuery = useStudyQuery<unknown>("indicator-study", {
    part: "formation", timeframe, pattern: column, side, bins: controls.bins, view: controls.view, band: controls.band, legendFeature: controls.legendFeature,
  }, { enabled: column !== "" });
  const formation = has(formationQuery.data?.data, "clauses") ? (formationQuery.data.data as unknown as FormationBody) : null;
  const firingCount = formation?.firingCount ?? 1;
  const occurrence = Math.min(Math.max(1, controls.firing > 0 ? controls.firing : (formation?.firstCompleteFiring ?? 1)), Math.max(1, firingCount));
  const firingQuery = useStudyQuery<unknown>("indicator-study", { part: "firing", timeframe, pattern: column, side, occurrence, legendFeature: controls.legendFeature }, { enabled: formation !== null });
  const firing = has(firingQuery.data?.data, "clauseHeadroom") ? (firingQuery.data.data as unknown as FiringBody) : null;
  const row = firing?.firing ?? null;

  return (
    <div className="space-y-3">
      <Section title="10 · Were the same market conditions there every time a pattern formed?" question="Two things get called 'conditions', and they have opposite answers.">
        <div className="space-y-2">
          <Finding>
            <strong>The shape rule is met every time, by construction.</strong> TA-Lib fires only when every comparison in the pattern&apos;s C rule passes, so the question worth asking
            is by how much: each clause is re-expressed as a headroom, 0 meaning the bar sat exactly on the limit. The 59 rules without a confirmation state machine were
            transcribed clause by clause, and each transcription reproduces TA-Lib on every bar before it is used; the two hikkakes carry that state machine and are not
            transcribed. <strong>The market around it: TA-Lib never looks.</strong> No TA-Lib pattern tests the prior trend, volatility, volume or the time of day, so ten
            features are measured at the last bar before the pattern&apos;s first candle (a k-candle pattern ending at bar i is read at j = i − k) and the firings&apos; spread
            over each one is compared with every bar&apos;s, on each feature&apos;s percentile rank among all bars. Width 50 = no different from any bar; the null shifts the
            firing positions circularly along the series (every shift; 5,000 at 1 minute).
          </Finding>
          <StudyState isLoading={conditionsQuery.isLoading} error={conditionsQuery.error}>
            <StudyNotes notes={conditionsQuery.data?.notes ?? []} />
            {conditions?.tiles && <Tiles tiles={conditions.tiles} timeframe={timeframe} />}
          </StudyState>
          <ControlBar>
            <SelectControl
              label="Pattern and sign"
              value={chosenKey}
              options={patterns.map((entry) => ({ value: `${entry.column_name}|${entry.signal_side}`, label: `${patternLabel(entry.column_name)} · ${entry.signal_side} · ${fmtInt(entry.firing_count)} firings` }))}
              onChange={(value) => {
                set("formationPattern", value);
                set("firing", 0);
                set("firingsPage", 1);
              }}
            />
            <SelectControl label="Feature read in the formula" value={controls.legendFeature} options={features.map((feature) => ({ value: feature.feature_name, label: feature.feature_name }))} onChange={(value) => set("legendFeature", value)} />
            <ChoiceControl label="x axis" value={controls.view === "raw" ? "raw" : "rank"} options={[{ value: "rank", label: "percentile rank among all bars" }, { value: "raw", label: "feature values" }]} onChange={(value) => set("view", value)} />
            <CommitSlider label="Bins" value={controls.bins} min={10} max={60} step={5} onCommit={(value) => set("bins", value)} />
            <CommitSlider label={`Firing f, in time order (of ${fmtInt(firingCount)})`} value={occurrence} min={1} max={Math.max(2, firingCount)} onCommit={(value) => set("firing", value)} wide />
          </ControlBar>
          <StudyState isLoading={formationQuery.isLoading} error={formationQuery.error}>
            <StudyNotes notes={formationQuery.data?.notes ?? []} />
            {formation?.rule && row ? <RuleText formation={formation} firing={row} /> : <Empty>Pick a pattern that fires at this timeframe.</Empty>}
          </StudyState>
        </div>
      </Section>
      {formation && <HeadroomSection formation={formation} firing={firing} band={controls.band} onBand={(value) => set("band", value)} />}
      {formation && <MarketSection formation={formation} firing={firing} view={controls.view === "raw" ? "raw" : "rank"} occurrence={occurrence} contextStatistics={overview?.contextStatistics ?? []} features={features} timeframe={timeframe} />}
      <MapSection conditions={conditions} statistic={controls.mapStatistic} minimum={controls.minimumFirings} onStatistic={(value) => set("mapStatistic", value)} onMinimum={(value) => set("minimumFirings", value)} timeframe={timeframe} />
      <TrendSection
        conditions={conditions}
        definitions={overview?.trendDefinitions ?? []}
        definition={controls.trendDefinition}
        interval={controls.interval === "wilson" ? "wilson" : "day_block"}
        horizon={controls.horizon}
        onDefinition={(value) => set("trendDefinition", value)}
        onInterval={(value) => set("interval", value)}
        timeframe={timeframe}
      />
      <FiringsSection timeframe={timeframe} column={column} side={side} page={controls.firingsPage} onPage={(value) => set("firingsPage", value)} />
    </div>
  );
}

function RuleText({ formation, firing }: { formation: FormationBody; firing: Record<string, unknown> }) {
  const rule = formation.rule;
  if (!rule) return null;
  const trend = formation.side === "positive" ? rule.required_prior_trend_for_bullish_signal : rule.required_prior_trend_for_bearish_signal;
  return (
    <div className="space-y-1 rounded-md border border-neutral-800 bg-neutral-900/40 p-3 text-[12px] text-neutral-300">
      <p>
        <strong className="text-neutral-100">{rule.talib_function}</strong> — {rule.pattern_type}, {rule.candle_count} candle(s). Firing f: TA-Lib value{" "}
        {String(firing.signal_value)} at <strong>{fmtTime(num(firing.formation_timestamp))} UTC</strong> ({String(firing.session_eastern ?? "").replace(/_/g, " ")} session); context read at{" "}
        {fmtTime(num(firing.context_timestamp))} UTC, {String(firing.context_offset_bars)} bar(s) earlier.
      </p>
      <p className="text-neutral-400">What TA-Lib&apos;s C rule compares — every one passed on this bar, and on every firing:</p>
      <ul className="list-disc space-y-0.5 pl-5 font-mono text-[11px] text-neutral-200">
        {rule.shape_conditions.split(" | ").map((condition) => (
          <li key={condition}>{condition.trim()}</li>
        ))}
      </ul>
      <p>
        <strong>Textbook prior trend for this sign: {trend ?? "none"}.</strong> Does TA-Lib check it? <strong>{rule.talib_checks_prior_trend ? "yes" : "no"}.</strong>{" "}
        {rule.trend_check_detail}
      </p>
      {rule.catalogue_correction && <p className="text-neutral-400">Catalogue correction: {rule.catalogue_correction}</p>}
    </div>
  );
}

// ── 10.1 · clause headroom ──────────────────────────────────────────────────

function HeadroomSection({ formation, firing, band, onBand }: { formation: FormationBody; firing: FiringBody | null; band: number; onBand: (value: number) => void }) {
  const headroomOf = new Map((firing?.clauseHeadroom ?? []).map((entry) => [`${entry.rule_branch}|${entry.clause_name}`, entry.headroom]));
  return (
    <Section title="10.1 · The shape rule: how close each firing came to failing it" question="One panel per clause of the rule. Compare a clause with itself across firings, never one clause's number with another's: each is measured in its own scale.">
      <div className="space-y-2">
        <FormulaCard
          tex={"\\text{headroom} = \\frac{\\text{slack}}{\\text{scale}}"}
          symbols={[
            { tex: "\\text{slack}", name: "how far the bar was inside the limit: limit − measured for a ceiling, measured − limit for a floor", value: "index points" },
            { tex: "\\text{scale}", name: "the CandleSettings amount the clause compares against (e.g. the 10-bar average real body), or for a comparison between two prices the mean high − low range of the 10 bars before", value: "index points" },
            { tex: "\\text{headroom}", name: "0 = exactly on the limit; 1 = one whole threshold (or one average bar range) to spare", value: "ratio" },
            { tex: "b", name: "'barely passed' band: headroom below this", value: fmt(band, 2) },
          ]}
        />
        <ControlBar>
          <CommitSlider label="Barely passed = headroom below" value={band} min={0.01} max={0.5} step={0.01} format={(value) => value.toFixed(2)} onCommit={onBand} />
        </ControlBar>
        {formation.clauses.length === 0 ? (
          <Empty>This pattern&apos;s rule carries a confirmation state machine (hikkake) and is not transcribed clause by clause.</Empty>
        ) : (
          <>
            <LegendRow items={[{ label: "share of firings per headroom bin (top 1% folded into the last bin)", color: OKABE.vermillion, shape: "square" }, { label: "barely-passed band", color: OKABE.yellow, shape: "square" }, { label: "firing f", color: "#f5f5f5", dash: true }]} />
            <div className="grid gap-2 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4">
              {formation.clauses.map((clause) => {
                const current = headroomOf.get(`${clause.rule_branch}|${clause.clause_name}`) ?? null;
                return (
                  <MiniHistogram
                    key={`${clause.rule_branch}|${clause.clause_name}`}
                    title={`${clause.clause_name.replace(/_/g, " ")}  [${clause.rule_branch}]`}
                    subtitle={
                      <>
                        headroom below {band.toFixed(2)} (barely passed) on {fmtPercent(clause.barelyShare)} of {fmtInt(clause.valueCount)} firings; scale was 0 on {fmtPercent(clause.share_with_zero_scale)}
                        <br />
                        median {fmt(clause.headroom_median, 3)}, minimum {fmt(clause.headroom_minimum, 4)}; firing f {current === null ? "n/a" : fmt(current, 3)}
                      </>
                    }
                    edges={uniformEdges(0, clause.upper, 30)}
                    series={[{ heights: clause.bins, color: OKABE.vermillion, style: "fill", label: "share of firings" }]}
                    band={[0, Math.min(band, clause.upper)]}
                    rule={current === null ? null : Math.min(current, clause.upper)}
                    formatHeight={(value) => fmtPercent(value, 2)}
                    height={120}
                  />
                );
              })}
            </div>
            <DataTable
              rows={formation.clauses}
              rowKey={(clause) => `${clause.rule_branch}|${clause.clause_name}`}
              pageSize={8}
              columns={[
                { key: "rule_branch", label: "rule_branch", value: (clause) => clause.rule_branch },
                { key: "clause_name", label: "clause_name", value: (clause) => clause.clause_name },
                { key: "clause_description", label: "clause_description", value: (clause) => clause.clause_description },
                { key: "firing_count", label: "firing_count", value: (clause) => clause.firing_count, numeric: true },
                { key: "headroom_median", label: "headroom_median", value: (clause) => clause.headroom_median, numeric: true },
                { key: "headroom_percentile_25", label: "headroom_percentile_25", value: (clause) => clause.headroom_percentile_25, numeric: true },
                { key: "headroom_percentile_75", label: "headroom_percentile_75", value: (clause) => clause.headroom_percentile_75, numeric: true },
                { key: "headroom_minimum", label: "headroom_minimum", value: (clause) => clause.headroom_minimum, numeric: true },
                { key: "share_within_10_percent_of_limit", label: "share_within_10_percent_of_limit", value: (clause) => clause.share_within_10_percent_of_limit, numeric: true },
                { key: "share_within_1_percent_of_limit", label: "share_within_1_percent_of_limit", value: (clause) => clause.share_within_1_percent_of_limit, numeric: true },
                { key: "share_with_zero_scale", label: "share_with_zero_scale", value: (clause) => clause.share_with_zero_scale, numeric: true },
              ]}
            />
          </>
        )}
      </div>
    </Section>
  );
}

// ── 10.2 · firings against every bar ────────────────────────────────────────

function MarketSection({
  formation, firing, view, occurrence, contextStatistics, features, timeframe,
}: {
  formation: FormationBody; firing: FiringBody | null; view: "rank" | "raw"; occurrence: number;
  contextStatistics: NonNullable<TabProps["overview"]>["contextStatistics"]; features: NonNullable<TabProps["overview"]>["marketFeatures"]; timeframe: string;
}) {
  const row = firing?.firing ?? null;
  const legend = formation.legendFeature;
  const meta = features.find((feature) => feature.feature_name === legend);
  const consistency = formation.consistency.find((entry) => entry.feature_name === legend);
  const legendValue = num(row?.[legend]);
  const legendRank = num(row?.[`${legend}_percentile_rank_among_all_bars`]);
  const barI = num(row?.formation_bar_number);
  const offset = num(row?.context_offset_bars);
  const session = formation.session;
  const sessionFirst = session[0];
  const order = ["asia", "london", "us_regular", "us_late", "maintenance_halt"];
  const sessionRows = [...session].sort((a, b) => order.indexOf(a.session_eastern) - order.indexOf(b.session_eastern));
  return (
    <Section title="10.2 · The market around it: firings against every bar" question="Grey filled = every bar of the timeframe, vermillion outline = this pattern's firings, each as a share of its own total. On the percentile-rank axis every bar is flat by construction, so a condition the pattern selects shows up as an outline that piles into one place. The dashed white rule is firing f.">
      <div className="space-y-3">
        <LegendRow items={[{ label: "every bar", color: OKABE.grey, shape: "square" }, { label: "this pattern's firings", color: OKABE.vermillion, shape: "square", hollow: true }, { label: "firing f", color: "#f5f5f5", dash: true }]} />
        <div className="grid gap-2 grid-cols-1 md:grid-cols-2 2xl:grid-cols-5">
          {formation.features.map((panel) => {
            const scale = view === "rank" ? 100 : 1;
            const current = view === "rank" ? num(row?.[`${panel.feature_name}_percentile_rank_among_all_bars`]) : num(row?.[panel.feature_name]);
            const clipped = current === null ? null : Math.min(Math.max(current, panel.low), panel.high) * scale;
            return (
              <MiniHistogram
                key={panel.feature_name}
                title={panel.feature_name.replace(/_/g, " ")}
                subtitle={`width ${panel.width === null ? "n/a" : Math.round(panel.width)} · shift ${panel.shift === null ? "n/a" : `${panel.shift > 0 ? "+" : ""}${panel.shift.toFixed(1)}`} · ${panel.grade ?? "n/a"} · ${fmtInt(panel.firingCount)} firings of ${fmtInt(panel.allBarCount)} bars`}
                edges={uniformEdges(panel.low * scale, panel.high * scale, panel.allBarShares.length)}
                series={[
                  { heights: panel.allBarShares, color: OKABE.grey, style: "fill", label: "every bar" },
                  { heights: panel.firingShares, color: OKABE.vermillion, style: "outline", label: "firings" },
                ]}
                rule={clipped}
                formatEdge={(value) => fmt(value, view === "rank" ? 0 : 2)}
                formatHeight={(value) => fmtPercent(value, 2)}
                height={120}
              />
            );
          })}
        </div>
        <Finding>
          {view === "rank" ? "x axis: percentile rank among all bars, 0 to 100." : "x axis: the feature's own values, the outer 0.5% each side folded into the end bins."} Width 50 = spread like any bar; a grade needs q &lt; 0.10 across the whole table.
        </Finding>
        <FormulaCard
          tex={"u_j = \\frac{\\operatorname{rank}(x_j) - \\tfrac12}{N} \\qquad \\text{location} = 100\\left(\\frac{1}{m}\\sum_{f=1}^{m} u_{j_f} - \\frac12\\right) \\qquad \\text{width} = 100\\,\\big(Q_{0.75} - Q_{0.25}\\big)\\big(u_{j_1},\\dots,u_{j_m}\\big)"}
          caption={`Reading the two statistics with this pattern's numbers, for ${legend}. Drag firing f to walk the sum one firing at a time.`}
          symbols={[
            { tex: "x_j", name: `the feature at bar j: ${meta?.description ?? legend} (${meta?.units ?? ""})`, value: legend },
            { tex: "N", name: "bars where the feature exists", value: `${fmtInt(formation.legendAllBarCount)} ${timeframe} bars` },
            { tex: "\\operatorname{rank}(x_j)", name: "position of x_j among those N values, ties averaged", value: "1 … N" },
            { tex: "u_j", name: "percentile rank of bar j: uniform on 0 … 1 for an ordinary bar", value: "0 … 1" },
            { tex: "f", name: "firing index, in time order (the slider)", value: fmtInt(occurrence) },
            { tex: "i_f,\\ j_f", name: "firing f's last candle, and its context bar i_f − k", value: barI === null ? "—" : `${fmtInt(barI)} and ${fmtInt(barI - (offset ?? 0))}` },
            { tex: "x_{j_f}", name: "the feature at firing f's context bar", value: show(legendValue) },
            { tex: "u_{j_f}", name: "its percentile rank, × 100 = points", value: legendRank === null ? show(null) : fmt(legendRank * 100, 1) },
            { tex: "m", name: "firings where the feature exists", value: fmtInt(consistency?.firing_count_with_feature) },
            { tex: "\\sum_{f=1}^{m}", name: "sum over every firing; through f so far", value: `location ${show(firing?.prefix.location ?? null, 1, true)}, width ${show(firing?.prefix.width ?? null, 1)}` },
            { tex: "Q_{0.25},\\ Q_{0.75}", name: "25th and 75th percentile of the firings' u, points", value: `${show(consistency?.firing_percentile_rank_25, 1)} and ${show(consistency?.firing_percentile_rank_75, 1)}` },
            { tex: "\\text{location}", name: `average rank minus 50, percentile points (null 95th percentile of its size ${fmt(consistency?.location_shift_null_95th_percentile_absolute, 1)}, p ${fmt(consistency?.location_shift_permutation_p_value, 4)}, q ${fmt(consistency?.location_shift_benjamini_hochberg_q_value, 3)})`, value: show(consistency?.location_shift_percentile_points, 1, true) },
            { tex: "\\text{width}", name: `spread of the middle half, 50 = any bar (null median ${fmt(consistency?.middle_half_width_null_median, 1)}, null 5th percentile ${fmt(consistency?.middle_half_width_null_5th_percentile, 1)}, p ${fmt(consistency?.middle_half_width_permutation_p_value, 4)}, q ${fmt(consistency?.middle_half_width_benjamini_hochberg_q_value, 3)})`, value: show(consistency?.middle_half_width_percentile_points, 1) },
            { tex: "\\text{grade}", name: "tight ≤ 25, narrower ≤ 35, shifted 5+ / under 5 points, each with q < 0.10", value: consistency?.consistency_grade ?? "—" },
            { tex: "\\Delta\\bar x", name: "(firing mean − every-bar mean) ÷ every-bar standard deviation", value: show(consistency?.mean_difference_in_all_bar_standard_deviations, 2, true) },
          ]}
        />
        <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
          <div className="min-w-0">
            <p className="text-[11px] text-neutral-300">The sum over f = 1…m, one firing at a time: {legend} (grey rules at 0 and 50; white rule = firing f)</p>
            <LegendRow items={[{ label: "location (points from 50)", color: OKABE.orange }, { label: "width (points; 50 = any bar)", color: OKABE.sky, dash: true }]} />
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={formation.running} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="firings_so_far" type="number" domain={["dataMin", "dataMax"]} {...AXIS} label={{ value: "firings included, in time order (f)", position: "insideBottom", offset: -8, fill: "#bdbdbd", fontSize: 10 }} />
                <YAxis {...AXIS} tickFormatter={(value: number) => fmt(value, 0)} />
                <ReferenceLine y={0} stroke={OKABE.grey} strokeDasharray="2 2" />
                <ReferenceLine y={50} stroke={OKABE.grey} strokeDasharray="2 2" />
                <ReferenceLine x={occurrence} stroke="#f5f5f5" />
                <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 1), String(name)]} labelFormatter={(label) => `firings so far ${label}`} />
                <Line dataKey="location" name="location (points from 50)" stroke={OKABE.orange} dot={false} strokeWidth={1.6} isAnimationActive={false} />
                <Line dataKey="width" name="width (points; 50 = any bar)" stroke={OKABE.sky} strokeDasharray="6 3" dot={false} strokeWidth={1.6} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-neutral-300">
              Eastern session at the pattern&apos;s last candle{sessionFirst ? `: total variation distance ${fmt(sessionFirst.total_variation_distance, 3)}, null 95th percentile ${fmt(sessionFirst.total_variation_distance_null_95th_percentile, 3)}, p ${fmt(sessionFirst.total_variation_distance_permutation_p_value, 4)}, q ${sessionFirst.total_variation_distance_benjamini_hochberg_q_value === null ? "n/a (fewer than 20 firings)" : fmt(sessionFirst.total_variation_distance_benjamini_hochberg_q_value, 3)}` : ""}
            </p>
            <LegendRow items={[{ label: "this pattern's firings", color: OKABE.vermillion, shape: "square" }, { label: "every bar", color: OKABE.grey, shape: "square" }]} />
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={sessionRows} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid {...GRID} horizontal={false} />
                <XAxis type="number" {...AXIS} tickFormatter={(value: number) => fmtPercent(value, 0)} />
                <YAxis type="category" dataKey="session_eastern" width={110} {...AXIS} interval={0} />
                <Tooltip
                  {...TOOLTIP}
                  formatter={(value, name) => [fmtPercent(Number(value), 1), String(name)]}
                  labelFormatter={(label, payload) => {
                    const entry = payload?.[0]?.payload as { session_hours?: string; firing_count_in_session?: number } | undefined;
                    return `${label} (${entry?.session_hours ?? ""}) · ${fmtInt(entry?.firing_count_in_session)} firings`;
                  }}
                />
                <Bar dataKey="firing_share" name="this pattern's firings" fill={OKABE.vermillion} isAnimationActive={false} />
                <Bar dataKey="all_bar_share" name="every bar" fill={OKABE.grey} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold text-neutral-200">The ten context features over every bar at {timeframe}: the eight numbers</p>
          <DataTable
            rows={contextStatistics}
            rowKey={(entry) => entry.feature_name}
            pageSize={10}
            columns={[
              { key: "feature_name", label: "feature_name", value: (entry) => entry.feature_name },
              { key: "units", label: "units", value: (entry) => entry.units },
              ...(["finite_count", "mean", "median", "standard_deviation", "skewness", "excess_kurtosis", "percentile_25", "percentile_75", "minimum", "maximum"] as const).map((key) => ({
                key,
                label: key,
                value: (entry: (typeof contextStatistics)[number]) => entry[key],
                numeric: true,
                format: (value: unknown) => (key === "finite_count" ? fmtInt(value as number) : fmt(value as number | null, 4)),
              })),
            ]}
          />
        </div>
      </div>
    </Section>
  );
}

// ── 10.3 · every pattern at once ────────────────────────────────────────────

function MapSection({
  conditions, statistic, minimum, onStatistic, onMinimum, timeframe,
}: {
  conditions: ConditionsBody | null; statistic: string; minimum: number; onStatistic: (value: string) => void; onMinimum: (value: number) => void; timeframe: string;
}) {
  const [hover, setHover] = useState<{ row: number; column: number } | null>(null);
  const cells = (conditions?.cells ?? []).filter((cell) => cell.firing_count_with_feature >= minimum);
  const featureNames = [...new Set((conditions?.cells ?? []).map((cell) => cell.feature_name))];
  const rowKey = (cell: ConsistencyRow) => `${patternLabel(cell.column_name)} · ${cell.signal_side} · ${cell.firing_count}`;
  const narrowest = new Map<string, number>();
  for (const cell of cells) {
    const key = rowKey(cell);
    narrowest.set(key, Math.min(narrowest.get(key) ?? Infinity, cell.middle_half_width_percentile_points ?? Infinity));
  }
  const rows = [...narrowest.entries()].sort((a, b) => a[1] - b[1]).map(([key]) => key);
  const lookup = new Map(cells.map((cell) => [`${rowKey(cell)}|${cell.feature_name}`, cell]));
  const valueOf = (cell: ConsistencyRow) => num((cell as unknown as Record<string, unknown>)[statistic]);
  const colorOf = (value: number | null) => {
    if (value === null) return null;
    if (statistic === "middle_half_width_percentile_points") return cividisColor((value - 15) / 40);
    const limit = statistic === "location_shift_percentile_points" ? 20 : 0.6;
    return divergingColor(value / limit);
  };
  const gradeCounts = new Map<string, number>();
  for (const cell of cells) gradeCounts.set(cell.consistency_grade ?? "ungraded", (gradeCounts.get(cell.consistency_grade ?? "ungraded") ?? 0) + 1);
  const hovered = hover ? lookup.get(`${rows[hover.row]}|${featureNames[hover.column]}`) : undefined;
  return (
    <Section title="10.3 · Every pattern at once: which conditions, if any, repeat" question="One row per pattern and sign with at least the chosen number of firings, one column per feature. Colour is the chosen statistic; the black mark is its grade. Every grade needs a Benjamini-Hochberg q below 0.10 across the whole table. Rows are sorted by their narrowest cell.">
      <div className="space-y-2">
        <ControlBar>
          <ChoiceControl label="Colour" value={statistic} options={STATISTICS.map((entry) => ({ value: entry.value, label: entry.label }))} onChange={onStatistic} />
          <CommitSlider label="Minimum firings per row" value={minimum} min={20} max={1000} step={10} onCommit={onMinimum} />
        </ControlBar>
        <LegendRow
          items={[
            ...Object.entries(GRADE_GLYPH).map(([grade, shape]) => ({ label: grade, color: "#111111", shape })),
            statistic === "middle_half_width_percentile_points"
              ? { label: "cividis: 15 (dark, narrow) → 55 (light, like any bar)", color: cividisColor(0.2), shape: "square" as const }
              : { label: `blue − · white 0 · orange + (clamped at ±${statistic === "location_shift_percentile_points" ? 20 : 0.6})`, color: divergingColor(1), shape: "square" as const },
          ]}
        />
        <StudyState isLoading={false} error={null}>
          {rows.length > 0 ? (
            <div className="relative">
              <Finding>{timeframe}: {fmtInt(rows.length)} pattern-signs × {featureNames.length} features.</Finding>
              <MatrixCanvas
                rowLabels={rows}
                columnLabels={featureNames.map((name) => name.replace(/_/g, " "))}
                labelSpace={230}
                maximumCell={30}
                columnLabelSpace={200}
                cell={(r, c) => {
                  const cell = lookup.get(`${rows[r]}|${featureNames[c]}`);
                  if (!cell) return { color: null };
                  const grade = cell.consistency_grade ? GRADE_GLYPH[cell.consistency_grade] ?? null : null;
                  return { color: colorOf(valueOf(cell)) ?? "#333", glyph: grade };
                }}
                onHover={setHover}
              />
              {hovered && (
                <div className="absolute right-0 top-0 z-10">
                  <Readout
                    lines={[
                      `${rows[hover?.row ?? 0]} · ${hovered.feature_name}`,
                      `grade ${hovered.consistency_grade ?? "—"} · firings with the feature ${fmtInt(hovered.firing_count_with_feature)}`,
                      `width ${fmt(hovered.middle_half_width_percentile_points, 1)} (q ${fmt(hovered.middle_half_width_benjamini_hochberg_q_value, 3)})`,
                      `location ${fmt(hovered.location_shift_percentile_points, 1)} (q ${fmt(hovered.location_shift_benjamini_hochberg_q_value, 3)})`,
                      `mean difference ${fmt(hovered.mean_difference_in_all_bar_standard_deviations, 2)} sd`,
                      `firing median ${fmt(hovered.firing_median, 3)} · every-bar median ${fmt(hovered.all_bar_median, 3)}`,
                    ]}
                  />
                </div>
              )}
            </div>
          ) : (
            <Empty>No pattern reaches that many firings here.</Empty>
          )}
        </StudyState>
        <DataTable
          rows={[...gradeCounts.entries()].map(([grade, count]) => ({ grade, count }))}
          rowKey={(entry) => entry.grade}
          initialSort={{ key: "count", descending: true }}
          columns={[
            { key: "grade", label: "consistency_grade", value: (entry) => entry.grade },
            { key: "count", label: "pattern × feature pairs", value: (entry) => entry.count, numeric: true },
          ]}
        />
      </div>
    </Section>
  );
}

// ── 10.4 / 10.5 · the textbook prior trend ──────────────────────────────────

function TrendSection({
  conditions, definitions, definition, interval, horizon, onDefinition, onInterval, timeframe,
}: {
  conditions: ConditionsBody | null; definitions: NonNullable<TabProps["overview"]>["trendDefinitions"]; definition: string; interval: "day_block" | "wilson";
  horizon: number; onDefinition: (value: string) => void; onInterval: (value: string) => void; timeframe: string;
}) {
  const shares = [...(conditions?.shares ?? [])].sort((a, b) => (a.share_minus_all_bar_share ?? 0) - (b.share_minus_all_bar_share ?? 0));
  const lowerKey = `share_in_required_trend_${interval}_lower_95` as keyof TrendShareRow;
  const upperKey = `share_in_required_trend_${interval}_upper_95` as keyof TrendShareRow;
  const shareRows: WhiskerRow[] = shares.map((row) => ({
    key: `${row.column_name}|${row.signal_side}`,
    label: `${patternLabel(row.column_name)} · ${row.signal_side} (needs ${row.required_prior_trend}, ${row.firing_count_with_trend_label})`,
    value: row.share_in_required_trend,
    low: num(row[lowerKey]),
    high: num(row[upperKey]),
    color: row.claimed_direction === "up" ? OKABE.orange : OKABE.blue,
    shape: row.claimed_direction === "up" ? "triangle-up" : "triangle-down",
    ticks: row.all_bar_share_in_required_trend !== null ? [{ value: row.all_bar_share_in_required_trend, color: "#f5f5f5" }] : [],
    details: [
      `share in the required trend ${fmtPercent(row.share_in_required_trend)} [${fmtPercent(num(row[lowerKey]))}, ${fmtPercent(num(row[upperKey]))}]`,
      `every bar ${fmtPercent(row.all_bar_share_in_required_trend)} · permutation p ${fmt(row.permutation_p_value, 4)} · q ${fmt(row.share_benjamini_hochberg_q_value, 3)}`,
      `firings trending up ${fmtPercent(row.firing_share_up)}, none ${fmtPercent(row.firing_share_none)}, down ${fmtPercent(row.firing_share_down)}`,
    ],
  }));
  const outcomes = [...(conditions?.outcomes ?? [])].sort((a, b) => (a.hit_rate_difference_present_minus_absent ?? 0) - (b.hit_rate_difference_present_minus_absent ?? 0));
  const outcomeRows: WhiskerRow[] = outcomes.map((row) => ({
    key: `${row.column_name}|${row.signal_side}`,
    label: `${patternLabel(row.column_name)} · ${row.signal_side} (claims ${row.claimed_direction})`,
    value: row.hit_rate_context_present,
    low: row.hit_rate_context_present_day_block_lower_95,
    high: row.hit_rate_context_present_day_block_upper_95,
    color: OKABE.vermillion,
    shape: "diamond",
    second: { value: row.hit_rate_context_absent, low: row.hit_rate_context_absent_day_block_lower_95, high: row.hit_rate_context_absent_day_block_upper_95, color: OKABE.grey, shape: "circle", hollow: true },
    ticks: row.base_rate_in_claimed_direction !== null ? [{ value: row.base_rate_in_claimed_direction, color: "#f5f5f5" }] : [],
    details: [
      `textbook trend present: ${fmtPercent(row.hit_rate_context_present)} over ${fmtInt(row.firing_count_context_present)} firings [${fmtPercent(row.hit_rate_context_present_day_block_lower_95)}, ${fmtPercent(row.hit_rate_context_present_day_block_upper_95)}]`,
      `absent: ${fmtPercent(row.hit_rate_context_absent)} over ${fmtInt(row.firing_count_context_absent)} firings [${fmtPercent(row.hit_rate_context_absent_day_block_lower_95)}, ${fmtPercent(row.hit_rate_context_absent_day_block_upper_95)}]`,
      `every bar ${fmtPercent(row.base_rate_in_claimed_direction)} · difference p ${fmt(row.difference_day_block_p_value, 4)} · q ${fmt(row.difference_benjamini_hochberg_q_value, 3)}`,
    ],
  }));
  const current = definitions.find((entry) => entry.trend_definition === definition);
  const above = shares.filter((row) => (row.share_benjamini_hochberg_q_value ?? 1) < 0.1 && (row.share_minus_all_bar_share ?? 0) > 0).length;
  const changed = outcomes.filter((row) => (row.difference_benjamini_hochberg_q_value ?? 1) < 0.1).length;
  return (
    <>
      <Section title="10.4 · The textbook prior trend: was it there?" question="Reversal patterns are meant to follow the opposite trend, continuation patterns the same one. 'Trend' has no canonical window, so four definitions are kept. The white tick is the share of every bar in that trend: a pattern that really needs the trend should sit well to its right.">
        <div className="space-y-2">
          <FormulaCard
            tex={"z^{(N)}_j = \\frac{\\ln C_j - \\ln C_{j-N}}{\\hat\\sigma_j\\,\\sqrt{N}}"}
            caption="'Up' is z ≥ 1 (or ≥ 1.645), 'down' is z ≤ −1; the fourth definition is ADX(14) above 20 signed by +DI − −DI. The raw OLS slope t-statistic is not used: on a price series it grows with the window whether or not there is a trend."
            symbols={[
              { tex: "C_j", name: "close of the context bar j, index points", value: timeframe },
              { tex: "N", name: "lookback, 10 or 20 bars", value: current?.feature_name?.includes("10") ? "10" : current?.feature_name?.includes("20") ? "20" : "—" },
              { tex: "\\hat\\sigma_j", name: "standard deviation of the 1-bar log returns of bars j − 59 … j", value: "log return per bar" },
              { tex: "z^{(N)}_j", name: "the N-bar move in random-walk standard deviations (a driftless random walk gives N(0, 1))", value: current ? `threshold ${fmt(current.threshold, 3)}` : "—" },
            ]}
          />
          <ControlBar>
            <ChoiceControl label="Trend definition" value={definition} options={definitions.map((entry) => ({ value: entry.trend_definition, label: entry.description }))} onChange={onDefinition} />
            <ChoiceControl label="95% interval" value={interval} options={[{ value: "day_block", label: "trading-day block bootstrap" }, { value: "wilson", label: "Wilson" }]} onChange={onInterval} />
          </ControlBar>
          {shareRows.length > 0 ? (
            <>
              <Finding>
                {timeframe}, {current?.description ?? definition}: {fmtInt(shareRows.length)} pattern-signs with a textbook trend and at least 20 firings; {above} sit above every bar&apos;s share at q &lt; 0.10.
              </Finding>
              <LegendRow items={[{ label: "claims up", color: OKABE.orange, shape: "triangle-up" }, { label: "claims down", color: OKABE.blue, shape: "triangle-down" }, { label: "white tick = every bar", color: "#f5f5f5" }]} />
              <DotWhisker rows={shareRows} domain={[0, 0.6]} axisLabel="share of firings with the textbook prior trend" format={(value) => fmtPercent(value, 0)} labelWidth={280} />
              <DataTable
                rows={shares}
                rowKey={(row) => `${row.column_name}|${row.signal_side}`}
                initialSort={{ key: "permutation_p_value" }}
                pageSize={10}
                columns={(["column_name", "signal_side", "required_prior_trend", "firing_count_with_trend_label", "share_in_required_trend", String(lowerKey), String(upperKey), "all_bar_share_in_required_trend", "permutation_p_value", "share_benjamini_hochberg_q_value", "share_benjamini_yekutieli_q_value"] as Array<keyof TrendShareRow>).map((key) => ({
                  key: String(key),
                  label: String(key),
                  value: (row: TrendShareRow) => row[key] as string | number | null,
                  numeric: !["column_name", "signal_side", "required_prior_trend"].includes(String(key)),
                }))}
              />
            </>
          ) : (
            <Empty>No pattern with a textbook trend reaches 20 firings here.</Empty>
          )}
        </div>
      </Section>
      <Section title="10.5 · Does the pattern do better when the textbook trend was there?" question={`Hit rate = the share of firings whose close ${horizon} bar(s) later moved the way the pattern claims. Only rows with at least 20 firings on each side; the interval resamples whole trading days, because firings on one afternoon are not independent draws.`}>
        {outcomeRows.length > 0 ? (
          <div className="space-y-2">
            <Finding>{timeframe}, h = {horizon}: {fmtInt(outcomeRows.length)} pattern-signs tested; {changed} change hit rate with the trend at q &lt; 0.10.</Finding>
            <LegendRow items={[{ label: "textbook trend present", color: OKABE.vermillion, shape: "diamond" }, { label: "absent", color: OKABE.grey, shape: "circle", hollow: true }, { label: "white tick = every bar's rate in that direction", color: "#f5f5f5" }]} />
            <DotWhisker rows={outcomeRows} domain={[0.2, 0.8]} axisLabel={`hit rate in the claimed direction, ${horizon} bar(s) later`} format={(value) => fmtPercent(value, 0)} rowHeight={26} labelWidth={280} />
            <DataTable
              rows={outcomes}
              rowKey={(row) => `${row.column_name}|${row.signal_side}`}
              initialSort={{ key: "difference_day_block_p_value" }}
              pageSize={10}
              columns={([
                "column_name", "signal_side", "claimed_direction", "firing_count_context_present", "hit_rate_context_present", "firing_count_context_absent", "hit_rate_context_absent",
                "hit_rate_difference_present_minus_absent", "difference_day_block_lower_95", "difference_day_block_upper_95", "difference_day_block_p_value",
                "difference_benjamini_hochberg_q_value", "difference_benjamini_yekutieli_q_value", "base_rate_in_claimed_direction",
              ] as Array<keyof TrendOutcomeRow>).map((key) => ({
                key: String(key),
                label: String(key),
                value: (row: TrendOutcomeRow) => row[key] as string | number | null,
                numeric: !["column_name", "signal_side", "claimed_direction"].includes(String(key)),
              }))}
            />
          </div>
        ) : (
          <Empty>No pattern has 20 firings both with and without the trend here.</Empty>
        )}
      </Section>
    </>
  );
}

// ── every firing ────────────────────────────────────────────────────────────

function FiringsSection({ timeframe, column, side, page, onPage }: { timeframe: string; column: string; side: string; page: number; onPage: (value: number) => void }) {
  const query = useStudyQuery<unknown>("indicator-study", { part: "firings", timeframe, pattern: column, side, page }, { enabled: column !== "" });
  const body = has(query.data?.data, "rows") && has(query.data?.data, "pageSize") ? (query.data.data as unknown as FiringsPageBody) : null;
  const pages = body ? Math.max(1, Math.ceil(body.total / body.pageSize)) : 1;
  const timeFormat = (value: unknown) => fmtTime(num(value));
  return (
    <Section title={`Every firing of ${patternLabel(column)} · ${side}, with its context`} question="Paged in time order; the grid below graphs every numeric column of the page.">
      <StudyState isLoading={query.isLoading} error={query.error}>
        {body && body.rows.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-neutral-400">
              <button type="button" disabled={body.page <= 1} onClick={() => onPage(body.page - 1)} className="rounded border border-neutral-700 px-2 disabled:opacity-40">previous</button>
              <span>page {body.page} of {pages} · firings {fmtInt((body.page - 1) * body.pageSize + 1)} to {fmtInt(Math.min(body.total, body.page * body.pageSize))} of {fmtInt(body.total)}</span>
              <button type="button" disabled={body.page >= pages} onClick={() => onPage(body.page + 1)} className="rounded border border-neutral-700 px-2 disabled:opacity-40">next</button>
            </div>
            <DataTable rows={body.rows} columns={columnsOf(body.rows, { formation_timestamp: timeFormat, context_timestamp: timeFormat })} rowKey={(row, index) => `${String(row.formation_bar_number)}-${index}`} pageSize={body.pageSize} />
            <ColumnGrid rows={body.rows} exclude={["formation_bar_number", "formation_timestamp", "context_timestamp", "signal_value", "context_offset_bars"]} title="Every numeric column of this page of firings" />
          </div>
        ) : (
          <Empty>No firings.</Empty>
        )}
      </StudyState>
    </Section>
  );
}
