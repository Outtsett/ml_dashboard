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
