/**
 * The window the Market chart is showing, read back from the context it
 * publishes — so every surface beside the chart can answer "which bars?"
 * without inventing an answer of its own.
 *
 * The chart publishes `visibleStartMs` / `visibleEndMs`, the bars it has loaded
 * (`firstBarMs`, `lastBarMs`, `barCount`) and the bar last clicked. The bar
 * interval is derived from what is loaded rather than from the timeframe
 * string, because a chart that skipped a weekend is not one bar per interval
 * apart. The visible window is then converted into a bar count, which is what
 * `/api/analytics` and `/api/charts/ohlcv` both take.
 *
 * The value survives the chart being unmounted: chartContextBridge keeps the
 * last context in module state, which is exactly what a reader means by "the
 * window I was looking at" after they navigate away from it.
 */

import { useEffect, useState } from "react";
import { CHART_CONTEXT_EVENT, latestChartContext, type PublishedChartContext } from "./chartContextBridge";

export interface ChartWindowOptions {
  /** Fewest bars the consumer's route will accept (its own floor). */
  min?: number;
  /** Most bars the consumer's route will accept (its own ceiling). */
  max?: number;
}

export interface ChartWindow {
  /** The chart's visible window as a bar count, clamped to the consumer's range. */
  bars: number;
  /** True when the clamp moved the number — the surface should say so. */
  clamped: boolean;
  /** Where the number came from: the visible window, or every loaded bar. */
  source: "visible" | "loaded";
  visibleStartMs: number | null;
  visibleEndMs: number | null;
  selectedMs: number | null;
  /** Milliseconds between two loaded bars, or null when fewer than two are loaded. */
  barIntervalMs: number | null;
  symbol: string;
  timeframe: string;
}

/** Subscribe to the published context; the last one published is the seed. */
export function usePublishedChartContext(): PublishedChartContext | null {
  const [context, setContext] = useState<PublishedChartContext | null>(() => latestChartContext());
  useEffect(() => {
    const onContext = (event: Event) => {
      setContext((event as CustomEvent<PublishedChartContext>).detail);
    };
    window.addEventListener(CHART_CONTEXT_EVENT, onContext);
    setContext(latestChartContext());
    return () => window.removeEventListener(CHART_CONTEXT_EVENT, onContext);
  }, []);
  return context;
}

function clamp(value: number, min: number, max: number): { value: number; clamped: boolean } {
  const bounded = Math.min(max, Math.max(min, value));
  return { value: bounded, clamped: bounded !== value };
}

/**
 * The published context as a window, or null when the chart has published
 * nothing yet (a cold load, or a reader who has never opened the chart).
 */
export function chartWindowFrom(
  context: PublishedChartContext | null,
  { min = 100, max = 100_000 }: ChartWindowOptions = {},
): ChartWindow | null {
  if (!context) return null;
  const loaded = context.barCount;
  const span = context.lastBarMs !== null && context.firstBarMs !== null ? context.lastBarMs - context.firstBarMs : null;
  const barIntervalMs = span !== null && loaded > 1 ? span / (loaded - 1) : null;

  const visibleSpan =
    context.visibleEndMs !== null && context.visibleStartMs !== null ? context.visibleEndMs - context.visibleStartMs : null;

  let raw: number;
  let source: ChartWindow["source"];
  if (visibleSpan !== null && barIntervalMs !== null && barIntervalMs > 0) {
    raw = Math.round(visibleSpan / barIntervalMs) + 1;
    source = "visible";
  } else {
    raw = loaded;
    source = "loaded";
  }

  const { value: bars, clamped } = clamp(Number.isFinite(raw) && raw > 0 ? raw : min, min, max);
  return {
    bars,
    clamped,
    source,
    visibleStartMs: context.visibleStartMs,
    visibleEndMs: context.visibleEndMs,
    selectedMs: context.selectedMs,
    barIntervalMs,
    symbol: context.symbol,
    timeframe: context.timeframe,
  };
}

/** One line naming the window, for a surface that is showing it. */
export function describeChartWindow(window: ChartWindow | null): string {
  if (!window) return "no chart window published yet";
  const from = window.source === "visible" ? "the chart's visible window" : "every bar the chart has loaded";
  const clamp = window.clamped ? ", clamped to what this page accepts" : "";
  return `${window.bars.toLocaleString()} bars from ${from}${clamp}`;
}