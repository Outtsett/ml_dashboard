// @vitest-environment jsdom
/**
 * Chart companion (apps/api/studies/handlers/chart-companion.ts and
 * packages/shared/src/studies/chart-companion.ts): the handler with a fake bar loader
 * and a fake StudyLake, and the pure computations against numbers produced by
 * the notebook's own pandas / scipy code (recorded in the comments).
 */

import { createElement, type ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishChartContext, resetChartContextBridgeForTests } from "@/market/lib/chartContextBridge";
import { SymbolProvider } from "../../../web/src/shared/contexts/SymbolContext";
import Page from "@/studies/pages/chart-companion/Page";
import {
  buildFrame, buildOverlays, countInBins, describeSelectedBar, describeValues, earlierReturns, findUnusualMoves, niceBins,
  normalTwoSidedShare, observedTailShares, overlayManifest, resolveSelectedIndex, rollingMean, scoreBars, selectedBar,
  sixSignificant, thinIndices, trailingPercentile, WARMUP_BARS_DEFAULT,
  type ChartCompanionBody,
} from "@shared/studies/chart-companion";
import { createChartCompanionHandler, type BarLoader, type BarRow } from "../../studies/handlers/chart-companion";
import type { StudyContext, StudyLake } from "../../studies/types";

// Recharts measures its container; jsdom has no layout, so give every chart a fixed size.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({ children, height }: { children: ReactElement; height?: number }) =>
      React.cloneElement(children, { width: 640, height: typeof height === "number" ? height : 200 } as Record<string, unknown>),
  };
});

// ── pure computations ────────────────────────────────────────────────────────

/** The notebook's pandas frame for returns [nan, .01, -.02, .015, .03, -.01, .005, .04], window 3. */
const RETURNS = [Number.NaN, 0.01, -0.02, 0.015, 0.03, -0.01, 0.005, 0.04];
function closesFor(returns: number[]): number[] {
  const closes = [100];
  for (let index = 1; index < returns.length; index += 1) closes.push((closes[index - 1] as number) * Math.exp(returns[index] as number));
  return closes;
}
function barsFor(closes: number[]) {
  return { high: closes.map((c) => c + 0.5), low: closes.map((c) => c - 0.5), close: closes };
}

describe("scoreBars", () => {
  const scored = scoreBars(barsFor(closesFor(RETURNS)), 3);

  it("reproduces pandas' return z-score on the prior window (first score at index window + 1)", () => {
    const expected = [Number.NaN, Number.NaN, Number.NaN, Number.NaN, 1.4967665407535602, -0.714526782707794, -0.32991443953692884, 1.5670935878004124];
    expected.forEach((value, index) => {
      const z = scored.returnZscore[index] as number;
      if (Number.isNaN(value)) expect(Number.isNaN(z)).toBe(true);
      else expect(z).toBeCloseTo(value, 10);
    });
    expect(scored.returnTrailingMean[4]).toBeCloseTo(0.0016666666666666663, 12);
    expect(scored.returnTrailingStandardDeviation[4]).toBeCloseTo(0.018929694486000914, 12);
  });

  it("compares a bar with the bars BEFORE it: changing the bar's own return leaves its mean and deviation alone", () => {
    const changed = scoreBars(barsFor(closesFor([...RETURNS.slice(0, 7), 0.4])), 3);
    expect(changed.returnTrailingMean[7]).toBeCloseTo(scored.returnTrailingMean[7] as number, 12);
    expect(changed.returnZscore[7]).not.toBeCloseTo(scored.returnZscore[7] as number, 3);
  });

  it("leaves the first bar unknown, never zero", () => {
    expect(Number.isNaN(scored.logReturn[0] as number)).toBe(true);
    expect(Number.isNaN(scored.trueRangePoints[0] as number)).toBe(true);
  });

  it("scores a flat window as unknown (zero deviation)", () => {
    const flat = scoreBars({ high: [10, 10, 10, 10, 10], low: [10, 10, 10, 10, 10], close: [10, 10, 10, 10, 10] }, 3);
    expect(flat.returnZscore.every(Number.isNaN)).toBe(true);
  });

  it("true range reaches to the previous close across a gap", () => {
    const gap = scoreBars({ high: [10, 13], low: [9, 12], close: [10, 12.5] }, 1);
    expect(gap.trueRangePoints[1]).toBeCloseTo(3, 12); // high - low = 1, |13 - 10| = 3, |12 - 10| = 2
  });
});

