/**
 * chartWindowFrom: the one place a chart's published window becomes a bar
 * count. The bar interval is derived from the bars the chart actually loaded,
 * not from the timeframe string, because a futures series skips weekends and
 * the 15:00-16:00 break — the count a reader sees must come from the bars.
 */

import { describe, expect, it } from "vitest";
import { chartWindowFrom, describeChartWindow, type ChartWindow } from "@/market/lib/useChartWindow";
import type { PublishedChartContext } from "@/market/lib/chartContextBridge";

function context(overrides: Partial<PublishedChartContext> = {}): PublishedChartContext {
  return {
    symbol: "MNQ",
    timeframe: "1m",
    assetClass: "futures",
    visibleStartMs: null,
    visibleEndMs: null,
    cursorMs: null,
    selectedMs: null,
    firstBarMs: null,
    lastBarMs: null,
    barCount: 0,
    ...overrides,
  };
}

const MINUTE = 60_000;

describe("chartWindowFrom", () => {
  it("is null when the chart has published nothing", () => {
    expect(chartWindowFrom(null)).toBeNull();
    expect(describeChartWindow(null)).toBe("no chart window published yet");
  });

  it("counts the bars between the visible edges", () => {
    // 500 loaded 1m bars; the reader is looking at the middle 200 of them.
    const first = 1_700_000_000_000;
    const window = chartWindowFrom(
      context({
        firstBarMs: first,
        lastBarMs: first + 499 * MINUTE,
        barCount: 500,
        visibleStartMs: first + 150 * MINUTE,
        visibleEndMs: first + 349 * MINUTE,
      }),
    );
    expect(window?.source).toBe("visible");
    expect(window?.barIntervalMs).toBe(MINUTE);
    expect(window?.bars).toBe(200);
    expect(window?.clamped).toBe(false);
  });

  it("derives the interval from the loaded bars, so a weekend gap is not a bar", () => {
    // Two bars either side of a weekend: 4 days apart, and the window between
    // them holds zero bars rather than 5,760.
    const first = Date.UTC(2026, 0, 2, 22, 0);
    const last = Date.UTC(2026, 0, 6, 22, 0);
    const window = chartWindowFrom(
      context({ firstBarMs: first, lastBarMs: last, barCount: 2, visibleStartMs: first, visibleEndMs: last }),
      { min: 1 },
    );
    expect(window?.barIntervalMs).toBe(last - first);
    expect(window?.bars).toBe(2);
  });

  it("falls back to every loaded bar when no range is visible", () => {
    const first = 1_700_000_000_000;
    const window = chartWindowFrom(context({ firstBarMs: first, lastBarMs: first + 499 * MINUTE, barCount: 500 }));
    expect(window?.source).toBe("loaded");
    expect(window?.bars).toBe(500);
  });

  it("clamps to the consumer's own range and says so", () => {
    const first = 1_700_000_000_000;
    const narrow = chartWindowFrom(
      context({
        firstBarMs: first,
        lastBarMs: first + 99 * MINUTE,
        barCount: 100,
        visibleStartMs: first,
        visibleEndMs: first + 20 * MINUTE,
      }),
      { min: 500, max: 100_000 },
    );
    expect(narrow?.bars).toBe(500);
    expect(narrow?.clamped).toBe(true);
    expect(describeChartWindow(narrow)).toContain("clamped");

    const wide = chartWindowFrom(
      context({ firstBarMs: first, lastBarMs: first + 99 * MINUTE, barCount: 100, visibleStartMs: first, visibleEndMs: first + 99 * MINUTE }),
      { min: 100, max: 1_000 },
    );
    expect(wide?.bars).toBe(100);
    expect(wide?.clamped).toBe(false);
  });

  it("never returns a non-positive bar count for an empty chart", () => {
    const window = chartWindowFrom(context({ barCount: 0 }), { min: 250, max: 20_000 });
    expect(window?.bars).toBe(250);
  });

  it("carries the clicked bar through", () => {
    const first = 1_700_000_000_000;
    const window = chartWindowFrom(
      context({ firstBarMs: first, lastBarMs: first + 99 * MINUTE, barCount: 100, selectedMs: first + 42 * MINUTE }),
    );
    expect(window?.selectedMs).toBe(first + 42 * MINUTE);
  });

  it("names where the number came from", () => {
    const first = 1_700_000_000_000;
    const visible = chartWindowFrom(
      context({
        firstBarMs: first,
        lastBarMs: first + 499 * MINUTE,
        barCount: 500,
        visibleStartMs: first,
        visibleEndMs: first + 99 * MINUTE,
      }),
    ) as ChartWindow;
    expect(describeChartWindow(visible)).toBe("100 bars from the chart's visible window");
  });
});