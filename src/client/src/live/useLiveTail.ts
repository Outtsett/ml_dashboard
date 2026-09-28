/**
 * The live tail of the Market chart: the hub's 1-minute bars after the lake's
 * last bar, rolled up to the chart's timeframe, with the forming bar updating
 * in place as ticks arrive.
 *
 * Bars carry `tChart`, the open in the chart's own stamping (the lake snapshot
 * stamps futures in Pacific wall clock), so a live ES bar lands next to the
 * lake's ES history instead of 7-8 hours away from it. The source and its
 * measured delay travel with the tail: OANDA forex is real time, Yahoo futures
 * run about ten minutes behind, Quantower prints are real time while it records.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OhlcvData } from "@/market/components/types";
import { minutesToApiKey } from "@/market/lib/timeframes";
import { useLiveBarsSnapshot, useLiveBarStream } from "./hooks";
import type { LiveBar } from "./types";

export interface LiveTail {
  bars: OhlcvData[];
  source: string | null;
  delaySeconds: number | null;
  connected: boolean;
  /** Minute bars the hub holds after the chart's last bar. */
  minuteBars: number;
  /** The chart holds the newest bar the chart API serves for this symbol, so
   *  the tail continues it; false while a scrolled-back or cached window shows. */
  atNewest: boolean;
}

const DAY = 86_400_000;

export function rollUp(minutes: LiveBar[], timeframeMinutes: number): OhlcvData[] {
  const width = timeframeMinutes * 60_000;
  const buckets = new Map<number, OhlcvData>();
  for (const bar of [...minutes].sort((a, b) => a.tChart - b.tChart)) {
    const bucket = Math.floor(bar.tChart / width) * width;
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, { timestamp: bucket, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/** The newest bar the chart API serves for the symbol (epoch ms, chart stamping). */
function useNewestChartBar(symbol: string, timeframeMinutes: number) {
  const timeframe = minutesToApiKey(timeframeMinutes);
  return useQuery({
    queryKey: ["/api/charts/ohlcv/newest", symbol, timeframe],
    queryFn: async ({ signal }) => {
      const url = `/api/charts/ohlcv?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=1&order=desc`;
      const response = await fetch(url, { signal });
      if (!response.ok) return null;
      const bars = (await response.json()) as OhlcvData[];
      return bars.length ? bars[bars.length - 1]!.timestamp : null;
    },
    staleTime: 5 * 60_000,
  });
}

export function useLiveTail(symbol: string, timeframeMinutes: number, lastChartTimestamp: number | null): LiveTail {
  const newestChartBar = useNewestChartBar(symbol, timeframeMinutes);
  const atNewest =
    newestChartBar.data != null && lastChartTimestamp !== null && lastChartTimestamp >= newestChartBar.data;
  // Nothing to continue until the chart has bars (and a moving Date.now() in
  // the query key would refetch on every render).
  const enabled = lastChartTimestamp !== null;
  // The hub filters on the true-UTC open; the chart's clock can be up to a day
  // behind that (Pacific), so ask from a day early and cut on tChart below.
  const since = lastChartTimestamp === null ? 0 : Math.floor((lastChartTimestamp - DAY) / 60_000) * 60_000;
  const snapshot = useLiveBarsSnapshot(enabled ? symbol : null, since);
  const [streamed, setStreamed] = useState<{ symbol: string; bars: Record<number, LiveBar> }>({ symbol, bars: {} });

  const { connected } = useLiveBarStream(enabled ? symbol : null, (bar) => {
    if (bar.symbol !== symbol) return;
    setStreamed((prev) => (prev.symbol === symbol ? { symbol, bars: { ...prev.bars, [bar.t]: bar } } : { symbol, bars: { [bar.t]: bar } }));
  });

  const merged = new Map<number, LiveBar>();
  for (const bar of snapshot.data?.bars ?? []) merged.set(bar.t, bar);
  if (streamed.symbol === symbol) for (const bar of Object.values(streamed.bars)) merged.set(bar.t, bar);
  const after = [...merged.values()].filter((bar) => lastChartTimestamp === null || bar.tChart > lastChartTimestamp);
  const newest = after.reduce<LiveBar | null>((best, bar) => (best === null || bar.t > best.t ? bar : best), null);

  // The first rolled-up bucket may share its open with the chart's last bar
  // (a partial bucket the lake already closed); only strictly later buckets
  // extend the chart.
  // ...and only when the chart shows its newest bar: after a scrolled-back or
  // cached window a live bar would land in the middle of history.
  const bars = atNewest ? rollUp(after, timeframeMinutes).filter((b) => lastChartTimestamp === null || b.timestamp > lastChartTimestamp) : [];

  return {
    bars,
    source: newest?.source ?? null,
    delaySeconds: newest?.delaySeconds ?? null,
    connected,
    minuteBars: after.length,
    atNewest,
  };
}