describe("trailingPercentile and rollingMean", () => {
  it("is the share of the previous window at or below the current value", () => {
    const result = trailingPercentile([1, 2, 3, 4, 5, 3], 3);
    expect(Number.isNaN(result[2] as number)).toBe(true);
    expect(result[3]).toBeCloseTo(1, 12);
    expect(result[4]).toBeCloseTo(1, 12);
    expect(result[5]).toBeCloseTo(1 / 3, 12);
  });
  it("is unknown when any value of the window is unknown", () => {
    const result = trailingPercentile([Number.NaN, 2, 3, 4, 5], 3);
    expect(Number.isNaN(result[3] as number)).toBe(true);
    expect(result[4]).toBeCloseTo(1, 12);
  });
  it("rolls a mean that includes the current value", () => {
    const result = rollingMean([1, 2, 3, 4], 2);
    expect(Array.from(result)).toEqual([Number.NaN, 1.5, 2.5, 3.5]);
  });
});

describe("describeValues", () => {
  // numpy / scipy on [1, 2, 3, 4, 10]: 4.0, 3.0, 3.5355339059327378, skew(bias=False) 1.6970562748477143, kurtosis(bias=False) 3.152, p25 2, p75 4.
  it("gives the eight numbers scipy gives", () => {
    const summary = describeValues([1, 2, 3, 4, 10]);
    expect(summary.count).toBe(5);
    expect(summary.mean).toBeCloseTo(4, 12);
    expect(summary.median).toBe(3);
    expect(summary.standardDeviation).toBeCloseTo(3.5355339059327378, 12);
    expect(summary.skewness).toBeCloseTo(1.6970562748477143, 10);
    expect(summary.kurtosis).toBeCloseTo(3.152, 10);
    expect(summary.percentile25).toBe(2);
    expect(summary.percentile75).toBe(4);
    expect([summary.minimum, summary.maximum]).toEqual([1, 10]);
  });
  it("leaves the shape numbers unknown for a constant column and below 3 / 4 observations", () => {
    expect(describeValues([5, 5, 5, 5])).toMatchObject({ skewness: null, kurtosis: null, standardDeviation: 0 });
    expect(describeValues([1, 2, 4])).toMatchObject({ kurtosis: null });
    expect(describeValues([]).mean).toBeNull();
  });
  it("ignores unknown values", () => {
    expect(describeValues([1, Number.NaN, 3]).count).toBe(2);
  });
});

describe("unusual moves", () => {
  it("counts scored bars and the up and down moves at the threshold", () => {
    const moves = findUnusualMoves([Number.NaN, 0.5, 2.0, -2.5, 1.99, -2.0], 2);
    expect(moves.upIndices).toEqual([2]);
    expect(moves.downIndices).toEqual([3, 5]);
    expect(moves.scoredCount).toBe(5);
    expect(moves.unscoredCount).toBe(1);
  });
  // scipy.stats.norm: 2 * (1 - cdf(2.0)) = 0.04550026389635842; 2 * (1 - cdf(3.0)) = 0.0026997960632601866
  it("gives the bell-curve share beyond the threshold", () => {
    expect(normalTwoSidedShare(2)).toBeCloseTo(0.04550026389635842, 7);
    expect(normalTwoSidedShare(3)).toBeCloseTo(0.0026997960632601866, 8);
  });
  it("measures the observed tail share", () => {
    expect(observedTailShares([1, -2, 3, Number.NaN, 0.5], [1, 2, 3, 4])).toEqual([0.75, 0.5, 0.25, 0]);
    expect(observedTailShares([], [1])).toEqual([null]);
  });
});

