import { useEffect, useRef } from 'react';
import { LineSeries, createSeriesMarkers, type IChartApi, type Time } from 'lightweight-charts';
import type { IndicatorOverlay } from '@/hooks/useIndicatorData';
import { dedupByTime } from './chartConfig';

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
    const existingKeys = Array.from(overlaySeriesRef.current.keys());

    // Remove series that are no longer selected
    for (const key of existingKeys) {
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
        });

        series.setData(dedupByTime(overlay.data.map(d => ({ time: d.time as Time, value: d.value }))));
        overlaySeriesRef.current.set(overlay.column, series);
      }
    }

    // Handle CDL markers
    if (candleSeriesRef.current) {
      const cdlOverlays = indicatorOverlays.filter(o => o.displayType === 'marker');
      if (cdlOverlays.length > 0) {
        const validCandleSet = new Set(candleTimes.map(d => d.time as number));

        const cdlMarkers = cdlOverlays.flatMap(overlay =>
          overlay.data
            .filter(d => validCandleSet.has(d.time))
            .map(d => ({
              time: d.time as Time,
              position: (d.value > 0 ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
              color: d.value > 0 ? '#facc15' : '#f97316',
              shape: (d.value > 0 ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
              text: overlay.column.replace('CDL_', ''),
            }))
        ).sort((a, b) => (a.time as number) - (b.time as number));

        if (cdlMarkers.length > 0) {
          if (!overlaySeriesRef.current.has('__cdl_markers__')) {
            const sm = createSeriesMarkers(candleSeriesRef.current, cdlMarkers);
            overlaySeriesRef.current.set('__cdl_markers__', sm);
          } else {
            overlaySeriesRef.current.get('__cdl_markers__').setMarkers(cdlMarkers);
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
