import { useEffect, useRef } from 'react';
import { LineSeries, createSeriesMarkers, type IChartApi, type Time } from 'lightweight-charts';
import type { SupportResistanceLevel, ZigZagPoint } from '@/market/lib/chart_overlays';
import { dedupByTime } from './chartConfig';

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ChartPriceLinesOptions {
  chartRef: React.MutableRefObject<IChartApi | null>;
  candleSeriesRef: React.MutableRefObject<any>;
  supportResistanceLevels: SupportResistanceLevel[];
  zigZagPoints: ZigZagPoint[];
  swingZigZagPoints: ZigZagPoint[];
  decimals: number;
}

// â”€â”€ Hook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Manages S/R price lines, microstructure line + markers, and microstructure microstructure line + markers.
 * Each overlay type owns its own refs and cleanup.
 */
export function useChartPriceLines({
  chartRef, candleSeriesRef,
  supportResistanceLevels, zigZagPoints, swingZigZagPoints,
  decimals,
}: ChartPriceLinesOptions): void {

  // â”€â”€ Refs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const srPriceLinesRef = useRef<any[]>([]);
  const zigZagSeriesRef = useRef<any>(null);
  const zigZagMarkersRef = useRef<any>(null);
  const swingZZSeriesRef = useRef<any>(null);
  const swingZZMarkersRef = useRef<any>(null);

  // â”€â”€ Support / Resistance price lines â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      // Okabe-Ito, not green/red. Support was rgb(34,197,94) and resistance
      // rgb(239,68,68) — a green-vs-red pair, the one contrast a deuteranope
      // cannot separate, so the two line types were indistinguishable. Blue vs
      // vermillion differ in hue AND luminance; the "S (n)" / "R (n)" title
      // already carries the meaning without colour at all.
      const color = isSupport
        ? `rgba(0, 114, 178, ${alpha})`    // #0072B2 blue
        : `rgba(213, 94, 0, ${alpha})`;    // #D55E00 vermillion

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

  // â”€â”€ microstructure line + markers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€ microstructure microstructure line + markers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€ Cleanup all overlay refs on unmount â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

