/**
 * §14 · Trading AT the zones: what happens at the first touch of a zone, against a matched null, the 600
 * arithmetic at the zones, rounds 12 and 13, and one session's touches and trades.
 */

import {
  ControlBar, Empty, Finding, FormulaCard, OKABE, Section, SegmentControl, SelectControl, SliderControl, StudyNotes, StudyState, fmt, fmtInt, fmtPercent,
} from "@/studies/kit";
import type { Row, ZonesBody, ZonesSessionBody } from "@shared/studies/ta-strategy-600-ticks";
import { useState } from "react";
import {
  BLACK, DataTable, RefreshViews, GroupedBars, HBarChart, Key, ProfileGrid, SeriesLines, SessionChart, SubHeading, asNumber, useTa, type Mark, type VerticalBar,
} from "./common";
import { tradeMarks } from "./CascadeTab";
import type { TabProps } from "./controls";

const ROUND_TWELVE_TEMPLATES = ["zone_bounce", "zone_touch_unconfirmed", "zone_bounce_rth", "zone_to_zone", "zone_to_zone_bounce_exit", "zone_bounce_rsi",
  "zone_bounce_calm", "zone_bounce_higher_timeframe", "zone_break_control"];
const OUTCOME_COLOUR: Record<string, string> = { bounced: OKABE.orange, broke: OKABE.blue, "timed out": BLACK, "gapped through": OKABE.purple };
/** A letter beside each touch repeats the outcome, so no outcome rests on colour alone. */
const OUTCOME_LETTER: Record<string, string> = { bounced: "B", broke: "X", "timed out": "T", "gapped through": "G" };

