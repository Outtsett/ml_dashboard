/**
 * Section 15's "Show these zones on the Market chart": the session's support and resistance bands as four
 * step lines and up to 30 level events, PUT to the Market chart's overlay bridge (apps/api/market/chartLink.router.ts),
 * then the chart is asked to show the session. The chart draws raw contract prices while the study's series is
 * back-adjusted, so the offset between the two (median raw close − adjusted close over the session's bars, the
 * same contract the chart shows unless a roll falls inside the day) is added back.
 */

import type { Overlay } from "@shared/chartLink";
import type { BuildBar, LevelEvent, ZoneAtBar } from "@shared/studies/ta-strategy-600-ticks";

export const OVERLAY_SOURCE = "ta_strategy_600_ticks_zones";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export async function pushZonesToMarketChart(input: {
  symbol: string; timeframeMinutes: number; bars: readonly BuildBar[]; zones: readonly ZoneAtBar[]; events: readonly LevelEvent[];
}): Promise<string> {
  const contextResponse = await fetch("/api/chart/context");
  if (!contextResponse.ok) return "The Market chart has not published its context yet: open the Market page first.";
  const context = (await contextResponse.json()) as { symbol: string; timeframe: string };
  if (context.symbol !== input.symbol) return `The Market chart shows ${context.symbol}; select ${input.symbol} there first.`;
  const offset = median(input.bars.map((bar) => bar.raw_close - bar.close));
  const widthMs = input.timeframeMinutes * 60_000;
  const overlays: Overlay[] = [];
  for (const [name, colour] of [["support", "#0072B2"], ["resistance", "#E69F00"]] as const) {
    for (const edge of ["low", "high"] as const) {
      const points = input.zones.flatMap((zone, index) => {
        const value = zone[`${name}_${edge}`];
        const bar = input.bars[index];
        return value === null || !bar ? [] : [{ time: bar.timestamp_seconds * 1000 + widthMs, value: value + offset }];
      });
      overlays.push({ kind: "line", id: `${name}_${edge}`, label: `${name} zone ${edge}`, color: colour, pane: "price", points });
    }
  }
  const first = input.bars[0];
  const last = input.bars[input.bars.length - 1];
  if (first && last) {
    const start = first.timestamp_seconds + input.timeframeMinutes * 60;
    const end = last.timestamp_seconds + input.timeframeMinutes * 60;
    input.events.filter((event) => event.known_from_seconds <= end && event.valid_until_seconds > start)
      .slice(0, 30)
      .forEach((event, index) => overlays.push({ kind: "level", id: `level_${index}`, label: event.source, color: "#56B4E9", style: "dotted", price: event.price + offset }));
  }
  const put = await fetch("/api/chart/overlays", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: OVERLAY_SOURCE, symbol: context.symbol, timeframe: context.timeframe, overlays }),
  });
  if (!put.ok) return `The chart refused the overlays (${put.status}).`;
  if (first && last) {
    await fetch("/api/chart/view", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startMs: first.timestamp_seconds * 1000, endMs: last.timestamp_seconds * 1000 + widthMs }),
    }).catch(() => undefined);
  }
  return `Drawn on the Market chart as "${OVERLAY_SOURCE}" (${overlays.length} overlays, roll offset ${offset >= 0 ? "+" : ""}${offset.toFixed(2)} points).`;
}
