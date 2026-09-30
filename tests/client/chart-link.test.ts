// @vitest-environment jsdom
/**
 * The Market chart's side of the notebook link:
 *  - selectNotebookOverlays keeps the sets for the chart's symbol and timeframe
 *    and turns each overlay kind into what the chart draws, times in the chart's
 *    seconds, uncoloured overlays given Okabe-Ito colours in order;
 *  - zoneBarSpan / barIndexAtOrBefore snap a time to the bar that contains it
 *    and clip a zone to the loaded bars;
 *  - publishChartContext posts into every notebook frame, answers a frame that
 *    says it is ready, skips an identical context, and writes the server once
 *    per throttle window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlaySet } from "@shared/chartLink";
import { selectNotebookOverlays } from "@/market/lib/useNotebookOverlays";
import { NotebookDrawingsPrimitive, barIndexAtOrBefore, zoneBarSpan } from "@/market/components/notebookDrawings";
import { publishChartContext, resetChartContextBridgeForTests, type PublishedChartContext } from "@/market/lib/chartContextBridge";

const SETS: OverlaySet[] = [
  {
    source: "chart_companion",
    symbol: "MNQ",
    timeframe: "5m",
    updatedAtIso: "2026-09-29T00:00:00.000Z",
    overlays: [
      { kind: "line", id: "vwap", label: "Volume-weighted average price", pane: "price", points: [{ time: 2_000_000, value: 2 }, { time: 1_000_000, value: 1 }] },
      { kind: "line", id: "z", pane: "pane", color: "#56B4E9", points: [{ time: 1_000_000, value: 0.5 }] },
      { kind: "marker", id: "moves", markers: [{ time: 9_000_000, position: "below", shape: "arrowUp", text: "2.8" }, { time: 3_000_000, position: "above", shape: "arrowDown" }] },
      { kind: "level", id: "high", label: "Visible high", price: 21_000.25, style: "dashed" },
      { kind: "zone", id: "volatile", label: "high volatility", zones: [{ start: 8_000_000, end: 6_000_000 }] },
      { kind: "vline", id: "focus", times: [5_000_000] },
    ],
  },
  { source: "other", symbol: "ES", timeframe: "5m", updatedAtIso: "x", overlays: [{ kind: "level", id: "es", price: 5000, style: "solid" }] },
  { source: "wrong_timeframe", symbol: "mnq", timeframe: "1h", updatedAtIso: "x", overlays: [{ kind: "level", id: "h", price: 1, style: "solid" }] },
];

describe("selectNotebookOverlays", () => {
  it("keeps only the chart's symbol (any case) and timeframe, and maps every kind", () => {
    const view = selectNotebookOverlays(SETS, "mnq", "5m");
    expect(view.sets).toHaveLength(3);
    expect(view.lines.map((line) => [line.column, line.displayType])).toEqual([
      ["notebook:chart_companion:vwap", "overlay"],
      ["notebook_chart_companion_z::z", "subchart"],
    ]);
    // Seconds, ascending, whatever order the notebook sent.
    expect(view.lines[0]!.data).toEqual([{ time: 1000, value: 1 }, { time: 2000, value: 2 }]);
    expect(view.lines[1]!.color).toBe("#56B4E9");
    expect(view.markers.map((marker) => marker.timeMs)).toEqual([3_000_000, 9_000_000]);
    expect(view.drawings.levels).toEqual([{ key: "chart_companion:high", price: 21_000.25, color: expect.any(String), label: "Visible high", style: "dashed" }]);
    // A zone given end-before-start is normalised.
    expect(view.drawings.zones[0]).toMatchObject({ startMs: 6_000_000, endMs: 8_000_000, label: "high volatility" });
    expect(view.drawings.verticalLines[0]).toMatchObject({ timeMs: 5_000_000, label: "focus" });
  });

  it("gives uncoloured overlays Okabe-Ito colours only", () => {
    const view = selectNotebookOverlays(SETS, "MNQ", "5m");
    const okabeIto = new Set(["#E69F00", "#0072B2", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442"]);
    for (const colour of [view.lines[0]!.color, view.markers[0]!.color, view.drawings.levels[0]!.color]) expect(okabeIto.has(colour)).toBe(true);
  });
});

describe("zoneBarSpan", () => {
  const times = [100, 160, 220, 280];
  it("snaps a time to the bar that contains it", () => {
    expect(barIndexAtOrBefore(times, 99)).toBe(-1);
    expect(barIndexAtOrBefore(times, 100)).toBe(0);
    expect(barIndexAtOrBefore(times, 219)).toBe(1);
    expect(barIndexAtOrBefore(times, 10_000)).toBe(3);
  });
  it("clips a zone to the loaded bars and drops one wholly outside", () => {
    expect(zoneBarSpan(times, 50_000, 230_000)).toEqual({ first: 0, last: 2 });
    expect(zoneBarSpan(times, 170_000, 900_000)).toEqual({ first: 1, last: 3 });
    expect(zoneBarSpan(times, 1_000, 2_000)).toBeNull();
    expect(zoneBarSpan(times, 500_000, 900_000)).toBeNull();
  });
});

describe("publishChartContext", () => {
  const context: PublishedChartContext = {
    symbol: "MNQ", timeframe: "5m", assetClass: "futures",
    visibleStartMs: 1, visibleEndMs: 2, cursorMs: null, selectedMs: null,
    firstBarMs: 1, lastBarMs: 2, barCount: 2,
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetChartContextBridgeForTests();
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = '<iframe src="/marimo/ml-dashboard/?file=x"></iframe><iframe src="/some/other/page"></iframe>';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("posts into notebook frames only, skips an identical context, and throttles the server write", async () => {
    const frames = [...document.querySelectorAll("iframe")];
    const notebookPost = vi.spyOn(frames[0]!.contentWindow!, "postMessage");
    const otherPost = vi.spyOn(frames[1]!.contentWindow!, "postMessage");
    publishChartContext(context);
    publishChartContext({ ...context });
    publishChartContext({ ...context, selectedMs: 2 });
    expect(notebookPost).toHaveBeenCalledTimes(2);
    expect(notebookPost.mock.calls[1]![0]).toEqual({ type: "dashboard:chart-context", context: { ...context, selectedMs: 2 } });
    expect(otherPost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toMatchObject({ selectedMs: 2 });
  });

  it("answers a notebook that says it is ready with the current context", () => {
    publishChartContext({ ...context, symbol: "ES" });
    const reply = vi.fn();
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "dashboard:notebook-ready" },
      origin: window.location.origin,
      source: { postMessage: reply } as unknown as Window,
    }));
    expect(reply).toHaveBeenCalledWith({ type: "dashboard:chart-context", context: { ...context, symbol: "ES" } }, window.location.origin);
    // Another origin is ignored.
    const foreign = vi.fn();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "dashboard:notebook-ready" }, origin: "http://evil.example", source: { postMessage: foreign } as unknown as Window }));
    expect(foreign).not.toHaveBeenCalled();
  });
});

describe("NotebookDrawingsPrimitive bands", () => {
  it("draws a support / resistance cloud from its first pivot to the last bar between its two prices, even when the first pivot is off screen", () => {
    const primitive = new NotebookDrawingsPrimitive();
    const times = Array.from({ length: 50 }, (_, i) => 1_000 + i * 60);
    const fake = {
      chart: { timeScale: () => ({ options: () => ({ barSpacing: 10 }), logicalToCoordinate: (index: number) => index * 10 - 200 }) },
      series: { priceToCoordinate: (price: number) => 1_000 - price },
      requestUpdate: () => {},
    };
    primitive.attached(fake as never);
    primitive.set(times, [], [], [{ startMs: times[5]! * 1000, endMs: null, top: 620, bottom: 600, color: "#0072B2", label: "Support zone · 3 touches" }]);
    const rects: number[][] = [];
    const texts: string[] = [];
    const context = {
      save() {}, restore() {}, fillRect: (...args: number[]) => rects.push(args), strokeRect() {}, fillText: (t: string) => texts.push(t),
      setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      fillStyle: "", strokeStyle: "", lineWidth: 1, font: "",
    };
    const target = { useMediaCoordinateSpace: (fn: (scope: { context: unknown; mediaSize: { width: number; height: number } }) => void) => fn({ context, mediaSize: { width: 800, height: 400 } }) };
    primitive.paneViews()[0]!.renderer()!.draw(target as never);
    // bar 5 sits at x = 5 * 10 - 200 = -150 (off screen to the left): still drawn, from there to the right edge
    expect(rects).toHaveLength(1);
    const [x, y, w, h] = rects[0]!;
    expect(x).toBe(-155);
    expect(y).toBe(1_000 - 620);
    expect(h).toBe(20);
    expect(x + w).toBe(805);
    expect(texts).toContain("Support zone · 3 touches");
  });
});
