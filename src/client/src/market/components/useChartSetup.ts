import { useEffect, useRef } from 'react';
import {
  createChart, type IChartApi, type ISeriesApi, CandlestickSeries, HistogramSeries,
  type CandlestickData, type Time, type LogicalRange,
} from 'lightweight-charts';
import {
  createChartOptions, candleSeriesOptions, volumeSeriesOptions, volumeScaleMargins,
} from './chartConfig';
import type { PriceInfo } from "@/market/components/types";

// ── Types ──────────────────────────────────────────────────────────────────

interface ChartSetupOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  decimals: number;
  minMove: number;
  isFutures: boolean;
  tickInfo: { tickSize: number; tickValue: number; decimals: number } | undefined;
  setPriceInfo: React.Dispatch<React.SetStateAction<PriceInfo | null>>;
  onRangeChangeRef: React.MutableRefObject<((range: LogicalRange) => void) | undefined>;
  showTimeAxis: boolean;
}

interface ChartSetupResult {
  chartRef: React.MutableRefObject<IChartApi | null>;
  candleSeriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  volumeSeriesRef: React.MutableRefObject<ISeriesApi<'Histogram'> | null>;
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Creates and manages the lightweight-charts instance, candle + volume series,
 * crosshair subscription (HUD), range-change subscription, and ResizeObserver.
 *
 * The chart is recreated when `decimals`, `minMove`, `isFutures`, or `tickInfo`
 * change (these affect price formatting on the candle series).
 */
export function useChartSetup({
  containerRef,
  decimals, minMove, isFutures, tickInfo,
  setPriceInfo, onRangeChangeRef,
  showTimeAxis,
}: ChartSetupOptions): ChartSetupResult {
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  // Store setPriceInfo in a ref so the crosshair closure never goes stale
  const setPriceInfoRef = useRef(setPriceInfo);
  setPriceInfoRef.current = setPriceInfo;

  // ── Create chart + series ──────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, createChartOptions());
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, candleSeriesOptions(decimals, minMove));
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, volumeSeriesOptions);
    volumeSeries.priceScale().applyOptions({ scaleMargins: volumeScaleMargins });
    volumeSeriesRef.current = volumeSeries;

    // Crosshair → HUD price info
    chart.subscribeCrosshairMove((param) => {
      if (param.time && candleSeriesRef.current) {
        const data = param.seriesData.get(candleSeriesRef.current) as CandlestickData<Time> | undefined;
        if (data) {
          // The time axis lightweight-charts draws is UTC; toLocaleString() put
          // the HUD in browser-local time, so the same candle read two clock
          // times with neither labelled. Both are UTC now, and the HUD says so.
          const date = new Date((param.time as number) * 1000);
          setPriceInfoRef.current({
            open: data.open, high: data.high, low: data.low, close: data.close,
            time: `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`,
          });
        }
      }
    });

    // Forward visible-range changes to parent
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && onRangeChangeRef.current) onRangeChangeRef.current(range);
    });

    // Resize
    const el = containerRef.current;
    const resizeObserver = new ResizeObserver(() => {
      if (el) {
        chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      }
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [decimals, isFutures, tickInfo, minMove]);  

  // ── Toggle time axis visibility ────────────────────────────────────────

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { visible: showTimeAxis !== false } });
  }, [showTimeAxis]);

  return { chartRef, candleSeriesRef, volumeSeriesRef };
}
