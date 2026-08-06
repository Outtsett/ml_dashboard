import { useEffect } from 'react';
import { createSeriesMarkers, type Time } from 'lightweight-charts';

export interface ChartMarker {
  time: Time;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text: string;
}

// Use `any` for the markers plugin ref — lightweight-charts' generic ISeriesMarkersPluginApi<T>
// is covariant on T, making it impractical to type the ref without casting everywhere.
type MarkersRef = React.MutableRefObject<any>;

/**
 * Generic hook that manages a set of lightweight-charts series markers.
 * Handles the create-or-update-or-clear lifecycle that was previously
 * copy-pasted 6 times in TradingChart.
 */
export function useSeriesMarkers(
  seriesRef: MarkersRef,
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
 * first bar, or more than one bar past the last. Callers filter those out.
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
  if (t < first || t > last + timeframeSec) return null;

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
