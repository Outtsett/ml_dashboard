/**
 * §15 · How a zone is built, on the candles. The session's bars, ATR(14), VWAP bands and level events come from
 * derived_study_ta_strategy_600_ticks_zone_build_* (the notebook's own code path, landed by
 * packages/ml-engine/src/studies/ta_strategy_600_ticks/build.py); the merge into zones runs here, in the browser, with the
 * TypeScript port of levels.zones_for_bars, so every dial recomputes at once. At the notebook's defaults the
 * port is checked bar by bar against the Python reference landed beside the bars.
 */

import { useState } from "react";
import { ControlBar, Empty, Finding, FormulaCard, OKABE, Section, SegmentControl, SelectControl, SliderControl, StudyNotes, StudyState, fmt, fmtInt } from "@/studies/kit";
import {
  BUILD_FAMILIES, BUILD_MARKETS, VWAP_KEYS, zoneLadder, zonesForBars,
  type BuildBar, type BuildBody, type BuildDaysBody, type LadderLevel, type LadderZone, type ZoneAtBar, type ZoneBarInput,
} from "@shared/studies/ta-strategy-600-ticks";
import { BLACK, ChipSelect, DataTable, Key, RefreshViews, SessionChart, asNumber, colourAt, dashAt, linear, niceTicks, splitList, useTa, useWidth, type Band, type Candle, type Segment } from "./common";
import { pushZonesToMarketChart } from "./marketChart";
import type { TabProps } from "./controls";

const WIDTH_MINUTES: Record<string, number> = { "5m": 5, "15m": 15, "30m": 30 };
const DEFAULT_WIDTH = 0.25;
const DEFAULT_REACH = 6;
const familyColour = (group: string) => colourAt(Math.max(0, (BUILD_FAMILIES as readonly string[]).indexOf(group)));
const familyDash = (group: string) => {
  const index = Math.max(0, (BUILD_FAMILIES as readonly string[]).indexOf(group));
  return dashAt(index) || (index >= 8 ? "5 3" : undefined);
};

function barInput(bar: BuildBar, withVwap: boolean): ZoneBarInput {
  return {
    bar_end_seconds: bar.bar_end_seconds, close: bar.close, average_true_range_14: bar.average_true_range_14,
    vwap: withVwap ? Object.fromEntries(VWAP_KEYS.map((key) => [key, bar[key]])) : null,
  };
}

/** Bars where the port and levels.zones_for_bars agree on every zone column (floats to 1e-9). */
function parity(zones: readonly ZoneAtBar[], reference: readonly Record<string, unknown>[]): { matching: number; total: number; firstMismatch: number | null } {
  const keys: Array<keyof ZoneAtBar> = ["support_low", "support_high", "support_price", "support_strength", "support_families", "resistance_low", "resistance_high",
    "resistance_price", "resistance_strength", "resistance_families", "inside_zone", "zones_within_2_atr"];
  let matching = 0;
  let firstMismatch: number | null = null;
  zones.forEach((zone, index) => {
    const row = reference[index];
    const same = row !== undefined && keys.every((key) => {
      const mine = zone[key];
      const theirs = row[key] ?? null;
      if (typeof mine === "number" && typeof theirs === "number") return Math.abs(mine - theirs) <= 1e-9 * Math.max(1, Math.abs(theirs));
      return (mine ?? null) === theirs || (mine === null && (theirs === "" || (typeof theirs === "number" && !Number.isFinite(theirs))));
    });
    if (same) matching += 1;
    else if (firstMismatch === null) firstMismatch = index;
  });
  return { matching, total: zones.length, firstMismatch };
}

