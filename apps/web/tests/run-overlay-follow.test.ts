// @vitest-environment jsdom
/**
 * `apps/web/src/cycle/useRunOverlay.ts` — where the view points while a run is
 * on the Market chart.
 *
 * The market chart is ALREADY on screen when a run's bars land, and it applies
 * the new `data` prop on its own animation frame — one store notification
 * before the candles are really there. So every pass of the overlay runs
 * against a chart that still holds the market's own bars, and only a later pass
 * sees the run's. These tests pin the transition that makes the chart jump to
 * the most recent candle's close:
 *
 *   1. a run's bars land while the chart holds the market's → the market's bars
 *      must not read as "the run's bars drawn", and the frame that lands once
 *      the chart has them must put the newest candle in view;
 *   2. hiding a run and showing it again re-frames, with no new bar to trigger it.
 */
import "./setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useRunOverlay, type RunOverlayTarget } from "@/cycle/useRunOverlay";
import { useCycleStore } from "@/cycle/store";
import { FOLLOW_RIGHT_PADDING_BARS } from "@/cycle/chartModel";
import type { CycleBars } from "@shared/cycle/schema";

const FIVE_MINUTES = 300;
/** The run's bars start here; the market's window starts much earlier. */
const RUN_START = 1_735_700_000;
const MARKET_START = RUN_START - 5_000 * FIVE_MINUTES;
const MARKET_BARS = 25_000;
const RUN_BARS = 300;

function barTime(index: number, start: number = RUN_START): number {
  return start + index * FIVE_MINUTES;
}

function runBarsEvent(from: number, count: number, start: number = RUN_START): CycleBars {
  const timestamps = Array.from({ length: count }, (_, i) => barTime(from + i, start));
  const close = timestamps.map((_, i) => 100 + ((from + i) % 7) - 3);
  const probabilityUp = timestamps.map((_, i) => ((from + i) % 10) / 10);
  const predictedDirection = probabilityUp.map((p) => ((p ?? 0.5) > 0.55 ? 1 : (p ?? 0.5) < 0.45 ? -1 : 0));
  return {
    role: from === 0 ? "context" : "processed",
    foldIndex: 0,
    timestamps,
    open: close.map((value) => value - 0.5),
    high: close.map((value) => value + 1),
    low: close.map((value) => value - 1),
    close,
    volume: close.map(() => 10),
    probabilityUp,
    predictedDirection,
    position: predictedDirection,
    equityUsd: timestamps.map((_, i) => (from + i) * 1.5 - 20),
  };
}

interface FakeCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function candleWindow(from: number, count: number, start: number): FakeCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + ((from + i) % 7) - 3;
    return {
      time: barTime(from + i, start),
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 10,
    };
  });
}

/**
 * Enough of a lightweight-charts chart for the overlay: the candle series holds
 * a real array (so `data()` reports what is really drawn), the time scale holds
 * a real visible logical range, and attaching a primitive speaks the same
 * protocol the library does.
 */
