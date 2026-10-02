/**
 * Section 1: candles, indicators and every candlestick pattern, over a window
 * of at most 1,500 bars scrubbed through the quarter.
 */

import { useState } from "react";
import { ColumnGrid, ControlBar, Empty, Finding, OKABE, Section, StudyNotes, StudyState, fmt, fmtInt, fmtTime, useStudyQuery } from "@/studies/kit";
import { DEFAULT_WINDOW_LENGTH, MAXIMUM_WINDOW_LENGTH, type CatalogueRow, type ChartBody, type ChartMarker } from "@shared/studies/indicator-study";
import { CandleChart, OVERLAY_COLORS, panelGroups, type CandleMarker } from "./CandleChart";
import { timeframeOf } from "./controls";
import type { TabProps } from "./Page";
import { CommitSlider, DataTable, LegendRow, MultiPicker, csv } from "./widgets";

type Meaning = "bullish claim" | "bearish claim" | "sign is the candle colour" | "no direction claimed";

const MEANING_STYLE: Record<Meaning, { shape: CandleMarker["shape"]; position: CandleMarker["position"]; color: string; glyph: "triangle-up" | "triangle-down" | "square" | "circle" }> = {
  "bullish claim": { shape: "arrowUp", position: "belowBar", color: OKABE.orange, glyph: "triangle-up" },
  "bearish claim": { shape: "arrowDown", position: "aboveBar", color: OKABE.blue, glyph: "triangle-down" },
  "sign is the candle colour": { shape: "square", position: "aboveBar", color: OKABE.purple, glyph: "square" },
  "no direction claimed": { shape: "circle", position: "aboveBar", color: "#f5f5f5", glyph: "circle" },
};

export function meaningOf(semantics: string | null | undefined, value: number): Meaning {
  if (semantics === "non_directional") return "no direction claimed";
  if (semantics === "sign_is_candle_colour") return "sign is the candle colour";
  return value > 0 ? "bullish claim" : "bearish claim";
}

function isChart(data: unknown): data is ChartBody {
  return typeof data === "object" && data !== null && "bars" in data && "markers" in data;
}