describe("the selected bar", () => {
  const stamps = [1000, 2000, 3000, 4000];
  it("is the exact bar, else the bar at or before, and nothing outside the visible bars", () => {
    expect(resolveSelectedIndex(stamps, 3000)).toBe(2);
    expect(resolveSelectedIndex(stamps, 3500)).toBe(2);
    expect(resolveSelectedIndex(stamps, 500)).toBeNull();
    expect(resolveSelectedIndex(stamps, 4500)).toBeNull();
    expect(resolveSelectedIndex(stamps, null)).toBeNull();
    expect(resolveSelectedIndex([], 1000)).toBeNull();
  });
  it("words the rank the way the notebook does", () => {
    const frame = buildFrame(bodyOf(closesFor(RETURNS), 0), 3);
    const bar = selectedBar(frame, 7);
    const words = describeSelectedBar(bar, 3);
    expect(words.sentence).toContain("1.57 standard deviations above the average of the 3 bars before it");
    expect(words.sentence).toContain("at or above 100% of them");
    expect(describeSelectedBar(selectedBar(frame, 1), 3).sentence).toContain("no z-score yet: fewer than 3 earlier returns");
    expect(earlierReturns(frame, 7)).toEqual([0.03, -0.01, 0.005].map((v) => expect.closeTo(v, 12)));
  });
});

describe("bins and thinning", () => {
  it("picks the step Vega-Lite picks for maxbins 30 over 0..100", () => {
    const bins = niceBins(0, 100, 30);
    expect(bins[0]).toEqual({ lower: 0, upper: 5 });
    expect(bins).toHaveLength(21);
  });
  it("keeps a constant column as one bin and counts a brushed stretch", () => {
    expect(niceBins(7, 7, 30)).toEqual([{ lower: 7, upper: 7 }]);
    const bins = niceBins(0, 9, 10);
    const all = countInBins(bins, [0, 1, 1, 2, 9]);
    expect(all.reduce((a, b) => a + b, 0)).toBe(5);
    const brushed = countInBins(bins, [0, 1, 1, 2, 9], [10, 20, 30, 40, 50], { from: 20, to: 40 });
    expect(brushed.reduce((a, b) => a + b, 0)).toBe(3);
  });
  it("thins a long series but keeps the spike and skips unknowns", () => {
    const values = Array.from({ length: 10_000 }, (_, index) => (index === 6_543 ? 1_000 : Math.sin(index / 50)));
    values[10] = Number.NaN;
    const kept = thinIndices(values, 400);
    expect(kept.length).toBeLessThan(1_000);
    expect(kept).toContain(6_543);
    expect(kept).not.toContain(10);
    expect(thinIndices([1, Number.NaN, 3], 10)).toEqual([0, 2]);
  });
  it("prints six significant digits", () => {
    expect(sixSignificant(0.000123456789)).toBe("0.000123457");
    expect(sixSignificant(21234.5678)).toBe("21,234.6");
    expect(sixSignificant(null)).toBe("—");
  });
});

function bodyOf(closes: number[], warmupCount: number): ChartCompanionBody {
  return {
    symbol: "TEST", timeframe: "5m", assetClass: "forex", adjustment: "none", clock: "UTC",
    firstVisibleMs: 1, lastVisibleMs: closes.length, warmupCount, visibleCount: closes.length - warmupCount, warmupRequested: warmupCount, truncated: false,
    bars: {
      timestamps: closes.map((_, index) => (index + 1) * 300_000),
      open: closes, high: closes.map((c) => c + 0.5), low: closes.map((c) => c - 0.5), close: closes, volume: closes.map(() => 10),
    },
  };
}

