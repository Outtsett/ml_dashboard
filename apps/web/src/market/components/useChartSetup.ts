import { useEffect, useRef } from 'react';
import {
  createChart, type IChartApi, type ISeriesApi, CandlestickSeries, HistogramSeries,
  type CandlestickData, type Time, type LogicalRange,
} from 'lightweight-charts';
import {
  createChartOptions, candleSeriesOptions, volumeSeriesOptions, volumeScaleMargins, latestBarRange,
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
  /**
   * Hands the finished chart to whoever draws onto it imperatively — the Model
   * Cycle overlay, which attaches a primitive and a forecast line to these exact
   * series. Called once per chart creation and again with `null` on teardown, so
   * the owner can drop what it attached. Kept out of the effect's dependencies
   * (read through a ref) because a new function identity must not rebuild the
   * chart and throw away the user's zoom.
   */
  onChartReady?: ((target: ChartAttachTarget | null) => void) | undefined;
}

export interface ChartAttachTarget {
  chart: IChartApi;
  candleSeries: ISeriesApi<'Candlestick'>;
  container: HTMLElement;
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
  onChartReady,
}: ChartSetupOptions): ChartSetupResult {
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  // Store setPriceInfo in a ref so the crosshair closure never goes stale
  const setPriceInfoRef = useRef(setPriceInfo);
  setPriceInfoRef.current = setPriceInfo;

  // Same for the ready callback: read through a ref so the chart is built once.
  const onChartReadyRef = useRef(onChartReady);
  onChartReadyRef.current = onChartReady;

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

    // Hand the finished chart over to any imperative owner (the Model Cycle
    // overlay). The cleanup below hands it back as null, so nothing outlives the
    // chart it attached to.
    onChartReadyRef.current?.({ chart, candleSeries, container: containerRef.current });

    // Size. The grid tile is absolutely positioned, so the chart can be created before it has a
    // pixel size and its first observation is 0x0. Applying that 0 makes the time scale resolve the
    // range against a zero-width pane, which widens the range until every bar clears minBarSpacing
    // and survives the real resize as a full-history zoom-out — the newest candle ends up a sliver
    // at the far right rather than pinned to the pane's right edge.
    //
    // So: never apply a zero size, and hold the re-frame until the pane is real AND the series
    // holds bars. The previous one-shot flag was consumed the moment a real width arrived — a frame
    // or two before the bars are fetched — so `data().length` was 0 and the re-frame never ran.
    const el = containerRef.current;
    let sized = el.clientWidth > 0 && el.clientHeight > 0;
    let pendingReframe = !sized;
    const applySize = () => {
      if (!el) return;
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width <= 0 || height <= 0) return;
      if (!sized) {
        sized = true;
        pendingReframe = true;
      }
      chart.applyOptions({ width, height });
      const total = candleSeries.data().length;
      if (pendingReframe && total > 0) {
        pendingReframe = false;
        chart.timeScale().setVisibleLogicalRange(latestBarRange(total));
      }
    };
    const resizeObserver = new ResizeObserver(applySize);
    resizeObserver.observe(el);
    applySize();

    return () => {
      resizeObserver.disconnect();
      onChartReadyRef.current?.(null);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [decimals, isFutures, tickInfo, minMove]);  

  // ── Toggle time axis visibility ────────────────────────────────────────

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { visible: showTimeAxis !== false } });
  }, [showTimeAxis]);

  return { chartRef, candleSeriesRef, volumeSeriesRef };
}