function fakeChart(initial: FakeCandle[]) {
  let candles = [...initial];
  let range: { from: number; to: number } = { from: 0, to: initial.length - 1 + 8 };
  const forecast: { time: number; value: number }[] = [];

  const timeScale = {
    getVisibleLogicalRange: () => ({ from: range.from, to: range.to }),
    setVisibleLogicalRange: (next: { from: number; to: number }) => {
      range = { from: next.from, to: next.to };
    },
    subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {},
    options: () => ({ barSpacing: 7 }),
    logicalToCoordinate: (index: number) => index * 7,
    coordinateToLogical: (x: number) => x / 7,
  };

  const candleSeries = {
    data: () => candles.map((candle) => ({ ...candle })),
    attachPrimitive: (primitive: {
      attached?: (param: unknown) => void;
      detached?: () => void;
    }) => {
      primitive.attached?.({ chart, series: candleSeries, requestUpdate: () => {} });
      return () => primitive.detached?.();
    },
  };

  const chart = {
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {},
    subscribeClick: () => {},
    addSeries: () => ({
      setData: (points: readonly { time: number; value: number }[]) => {
        forecast.splice(0, forecast.length, ...points);
      },
      update: (point: { time: number; value: number }) => {
        const at = forecast.findIndex((existing) => existing.time === point.time);
        if (at < 0) forecast.push(point);
        else forecast[at] = point;
      },
      applyOptions: () => {},
    }),
  };

  return {
    target: { chart, candleSeries, container: document.createElement("div") } as unknown as RunOverlayTarget,
    range: () => ({ from: range.from, to: range.to }),
    setRange: (next: { from: number; to: number }) => {
      range = { from: next.from, to: next.to };
    },
    /** What `useChartSeries` does on its own frame: put the run's bars on the series. */
    applyBars: (next: FakeCandle[]) => {
      candles = [...next];
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useCycleStore.setState({
    modelId: null,
    modelType: null,
    status: "idle",
    error: null,
    plan: null,
    cursor: null,
    bars: { timestamps: [], open: [], high: [], low: [], close: [], volume: [], probabilityUp: [], predictedDirection: [], position: [], equityUsd: [] },
    barsVersion: 0,
    barCount: 0,
    barsEpoch: 0,
    trades: [],
    follow: true,
    showOnChart: true,
    focusTimestamp: null,
    inspectTimestamp: null,
    inspectSource: "cursor",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a run's bars land on a chart already showing the market", () => {
  it("jumps to the most recent candle once the chart holds the run's bars", () => {
    const fake = fakeChart(candleWindow(0, MARKET_BARS, MARKET_START));
    let attach: ((target: RunOverlayTarget | null) => void) | null = null;
    const onChartReady = (next: (target: RunOverlayTarget | null) => void) => {
      attach = next;
    };

    const { unmount } = renderHook(() => useRunOverlay({ onChartReady }));
    act(() => attach!(fake.target));

    // A run starts, then delivers its first bars. The chart still holds the
    // market's: `useChartSeries` applies the new data on its own frame.
    act(() => useCycleStore.getState().begin("run-1", "xgboost+walk_forward_cycle"));
    act(() => useCycleStore.getState().applyEvents([{ type: "cycle_bars", data: runBarsEvent(0, RUN_BARS) }]));
    act(() => fake.applyBars(candleWindow(0, RUN_BARS, RUN_START)));
    act(() => {
      vi.advanceTimersByTime(250);
    });

    const range = fake.range();
    expect(range.to).toBe(RUN_BARS - 1 + FOLLOW_RIGHT_PADDING_BARS);
    // The newest candle is in view, not parked at the market's own newest bar.
    expect(range.from).toBeLessThanOrEqual(RUN_BARS - 1);
    expect(range.to).toBeLessThan(MARKET_BARS);

    unmount();
  });

  it("re-frames when a hidden run is shown again, with no new bar to trigger it", () => {
    const fake = fakeChart(candleWindow(0, MARKET_BARS, MARKET_START));
    let attach: ((target: RunOverlayTarget | null) => void) | null = null;
    const onChartReady = (next: (target: RunOverlayTarget | null) => void) => {
      attach = next;
    };

    const { unmount } = renderHook(() => useRunOverlay({ onChartReady }));
    act(() => attach!(fake.target));

    act(() => useCycleStore.getState().begin("run-1", "xgboost+walk_forward_cycle"));
    act(() => useCycleStore.getState().applyEvents([{ type: "cycle_bars", data: runBarsEvent(0, RUN_BARS) }]));
    act(() => fake.applyBars(candleWindow(0, RUN_BARS, RUN_START)));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(fake.range().to).toBe(RUN_BARS - 1 + FOLLOW_RIGHT_PADDING_BARS);

    // The user pans away, hides the run (the market's own bars come back) and
    // shows it again. Nothing about the run moved, so only the show can frame it.
    act(() => fake.setRange({ from: 10, to: 90 }));
    act(() => useCycleStore.getState().setShowOnChart(false));
    act(() => fake.applyBars(candleWindow(0, MARKET_BARS, MARKET_START)));
    act(() => useCycleStore.getState().setShowOnChart(true));
    act(() => fake.applyBars(candleWindow(0, RUN_BARS, RUN_START)));
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(fake.range().to).toBe(RUN_BARS - 1 + FOLLOW_RIGHT_PADDING_BARS);

    unmount();
  });
});