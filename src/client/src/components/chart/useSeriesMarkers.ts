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
 * Build a Set of valid candle times for marker alignment filtering.
 */
export function buildCandleTimeSet(candles: { time: Time }[]): Set<number> {
  return new Set(candles.map(d => d.time as number));
}

/**
 * Align a millisecond timestamp to the nearest candle boundary.
 */
export function alignTimestamp(timestampMs: number, timeframeSec: number): number {
  const timestampSec = Math.floor(timestampMs / 1000);
  return Math.floor(timestampSec / timeframeSec) * timeframeSec;
}
