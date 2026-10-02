import { useEffect, useRef } from 'react';
import {
  LineSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from 'lightweight-charts';
import type { ZigZagPoint } from '@/market/lib/chart_overlays';
import { dedupByTime } from './chartConfig';

// ── Types ──────────────────────────────────────────────────────────────────

interface ChartZigZagOverlaysOptions {
  chartRef: React.MutableRefObject<IChartApi | null>;
  zigZagPoints: ZigZagPoint[];
  swingZigZagPoints: ZigZagPoint[];
  decimals: number;
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Manages microstructure (zigzag) line + markers and microstructure swing
 * line + markers on the chart.
 *
 * Support / resistance zones are rendered as shaded bands by
 * useNotebookDrawings (notebookDrawings.ts) — not as price lines here.
 */
export function useChartZigZagOverlays({
  chartRef,
  zigZagPoints, swingZigZagPoints,
  decimals,
}: ChartZigZagOverlaysOptions): void {

  // ── Refs ─────────────────────────────────────────────────────────────

  const zigZagSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const zigZagMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const swingZZSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const swingZZMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // ── microstructure line + markers ──────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Clean up previous microstructure series/markers
    if (zigZagSeriesRef.current) {
      try { chart.removeSeries(zigZagSeriesRef.current); } catch { /* already removed */ }
      zigZagSeriesRef.current = null;
    }
    if (zigZagMarkersRef.current) {
      try { zigZagMarkersRef.current.setMarkers([]); } catch { /* already cleared */ }
      zigZagMarkersRef.current = null;
    }

    if (zigZagPoints.length < 2) return;

    const zzSeries = chart.addSeries(LineSeries, {
      color: 'rgba(250, 204, 21, 0.7)', lineWidth: 2, priceScaleId: 'right',
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      lineStyle: 0, autoscaleInfoProvider: () => null,
    });

    zzSeries.setData(dedupByTime(zigZagPoints.map(p => ({ time: p.time as Time, value: p.value }))));
    zigZagSeriesRef.current = zzSeries;

    const markers = zigZagPoints
      .map(p => ({
        time: p.time as Time,
        position: (p.type === 'high' ? 'aboveBar' : 'belowBar') as 'aboveBar' | 'belowBar',
        color: p.type === 'high' ? '#0072B2' : '#E69F00',
        shape: 'circle' as const, text: p.value.toFixed(decimals),
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    if (markers.length > 0) {
      zigZagMarkersRef.current = createSeriesMarkers(zzSeries, markers);
    }
  }, [zigZagPoints, decimals, chartRef]);

  // ── microstructure microstructure line + markers ────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Clean up previous microstructure microstructure series/markers
    if (swingZZSeriesRef.current) {
      try { chart.removeSeries(swingZZSeriesRef.current); } catch { /* already removed */ }
      swingZZSeriesRef.current = null;
    }
    if (swingZZMarkersRef.current) {
      try { swingZZMarkersRef.current.setMarkers([]); } catch { /* already cleared */ }
      swingZZMarkersRef.current = null;
    }

    if (swingZigZagPoints.length < 2) return;

    const swSeries = chart.addSeries(LineSeries, {
      color: 'rgba(6, 182, 212, 0.55)', lineWidth: 1, priceScaleId: 'right',
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      lineStyle: 0, autoscaleInfoProvider: () => null,
    });

    swSeries.setData(dedupByTime(swingZigZagPoints.map(p => ({ time: p.time as Time, value: p.value }))));
    swingZZSeriesRef.current = swSeries;

    const markers = swingZigZagPoints
      .map(p => ({
        time: p.time as Time,
        position: (p.type === 'high' ? 'aboveBar' : 'belowBar') as 'aboveBar' | 'belowBar',
        color: p.type === 'high' ? 'rgba(239, 68, 68, 0.6)' : 'rgba(34, 197, 94, 0.6)',
        shape: (p.type === 'high' ? 'arrowDown' : 'arrowUp') as 'arrowDown' | 'arrowUp',
        text: '',
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    if (markers.length > 0) {
      swingZZMarkersRef.current = createSeriesMarkers(swSeries, markers);
    }
  }, [swingZigZagPoints, chartRef]);

  // ── Cleanup all overlay refs on unmount ────────────────────────────

  useEffect(() => {
    return () => {
      zigZagSeriesRef.current = null;
      zigZagMarkersRef.current = null;
      swingZZSeriesRef.current = null;
      swingZZMarkersRef.current = null;
    };
  }, []);
}