describe("overlays", () => {
  const closes = closesFor([Number.NaN, ...Array.from({ length: 60 }, (_, index) => (index % 11 === 0 ? 0.05 : index % 7 === 0 ? -0.05 : 0.001 * ((index % 5) - 2)))]);
  const frame = buildFrame(bodyOf(closes, 10), 5);
  const all = { markers: true, levels: true, zones: true, selectedLine: true };

  it("draws arrows on unusual moves, three levels, high-volatility spans and the selected bar", () => {
    const overlays = buildOverlays(frame, 2, 4, all);
    const ids = overlays.map((overlay) => overlay.id);
    expect(ids).toEqual(expect.arrayContaining(["visible_high", "visible_low", "visible_volume_weighted_average_price", "selected_bar"]));
    const up = overlays.find((overlay) => overlay.id === "unusual_up_moves");
    expect(up?.kind).toBe("marker");
    if (up?.kind === "marker") {
      expect(up.markers.every((marker) => marker.shape === "arrowUp" && marker.position === "below")).toBe(true);
      const times = up.markers.map((marker) => marker.time);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    }
    const high = overlays.find((overlay) => overlay.id === "visible_high");
    expect(high?.kind === "level" && high.price).toBeCloseTo(Math.max(...closes.slice(10)) + 0.5, 9);
    const vwap = overlays.find((overlay) => overlay.id === "visible_volume_weighted_average_price");
    const typical = closes.slice(10).map((c) => (c + 0.5 + c - 0.5 + c) / 3);
    expect(vwap?.kind === "level" && vwap.price).toBeCloseTo(typical.reduce((a, b) => a + b, 0) / typical.length, 9);
  });

  it("draws only what is chosen and lists it in a manifest", () => {
    const none = buildOverlays(frame, 2, null, { markers: false, levels: false, zones: false, selectedLine: true });
    expect(none).toEqual([]);
    const levels = overlayManifest(buildOverlays(frame, 2, null, { markers: false, levels: true, zones: false, selectedLine: false }));
    expect(levels.map((row) => row.drawnAs)).toEqual(["horizontal line", "horizontal line", "horizontal line"]);
    expect(levels.every((row) => row.price !== null && row.itemCount === 1)).toBe(true);
  });

  it("never draws a level with no volume-weighted price when nothing traded", () => {
    const body = bodyOf(closes, 10);
    body.bars.volume = body.bars.volume.map(() => 0);
    const overlays = buildOverlays(buildFrame(body, 5), 2, null, { markers: false, levels: true, zones: false, selectedLine: false });
    expect(overlays.map((overlay) => overlay.id)).toEqual(["visible_high", "visible_low"]);
  });
});

// ── the handler ──────────────────────────────────────────────────────────────

const FIVE_MINUTES = 300_000;
const START = Date.UTC(2025, 5, 2, 0, 0);

function series(count: number, from = START, step = FIVE_MINUTES): BarRow[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 7) * 3 + index * 0.01;
    return { timestamp: from + index * step, open: close - 0.1, high: close + 0.4, low: close - 0.4, close, volume: 100 + (index % 9) };
  });
}

interface Call { symbol: string; timeframe: string; startMs: number; endMs: number; limit: number; newest: boolean }

function fakeLoader(rows: BarRow[], options: { futures?: boolean; anchor?: number | null } = {}): { loader: BarLoader; calls: Call[] } {
  const calls: Call[] = [];
  const loader: BarLoader = {
    isFuturesRoot: () => options.futures ?? false,
    async anchor() {
      return options.anchor === undefined ? (rows[rows.length - 1]?.timestamp ?? null) : options.anchor;
    },
    async bars(symbol, timeframe, startMs, endMs, limit, newest) {
      calls.push({ symbol, timeframe, startMs, endMs, limit, newest });
      const inside = rows.filter((row) => row.timestamp >= startMs && row.timestamp <= endMs);
      return newest ? inside.slice(-limit) : inside.slice(0, limit);
    },
  };
  return { loader, calls };
}

const fakeLake = (views: string[]): StudyLake => ({
  async query() {
    return [];
  },
  async hasView(name) {
    return views.includes(name);
  },
  async columns() {
    return [];
  },
});

async function runHandler(loader: BarLoader, rawQuery: Record<string, unknown>, views = ["ohlcv_5m", "ohlcv_1d"]) {
  const handler = createChartCompanionHandler(() => loader);
  const notes: string[] = [];
  const context: StudyContext = { lake: fakeLake(views), notes };
  const query = handler.query.parse(rawQuery);
  const data = await handler.run(query, context);
  return { data, notes, handler };
}

