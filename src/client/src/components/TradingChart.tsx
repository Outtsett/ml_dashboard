import { useRef, useState, useMemo, forwardRef, useImperativeHandle } from 'react';
import type { LogicalRange } from 'lightweight-charts';

import { futuresTickInfo, forexPipInfo, getBaseSymbol } from './chart/chartConfig';
import { useChartSetup } from './chart/useChartSetup';
import { useChartSeries } from './chart/useChartSeries';
import { useChartMarkers } from './chart/useChartMarkers';
import { useChartPriceLines } from './chart/useChartPriceLines';
import { useChartOverlays } from './chart/useChartOverlays';
import type { TradingChartHandle, TradingChartProps, PriceInfo } from './chart/types';

// Re-export public types for backward compatibility
export type { LabelMarker, TradingChartHandle, TradingChartProps } from './chart/types';

const TradingChart = forwardRef<TradingChartHandle, TradingChartProps>(function TradingChart({
  data,
  symbol,
  isFutures,
  timeframe = 1,
  onLoadMore,
  isLoadingMore = false,
  hasMoreLeft = true,
  hasMoreRight = false,
  labelMarkers = [],
  indicatorOverlays = [],
  onVisibleLogicalRangeChange,
  showTimeAxis = true,
  supportResistanceLevels = [],
  zigZagPoints = [],
  swingZigZagPoints = [],
  tradeMarkers = [],
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
    onLoadMore, isLoadingMore, hasMoreLeft, hasMoreRight,
  });

  useChartMarkers({
    candleSeriesRef,
    processedCandles: processedData.candles,
    timeframe, symbol, isFutures,
    labelMarkers, tradeMarkers, predictionMarkers,
    trainTestSplitTime,
  });

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
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-violet-500/30 overflow-hidden z-10">
          <div className="h-full bg-violet-500 animate-pulse" style={{ width: '100%' }} />
        </div>
      )}

      <div className="absolute top-2 left-2 flex items-center gap-4 text-[10px] font-mono bg-black/40 backdrop-blur-sm rounded-lg px-3 py-1.5">
        <span className="text-primary font-bold">{symbol}</span>
        <span className="text-muted-foreground">{tickOrPipLabel}</span>
        {priceInfo && (
          <>
            <span className="text-muted-foreground">O: <span className="text-white">{priceInfo.open.toFixed(decimals)}</span></span>
            <span className="text-muted-foreground">H: <span className="text-green-400">{priceInfo.high.toFixed(decimals)}</span></span>
            <span className="text-muted-foreground">L: <span className="text-rose-400">{priceInfo.low.toFixed(decimals)}</span></span>
            <span className="text-muted-foreground">C: <span className="text-white">{priceInfo.close.toFixed(decimals)}</span></span>
          </>
        )}
      </div>

      {labelMarkers.length > 0 && (
        <div className="absolute top-12 right-2 flex flex-col gap-0.5 text-[8px] font-mono bg-violet-500/10 backdrop-blur-sm rounded px-2 py-1.5 border border-violet-500/20">
          <span className="text-violet-400 font-semibold mb-1">Labels Preview</span>
          <div className="flex gap-2">
            <span className="text-green-400">&#9650; {labelMarkers.filter(m => m.label === 1).length}</span>
            <span className="text-rose-400">&#9660; {labelMarkers.filter(m => m.label === -1).length}</span>
            <span className="text-gray-400">&#9679; {labelMarkers.filter(m => m.label === 0).length}</span>
          </div>
        </div>
      )}

      <div className="absolute bottom-2 right-2 text-[9px] text-muted-foreground/50 font-mono flex items-center gap-2">
        {dataDateRange && <span>{dataDateRange}</span>}
        <span>Scroll to zoom &bull; Drag to pan</span>
      </div>
    </div>
  );
});

export default TradingChart;
