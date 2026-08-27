import { useEffect } from 'react';
import { createSeriesMarkers, type Time } from 'lightweight-charts';

export interface ChartMarker {
  time: Time;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text: string;
  /**
   * lightweight-charts marker size multiplier (default 1). The label overlay
   * uses it to carry label magnitude, so ±2 reads as stronger than ±1 without
   * needing a fifth shape the library does not have.
   */
  size?: number;
}

// Use `any` for the markers plugin ref — lightweight-charts' generic ISeriesMarkersPluginApi<T>
// is covariant on T, making it impractical to type the ref without casting everywhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MarkersRef = React.MutableRefObject<any>;

/**
 * Generic hook that manages a set of lightweight-charts series markers.
 * Handles the create-or-update-or-clear lifecycle that was previously
 * copy-pasted 6 times in TradingChart.
 */
export function useSeriesMarkers(
  seriesRef: MarkersRef,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  candleSeriesRef: React.RefObject<any>,
  markers: ChartMarker[],
) {
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    if (markers.length === 0) {
      if (seriesRef.current) {
        seriesRef.current.setMarkers([]);
      }
      return;
    }

    if (seriesRef.current) {
      seriesRef.current.setMarkers(markers);
    } else {
      seriesRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
    }
  }, [seriesRef, candleSeriesRef, markers]);
}

/**
 * Ascending list of the times of the bars actually on the chart.
 * `processedData.candles` is already built in time order, so this is a cheap
 * projection rather than a sort.
 */
export function buildCandleTimes(candles: { time: Time }[]): number[] {
  return candles.map(d => d.time as number);
}

/**
 * Snap a millisecond timestamp onto the bar that contains it.
 *
 * Returns the time of the greatest candle at or before `timestampMs`, so a
 * marker always lands on a bar that exists — including on session-offset
 * timeframes (4h futures bars open at 22:00 UTC, not on an epoch multiple of
 * 14400s) where arithmetic flooring produces a boundary with no candle and the
 * marker gets silently dropped instead of drawn.
 *
 * Returns null when the timestamp falls outside the loaded range: before the
 * first bar, or at/past the next bar's open. Callers filter those out.
 *
 * The tolerance past the last bar stops one second short of a full timeframe
 * on purpose. `last + timeframeSec` is exactly the NEXT bar's open — a bar the
 * chart has not loaded — and accepting it folded that bar's label onto the
 * rightmost candle, so the last bar could show a marker belonging to a
 * different bar. The overlay pads its query 20% past the viewport, so such
 * timestamps are routinely in the response. Anything strictly inside the
 * final bar still snaps to it, which is what session-offset timeframes need.
 */
export function snapToCandle(
  timestampMs: number,
  sortedTimes: number[],
  timeframeSec: number,
): number | null {
  if (sortedTimes.length === 0) return null;
  const t = Math.floor(timestampMs / 1000);
  const first = sortedTimes[0]!;
  const last = sortedTimes[sortedTimes.length - 1]!;
  if (t < first || t >= last + timeframeSec) return null;

  // Greatest index whose time is <= t.
  let lo = 0;
  let hi = sortedTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sortedTimes[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return sortedTimes[lo]!;
}