export function ZonesTab({ controls, set, overview }: TabProps) {
  const [nonce, setNonce] = useState<number | undefined>(undefined);
  const query = useTa<ZonesBody>("zones", { symbol: controls.zoneMarket, bins: controls.bins, nonce });
  const body = query.data?.data;
  const summary = body?.summary ?? [];
  const conditions = [...new Set(summary.map((row) => String(row.condition)))].filter((name) => !["all", "strength_trend", "gapped_through"].includes(name)).sort();
  const condition = conditions.includes(controls.condition) ? controls.condition : (conditions[0] ?? "strength_bucket");
  const bounce = controls.outcome === "bounce";
  const [lift, low, high, pValue, survives] = bounce
    ? ["lift_over_matched_random", "lift_bootstrap_low", "lift_bootstrap_high", "lift_bootstrap_p", "survives_benjamini_hochberg_q10"]
    : ["reach_lift_over_matched_random", "reach_lift_bootstrap_low", "reach_lift_bootstrap_high", "reach_lift_bootstrap_p", "reach_survives_benjamini_hochberg_q10"];
  const [rate, nullRate] = bounce ? ["bounce_rate", "null_bounce_rate"] : ["next_zone_reach_rate", "null_next_zone_reach_rate"];
  const rows = summary.filter((row) => row.condition === condition);
  const all = summary.find((row) => row.condition === "all");
  const trend = summary.find((row) => row.condition === "strength_trend");
  const gapped = summary.find((row) => row.condition === "gapped_through");
  const leak = body?.leak ?? [];
  const leaky = leak.find((row) => row.arm === "leaky");
  const honest = leak.find((row) => row.arm === "honest");
  const stats = body?.touchStatistics;
  const perDay = stats && stats.sessionDays ? stats.resolvedTouches / stats.sessionDays : 0;
  const net = controls.netPerTrade;
  const needed = overview.goalTicks / net;
  const bounceSurvivors = summary.filter((row) => row.survives_benjamini_hochberg_q10 === true).length;
  const reachSurvivors = summary.filter((row) => row.reach_survives_benjamini_hochberg_q10 === true).length;

  return (
    <div className="space-y-3">
      <Section title="14 · Trading AT the zones: what happens at the first touch"
        question="Every zone of the multi-timeframe map (prior session / RTH / week levels, opening ranges, round numbers, 15m / 1h / 4h fractals, 5m / 15m / 30m swings, VWAP bands, merged per 5m bar; strength = distinct families) is watched on the 1-minute path. A touch is the first minute whose low enters the support zone from above (mirror at resistance), with the zone known at the previous bar's close. Bounce = price moved 1 ATR away before a close through the far edge; next zone reached = the opposing zone's near edge came first. The lift is each rate minus the same test on a pseudo level at the same distance and time of day in a random other session.">
        <ControlBar>
          <SegmentControl label="Market" value={controls.zoneMarket} options={["MNQ", "NQ"].map((value) => ({ value, label: value }))} onChange={(value) => set("zoneMarket", value)} />
          <SelectControl label="Condition" value={condition} options={conditions.map((value) => ({ value, label: value }))} onChange={(value) => set("condition", value)} />
          <SegmentControl label="Outcome" value={controls.outcome} options={[{ value: "bounce", label: "bounce" }, { value: "next zone reached", label: "next zone reached" }]} onChange={(value) => set("outcome", value)} />
        </ControlBar>
      </Section>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        <RefreshViews notes={query.data?.notes ?? []} onRefreshed={setNonce} />
        {!body || body.recipe === "" ? <Empty>The zone-touch study has not landed.</Empty> : (
          <>
            <Section title={`Lift over the matched null by ${condition} (${controls.zoneMarket})`}
              question="Bar = lift (orange ▲ positive, blue ▼ negative), whisker = session-block bootstrap 95%, black ◆ = survives Benjamini-Hochberg at q = 0.10, ● = does not.">
              {all && (
                <Finding>
                  Pooled: {fmtInt(asNumber(all.touches))} first touches in {fmtInt(asNumber(all.sessions))} sessions ({fmt(asNumber(all.touches_per_session_day), 1)} a session day);
                  bounce {fmt(asNumber(all.bounce_rate), 3)} vs null {fmt(asNumber(all.null_bounce_rate), 3)}, lift {fmt(asNumber(all.lift_over_matched_random), 3)} [{fmt(asNumber(all.lift_bootstrap_low), 3)}, {fmt(asNumber(all.lift_bootstrap_high), 3)}];
                  next zone reached {fmt(asNumber(all.next_zone_reach_rate), 3)} vs null {fmt(asNumber(all.null_next_zone_reach_rate), 3)}, lift {fmt(asNumber(all.reach_lift_over_matched_random), 3)} [{fmt(asNumber(all.reach_lift_bootstrap_low), 3)}, {fmt(asNumber(all.reach_lift_bootstrap_high), 3)}].
                  Cells tested {fmtInt(asNumber(all.cells_tested))}; bounce lifts surviving Benjamini-Hochberg at q = 0.10: {bounceSurvivors}; reach lifts: {reachSurvivors}.
                  {trend && ` Strength trend (Spearman over the strength buckets' lifts): rho ${fmt(asNumber(trend.lift_over_matched_random), 2)}, p ${fmt(asNumber(trend.lift_bootstrap_p), 2)}.`}
                  {gapped && ` Gap-throughs (excluded): ${fmtInt(asNumber(gapped.touches))}.`}
                  {leaky && honest && ` Leaky control (zones of the touch bar applied to its own minutes): bounce ${fmt(asNumber(leaky.bounce_rate), 3)} vs honest ${fmt(asNumber(honest.bounce_rate), 3)}, so the honest arm is not leaking.`}
                </Finding>
              )}
              <div className="grid gap-3 xl:grid-cols-2">
                <GroupedBars bars={rows.map((row) => ({
                  category: String(row.value), group: "lift", value: asNumber(row[lift]), low: asNumber(row[low]), high: asNumber(row[high]),
                  marker: { glyph: row[survives] === true ? "diamond" : "circle", at: asNumber(row[high]) },
                  tooltip: `${String(row.value)}: ${fmtInt(asNumber(row.touches))} touches in ${fmtInt(asNumber(row.sessions))} sessions · rate ${fmt(asNumber(row[rate]), 3)} vs null ${fmt(asNumber(row[nullRate]), 3)} · lift ${fmt(asNumber(row[lift]), 3)} [${fmt(asNumber(row[low]), 3)}, ${fmt(asNumber(row[high]), 3)}] · p ${fmt(asNumber(row[pValue]), 3)} · ${row[survives] === true ? "survives Benjamini-Hochberg at q = 0.10" : "does not survive"} · break-even ${fmt(asNumber(row.break_even_hit_rate_zone_to_zone_median), 3)}`,
                }))} groups={["lift"]} colourOf={() => OKABE.orange} signColoured yLabel={`${controls.outcome}: lift over the matched null`} height={280} />
                <RateDots rows={rows} rate={rate} nullRate={nullRate} />
              </div>
              <Finding>Right: the observed rate (orange ●), the matched null (black ×) and the break-even hit rate of the zone-to-zone bracket, p* = (S + 6.56) / (S + T + 1) with S = zone width + buffer and T = the distance to the next zone, in ticks (vermillion ▼). The bracket pays only where the orange dot sits above the vermillion triangle.</Finding>
              <DataTable rows={rows} />
            </Section>

            <Section title={`The 600 arithmetic at the zones (${controls.zoneMarket}): drag the net per trade`}>
              <ControlBar>
                <SliderControl label="Net ticks a trade the entry would have to average" value={net} min={1} max={60} onChange={(value) => set("netPerTrade", value)} />
              </ControlBar>
              <FormulaCard
                tex={`\\text{trades needed} = \\frac{600}{\\overline{\\text{net}}} = \\frac{600}{${net}} = ${needed.toFixed(0)} \\qquad \\text{ceiling} = \\text{touches a day} \\times \\overline{\\text{net}} = ${fmt(perDay, 1)} \\times ${net} = ${fmt(perDay * net, 0)}`}
                symbols={[
                  { tex: "\\overline{\\text{net}}", name: `average net ticks a trade after the ${fmt(overview.costTicks, 2)}-tick round trip`, value: String(net) },
                  { tex: "\\text{trades needed}", name: "trades a day at that average to reach 600", value: needed.toFixed(0) },
                  { tex: "\\text{touches a day}", name: "resolved first touches per session day (gap-throughs excluded)", value: `${fmt(perDay, 1)} (${fmtInt(stats?.resolvedTouches)} over ${fmtInt(stats?.sessionDays)} days)` },
                  { tex: "\\text{ceiling}", name: "what trading every touch at that average would total", value: `${fmt(perDay * net, 0)} ticks/day` },
                ]}
              />
              <Finding>
                The best excursion before the zone broke exceeded the cost on {fmtPercent(stats?.shareOfTouchesPayingCost ?? null)} of touches (median {fmt(stats?.favourableTicksMedian ?? null, 0)} ticks),
                so the oracle ceiling below (exit at that best price, skip the rest, pay every cost) is the most any zone strategy could earn.
              </Finding>
              <GroupedBars bars={summary.filter((row) => ["all", "strength_bucket", "session_part"].includes(String(row.condition))).map((row) => ({
                category: `${String(row.condition) === "all" ? "" : `${String(row.condition)}: `}${String(row.value)}`, group: "oracle", value: asNumber(row.oracle_zone_to_zone_ticks_per_session_day),
                tooltip: `${String(row.condition)} ${String(row.value)}: ${fmtInt(asNumber(row.oracle_zone_to_zone_ticks_per_session_day))} oracle ticks/day · ${fmtInt(asNumber(row.touches))} touches · median favourable ${fmt(asNumber(row.favourable_ticks_median), 0)}`,
              }))} groups={["oracle"]} colourOf={() => OKABE.sky} yLabel="oracle ticks per session day" height={240}
                references={[{ value: overview.goalTicks, colour: OKABE.vermillion, label: "600", dash: "6 3" }]} />
              <SubHeading>Every column of the touch table, and its eight numbers (resolved touches, gap-throughs excluded)</SubHeading>
              <ProfileGrid profiles={body.profiles} title="Zone touches" rowCount={stats?.resolvedTouches} bins={controls.bins} onBins={(value) => set("bins", value)} />
            </Section>

            <Section title="Rounds 12 and 13: the zone strategies and the swings-only control, tuned on prior years, tested 2022-2025"
              question="Bounce, unconfirmed touch, zone-to-zone, bounce exit, RSI / calm / higher-timeframe confirmations, the breakout control, and round 13's swings-only zones. Bar = net (orange ▲ / blue ▼), black ◆ = excess over matched random entries with the same stop and target geometry, vermillion dashed = 600.">
              <HBarChart rows={[...body.roundsTwelveThirteen.templates].sort((a, b) => (asNumber(b.net_ticks_per_session_day) ?? 0) - (asNumber(a.net_ticks_per_session_day) ?? 0)).map((row) => {
                const value = asNumber(row.net_ticks_per_session_day);
                return {
                  label: `${String(row.template)} (round ${String(row.round)})`, bars: [{ value, colour: (value ?? 0) >= 0 ? OKABE.orange : OKABE.blue, name: "net ticks per session day" }],
                  marks: [{ value: asNumber(row.excess_ticks_per_session_day), glyph: "diamond", colour: BLACK, name: "excess over matched random" }],
                  tooltip: `${String(row.template)}: net ${fmt(value, 1)} · ${fmt(asNumber(row.trades_per_session_day), 2)} trades/day · net/trade ${fmt(asNumber(row.net_ticks_per_trade), 2)} · excess ${fmt(asNumber(row.excess_ticks_per_session_day), 1)} (Newey-West t ${fmt(asNumber(row.excess_newey_west_t), 2)}) · win rate ${fmt(asNumber(row.win_rate), 3)} · profit factor ${fmt(asNumber(row.profit_factor), 2)}`,
                };
              })} references={[{ value: overview.goalTicks, colour: OKABE.vermillion, label: "600", dash: "6 3" }, { value: 0, colour: "#737373", label: "" }]}
                xLabel="stitched out-of-sample net ticks per session day (2022-2025)" rowHeight={18} labelWidth={260} />
              <SeriesLines set={body.roundsTwelveThirteen.cumulative} yLabel="cumulative net ticks, 1 contract" height={280} />
              <DataTable rows={body.roundsTwelveThirteen.templates} />
            </Section>

            <ZoneSession days={body.sessionDays} controls={controls} set={set} overview={overview} />
          </>
        )}
      </StudyState>
    </div>
  );
}