describe("chart-companion handler", () => {
  const rows = series(1_200);

  it("reads the visible range and the warm-up bars before it, warm-up first", async () => {
    const visibleStart = rows[600]!.timestamp;
    const visibleEnd = rows[799]!.timestamp;
    const { loader } = fakeLoader(rows);
    const { data, notes } = await runHandler(loader, { symbol: "eurusd", timeframe: "5m", startMs: visibleStart, endMs: visibleEnd });
    expect(data.symbol).toBe("EURUSD");
    expect(data.visibleCount).toBe(200);
    expect(data.warmupCount).toBe(WARMUP_BARS_DEFAULT);
    expect(data.bars.timestamps).toHaveLength(200 + WARMUP_BARS_DEFAULT);
    expect(data.bars.timestamps[WARMUP_BARS_DEFAULT]).toBe(visibleStart);
    expect(data.bars.timestamps[data.bars.timestamps.length - 1]).toBe(visibleEnd);
    expect(data.firstVisibleMs).toBe(visibleStart);
    expect(data.lastVisibleMs).toBe(visibleEnd);
    expect(data.adjustment).toBe("none");
    expect(data.clock).toBe("UTC");
    expect(data.truncated).toBe(false);
    expect(notes).toEqual([]);
    expect([...data.bars.timestamps]).toEqual([...data.bars.timestamps].sort((a, b) => a - b));
  });

  it("widens the look-back until the warm-up is covered", async () => {
    // One bar every 30 minutes on a 5-minute timeframe (overnight and weekend holes): three bar-lengths of look-back is too short.
    const sparse = series(1_200, START, 6 * FIVE_MINUTES);
    const { loader, calls } = fakeLoader(sparse);
    const visibleStart = sparse[500]!.timestamp;
    const { data } = await runHandler(loader, { symbol: "EURUSD", timeframe: "5m", startMs: visibleStart, endMs: sparse[520]!.timestamp, warmupBars: 450 });
    expect(data.warmupCount).toBe(450);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[1]!.startMs).toBeLessThan(calls[0]!.startMs);
  });

  it("notes a short warm-up at the start of the data", async () => {
    const { loader } = fakeLoader(rows);
    const { data, notes } = await runHandler(loader, { symbol: "EURUSD", timeframe: "5m", startMs: rows[50]!.timestamp, endMs: rows[100]!.timestamp });
    expect(data.warmupCount).toBe(50);
    expect(notes.join(" ")).toContain("Only 50 of 402 warm-up bars");
  });

  it("reads a futures root to the chart's last bar so the roll adjustment matches, and says the prices are ratio-adjusted", async () => {
    const { loader, calls } = fakeLoader(rows, { futures: true });
    const visibleEnd = rows[799]!.timestamp;
    const { data } = await runHandler(loader, { symbol: "MNQ", timeframe: "5m", startMs: rows[700]!.timestamp, endMs: visibleEnd, lastBarMs: rows[1_100]!.timestamp, warmupBars: 10 });
    expect(calls[0]!.endMs).toBe(rows[1_100]!.timestamp);
    expect(data.visibleCount).toBe(100); // still only the bars inside the visible range
    expect(data.adjustment).toBe("ratio");
    expect(data.assetClass).toBe("futures");
    expect(data.clock).toBe("exchange time (CME Pacific)");
  });

  it("reads the newest bars when no range is named, anchored on the newest stamp", async () => {
    const { loader, calls } = fakeLoader(rows);
    const { data } = await runHandler(loader, { symbol: "EURUSD", timeframe: "5m", visibleBars: 300, warmupBars: 50 });
    expect(data.visibleCount).toBe(300);
    expect(data.warmupCount).toBe(50);
    expect(data.lastVisibleMs).toBe(rows[rows.length - 1]!.timestamp);
    expect(data.firstVisibleMs).toBe(rows[rows.length - 300]!.timestamp);
    expect(calls[0]!.newest).toBe(true);
  });

  it("notes a half-given range and reads the newest bars", async () => {
    const { loader } = fakeLoader(rows);
    const { data, notes } = await runHandler(loader, { symbol: "EURUSD", timeframe: "5m", startMs: rows[10]!.timestamp, visibleBars: 20, warmupBars: 0 });
    expect(data.visibleCount).toBe(20);
    expect(notes[0]).toContain("Only one end of a time range");
  });

  it("drops rows that are not finite and treats a missing volume as zero", async () => {
    const dirty: BarRow[] = [...series(30), { timestamp: START + 30 * FIVE_MINUTES, open: Number.NaN, high: 1, low: 1, close: 1, volume: 1 }, { ...series(1, START + 31 * FIVE_MINUTES)[0]!, volume: Number.NaN }];
    const { loader } = fakeLoader(dirty);
    const { data } = await runHandler(loader, { symbol: "EURUSD", timeframe: "5m", visibleBars: 100, warmupBars: 0 });
    expect(data.visibleCount).toBe(31);
    expect(data.bars.volume[30]).toBe(0);
  });

  it("answers with an empty body and a note when the view is not in the lake", async () => {
    const { loader } = fakeLoader(rows);
    const { data, notes } = await runHandler(loader, { symbol: "EURUSD", timeframe: "5m", visibleBars: 100 }, []);
    expect(data.visibleCount).toBe(0);
    expect(data.bars.timestamps).toEqual([]);
    expect(notes[0]).toContain("ohlcv_5m");
  });

  it("answers with an empty body and a note when the symbol has no bars", async () => {
    const { loader } = fakeLoader([], { anchor: null });
    const { data, notes } = await runHandler(loader, { symbol: "EURUSD", timeframe: "5m", visibleBars: 100 });
    expect(data.visibleCount).toBe(0);
    expect(notes[0]).toContain("has no 5m bars");
  });

  it("answers with an empty body and a note when the range holds no bars", async () => {
    const { loader } = fakeLoader(rows);
    const { data, notes } = await runHandler(loader, { symbol: "EURUSD", timeframe: "5m", startMs: 1, endMs: 2, warmupBars: 0 });
    expect(data.visibleCount).toBe(0);
    expect(notes[0]).toContain("holds no EURUSD 5m bars");
  });

  it("parses the query: defaults, upper-cased symbols, refusal of a bad symbol, timeframe and range", async () => {
    const handler = createChartCompanionHandler(() => fakeLoader([]).loader);
    const parsed = handler.query.parse({ symbol: " mnq " });
    expect(parsed).toMatchObject({ symbol: "MNQ", timeframe: "1m", visibleBars: 500, warmupBars: WARMUP_BARS_DEFAULT });
    expect(handler.query.parse({ symbol: "MNQ", startMs: "1750000000000", endMs: "", timeframe: "4h" })).toMatchObject({ startMs: 1_750_000_000_000, endMs: undefined, timeframe: "4h" });
    expect(handler.query.safeParse({ symbol: "x'; DROP" }).success).toBe(false);
    expect(handler.query.safeParse({ symbol: "MNQ", timeframe: "2h" }).success).toBe(false);
    expect(handler.query.safeParse({ symbol: "MNQ", visibleBars: 5 }).success).toBe(false);
    expect(handler.slug).toBe("chart-companion");
    expect(handler.datasets).toContain("ohlcv_1h_v");
  });

  it("scores the returned bars with the same numbers the page shows (frame over warm-up + visible)", async () => {
    const { loader } = fakeLoader(rows);
    const { data } = await runHandler(loader, { symbol: "EURUSD", timeframe: "5m", startMs: rows[700]!.timestamp, endMs: rows[799]!.timestamp });
    const frame = buildFrame(data, 50);
    expect(frame.bars.timestamps).toHaveLength(100);
    // with 402 warm-up bars every visible bar already has a z-score and a volatility percentile
    expect(frame.scored.returnZscore.every((z) => !Number.isNaN(z))).toBe(true);
    expect(frame.scored.trailingTrueRangePercentile.every((p) => !Number.isNaN(p))).toBe(true);
  });
});

