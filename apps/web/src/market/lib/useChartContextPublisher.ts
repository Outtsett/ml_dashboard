/**
 * Publishes the Market chart's context (symbol, timeframe, visible range, the
 * clicked bar, the loaded span) whenever it changes — see chartContextBridge.ts.
 */

import { useEffect } from "react";
import { publishChartContext } from "./chartContextBridge";

export interface ChartContextInputs {
  symbol: string;
  /** The API timeframe key: 1m, 5m, 1h, 1d … */
  timeframe: string;
  assetClass: "futures" | "forex";
  visibleRange: { start: number; end: number } | null;
  selectedMs: number | null;
  /** The loaded bars' timestamps, epoch ms, ascending. */
  firstBarMs: number | null;
  lastBarMs: number | null;
  barCount: number;
}

export function useChartContextPublisher(inputs: ChartContextInputs): void {
  const { symbol, timeframe, assetClass, visibleRange, selectedMs, firstBarMs, lastBarMs, barCount } = inputs;
  const visibleStartMs = visibleRange ? Math.round(visibleRange.start) : null;
  const visibleEndMs = visibleRange ? Math.round(visibleRange.end) : null;
  useEffect(() => {
    if (!symbol || barCount === 0) return;
    publishChartContext({
      symbol,
      timeframe,
      assetClass,
      visibleStartMs,
      visibleEndMs,
      cursorMs: null,
      selectedMs,
      firstBarMs,
      lastBarMs,
      barCount,
    });
  }, [symbol, timeframe, assetClass, visibleStartMs, visibleEndMs, selectedMs, firstBarMs, lastBarMs, barCount]);
}