function RateDots({ rows, rate, nullRate }: { rows: Row[]; rate: string; nullRate: string }) {
  return (
    <div className="min-w-0">
      <Key items={[{ label: "observed rate", colour: OKABE.orange, glyph: "circle" }, { label: "matched null", colour: BLACK, glyph: "cross" }, { label: "break-even hit rate", colour: OKABE.vermillion, glyph: "triangle-down" }]} />
      <HBarChart domain={[0, 1]} rows={rows.map((row) => ({
        label: String(row.value),
        marks: [
          { value: asNumber(row[rate]), glyph: "circle", colour: OKABE.orange, name: rate },
          { value: asNumber(row[nullRate]), glyph: "cross", colour: BLACK, name: nullRate },
          { value: asNumber(row.break_even_hit_rate_zone_to_zone_median), glyph: "triangle-down", colour: OKABE.vermillion, name: "break-even hit rate (median)" },
        ],
      }))} xLabel="probability" rowHeight={22} labelWidth={110} />
    </div>
  );
}

function ZoneSession({ days, controls, set }: TabProps & { days: string[] }) {
  const day = days.includes(controls.zoneDay) ? controls.zoneDay : (days[Math.max(0, days.length - 60)] ?? "");
  const query = useTa<ZonesSessionBody>("zones_session", { symbol: controls.zoneMarket, day, template: controls.zoneTemplate }, day !== "");
  const body = query.data?.data;
  const touches = body?.touches ?? [];
  const outcomeOf = (row: Row) => (row.gapped_through ? "gapped through" : row.bounced ? "bounced" : row.broke ? "broke" : "timed out");
  const verticals: VerticalBar[] = touches.map((row) => ({
    x: asNumber(row.timestamp) ?? 0, y0: asNumber(row.near_edge) ?? 0, y1: asNumber(row.far_edge) ?? 0,
    colour: row.side_name === "support" ? OKABE.blue : OKABE.orange, width: 6, opacity: 0.35,
  }));
  const touchMarks: Mark[] = touches.map((row) => ({
    x: asNumber(row.timestamp) ?? 0, y: asNumber(row.near_edge) ?? 0, glyph: asNumber(row.side) === 1 ? "triangle-up" : "triangle-down",
    colour: OUTCOME_COLOUR[outcomeOf(row)] ?? BLACK, size: 5, label: OUTCOME_LETTER[outcomeOf(row)],
    tooltip: `${new Date(asNumber(row.timestamp) ?? 0).toISOString().slice(11, 16)} ${String(row.side_name)} · ${outcomeOf(row)} · strength ${fmt(asNumber(row.strength), 0)} · ${String(row.families ?? "")} · near edge ${fmt(asNumber(row.near_edge), 2)} · favourable ${fmt(asNumber(row.favourable_ticks), 0)} · next zone ${fmt(asNumber(row.next_zone_distance_ticks), 0)} ticks · break-even ${fmt(asNumber(row.break_even_hit_rate_zone_to_zone), 2)} · reached next zone ${String(row.reached_next_zone)}`,
  }));
  const marks = [...touchMarks, ...tradeMarks(body?.trades ?? [], true)];
  return (
    <Section title={`Session ${day || "—"} (${controls.zoneMarket}): every first touch of a zone and the round-12 trades`}
      question="▲ support, ▼ resistance at the zone's near edge; the thick bar is the zone (blue support, orange resistance); glyph colour and the letter beside it are the outcome (B bounced, X broke, T timed out, G gapped through). Hollow ▲/▼ with + / − are the chosen template's entries (won / lost), × its exits. Hover a touch for its families, strength, room to the next zone and break-even.">
      <ControlBar>
        <SelectControl label="Session day" value={day || "—"} options={(days.length ? [...new Set([...days.slice(-400), day])] : ["—"]).map((value) => ({ value, label: value }))} onChange={(value) => set("zoneDay", value)} />
        <SliderControl label="Step the session day" value={Math.max(0, days.indexOf(day))} min={0} max={Math.max(0, days.length - 1)} onChange={(value) => set("zoneDay", days[value] ?? "")} format={(value) => days[value] ?? "—"} />
        <SelectControl label="Round-12 trades to mark" value={controls.zoneTemplate} options={ROUND_TWELVE_TEMPLATES.map((value) => ({ value, label: value }))} onChange={(value) => set("zoneTemplate", value)} />
      </ControlBar>
      <Key items={[
        ...Object.entries(OUTCOME_COLOUR).map(([label, colour]) => ({ label: `${OUTCOME_LETTER[label]} = ${label}`, colour, glyph: "triangle-up" as const })),
        { label: "support zone", colour: OKABE.blue, glyph: "square" }, { label: "resistance zone", colour: OKABE.orange, glyph: "square" },
        { label: "trade entry (hollow)", colour: "#a3a3a3", glyph: "triangle-up", filled: false }, { label: "exit", colour: BLACK, glyph: "cross" },
      ]} />
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        <SessionChart line={(body?.minutes ?? []).map((row) => ({ t: asNumber(row.timestamp) ?? 0, v: asNumber(row.close) ?? 0 }))} verticals={verticals} marks={marks} height={420} yLabel="close (back-adjusted points)" />
        <DataTable rows={touches} caption={`${touches.length} touches this session.`} />
      </StudyState>
    </Section>
  );
}