export function BuildTab({ controls, set, overview }: TabProps) {
  const symbol = controls.buildMarket;
  const [nonce, setNonce] = useState<number | undefined>(undefined);
  const daysQuery = useTa<BuildDaysBody>("build_days", { symbol, nonce });
  const days = daysQuery.data?.data.days ?? [];
  const day = days.includes(controls.buildDay) ? controls.buildDay : (days[days.length - 1] ?? controls.buildDay);
  const timeframe = controls.buildTimeframe;
  const query = useTa<BuildBody>("build", { symbol, day, timeframe, nonce }, day !== "");
  const body = query.data?.data;
  const bars = body?.bars ?? [];
  const families = splitList(controls.buildFamilies);
  const withVwap = families.includes("vwap");
  const events = (body?.events ?? []).filter((event) => families.includes(event.family_group));
  const tick = overview.tickSizePoints;
  const zones = zonesForBars(bars.map((bar) => barInput(bar, withVwap)), events, tick, controls.width, controls.reach);
  const atDefaults = controls.width === DEFAULT_WIDTH && controls.reach === DEFAULT_REACH && families.length === BUILD_FAMILIES.length;
  const check = atDefaults && body ? parity(zones, body.reference) : null;
  const index = Math.min(Math.max(0, controls.buildBar), Math.max(0, bars.length - 1));
  const bar = bars[index];
  const ladder = bar ? zoneLadder(barInput(bar, withVwap), events, tick, controls.width, controls.reach) : { levels: [], zones: [], gap: null };
  const [pushMessage, setPushMessage] = useState("");
  const atr = bar?.average_true_range_14 ?? null;
  const minutes = WIDTH_MINUTES[timeframe] ?? 5;

  return (
    <div className="space-y-3">
      <Section title="15 · How a zone is built, on the candles"
        question="Every level is an event (price, family, the minute it became knowable, the minute it stops being valid). At the close of every bar the levels that are known, still valid and within r × ATR of the close are sorted by price and single-linked into zones: a gap larger than max(w × ATR, 4 ticks) starts a new zone. A zone's strength is the number of distinct families in it. The zone whose centre is nearest below the close is support, the nearest above is resistance; they apply to the NEXT bar.">
        <ControlBar onReset={() => { set("width", DEFAULT_WIDTH); set("reach", DEFAULT_REACH); set("buildFamilies", BUILD_FAMILIES.join(",")); }}>
          <SegmentControl label="Market" value={symbol} options={BUILD_MARKETS.map((value) => ({ value, label: value }))} onChange={(value) => set("buildMarket", value)} />
          <SelectControl label="Session day (the CME session that ENDS on this date, 15:00 → 14:00 Pacific)" value={day || "—"}
            options={(days.length ? days : [day || "—"]).map((value) => ({ value, label: value }))} onChange={(value) => set("buildDay", value)} />
          <SegmentControl label="Bar" value={timeframe} options={["5m", "15m", "30m"].map((value) => ({ value, label: value }))} onChange={(value) => set("buildTimeframe", value)} />
          <SliderControl label="Merge gap w (× ATR)" value={controls.width} min={0.05} max={0.6} step={0.05} onChange={(value) => set("width", Number(value.toFixed(2)))} format={(value) => value.toFixed(2)} />
          <SliderControl label="Reach r (× ATR from the close)" value={controls.reach} min={1} max={8} step={0.5} onChange={(value) => set("reach", value)} format={(value) => value.toFixed(1)} />
        </ControlBar>
        <ChipSelect label="Level families in the map" options={BUILD_FAMILIES} selected={families} onChange={(next) => set("buildFamilies", next.join(","))} />
      </Section>
      <StudyState isLoading={daysQuery.isLoading || query.isLoading} error={daysQuery.error ?? query.error}>
        <StudyNotes notes={[...(daysQuery.data?.notes ?? []), ...(query.data?.notes ?? [])]} />
        <RefreshViews notes={[...(daysQuery.data?.notes ?? []), ...(query.data?.notes ?? [])]} onRefreshed={setNonce} />
        {bars.length === 0 ? <Empty>No landed session for {symbol} ending {day}. The build lands every 2025 session of MNQ, NQ, ES and MES.</Empty> : (
          <>
            <Finding>
              {symbol} session ending {day}: {bars.length} {timeframe} bars, {fmtInt(asNumber(body?.session?.level_event_count_in_loaded_window))} level events known in the loaded window
              ({fmtInt(asNumber(body?.session?.minutes_loaded))} minutes, {fmtInt(asNumber(body?.session?.rolls_back_adjusted))} rolls back-adjusted); {events.length} of them touch this session with the chosen families.
              {check && <> The TypeScript merge matches <code>levels.zones_for_bars</code> on <b>{check.matching} of {check.total}</b> bars{check.firstMismatch !== null ? ` (first difference at bar ${check.firstMismatch})` : ""}.</>}
              {!check && " Parity against the Python reference is checked at the notebook's defaults (w 0.25, r 6, all twelve families)."}
            </Finding>
            <Section title={`Bar ${index} of the session (${bar ? new Date(bar.timestamp_seconds * 1000).toISOString().slice(0, 16).replace("T", " ") : "—"} Pacific, close ${fmt(bar?.close, 2)}): the levels in reach, sorted, and where the gaps cut them into zones`}>
              <ControlBar>
                <SliderControl label="Bar of the session (step it)" value={index} min={0} max={Math.max(0, bars.length - 1)} onChange={(value) => set("buildBar", value)} />
              </ControlBar>
              <FormulaCard
                tex={`\\text{gap}_{\\max} = \\max(w \\cdot \\text{ATR},\\ 4\\ \\text{ticks}) = \\max(${controls.width.toFixed(2)} \\times ${fmt(atr, 2)},\\ ${(4 * tick).toFixed(2)}) = ${fmt(ladder.gap, 2)}\\ \\text{points} \\qquad \\text{new zone at } i \\iff p_i - p_{i-1} > \\text{gap}_{\\max} \\qquad \\text{strength}(Z) = \\left|\\{\\text{family}(\\ell) : \\ell \\in Z\\}\\right| \\qquad S = \\arg\\max_{Z:\\ \\bar p_Z \\le c} \\bar p_Z,\\quad R = \\arg\\min_{Z:\\ \\bar p_Z > c} \\bar p_Z`}
                symbols={[
                  { tex: "w", name: "merge gap, in ATR", value: controls.width.toFixed(2) },
                  { tex: "\\text{ATR}", name: `ATR(14) of the ${timeframe} bars at this bar`, value: `${fmt(atr, 2)} points` },
                  { tex: "r", name: "reach: levels farther than r × ATR from the close are left out", value: `${controls.reach.toFixed(1)} ATR = ${fmt(atr === null ? null : controls.reach * atr, 1)} points` },
                  { tex: "c", name: "this bar's close (back-adjusted)", value: fmt(bar?.close, 2) },
                  { tex: "p_i", name: "the i-th level price, sorted", value: `${ladder.levels.length} levels in reach` },
                  { tex: "\\bar p_Z", name: "a zone's centre: the mean of its levels", value: `${ladder.zones.length} zones` },
                  { tex: "S,\\ R", name: "the support / resistance zone handed to the next bar", value: `${fmt(ladder.zones.find((zone) => zone.role === "support")?.centre, 2)} / ${fmt(ladder.zones.find((zone) => zone.role === "resistance")?.centre, 2)}` },
                ]}
              />
              <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
                <Ladder levels={ladder.levels} zones={ladder.zones} close={bar?.close ?? 0} atr={atr} reach={controls.reach} />
                <div className="min-w-0 space-y-2">
                  <DataTable rows={ladder.levels as unknown as Record<string, unknown>[]} caption="Levels in reach (sorted by price; a gap above the threshold starts a new zone)." pageSize={14} />
                  <DataTable rows={ladder.zones as unknown as Record<string, unknown>[]} caption="Zones." />
                </div>
              </div>
            </Section>
            <Section title={`${symbol} ${timeframe} candles with the zones each bar hands to the next bar`}
              question="Blue band = support, orange band = resistance (hover for strength and families); every level event while it was known and valid (lines by family); the bar picked above (dashed). Candles: orange hollow = up, blue filled = down.">
              <CandleView bars={bars} zones={zones} events={events} minutes={minutes} cursor={bar ? bar.timestamp_seconds * 1000 : null} families={families} />
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="rounded border border-[#56B4E9]/60 px-2 py-1 text-[11px] text-[#56B4E9] hover:bg-[#56B4E9]/10"
                  onClick={() => { void pushZonesToMarketChart({ symbol, timeframeMinutes: minutes, bars, zones, events }).then(setPushMessage).catch((error: unknown) => setPushMessage(String(error))); }}>
                  Show these zones on the Market chart
                </button>
                <span className="text-[11px] text-neutral-400">{pushMessage || "Draws the support / resistance bands (four step lines) and up to 30 level events on the Market chart, on its raw price scale. Put the chart on the same symbol first."}</span>
              </div>
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}

function Ladder({ levels, zones, close, atr, reach }: { levels: LadderLevel[]; zones: LadderZone[]; close: number; atr: number | null; reach: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (atr === null) return <Empty>ATR(14) is not defined yet at this bar.</Empty>;
  const low = Math.min(close - reach * atr, ...levels.map((level) => level.price));
  const high = Math.max(close + reach * atr, ...levels.map((level) => level.price));
  const height = 440;
  const y = linear([low, high], [height - 10, 10]);
  const left = 54;
  return (
    <div ref={ref} className="w-full min-w-0">
      <p className="text-[10px] text-neutral-400">Price ladder at this bar: ticks = levels (coloured by family), bands = zones (blue support, orange resistance, grey others), black = close, shaded = reach.</p>
      <svg width={width} height={height} className="block">
        {niceTicks(low, high, 8).map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - 4} y1={y(tick)} y2={y(tick)} stroke="#1f1f1f" />
            <text x={left - 4} y={y(tick) + 3} textAnchor="end" fontSize={9} fill="#8a8a8a">{fmt(tick, 2)}</text>
          </g>
        ))}
        <rect x={left} width={width - left - 4} y={y(close + reach * atr)} height={Math.abs(y(close - reach * atr) - y(close + reach * atr))} fill="#ffffff" opacity={0.04} />
        {zones.map((zone) => (
          <rect key={zone.zone} x={left + 4} width={width - left - 12} y={y(zone.high) - 2} height={Math.max(4, y(zone.low) - y(zone.high) + 4)}
            fill={zone.role === "support" ? OKABE.blue : zone.role === "resistance" ? OKABE.orange : "#737373"} opacity={0.45}>
            <title>{`zone ${zone.zone}${zone.role ? ` (${zone.role.toUpperCase()})` : ""}: ${fmt(zone.low, 2)}-${fmt(zone.high, 2)} · centre ${fmt(zone.centre, 2)} · ${zone.levels} levels · strength ${zone.strength} · ${zone.families} · ${fmt(zone.width_ticks, 0)} ticks wide · ${fmt(zone.distance_from_close_ticks, 0)} ticks from the close`}</title>
          </rect>
        ))}
        {levels.map((level, index) => (
          <line key={`${level.source}-${index}`} x1={left + 20} x2={width - 20} y1={y(level.price)} y2={y(level.price)} stroke={familyColour(level.family_group)} strokeWidth={2} strokeDasharray={familyDash(level.family_group)}>
            <title>{`${level.source} (${level.family_group}) ${fmt(level.price, 2)} · ${fmt(level.distance_atr, 2)} ATR from the close · gap to previous ${fmt(level.gap_to_previous, 2)}${level.starts_new_zone ? " · starts a new zone" : ""} · zone ${level.zone}`}</title>
          </line>
        ))}
        <line x1={left} x2={width - 4} y1={y(close)} y2={y(close)} stroke={BLACK} strokeWidth={2} />
        <text x={width - 6} y={y(close) - 3} textAnchor="end" fontSize={9} fill={BLACK}>close {fmt(close, 2)}</text>
      </svg>
    </div>
  );
}

function CandleView({ bars, zones, events, minutes, cursor, families }: {
  bars: readonly BuildBar[]; zones: readonly ZoneAtBar[]; events: BuildBody["events"]; minutes: number; cursor: number | null; families: string[];
}) {
  const widthMs = minutes * 60_000;
  const candles: Candle[] = bars.map((bar) => ({ t: bar.timestamp_seconds * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close, widthMs,
    tooltip: `bar ${bar.bar} · ${new Date(bar.timestamp_seconds * 1000).toISOString().slice(11, 16)} O ${fmt(bar.open, 2)} H ${fmt(bar.high, 2)} L ${fmt(bar.low, 2)} C ${fmt(bar.close, 2)} · ATR ${fmt(bar.average_true_range_14, 2)}` }));
  const bands: Band[] = [];
  zones.forEach((zone, index) => {
    const bar = bars[index];
    if (!bar) return;
    const next = bar.timestamp_seconds * 1000 + widthMs;   // the zone of bar b applies to bar b + 1
    if (zone.support_low !== null && zone.support_high !== null) {
      bands.push({ x0: next, x1: next + widthMs, y0: zone.support_low, y1: zone.support_high === zone.support_low ? zone.support_low + 0.25 : zone.support_high, colour: OKABE.blue, opacity: 0.45,
        tooltip: `support for the bar at ${new Date(next).toISOString().slice(11, 16)}: ${fmt(zone.support_low, 2)}-${fmt(zone.support_high, 2)} · strength ${zone.support_strength} · ${zone.support_families}` });
    }
    if (zone.resistance_low !== null && zone.resistance_high !== null) {
      bands.push({ x0: next, x1: next + widthMs, y0: zone.resistance_low, y1: zone.resistance_high === zone.resistance_low ? zone.resistance_low + 0.25 : zone.resistance_high, colour: OKABE.orange, opacity: 0.45,
        tooltip: `resistance for the bar at ${new Date(next).toISOString().slice(11, 16)}: ${fmt(zone.resistance_low, 2)}-${fmt(zone.resistance_high, 2)} · strength ${zone.resistance_strength} · ${zone.resistance_families}` });
    }
  });
  const t0 = (bars[0]?.timestamp_seconds ?? 0);
  const t1 = (bars[bars.length - 1]?.timestamp_seconds ?? 0) + minutes * 60;
  const low = Math.min(...bars.map((bar) => bar.low));
  const high = Math.max(...bars.map((bar) => bar.high));
  const pad = (high - low) * 0.15;
  const segments: Segment[] = events.filter((event) => event.known_from_seconds <= t1 && event.valid_until_seconds > t0 && event.price > low - pad && event.price < high + pad)
    .map((event) => ({
      x0: Math.max(event.known_from_seconds, t0) * 1000, x1: Math.min(event.valid_until_seconds, t1) * 1000, y: event.price,
      colour: familyColour(event.family_group), dash: familyDash(event.family_group), width: 1.5,
      tooltip: `${event.source} (${event.family_group}) ${fmt(event.price, 2)} · known ${new Date(event.known_from_seconds * 1000).toISOString().slice(0, 16)} · valid until ${new Date(event.valid_until_seconds * 1000).toISOString().slice(0, 16)}`,
    }));
  return (
    <>
      <Key items={[
        { label: "support (next bar)", colour: OKABE.blue, glyph: "square" }, { label: "resistance (next bar)", colour: OKABE.orange, glyph: "square" },
        ...families.filter((family) => family !== "vwap").map((family) => ({ label: family, colour: familyColour(family), dash: familyDash(family) ?? "" })),
        { label: "picked bar", colour: BLACK, dash: "4 3" },
      ]} />
      <SessionChart candles={candles} bands={bands} segments={segments} cursor={cursor} height={520} yPad={0.15} />
    </>
  );
}