// ── the page, rendered over a handler body with fetch faked ──────────────────

interface Sent {
  url: string;
  method: string;
  body: string | null;
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

describe("chart-companion page", () => {
  afterEach(() => {
    cleanup();
    resetChartContextBridgeForTests();
    vi.unstubAllGlobals();
  });

  async function mount(selectedIndex: number | null) {
    const rows = series(900);
    const visibleStart = rows[500]!.timestamp;
    const visibleEnd = rows[799]!.timestamp;
    const { data } = await runHandler(fakeLoader(rows).loader, { symbol: "EURUSD", timeframe: "5m", startMs: visibleStart, endMs: visibleEnd });
    const sent: Sent[] = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      sent.push({ url, method, body: typeof init?.body === "string" ? init.body : null });
      if (url.startsWith("/api/studies/chart-companion")) return jsonResponse({ slug: "chart-companion", notes: [], data });
      if (url === "/api/chart/overlays" && method === "GET") return jsonResponse({ sets: [] });
      if (url.startsWith("/api/chart/overlays")) return jsonResponse(method === "PUT" ? { set: {} } : { removed: true });
      if (url === "/api/chart/context") return method === "PUT" ? jsonResponse({ changed: true }) : jsonResponse({ error: "none" }, 404);
      return jsonResponse({}, 404);
    });
    publishChartContext({
      symbol: "EURUSD", timeframe: "5m", assetClass: "forex", visibleStartMs: visibleStart, visibleEndMs: visibleEnd, cursorMs: null,
      selectedMs: selectedIndex === null ? null : rows[500 + selectedIndex]!.timestamp, firstBarMs: rows[0]!.timestamp, lastBarMs: rows[899]!.timestamp, barCount: 900,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(SymbolProvider, null, createElement(Page))));
    return { sent, data, rows };
  }

