import { useRef, useState, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react';
import type { LogicalRange, MouseEventParams, Time } from 'lightweight-charts';

import { futuresTickInfo, forexPipInfo, getBaseSymbol } from '@/market/components/chartConfig';
import { useChartSetup } from '@/market/components/useChartSetup';
import { useChartSeries } from '@/market/components/useChartSeries';
import { useChartMarkers } from '@/market/components/useChartMarkers';
import { useChartPriceLines } from '@/market/components/useChartPriceLines';
import { useChartOverlays } from '@/market/components/useChartOverlays';
import { snapToCandle } from '@/market/components/useSeriesMarkers';
import type { TradingChartHandle, TradingChartProps, PriceInfo } from "@/market/components/types";

// Re-export public types for backward compatibility
export type { LabelMarker, TradingChartHandle, TradingChartProps } from "@/market/components/types";

/**
 * Vertical slack (in pixels) allowed between a click and a trade marker's price
 * coordinate before the click is treated as a miss. Markers render just above /
 * below their bar, so the click never lands exactly on the trade price.
 */
const MARKER_HIT_TOLERANCE_PX = 60;

const TradingChart = forwardRef<TradingChartHandle, TradingChartProps>(function TradingChart({
  data,
  symbol,
  isFutures,
  timeframe = 1,
  onLoadMore,
  onPrefetch,
  isLoadingMore = false,
  hasMoreLeft = true,
  hasMoreRight = false,
  labelMarkers = [],
  indicatorOverlays = [],
  onVisibleLogicalRangeChange,
  onVisibleTimeRangeChange,
  showTimeAxis = true,
  supportResistanceLevels = [],
  zigZagPoints = [],
  swingZigZagPoints = [],
  tradeMarkers = [],
  onTradeMarkerClick,
  predictionMarkers = [],
  isReplayActive = false,
  regimeColorMap,
  trainTestSplitTime,
}, ref) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [priceInfo, setPriceInfo] = useState<PriceInfo | null>(null);

  // ── Symbol config ──────────────────────────────────────────────────────

  const baseSymbol = getBaseSymbol(symbol);
  const tickInfo = futuresTickInfo[baseSymbol];
  const pipInfo = forexPipInfo[symbol.toUpperCase()];

  const decimals = isFutures
    ? (tickInfo?.decimals ?? 2)
    : (pipInfo?.decimals ?? 5);

  const minMove = isFutures
    ? (tickInfo?.tickSize ?? 0.01)
    : (pipInfo?.pipValue ?? 0.00001);

  // ── Stable refs for crosshair / range-change callbacks ─────────────────

  const onRangeChangeRef = useRef(onVisibleLogicalRangeChange);
  onRangeChangeRef.current = onVisibleLogicalRangeChange;



  // ── Chart lifecycle hooks ──────────────────────────────────────────────

  const { chartRef, candleSeriesRef, volumeSeriesRef } = useChartSetup({
    containerRef: chartContainerRef,
    decimals, minMove, isFutures, tickInfo,
    setPriceInfo, onRangeChangeRef,
    showTimeAxis,
  });

  const { processedData } = useChartSeries({
    chartRef, candleSeriesRef, volumeSeriesRef,
    data, symbol, timeframe, isFutures,
    regimeColorMap, isReplayActive,
    onLoadMore, onPrefetch, isLoadingMore, hasMoreLeft, hasMoreRight,
  });

  // Track active contract at crosshair position for futures rollover HUD
  const [activeContract, setActiveContract] = useState<string | null>(null);

  // Subscribe to crosshair to update activeContract from the map
  useEffect(() => {
    if (!chartRef.current || !isFutures || !processedData.activeContractMap?.size) return;
    const chart = chartRef.current;
    const contractMap = processedData.activeContractMap;

    const handler = (param: MouseEventParams<Time>) => {
      if (param.time != null) {
        const contract = contractMap.get(param.time as number);
        setActiveContract(contract ?? null);
      }
    };
    chart.subscribeCrosshairMove(handler);
    return () => { chart.unsubscribeCrosshairMove(handler); };
  }, [chartRef, isFutures, processedData.activeContractMap]);

  // ── Trade-marker click hit-testing ─────────────────────────────────────
  //
  // The subscription binds once per chart instance. Everything the handler
  // reads lives in a ref, so prop churn (new markers, new callback identity)
  // never forces a re-bind and never leaks a stale handler.

  const onTradeMarkerClickRef = useRef(onTradeMarkerClick);
  onTradeMarkerClickRef.current = onTradeMarkerClick;

  const tradeMarkersRef = useRef(tradeMarkers);
  tradeMarkersRef.current = tradeMarkers;

  const timeframeSecRef = useRef(timeframe * 60);
  timeframeSecRef.current = timeframe * 60;

  // Hit-testing must snap the same way rendering does, or a click lands on a
  // bar the arrow was never drawn on.
  const candleTimesRef = useRef<number[]>([]);
  candleTimesRef.current = processedData.candles.map(c => c.time as number);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handler = (param: MouseEventParams<Time>) => {
      const notify = onTradeMarkerClickRef.current;
      const markers = tradeMarkersRef.current;
      if (!notify || param.time == null || markers.length === 0) return;

      const timeframeSec = timeframeSecRef.current;
      const clickedTime = param.time as number;
      const clickY = param.point?.y;
      const series = candleSeriesRef.current;

      // Nearest marker wins: closest bar first, then closest price.
      let best: { id: string; timeDelta: number; priceDelta: number } | null = null;

      for (const tm of markers) {
        // Markers are rendered on the bar their timestamp falls in — hit-test
        // against that same aligned time, and allow a one-bar near-miss.
        const markerTime = snapToCandle(tm.timestamp, candleTimesRef.current, timeframeSec);
        if (markerTime === null) continue;
        const timeDelta = Math.abs(markerTime - clickedTime);
        if (timeDelta > timeframeSec) continue;

        let priceDelta = 0;
        if (clickY != null && series) {
          const markerY = series.priceToCoordinate(tm.price);
          if (markerY != null) {
            priceDelta = Math.abs(markerY - clickY);
            if (priceDelta > MARKER_HIT_TOLERANCE_PX) continue;
          }
        }

        if (
          !best ||
          timeDelta < best.timeDelta ||
          (timeDelta === best.timeDelta && priceDelta < best.priceDelta)
        ) {
          best = { id: tm.id, timeDelta, priceDelta };
        }
      }

      if (best) notify(best.id);
    };

    chart.subscribeClick(handler);
    return () => {
      try { chart.unsubscribeClick(handler); } catch { /* chart disposed */ }
    };
  }, [chartRef, candleSeriesRef, decimals, minMove, isFutures, tickInfo]);

  useChartMarkers({
    candleSeriesRef,
    processedCandles: processedData.candles,
    timeframe, symbol, isFutures,
    labelMarkers, tradeMarkers, predictionMarkers,
    trainTestSplitTime,
  });

  // ── Report the visible span so label previews follow the viewport ──────
  //
  // Without this the label overlay requests the whole loaded span. On a chart
  // holding months of bars the row cap then spreads markers so thinly that a
  // few hours of viewport contains none, and the overlay looks broken while
  // working correctly. Emitting wall-clock bounds lets the request cover
  // exactly what is on screen.

  const onVisibleTimeRangeChangeRef = useRef(onVisibleTimeRangeChange);
  onVisibleTimeRangeChangeRef.current = onVisibleTimeRangeChange;

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const timeScale = chart.timeScale();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const emit = () => {
      const notify = onVisibleTimeRangeChangeRef.current;
      if (!notify) return;
      // Debounced: panning fires this continuously, and each change starts a
      // network request.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const range = timeScale.getVisibleRange();
          if (!range) { notify(null); return; }
          notify({ start: (range.from as number) * 1000, end: (range.to as number) * 1000 });
        } catch { /* chart disposed mid-debounce */ }
      }, 250);
    };

    timeScale.subscribeVisibleTimeRangeChange(emit);
    emit();
    return () => {
      if (timer) clearTimeout(timer);
      try { timeScale.unsubscribeVisibleTimeRangeChange(emit); } catch { /* disposed */ }
    };
  }, [chartRef, data.length]);

  useChartOverlays(chartRef, candleSeriesRef, indicatorOverlays, processedData.candles);

  useChartPriceLines({
    chartRef, candleSeriesRef,
    supportResistanceLevels, zigZagPoints, swingZigZagPoints,
    decimals,
  });

  // ── Imperative handle ──────────────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    setVisibleLogicalRange: (range: LogicalRange) => {
      try { chartRef.current?.timeScale().setVisibleLogicalRange(range); } catch { /* chart disposed */ }
    },
    getVisibleLogicalRange: () => {
      try { return chartRef.current?.timeScale().getVisibleLogicalRange() ?? null; } catch { return null; }
    },
  }), []);

  // ── HUD computed values ────────────────────────────────────────────────

  const tickOrPipLabel = isFutures
    ? `Tick: ${tickInfo?.tickSize ?? 'N/A'} = $${tickInfo?.tickValue ?? 'N/A'}`
    : `Pip: ${pipInfo?.pipValue ?? 0.0001}`;

  const dataDateRange = useMemo(() => {
    if (processedData.candles.length === 0) return null;
    const first = new Date((processedData.candles[0]!.time as number) * 1000);
    const last = new Date((processedData.candles[processedData.candles.length - 1]!.time as number) * 1000);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    return `${fmt(first)} - ${fmt(last)}`;
  }, [processedData.candles]);

  // ── JSX ────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full">
      <div
        ref={chartContainerRef}
        className="w-full h-full"
        data-testid="trading-chart"
      />

      {/* Loading overlay */}
      {isLoadingMore && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-violet-500/20 overflow-hidden z-10 rounded-full">
          <div
            className="h-full bg-gradient-to-r from-violet-500 via-primary to-violet-500 rounded-full"
            style={{
              width: '40%',
              animation: 'loading-slide 1.2s ease-in-out infinite',
            }}
          />
          <style>{`@keyframes loading-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }`}</style>
        </div>
      )}

      {/* HUD overlay */}
      <div className="absolute top-2 left-2 flex items-center gap-3 text-[11px] font-mono bg-black/50 backdrop-blur-md rounded-lg px-3.5 py-2 border-l-2 border-l-primary/60 border border-white/[0.06] shadow-lg">
        <span className="text-primary font-bold text-xs tracking-wide">{symbol}</span>
        {/* Active contract badge — shows which expiration is being charted at the crosshair */}
        {isFutures && activeContract && activeContract !== symbol && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400/90 border border-amber-500/20 font-semibold tracking-wide">
            {activeContract}
          </span>
        )}
        <span className="text-muted-foreground/70 text-[10px]">{tickOrPipLabel}</span>
        {priceInfo && (
          <>
            <span className="text-[10px]"><span className="text-blue-400/80 font-medium">O</span> <span className="text-foreground/90">{priceInfo.open.toFixed(decimals)}</span></span>
            <span className="text-[10px]"><span className="text-emerald-400/80 font-medium">H</span> <span className="text-emerald-300/90">{priceInfo.high.toFixed(decimals)}</span></span>
            <span className="text-[10px]"><span className="text-rose-400/80 font-medium">L</span> <span className="text-rose-300/90">{priceInfo.low.toFixed(decimals)}</span></span>
            <span className="text-[10px]"><span className="text-blue-400/80 font-medium">C</span> <span className="text-foreground/90">{priceInfo.close.toFixed(decimals)}</span></span>
          </>
        )}
      </div>

      {/* Labels preview */}
      {labelMarkers.length > 0 && (
        <div className="absolute top-12 right-2 flex flex-col gap-0.5 text-[9px] font-mono bg-violet-500/10 backdrop-blur-md rounded-md px-2.5 py-2 border border-violet-500/20 shadow-md">
          <span className="text-violet-400 font-semibold mb-1 text-[9px] tracking-wide">Labels</span>
          <div className="flex gap-2.5">
            <span className="text-green-400">&#9650; {labelMarkers.filter(m => m.label === 1).length}</span>
            <span className="text-rose-400">&#9660; {labelMarkers.filter(m => m.label === -1).length}</span>
            <span className="text-gray-400">&#9679; {labelMarkers.filter(m => m.label === 0).length}</span>
          </div>
        </div>
      )}

      {/* Bottom-right help */}
      <div className="absolute bottom-2 right-2 text-[9px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors duration-300 font-mono flex items-center gap-3">
        {dataDateRange && <span>{dataDateRange}</span>}
        <span className="flex items-center gap-1.5">
          <kbd className="px-1 py-0.5 rounded border border-white/10 bg-white/5 text-[8px]">scroll</kbd> zoom
          <span className="text-muted-foreground/20 mx-0.5">·</span>
          <kbd className="px-1 py-0.5 rounded border border-white/10 bg-white/5 text-[8px]">drag</kbd> pan
        </span>
      </div>
    </div>
  );
});

export default TradingChart;
