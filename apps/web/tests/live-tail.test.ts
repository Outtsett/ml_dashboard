/**
 * `apps/web/src/live/useLiveTail.ts` — the live tail joins the chart only
 * when it continues it. The lake's history ends months before the hub's first
 * bar; joined across that hole, a December price and a September price were
 * drawn as neighbouring bars (2026-09-28).
 */
import { describe, expect, it } from "vitest";
import { MAX_JOIN_GAP_MS, tailBars } from "@/live/useLiveTail";
import type { LiveBar } from "@/live/types";

const MINUTE = 60_000;

function bar(tChart: number, close: number): LiveBar {
  return { t: tChart, tChart, open: close, high: close, low: close, close, volume: 1, symbol: "MNQ", source: "yahoo", delaySeconds: 540 } as LiveBar;
}

describe("live tail joining", () => {
  const lastChart = Date.UTC(2025, 11, 30, 15);

  it("refuses to join across a hole of months", () => {
    const first = Date.UTC(2026, 8, 21, 4);
    const { bars, gap } = tailBars([bar(first, 30_099.5), bar(first + MINUTE, 30_100)], lastChart, 1);
    expect(bars).toEqual([]);
    expect(gap).toEqual({ lastChartBar: lastChart, firstLiveBar: first });
  });

  it("joins across a weekend", () => {
    const friday = Date.UTC(2026, 8, 18, 21);                 // Friday 14:00 Pacific, stamped as the chart stamps
    const sunday = friday + 49 * 60 * MINUTE;                  // Sunday 15:00 open
    const { bars, gap } = tailBars([bar(sunday, 25_700)], friday, 1);
    expect(gap).toBeNull();
    expect(bars.map((b) => b.timestamp)).toEqual([sunday]);
  });

  it("stops at the widest silence it allows", () => {
    expect(tailBars([bar(lastChart + MAX_JOIN_GAP_MS, 1)], lastChart, 1).gap).toBeNull();
    expect(tailBars([bar(lastChart + MAX_JOIN_GAP_MS + MINUTE, 1)], lastChart, 1).gap).not.toBeNull();
  });
});