  it("follows the chart and shows every section over the bars the handler returned", async () => {
    const { sent, data } = await mount(150);
    await waitFor(() => expect(screen.getByText("The visible bars in numbers")).toBeTruthy(), { timeout: 10_000 });
    const asked = sent.find((entry) => entry.url.startsWith("/api/studies/chart-companion"));
    expect(asked?.url).toContain("symbol=EURUSD");
    expect(asked?.url).toContain("warmupBars=402");
    expect(screen.getAllByText("300 visible bars").length).toBeGreaterThan(0);
    for (const title of ["Every column, seen", "Which bars moved unusually", "The selected bar", "What would be drawn on the chart"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    for (const column of ["Open price", "Volume", "Log return (natural log of close over previous close)", "True range (price points)"]) {
      expect(screen.getAllByText(column).length).toBeGreaterThan(0);
    }
    // the flagged count the page words is the count the shared computation gives on the same bars
    const frame = buildFrame(data, 50);
    const moves = findUnusualMoves(frame.scored.returnZscore, 2);
    const flagged = moves.upIndices.length + moves.downIndices.length;
    expect(screen.getByText(`${flagged} of ${moves.scoredCount}`)).toBeTruthy();
    expect(screen.getAllByText(/standard deviations (above|below) the average of the 50 bars before it/).length).toBeGreaterThan(0);
    expect(screen.getByText("Every numeric column of the scored bars (300 rows)")).toBeTruthy();
  }, 30_000);

  it("says what to click when no bar is selected, and draws nothing until the switch is on", async () => {
    const { sent } = await mount(null);
    await waitFor(() => expect(screen.getByText("The visible bars in numbers")).toBeTruthy(), { timeout: 10_000 });
    expect(screen.getByText(/Click a bar on the Market chart to see it here/)).toBeTruthy();
    expect(sent.some((entry) => entry.method === "PUT" && entry.url === "/api/chart/overlays")).toBe(false);
    expect(screen.getByText(/Drawing is off/)).toBeTruthy();
  }, 30_000);

  it("pushes the overlays to the chart when Draw on the chart is switched on", async () => {
    const { sent } = await mount(150);
    await waitFor(() => expect(screen.getByText("The visible bars in numbers")).toBeTruthy(), { timeout: 10_000 });
    const toggle = screen.getAllByRole("switch").find((element) => element.closest("label")?.textContent?.includes("Draw on the chart"));
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle!);
    await waitFor(() => expect(sent.some((entry) => entry.method === "PUT" && entry.url === "/api/chart/overlays")).toBe(true), { timeout: 5_000 });
    const put = sent.find((entry) => entry.method === "PUT" && entry.url === "/api/chart/overlays")!;
    const payload = JSON.parse(put.body as string) as { source: string; symbol: string; timeframe: string; overlays: Array<{ kind: string; id: string }> };
    expect(payload).toMatchObject({ source: "chart_companion", symbol: "EURUSD", timeframe: "5m" });
    expect(payload.overlays.map((overlay) => overlay.id)).toEqual(expect.arrayContaining(["visible_high", "visible_low", "selected_bar"]));
  }, 30_000);
});
