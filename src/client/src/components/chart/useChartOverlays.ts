import { useEffect, useRef } from 'react';
import { LineSeries, createSeriesMarkers, type IChartApi, type Time } from 'lightweight-charts';
import type { IndicatorOverlay } from '@/hooks/useIndicatorData';
import { getPatternDisplayName } from '@/lib/candlePatterns';
import { getSeriesTitle } from '@/lib/indicatorPanels';
import { dedupByTime } from './chartConfig';

/**
 * Snap a marker timestamp to the nearest candle time.
 * Uses binary search for O(log n) lookup.
 * Returns the matched candle time, or -1 if no candle is close enough.
 *
 * @param markerTime - Marker timestamp in seconds
 * @param sortedCandleTimes - Sorted array of candle timestamps in seconds
 * @param maxGapSec - Maximum allowed gap (half a candle interval)
 */
function snapToCandle(
  markerTime: number,
  sortedCandleTimes: number[],
  maxGapSec: number,
): number {
  const len = sortedCandleTimes.length;
  if (len === 0) return -1;

  let lo = 0;
  let hi = len - 1;

  // Binary search for closest
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midVal = sortedCandleTimes[mid]!;
    if (midVal === markerTime) return midVal;
    if (midVal < markerTime) lo = mid + 1;
    else hi = mid - 1;
  }

  // lo is the insertion point — check lo and lo-1 for closest
  let best = -1;
  let bestDist = Infinity;
  for (const idx of [lo - 1, lo]) {
    if (idx >= 0 && idx < len) {
      const dist = Math.abs(sortedCandleTimes[idx]! - markerTime);
      if (dist < bestDist) {
        bestDist = dist;
        best = sortedCandleTimes[idx]!;
      }
    }
  }

  return bestDist <= maxGapSec ? best : -1;
}

/**
 * Manages indicator overlay series on the main chart.
 * Handles adding/removing/updating LineSeries for overlay indicators,
 * and CDL pattern markers via createSeriesMarkers.
 */
export function useChartOverlays(
  chartRef: React.RefObject<IChartApi | null>,
  candleSeriesRef: React.RefObject<any>,
  indicatorOverlays: IndicatorOverlay[],
  candleTimes: { time: Time }[],
) {
  const overlaySeriesRef = useRef<Map<string, any>>(new Map());

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      overlaySeriesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const currentKeys = new Set(indicatorOverlays.map(o => o.column));
    const markerKeys = new Set(
      indicatorOverlays.filter(o => o.displayType === 'marker').map(o => o.column),
    );
    const existingKeys = Array.from(overlaySeriesRef.current.keys());

    // Remove line series that are no longer selected.
    // Skip __cdl_markers__ (managed separately) and marker-type overlay keys
    // (CDL patterns don't have their own LineSeries — they share the markers primitive).
    for (const key of existingKeys) {
      if (key === '__cdl_markers__') continue;
      if (markerKeys.has(key)) continue;
      if (!currentKeys.has(key)) {
        const series = overlaySeriesRef.current.get(key);
        if (series) {
          try { chart.removeSeries(series); } catch { /* series already removed from chart */ }
        }
        overlaySeriesRef.current.delete(key);
      }
    }

    // Add or update overlay series
    for (const overlay of indicatorOverlays) {
      const existing = overlaySeriesRef.current.get(overlay.column);

      if (existing) {
        existing.setData(dedupByTime(overlay.data.map(d => ({ time: d.time as Time, value: d.value }))));
      } else if (overlay.displayType === 'marker') {
        // CDL pattern markers — handled via createSeriesMarkers below
      } else {
        const series = chart.addSeries(LineSeries, {
          color: overlay.color,
          lineWidth: overlay.lineWidth as 1 | 2 | 3 | 4,
          priceScaleId: 'right',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 3,
          title: getSeriesTitle(overlay.column),
        });

        series.setData(dedupByTime(overlay.data.map(d => ({ time: d.time as Time, value: d.value }))));
        overlaySeriesRef.current.set(overlay.column, series);
      }
    }

    // Handle CDL markers
    if (candleSeriesRef.current) {
      const cdlOverlays = indicatorOverlays.filter(o => o.displayType === 'marker');
      if (cdlOverlays.length > 0) {
        // Build sorted candle time array for binary-search snapping
        const sortedCandleTimes = candleTimes
          .map(d => d.time as number)
          .sort((a, b) => a - b);

        // Compute max snap gap: if we have >= 2 candles, use the median interval;
        // otherwise default to 60s (1 minute).
        let maxGapSec = 60;
        if (sortedCandleTimes.length >= 2) {
          // Use first interval as representative (candles are evenly spaced)
          const interval = sortedCandleTimes[1]! - sortedCandleTimes[0]!;
          maxGapSec = Math.max(interval, 60);
        }

        const cdlMarkers = cdlOverlays.flatMap(overlay =>
          overlay.data
            .map(d => {
              const snapped = snapToCandle(d.time, sortedCandleTimes, maxGapSec);
              if (snapped === -1) return null;
              return {
                time: snapped as Time,
                position: (d.value > 0 ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
                color: d.value > 0 ? '#22c55e' : '#ef4444',
                shape: (d.value > 0 ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
                text: getPatternDisplayName(overlay.column),
              };
            })
            .filter((m): m is NonNullable<typeof m> => m !== null)
        ).sort((a, b) => (a.time as number) - (b.time as number));

        // Deduplicate markers at the same time (keep first per time)
        const deduped: typeof cdlMarkers = [];
        const seenTimes = new Map<number, Set<string>>();
        for (const m of cdlMarkers) {
          const t = m.time as number;
          if (!seenTimes.has(t)) seenTimes.set(t, new Set());
          const textSet = seenTimes.get(t)!;
          if (!textSet.has(m.text)) {
            textSet.add(m.text);
            deduped.push(m);
          }
        }

        if (deduped.length > 0) {
          if (!overlaySeriesRef.current.has('__cdl_markers__')) {
            const sm = createSeriesMarkers(candleSeriesRef.current, deduped);
            overlaySeriesRef.current.set('__cdl_markers__', sm);
          } else {
            overlaySeriesRef.current.get('__cdl_markers__').setMarkers(deduped);
          }
        } else {
          // No markers matched — clear any existing
          const cdlSm = overlaySeriesRef.current.get('__cdl_markers__');
          if (cdlSm) {
            cdlSm.setMarkers([]);
            overlaySeriesRef.current.delete('__cdl_markers__');
          }
        }
      } else {
        // Clear CDL markers if none selected
        const cdlSm = overlaySeriesRef.current.get('__cdl_markers__');
        if (cdlSm) {
          cdlSm.setMarkers([]);
          overlaySeriesRef.current.delete('__cdl_markers__');
        }
      }
    }
  }, [chartRef, candleSeriesRef, indicatorOverlays, candleTimes]);

  return overlaySeriesRef;
}