export function ChartTab({ controls, set, overview }: TabProps) {
  const timeframe = timeframeOf(controls);
  const catalogue: CatalogueRow[] = overview?.catalogue ?? [];
  const byColumn = new Map(catalogue.map((row) => [row.column_name, row]));
  const levelOptions = catalogue
    .filter((row) => (row.feature_kind === "price_level" || row.feature_kind === "signed_price_level") && row.excluded_reason === null && row.talib_function !== "CEIL" && row.talib_function !== "FLOOR")
    .map((row) => ({ value: row.column_name, label: row.column_name }));
  const panelOptions = catalogue
    .filter((row) => !["price_level", "signed_price_level", "candlestick_pattern", "degenerate_of_price"].includes(row.feature_kind) && row.excluded_reason === null)
    .map((row) => ({ value: row.column_name, label: `${row.column_name} (${row.talib_group})` }));
  const patternRows = catalogue.filter((row) => row.feature_kind === "candlestick_pattern");
  const kindOptions = [...new Set(patternRows.map((row) => row.pattern_semantics).filter((value): value is string => !!value))].sort().map((value) => ({ value, label: value }));
  const kinds = csv(controls.kinds);
  const patternOptions = patternRows
    .filter((row) => row.excluded_reason === null && row.pattern_semantics !== null && kinds.includes(row.pattern_semantics))
    .map((row) => ({ value: row.column_name, label: row.column_name }));
  const hidden = new Set(csv(controls.hiddenPatterns));
  const drawn = patternOptions.map((option) => option.value).filter((value) => !hidden.has(value));
  const overlays = csv(controls.overlays).filter((column) => byColumn.has(column));
  const panels = csv(controls.panels).filter((column) => byColumn.has(column));

  const windowLength = controls.windowLength > 0 ? controls.windowLength : DEFAULT_WINDOW_LENGTH[timeframe];
  const query = useStudyQuery<unknown>("indicator-study", {
    part: "chart", timeframe, horizon: controls.horizon, windowEnd: controls.windowEnd, windowLength, overlays: overlays.join(","), panels: panels.join(","),
  }, { enabled: overview !== null });
  const body = isChart(query.data?.data) ? query.data.data : null;
  const [hover, setHover] = useState<number | null>(null);

  const drawnSet = new Set(drawn);
  const shown: Array<ChartMarker & { meaning: Meaning }> = (body?.markers ?? [])
    .filter((marker) => drawnSet.has(marker.pattern))
    .map((marker) => ({ ...marker, meaning: meaningOf(byColumn.get(marker.pattern)?.pattern_semantics, marker.value) }));
  const candleMarkers: CandleMarker[] = shown.map((marker) => ({ bar_index: marker.bar_index, ...MEANING_STYLE[marker.meaning] }));
  const rolls = (body?.bars ?? []).filter((bar) => bar.bars_since_contract_roll === 0 && bar.bar_index > 0).map((bar) => ({ bar_index: bar.bar_index, color: "rgba(245,245,245,0.35)" }));
  const summary = new Map<string, { pattern: string; meaning: Meaning; bars_in_window: number }>();
  for (const marker of shown) {
    const key = `${marker.pattern}|${marker.meaning}`;
    const entry = summary.get(key) ?? { pattern: marker.pattern, meaning: marker.meaning, bars_in_window: 0 };
    entry.bars_in_window += 1;
    summary.set(key, entry);
  }
  const barsWithMarkers = new Set(shown.map((marker) => marker.bar_index)).size;
  const hovered = body?.bars.find((bar) => bar.bar_index === hover) ?? null;
  const hoveredMarkers = shown.filter((marker) => marker.bar_index === hover);
  const barCount = body?.barCount ?? overview?.barCount ?? 1;
  const windowEnd = controls.windowEnd < 0 ? barCount - 1 : Math.min(controls.windowEnd, barCount - 1);
  const frame = (body?.bars ?? []).map((bar) => ({ open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, ...bar.values }));

  return (
    <Section title="1 · Candles, indicators and every candlestick pattern" question="Scrub the window through the quarter; hover a bar for its patterns, what each sign means, and the direction label the predictability section scores.">
      <div className="space-y-2">
        <ControlBar>
          <CommitSlider label="Window end (bar number)" value={windowEnd} min={Math.min(19, barCount - 1)} max={barCount - 1} onCommit={(value) => set("windowEnd", value >= barCount - 1 ? -1 : value)} wide />
          <CommitSlider label="Bars shown" value={windowLength} min={20} max={Math.min(MAXIMUM_WINDOW_LENGTH, barCount)} step={10} onCommit={(value) => set("windowLength", value)} />
        </ControlBar>
        <div className="grid gap-2 grid-cols-1 xl:grid-cols-2">
          <MultiPicker label="Overlaid on price" options={levelOptions} selected={overlays} onChange={(next) => set("overlays", next.join(","))} />
          <MultiPicker label="Own panels (MACD's three lines share one)" options={panelOptions} selected={panels} onChange={(next) => set("panels", next.join(","))} />
          <MultiPicker label="Pattern kinds" options={kindOptions} selected={kinds} onChange={(next) => set("kinds", next.join(","))} />
          <MultiPicker
            label="Patterns drawn (every one in the chosen kinds)"
            options={patternOptions}
            selected={drawn}
            onChange={(next) => set("hiddenPatterns", patternOptions.map((option) => option.value).filter((value) => !next.includes(value)).join(","))}
          />
        </div>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={query.data?.notes ?? []} />
          {body && body.bars.length > 0 ? (
            <>
              <LegendRow
                items={[
                  ...body.overlays.map((column, index) => ({ label: column, color: OVERLAY_COLORS[index % OVERLAY_COLORS.length] as string, dash: index % 5 !== 0 })),
                  ...(Object.keys(MEANING_STYLE) as Meaning[]).map((meaning) => ({ label: meaning, color: MEANING_STYLE[meaning].color, shape: MEANING_STYLE[meaning].glyph })),
                  { label: "white shaded bar = the MNQZ5 → MNQH6 roll", color: "#f5f5f5", shape: "square" as const, hollow: true },
                ]}
              />
              <CandleChart
                bars={body.bars}
                overlays={body.overlays}
                groups={panelGroups(body.panels)}
                markers={candleMarkers}
                bands={rolls}
                strip
                height={420 + 110 * panelGroups(body.panels).length}
                onHover={setHover}
              />
              <div className="min-h-[3.5rem] rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1 font-mono text-[11px] text-neutral-300">
                {hovered ? (
                  <>
                    <div>
                      bar {fmtInt(hovered.bar_index)} · {fmtTime(hovered.timestamp)} UTC · {hovered.contract_symbol} · open {fmt(hovered.open)} high {fmt(hovered.high)} low {fmt(hovered.low)} close {fmt(hovered.close)} · volume {fmtInt(hovered.volume)}
                    </div>
                    <div>
                      direction label, h = {body.horizon}:{" "}
                      {hovered.direction_binary === 1 ? <span style={{ color: OKABE.orange }}>▲ higher</span> : hovered.direction_binary === 0 ? <span style={{ color: OKABE.blue }}>▼ lower</span> : `● excluded (${hovered.exclusion_reason ?? "no label"})`}
                      {Object.entries(hovered.values).map(([column, value]) => ` · ${column} ${fmt(value, 4)}`).join("")}
                    </div>
                    {hoveredMarkers.map((marker) => (
                      <div key={marker.pattern} style={{ color: MEANING_STYLE[marker.meaning].color }}>
                        {marker.pattern} = {marker.value} ({marker.meaning}) — {byColumn.get(marker.pattern)?.semantics_description ?? ""}
                      </div>
                    ))}
                  </>
                ) : (
                  <span className="text-neutral-500">Hover a bar for its time, prices, indicator values, direction label and every pattern that fired on it.</span>
                )}
              </div>
              <Finding>
                {fmtInt(shown.length)} pattern markers on {fmtInt(barsWithMarkers)} of the {fmtInt(body.bars.length)} bars in the window (bars {fmtInt(body.firstBarIndex)} to{" "}
                {fmtInt(body.lastBarIndex)} of {fmtInt(body.barCount)}). The strip under the price is the label section 5 scores: ▲ the close {body.horizon} bar(s) later was
                higher, ▼ lower, ● excluded (a tie, a window that crosses the roll, or the end of the sample).
              </Finding>
              {summary.size > 0 ? (
                <DataTable
                  rows={[...summary.values()]}
                  rowKey={(row) => `${row.pattern}|${row.meaning}`}
                  initialSort={{ key: "bars_in_window", descending: true }}
                  pageSize={10}
                  columns={[
                    { key: "pattern", label: "pattern", value: (row) => row.pattern },
                    { key: "meaning", label: "marker meaning", value: (row) => row.meaning },
                    { key: "bars_in_window", label: "bars in window", value: (row) => row.bars_in_window, numeric: true },
                  ]}
                />
              ) : (
                <Empty>No selected pattern fires inside this window.</Empty>
              )}
              <ColumnGrid rows={frame} title="Every column of the window (prices, volume and each chosen indicator)" />
            </>
          ) : (
            <Empty>No bars in this window.</Empty>
          )}
        </StudyState>
      </div>
    </Section>
  );
}
