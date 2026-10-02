/**
 * §13 · Multi-timeframe cascade (1m -> 5m -> 15m -> 30m swing breaks), volume at levels, volatility indicators,
 * the delayed-oracle ceiling, round 10's cascade strategies, and one session drawn minute by minute.
 */

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Empty, Finding, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, StudyNotes, StudyState, TOOLTIP, fmt, fmtInt,
} from "@/studies/kit";
import type { CascadeBody, CascadeSessionBody, Row } from "@shared/studies/ta-strategy-600-ticks";
import {
  BLACK, ChipSelect, DataTable, GroupedBars, HBarChart, Key, SeriesLines, SessionChart, StripChart, SubHeading, asNumber, splitList, useTa, type Mark, type Segment,
} from "./common";
import type { TabProps } from "./controls";

const TIMEFRAME_COLOUR: Record<string, string> = { "1m": OKABE.sky, "5m": OKABE.blue, "15m": OKABE.orange, "30m": OKABE.vermillion };
const ROUND_TEN_TEMPLATES = ["cascade_trend", "cascade_trend_volume", "cascade_trend_momentum", "cascade_trend_momentum_cross", "cascade_trend_full",
  "cascade_trend_full_rth", "cascade_trend_rth", "cascade_aligned_control"];

export function CascadeTab({ controls, set, overview }: TabProps) {
  const query = useTa<CascadeBody>("cascade", { symbol: controls.cascadeMarket });
  const body = query.data?.data;
  const part = controls.sessionPart;
  const occupancy = (body?.occupancy ?? []).filter((row) => row.session_part === part && (row.state === "stage_up" || row.state === "stage_down"));
  const moves = (body?.moves ?? []).filter((row) => row.session_part === part && asNumber(row.horizon_minutes) === controls.horizon);
  const volume = (body?.volumeDeciles ?? []).filter((row) => row.session_part === part && row.measure === controls.volumeMeasure);
  const volatility = (body?.volatility ?? []).filter((row) => row.session_part === part);
  const oracle = body?.oracle ?? [];
  const bestMove = [...moves].sort((a, b) => (asNumber(b.mean_signed_move_ticks) ?? 0) - (asNumber(a.mean_signed_move_ticks) ?? 0))[0];

  return (
    <div className="space-y-3">
      <Section title="13 · Multi-timeframe cascade, volume at levels, volatility indicators"
        question="Swing levels (Williams fractals) on 1m, 5m, 15m and 30m bars, known only k bars after the swing. A 1-minute close through the 1m resistance, then the 5m, then the 15m, then the 30m (each at or above the last, within a window) is an UP cascade of that many stages; support breaks in that order are a DOWN cascade. Every state is causal (cascade.py).">
        <ControlBar>
          <SegmentControl label="Market" value={controls.cascadeMarket} options={["MNQ", "NQ"].map((value) => ({ value, label: value }))} onChange={(value) => set("cascadeMarket", value)} />
          <SegmentControl label="Session part" value={part} options={["all", "overnight", "regular_hours"].map((value) => ({ value, label: value }))} onChange={(value) => set("sessionPart", value)} />
          <SliderControl label="Horizon after the cascade (minutes)" value={controls.horizon} min={15} max={120} step={15} onChange={(value) => set("horizon", value)} />
        </ControlBar>
      </Section>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!body || body.recipe === "" ? <Empty>The cascade study has not landed.</Empty> : (
          <>
            <Section title={`Does the cascade point the way? (${controls.cascadeMarket}, ${part})`}
              question={`Left: how often each number of stages is on. Right: at the minute a cascade FIRST reaches each stage, the signed move over the next ${controls.horizon} minutes (bar), its session-block bootstrap 95% interval (whisker) and the unconditional drift in the same session part (black tick). A bar must clear the ${fmt(overview.costTicks, 2)}-tick cost and the black tick to matter. Recipe ${body.recipe}.`}>
              {bestMove && <Finding>Largest move: {String(bestMove.direction)} stage {String(bestMove.stage)}, {fmt(asNumber(bestMove.mean_signed_move_ticks), 1)} ticks [{fmt(asNumber(bestMove.bootstrap_low), 1)}, {fmt(asNumber(bestMove.bootstrap_high), 1)}] against a drift of {fmt(asNumber(bestMove.unconditional_mean_signed_move_ticks), 1)}, {fmt(asNumber(bestMove.events_per_session_day), 2)} events a day.</Finding>}
              <Key items={[{ label: "▲ up (stage_up)", colour: OKABE.orange, glyph: "triangle-up" }, { label: "▼ down (stage_down)", colour: OKABE.blue, glyph: "triangle-down" }, { label: "unconditional drift", colour: BLACK, glyph: "vtick" }]} />
              <div className="grid gap-3 xl:grid-cols-2">
                <GroupedBars bars={occupancy.map((row) => ({ category: `stage ${String(row.stage)}`, group: String(row.state), value: asNumber(row.share_of_minutes),
                  tooltip: `${String(row.state)} stage ${String(row.stage)}: ${fmt((asNumber(row.share_of_minutes) ?? 0) * 100, 2)}% of minutes` }))}
                  groups={["stage_up", "stage_down"]} colourOf={(group) => (group === "stage_up" ? OKABE.orange : OKABE.blue)} yLabel="share of minutes" percent height={240} />
                <GroupedBars bars={moves.map((row) => ({
                  category: `stage ${String(row.stage)}`, group: String(row.direction), value: asNumber(row.mean_signed_move_ticks),
                  low: asNumber(row.bootstrap_low), high: asNumber(row.bootstrap_high), tick: asNumber(row.unconditional_mean_signed_move_ticks),
                  tooltip: `${String(row.direction)} stage ${String(row.stage)}: ${fmt(asNumber(row.mean_signed_move_ticks), 1)} ticks [${fmt(asNumber(row.bootstrap_low), 1)}, ${fmt(asNumber(row.bootstrap_high), 1)}] · ${fmtInt(asNumber(row.events))} events (${fmt(asNumber(row.events_per_session_day), 2)}/day) · share positive ${fmt(asNumber(row.share_positive), 3)} · drift ${fmt(asNumber(row.unconditional_mean_signed_move_ticks), 1)}`,
                }))} groups={["up", "down"]} colourOf={(group) => (group === "up" ? OKABE.orange : OKABE.blue)} yLabel={`signed move over ${controls.horizon} minutes (ticks, + = with the cascade)`} height={260}
                  references={[{ value: overview.costTicks, colour: OKABE.vermillion, label: "cost", dash: "4 3" }]} />
              </div>
              <DataTable rows={body.levels} caption="Swing levels by timeframe." />
            </Section>

            <Section title="Do levels break or hold with the volume of the approach?"
              question="Orange: real break rate with its Wilson band; dashed black: the same tests with volume shuffled within each session, which keeps the session's volume and the level geometry and destroys only the minute-by-minute link. What the orange line adds over the dashed one is the information in volume.">
              <ControlBar>
                <SegmentControl label="Approach measure" value={controls.volumeMeasure} options={[{ value: "relative_volume", label: "relative volume" }, { value: "volume_trend", label: "volume trend" }]} onChange={(value) => set("volumeMeasure", value)} />
              </ControlBar>
              <Key items={[{ label: "break rate (real)", colour: OKABE.orange, dash: "" }, { label: "Wilson 95% band", colour: OKABE.orange, glyph: "square" }, { label: "volume shuffled", colour: BLACK, dash: "4 3" }]} />
              <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                {["1m", "5m", "15m", "30m"].map((timeframe) => {
                  const rows = volume.filter((row) => row.timeframe === timeframe).map((row) => ({ ...row, band: [asNumber(row.break_rate_wilson_low), asNumber(row.break_rate_wilson_high)] }));
                  return (
                    <div key={timeframe} className="min-w-0 rounded border border-neutral-800 p-1">
                      <div className="text-[10px] text-neutral-300">{timeframe}</div>
                      {rows.length === 0 ? <Empty>none</Empty> : (
                        <ResponsiveContainer width="100%" height={170}>
                          <ComposedChart data={rows} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                            <CartesianGrid {...GRID} />
                            <XAxis dataKey="decile" {...AXIS} />
                            <YAxis {...AXIS} width={36} domain={["auto", "auto"]} />
                            <Tooltip {...TOOLTIP} formatter={(value) => (Array.isArray(value) ? value.map((entry) => fmt(Number(entry), 3)).join(" – ") : fmt(Number(value), 3))} labelFormatter={(value) => `decile ${value}`} />
                            <Area dataKey="band" stroke="none" fill={OKABE.orange} fillOpacity={0.2} isAnimationActive={false} />
                            <Line dataKey="break_rate" stroke={OKABE.orange} dot={{ r: 2 }} isAnimationActive={false} />
                            <Line dataKey="shuffled_volume_break_rate" stroke={BLACK} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  );
                })}
              </div>
              <Finding>Correlation of each measure with breaking, and with the approach's own range (volume tracks range mechanically): the "given range" column is what survives once the range is taken out.</Finding>
              <DataTable rows={body.volumeSummary} />
            </Section>

            <Section title="Which volatility measure anticipates the next hour?" question="Spearman correlation with the outcome, with its session-block bootstrap 95% interval: the range of the next 60 minutes ÷ ATR, the range ahead in ticks, and the move in the cascade's direction ÷ ATR (follow-through, on minutes where a cascade is on).">
              <div className="grid gap-3 xl:grid-cols-3">
                {[...new Set(volatility.map((row) => String(row.outcome)))].map((outcome) => (
                  <div key={outcome} className="min-w-0">
                    <div className="text-[10px] text-neutral-300">{outcome}</div>
                    <HBarChart rows={volatility.filter((row) => row.outcome === outcome).sort((a, b) => (asNumber(b.spearman) ?? 0) - (asNumber(a.spearman) ?? 0)).map((row) => ({
                      label: String(row.measure), low: asNumber(row.spearman_bootstrap_low), high: asNumber(row.spearman_bootstrap_high),
                      marks: [{ value: asNumber(row.spearman), glyph: "circle", colour: OKABE.blue, name: "Spearman" }],
                      tooltip: `${String(row.measure)} → ${outcome}: ${fmt(asNumber(row.spearman), 3)} [${fmt(asNumber(row.spearman_bootstrap_low), 3)}, ${fmt(asNumber(row.spearman_bootstrap_high), 3)}] over ${fmtInt(asNumber(row.bars))} bars`,
                    }))} references={[{ value: 0, colour: BLACK, label: "0" }]} xLabel="Spearman (bootstrap 95%)" rowHeight={16} labelWidth={150} />
                  </div>
                ))}
              </div>
            </Section>

            <Section title="The delayed-oracle ceiling" question="Enter at each confirmed swing (causal), exit at the NEXT swing's exact price (hindsight), skip losers, pay every cost: the most cascade-style trading could earn. Vermillion dashed = 600.">
              <GroupedBars bars={["1m", "5m", "15m", "30m"].map((timeframe) => {
                const row = oracle.find((entry) => entry.timeframe === timeframe);
                return { category: timeframe, group: "ceiling", value: asNumber(row?.ceiling_net_ticks_per_session_day_mean),
                  tooltip: row ? `${timeframe}: mean ${fmtInt(asNumber(row.ceiling_net_ticks_per_session_day_mean))} · median ${fmtInt(asNumber(row.ceiling_net_ticks_per_session_day_median))} · ${fmt(asNumber(row.trades_per_session_day), 1)} trades/day · days ≥ 600 ${fmt((asNumber(row.share_of_session_days_at_or_above_600) ?? 0) * 100, 1)}% · capture needed ${fmt((asNumber(row.required_capture_share_for_600) ?? 0) * 100, 1)}%` : timeframe };
              })} groups={["ceiling"]} colourOf={() => OKABE.sky} yLabel="net ticks per session day" height={220}
                references={[{ value: overview.goalTicks, colour: OKABE.vermillion, label: "600", dash: "6 3" }]} />
              <DataTable rows={oracle} />
            </Section>

            <Section title="Round 10: the cascade strategies with volume, volatility and momentum confirmations, tuned on prior years, tested 2022-2025"
              question="Bar = net (orange ▲ positive, blue ▼ negative), black ◆ = excess over matched random, vermillion dashed = 600.">
              {body.roundTen.recipe ? (
                <>
                  <HBarChart rows={[...body.roundTen.templates].sort((a, b) => (asNumber(b.net_ticks_per_session_day) ?? 0) - (asNumber(a.net_ticks_per_session_day) ?? 0)).map((row) => {
                    const net = asNumber(row.net_ticks_per_session_day);
                    return {
                      label: String(row.template), bars: [{ value: net, colour: (net ?? 0) >= 0 ? OKABE.orange : OKABE.blue, name: "net ticks per session day" }],
                      marks: [{ value: asNumber(row.excess_ticks_per_session_day), glyph: "diamond", colour: BLACK, name: "excess over matched random" }],
                      tooltip: `${String(row.template)}: net ${fmt(net, 1)} · excess ${fmt(asNumber(row.excess_ticks_per_session_day), 1)} (Newey-West t ${fmt(asNumber(row.excess_newey_west_t), 2)}) · ${fmt(asNumber(row.trades_per_session_day), 2)} trades/day · win rate ${fmt(asNumber(row.win_rate), 3)} · profit factor ${fmt(asNumber(row.profit_factor), 2)}`,
                    };
                  })} references={[{ value: overview.goalTicks, colour: OKABE.vermillion, label: "600", dash: "6 3" }, { value: 0, colour: "#737373", label: "" }]}
                    xLabel="stitched out-of-sample net ticks per session day (2022-2025)" rowHeight={18} labelWidth={220} />
                  <SeriesLines set={body.roundTen.cumulative} yLabel="cumulative net ticks, 1 contract" height={280} />
                  <DataTable rows={body.roundTen.templates} />
                </>
              ) : <Empty>Round 10 has not landed.</Empty>}
            </Section>

            <CascadeSession days={body.sessionDays} controls={controls} set={set} overview={overview} />
          </>
        )}
      </StudyState>
    </div>
  );
}

function CascadeSession({ days, controls, set }: TabProps & { days: string[] }) {
  const day = days.includes(controls.cascadeDay) ? controls.cascadeDay : (days[Math.max(0, days.length - 60)] ?? "");
  const query = useTa<CascadeSessionBody>("cascade_session", { symbol: controls.cascadeMarket, day, template: controls.cascadeTemplate }, day !== "");
  const body = query.data?.data;
  const timeframes = splitList(controls.cascadeTimeframes);
  const minutes = body?.minutes ?? [];
  const segments: Segment[] = (body?.levels ?? []).filter((level) => timeframes.includes(String(level.timeframe))).map((level) => {
    const resistance = asNumber(level.side) === 1;
    return {
      x0: asNumber(level.drawn_from) ?? 0, x1: asNumber(level.drawn_to) ?? 0, y: asNumber(level.price) ?? 0, colour: TIMEFRAME_COLOUR[String(level.timeframe)] ?? OKABE.sky,
      dash: resistance ? undefined : "4 3", width: 2,
      tooltip: `${String(level.timeframe)} ${resistance ? "resistance" : "support"} ${fmt(asNumber(level.price), 2)} · known ${new Date(asNumber(level.known_timestamp) ?? 0).toISOString().slice(0, 16)} · ends ${new Date(asNumber(level.end_timestamp) ?? 0).toISOString().slice(0, 16)} · ${level.broken ? "broken" : "not broken"}`,
    };
  });
  const marks: Mark[] = tradeMarks(body?.trades ?? []);
  return (
    <Section title={`Session ${day || "—"} (${controls.cascadeMarket}): each timeframe's levels, the cascade stage counter, volume and the round-10 trades`}
      question="Levels are drawn from the minute they are known to the minute they break (solid = resistance, dashed = support). ▲ long / ▼ short entries (orange + = won, blue − = lost), × exits. Hover any level or trade.">
      <ControlBar>
        <SelectControl label="Session day" value={day || "—"} options={(days.length ? [...new Set([...days.slice(-400), day])] : ["—"]).map((value) => ({ value, label: value }))} onChange={(value) => set("cascadeDay", value)} />
        <SliderControl label="Step the session day" value={Math.max(0, days.indexOf(day))} min={0} max={Math.max(0, days.length - 1)} onChange={(value) => set("cascadeDay", days[value] ?? "")} format={(value) => days[value] ?? "—"} />
        <ChipSelect label="Levels drawn" options={["1m", "5m", "15m", "30m"]} selected={timeframes} onChange={(next) => set("cascadeTimeframes", next.join(","))} />
        <SelectControl label="Round-10 trades to mark" value={controls.cascadeTemplate} options={ROUND_TEN_TEMPLATES.map((value) => ({ value, label: value }))} onChange={(value) => set("cascadeTemplate", value)} />
      </ControlBar>
      <Key items={[
        ...Object.entries(TIMEFRAME_COLOUR).map(([label, colour]) => ({ label: `${label} level`, colour, dash: "" })),
        { label: "support (dashed)", colour: "#a3a3a3", dash: "4 3" },
        { label: "won (+)", colour: OKABE.orange, glyph: "triangle-up" }, { label: "lost (−)", colour: OKABE.blue, glyph: "triangle-down" }, { label: "exit", colour: BLACK, glyph: "cross" },
      ]} />
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        <SessionChart line={minutes.map((row) => ({ t: asNumber(row.timestamp) ?? 0, v: asNumber(row.close) ?? 0 }))} segments={segments} marks={marks} height={380} yLabel="close (back-adjusted points)" />
        <StripChart points={minutes.map((row) => ({ t: asNumber(row.timestamp) ?? 0, v: (asNumber(row.stage_up) ?? 0) - (asNumber(row.stage_down) ?? 0) }))}
          yLabel="stages ▲+ / ▼−" colourOf={(value) => (value >= 0 ? OKABE.orange : OKABE.blue)} step height={80} />
        <StripChart points={minutes.map((row) => ({ t: asNumber(row.timestamp) ?? 0, v: asNumber(row.volume) ?? 0 }))} yLabel="volume" colourOf={() => OKABE.sky} height={70} />
        <SubHeading>Trades of {controls.cascadeTemplate} on this day</SubHeading>
        <DataTable rows={body?.trades ?? []} />
      </StudyState>
    </Section>
  );
}

/** ▲ long / ▼ short at the entry (orange won, blue lost; hollow when `hollow`), × at the exit. */
export function tradeMarks(trades: readonly Row[], hollow = false): Mark[] {
  return trades.flatMap((trade) => {
    const won = (asNumber(trade.net_ticks) ?? 0) > 0;
    const colour = won ? OKABE.orange : OKABE.blue;
    const tip = `${String(trade.side)} · entry ${new Date(asNumber(trade.entry_timestamp) ?? 0).toISOString().slice(11, 16)} at ${fmt(asNumber(trade.entry_price), 2)} · exit ${new Date(asNumber(trade.exit_timestamp) ?? 0).toISOString().slice(11, 16)} at ${fmt(asNumber(trade.exit_price), 2)} · ${fmt(asNumber(trade.net_ticks), 0)} net ticks · ${String(trade.exit_reason)}`;
    return [
      { x: asNumber(trade.entry_timestamp) ?? 0, y: asNumber(trade.entry_price) ?? 0, glyph: trade.side === "long" ? "triangle-up" : "triangle-down", colour, filled: !hollow, size: 6, tooltip: tip, label: won ? "+" : "−" } as Mark,
      { x: asNumber(trade.exit_timestamp) ?? 0, y: asNumber(trade.exit_price) ?? 0, glyph: "cross", colour: BLACK, size: 4, tooltip: tip } as Mark,
    ];
  });
}
