import { useEffect, useRef } from 'react';
import { LineSeries, createSeriesMarkers, type IChartApi, type Time } from 'lightweight-charts';
import type { SupportResistanceLevel, ZigZagPoint } from '@/lib/chart_overlays';
import { dedupByTime } from './chartConfig';

// ── Types ──────────────────────────────────────────────────────────────────

interface ChartPriceLinesOptions {
  chartRef: React.MutableRefObject<IChartApi | null>;
  candleSeriesRef: React.MutableRefObject<any>;
  supportResistanceLevels: SupportResistanceLevel[];
  zigZagPoints: ZigZagPoint[];
  swingZigZagPoints: ZigZagPoint[];
  decimals: number;
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Manages S/R price lines, ZigZag line + markers, and Swing ZigZag line + markers.
 * Each overlay type owns its own refs and cleanup.
 */
export function useChartPriceLines({
  chartRef, candleSeriesRef,
  supportResistanceLevels, zigZagPoints, swingZigZagPoints,
  decimals,
}: ChartPriceLinesOptions): void {

  // ── Refs ───────────────────────────────────────────────────────────────

  const srPriceLinesRef = useRef<any[]>([]);
  const zigZagSeriesRef = useRef<any>(null);
  const zigZagMarkersRef = useRef<any>(null);
  const swingZZSeriesRef = useRef<any>(null);
  const swingZZMarkersRef = useRef<any>(null);

  // ── Support / Resistance price lines ───────────────────────────────────

  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const series = candleSeriesRef.current;

    // Remove previous price lines
    for (const pl of srPriceLinesRef.current) {
      try { series.removePriceLine(pl); } catch { /* price line already removed */ }
    }
    srPriceLinesRef.current = [];

    // Add new price lines
    for (const level of supportResistanceLevels) {
      const isSupport = level.type === 'support';
      const alpha = 0.25 + level.strength * 0.55;
      const color = isSupport ? `rgba(34, 197, 94, ${alpha})` : `rgba(239, 68, 68, ${alpha})`;

      try {
        const pl = series.createPriceLine({
          price: level.price, color,
          lineWidth: level.touches >= 4 ? 2 : 1,
          lineStyle: 2, axisLabelVisible: true,
          title: `${isSupport ? 'S' : 'R'} (${level.touches})`,
        });
        srPriceLinesRef.current.push(pl);
      } catch { /* series disposed */ }
    }
  }, [supportResistanceLevels, candleSeriesRef]);

  // ── ZigZag line + markers ──────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Clean up previous zigzag series/markers
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
        color: p.type === 'high' ? '#ef4444' : '#22c55e',
        shape: 'circle' as const, text: p.value.toFixed(decimals),
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    if (markers.length > 0) {
      zigZagMarkersRef.current = createSeriesMarkers(zzSeries, markers);
    }
  }, [zigZagPoints, decimals, chartRef]);

  // ── Swing ZigZag line + markers ────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Clean up previous swing zigzag series/markers
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

  // ── Cleanup all overlay refs on unmount ────────────────────────────────

  useEffect(() => {
    return () => {
      srPriceLinesRef.current = [];
      zigZagSeriesRef.current = null;
      zigZagMarkersRef.current = null;
      swingZZSeriesRef.current = null;
      swingZZMarkersRef.current = null;
    };
  }, []);
}
