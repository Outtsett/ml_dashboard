/**
 * What the Market chart shows right now, as the page needs it.
 *
 * The chart publishes its context (symbol, timeframe, visible range, clicked
 * bar) through `market/lib/chartContextBridge.ts`; this tab hears it as a
 * window event, so following the chart costs no request. A study opened in a
 * tab with no chart of its own falls back to the context the server last
 * received (GET /api/chart/context, polled every 5 s).
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { CHART_CONTEXT_EVENT, latestChartContext, type PublishedChartContext } from "@/market/lib/chartContextBridge";

function subscribe(listener: () => void): () => void {
  window.addEventListener(CHART_CONTEXT_EVENT, listener);
  return () => window.removeEventListener(CHART_CONTEXT_EVENT, listener);
}

export interface FollowedChart {
  context: PublishedChartContext | null;
  origin: "chart" | "server" | "none";
}

export function useFollowedChart(enabled: boolean): FollowedChart {
  const published = useSyncExternalStore(subscribe, latestChartContext, () => null);
  const server = useQuery({
    queryKey: ["chart-context"],
    queryFn: async ({ signal }): Promise<PublishedChartContext | null> => {
      const response = await fetch("/api/chart/context", { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`the chart context answered ${response.status}`);
      return (await response.json()) as PublishedChartContext;
    },
    enabled: enabled && published === null,
    refetchInterval: 5_000,
    retry: false,
  });
  if (published !== null) return { context: published, origin: "chart" };
  if (server.data) return { context: server.data, origin: "server" };
  return { context: null, origin: "none" };
}

/** A value that follows `value` after it has held still for `milliseconds` (a scroll or zoom fires many contexts). */
export function useSettled<T>(value: T, milliseconds: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), milliseconds);
    return () => clearTimeout(timer);
  }, [value, milliseconds]);
  return settled;
}

export interface ChartRequest {
  symbol: string;
  timeframe: string;
  assetClass: "futures" | "forex";
  startMs: number;
  endMs: number;
  lastBarMs: number | null;
}

/** The request the chart's context names: its visible range, or its loaded range when the view has not been published. Null while the chart has no bars. */
export function requestOf(context: PublishedChartContext | null): ChartRequest | null {
  if (!context) return null;
  const start = context.visibleStartMs ?? context.firstBarMs;
  const end = context.visibleEndMs ?? context.lastBarMs;
  if (start === null || end === null) return null;
  return {
    symbol: context.symbol,
    timeframe: context.timeframe,
    assetClass: context.assetClass,
    startMs: Math.min(start, end),
    endMs: Math.max(start, end),
    lastBarMs: context.lastBarMs,
  };
}
