import { useNotebookDrawings } from "./notebookDrawings";
import { requestChartView, subscribeChartScroll, type NotebookBand } from "@/market/lib/useNotebookOverlays";
import { logWarn } from "@/infrastructure/lib/error_logger";
import { useRef, useState, useMemo, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { LogicalRange, MouseEventParams, Time, UTCTimestamp } from 'lightweight-charts';

import { futuresTickInfo, forexPrecision, getBaseSymbol, latestBarRange } from '@/market/components/chartConfig';
import { useChartSetup } from '@/market/components/useChartSetup';
import { useChartSeries } from '@/market/components/useChartSeries';
import { useChartMarkers } from '@/market/components/useChartMarkers';
import { useChartZigZagOverlays } from '@/market/components/useChartPriceLines';
import { useChartOverlays } from '@/market/components/useChartOverlays';
import { snapToCandle } from '@/market/components/useSeriesMarkers';
import { usePatternHover } from '@/market/components/usePatternHover';
import { ChartHUD } from './ChartHUD';
import { ChartContextMenu } from './ChartContextMenu';
import { PatternHoverCard } from '@/market/components/PatternHoverCard';
import { talibPatternDisplayName } from '@/market/lib/talibPatternCatalog';
import { ChevronsRight } from 'lucide-react';
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
  onReloadBars,
  isReloadingBars = false,
  onBarClick,
  notebookMarkers,
  notebookDrawings,
  extraMarkers,
  onChartReady,
  chrome,
}, ref) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [priceInfo, setPriceInfo] = useState<PriceInfo | null>(null);

  // â”€â”€ Symbol config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const baseSymbol = getBaseSymbol(symbol);
  const tickInfo = futuresTickInfo[baseSymbol];
  const forex = forexPrecision(symbol);

  const decimals = isFutures
    ? (tickInfo?.decimals ?? 2)
    : forex.decimals;

  const minMove = isFutures
    ? (tickInfo?.tickSize ?? 0.01)
    : forex.minMove;

  // â”€â”€ Stable refs for crosshair / range-change callbacks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const onRangeChangeRef = useRef(onVisibleLogicalRangeChange);
  onRangeChangeRef.current = onVisibleLogicalRangeChange;



  // â”€â”€ Chart lifecycle hooks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const { chartRef, candleSeriesRef, volumeSeriesRef } = useChartSetup({
    containerRef: chartContainerRef,
    decimals, minMove, isFutures, tickInfo,
    setPriceInfo, onRangeChangeRef,
    showTimeAxis,
    onChartReady,
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

  // â”€â”€ Trade-marker click hit-testing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        // Markers are rendered on the bar their timestamp falls in â€” hit-test
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
    notebookMarkers,
    extraMarkers,
  });

  // Levels, shaded zones and vertical lines a notebook drew on this chart, and the chart's own
  // support / resistance clouds: each zone shaded from its pivots' wick extreme to their body edge,
  // from the first pivot to the last bar (blue = support, vermillion = resistance).
  const drawingTimes = useMemo(() => processedData.candles.map((c) => c.time as number), [processedData.candles]);
  const supportResistanceBands = useMemo<NotebookBand[]>(() => supportResistanceLevels.map((level) => ({
    startMs: level.firstTime * 1000,
    endMs: level.lastTime * 1000,
    top: level.zoneTop,
    bottom: level.zoneBottom,
    color: level.type === 'support' ? '#0072B2' : '#D55E00',
    label: `${level.type === 'support' ? 'Support' : 'Resistance'} zone \u00b7 ${level.touches} touches`,
    // Tagged on the price axis ("R 3x" / "S 5x"), so nothing is printed over the candles.
    axisLabel: `${level.type === 'support' ? 'S' : 'R'} ${level.touches}x`,
    opacity: 0.15 + (level.strength * 0.4),
  })), [supportResistanceLevels, drawingTimes]);
  useNotebookDrawings(candleSeriesRef, drawingTimes, notebookDrawings, supportResistanceBands);

  // The page asks the chart to move (a view request through the chart link, after any reload).
  // "latest" sets the logical range to end at the last bar rather than calling scrollToRealTime,
  // whose animation needs requestAnimationFrame and never finishes in a background tab.
  const candleCountRef = useRef(0);
  candleCountRef.current = processedData.candles.length;
  useEffect(() => subscribeChartScroll((view) => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      const timeScale = chart.timeScale();
      if ("target" in view) {
        const count = candleCountRef.current;
        if (count === 0) return;
        const current = timeScale.getVisibleLogicalRange();
        const width = current ? Math.max(20, current.to - current.from) : 200;
        timeScale.setVisibleLogicalRange(latestBarRange(count, width, Math.max(0, timeScale.options().rightOffset)));
      } else {
        let fromTime = Math.floor(view.startMs / 1000);
        let toTime = Math.floor(view.endMs / 1000);
        
        const times = candleTimesRef.current;
        if (times && times.length > 0) {
          const firstTime = times[0]!; // guarded by times.length > 0
          const lastTime = times[times.length - 1]!;
          
          // Reject completely out of bounds views
          if (toTime < firstTime || fromTime > lastTime) return;
          
          if (fromTime < firstTime) fromTime = firstTime;
          if (toTime > lastTime) toTime = lastTime;
          
          if (fromTime >= toTime) {
            const visible = Math.min(250, times.length);
            const start = times[times.length - visible];
            const end = times[times.length - 1];
            if (start !== undefined && end !== undefined) {
              timeScale.setVisibleRange({ from: start as UTCTimestamp, to: end as UTCTimestamp });
            }
            return;
          }
        }
        
        timeScale.setVisibleRange({ from: fromTime as UTCTimestamp, to: toTime as UTCTimestamp });
      }
    } catch (err) {
      logWarn("TradingChart", "could not apply the chart view request", { error: String(err) });
    }
  }), [chartRef]);

  // A click on a bar is the notebooks' focus bar (chartContextBridge.ts).
  const onBarClickRef = useRef(onBarClick);
  onBarClickRef.current = onBarClick;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (param: MouseEventParams<Time>) => {
      if (param.time == null) return;
      onBarClickRef.current?.((param.time as number) * 1000);
    };
    chart.subscribeClick(handler);
    return () => {
      try { chart.unsubscribeClick(handler); } catch { /* chart disposed */ }
    };
  }, [chartRef, decimals, minMove, isFutures, tickInfo]);

  // Hovering a candlestick-pattern arrow opens a card comparing the textbook
  // pattern with the candles it fired on, and shades those candles here.
  const patternHover = usePatternHover({
    chartRef, candleSeriesRef,
    containerRef: chartContainerRef,
    labelMarkers,
    candles: processedData.candles,
    timeframeSec: timeframe * 60,
  });

  // Counted by SIGN, not by value: patterns arrive as +/-1, +/-0.8 (engulfing,
  // harami) and +/-2 (hikkake confirmation), and an equality test on 1 and -1
  // dropped every one of the others from the legend.
  const labelLegend = useMemo(() => {
    let up = 0;
    let down = 0;
    let flat = 0;
    let pattern: string | null = null;
    for (const m of labelMarkers) {
      if (m.label === null || m.label === undefined) continue;
      if (m.pattern) pattern = m.pattern;
      const value = Number(m.label);
      if (value > 0) up++;
      else if (value < 0) down++;
      else flat++;
    }
    return { up, down, flat, patternName: pattern ? talibPatternDisplayName(pattern) : null };
  }, [labelMarkers]);

  // â”€â”€ Report the visible span so label previews follow the viewport â”€â”€â”€â”€â”€â”€
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

  useChartZigZagOverlays({
    chartRef,
    zigZagPoints, swingZigZagPoints,
    decimals,
  });

  // â”€â”€ Imperative handle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  useImperativeHandle(ref, () => ({
    setVisibleLogicalRange: (range: LogicalRange) => {
      try { chartRef.current?.timeScale().setVisibleLogicalRange(range); } catch { /* chart disposed */ }
    },
    getVisibleLogicalRange: () => {
      try { return chartRef.current?.timeScale().getVisibleLogicalRange() ?? null; } catch { return null; }
    },
  }), []);

  // â”€â”€ HUD computed values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const tickOrPipLabel = isFutures
    ? `Tick: ${tickInfo?.tickSize ?? 'N/A'} = $${tickInfo?.tickValue ?? 'N/A'}`
    : `Pip: ${forex.minMove}`;

  const dataDateRange = useMemo(() => {
    if (processedData.candles.length === 0) return null;
    const first = new Date((processedData.candles[0]!.time as number) * 1000);
    const last = new Date((processedData.candles[processedData.candles.length - 1]!.time as number) * 1000);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    return `${fmt(first)} - ${fmt(last)}`;
  }, [processedData.candles]);

  // â”€â”€ Right-click menu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //
  // Owned here rather than delegated to Radix's ContextMenuTrigger. The trigger
  // did not open on this chart: the `contextmenu` event reaches the wrapper
  // with defaultPrevented false (verified in the page), but the trigger tracks
  // a pointerdown/contextmenu pair and the canvas underneath does not produce
  // the sequence it expects. Handling the event directly is deterministic and
  // behaves identically for a real right-click.
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!onReloadBars) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    setMenuPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  }, [onReloadBars]);

  // Any click elsewhere, a scroll, or Escape dismisses it. Registered only
  // while the menu is open so the chart keeps its own pointer handling
  // untouched the rest of the time.
  useEffect(() => {
    if (!menuPoint) return;
    const close = () => setMenuPoint(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuPoint]);

  // â”€â”€ JSX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // lightweight-charts paints to a canvas that swallows nothing, so a
  // right-click on the chart surface lands on this wrapper and Radix opens the
  // menu there. Without it the browser's own menu appears, which is what made
  // the reload look missing: it was in the toolbar, not where the hand was.
  return (
    <div className="relative w-full h-full" onContextMenu={handleContextMenu}>
      <div
        ref={chartContainerRef}
        className="w-full h-full"
        data-testid="chart-context-target"
      />

      {menuPoint && (
        <ChartContextMenu
          menuPoint={menuPoint}
          isReloadingBars={isReloadingBars}
          onReloadBars={onReloadBars}
          onJumpLatest={() => requestChartView({ target: 'latest' })}
          onFitContent={() => chartRef.current?.timeScale().fitContent()}
          onClose={() => setMenuPoint(null)}
        />
      )}

      {/* Jump to the most recent candle: loads the newest window (the chart may be anchored on an
          older one), then puts its last bar at the right edge. */}
      <button
        type="button"
        onClick={() => requestChartView({ target: "latest" })}
        disabled={isReloadingBars}
        data-testid="jump-latest"
        title="Jump to the most recent candle"
        aria-label="Jump to the most recent candle"
        className="absolute bottom-8 right-[72px] z-20 flex items-center gap-1 rounded-md border border-white/15 bg-neutral-900/85 px-2 py-1 text-[11px] text-neutral-200 shadow-md backdrop-blur-sm hover:border-[#E69F00]/70 hover:text-[#E69F00] disabled:opacity-50"
      >
        <ChevronsRight className={`h-3.5 w-3.5 ${isReloadingBars ? 'animate-pulse' : ''}`} aria-hidden="true" />
        Latest
      </button>

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

      <ChartHUD symbol={symbol} isFutures={isFutures} activeContract={activeContract} tickOrPipLabel={tickOrPipLabel} priceInfo={priceInfo} decimals={decimals} />

      {/* The pattern's own candles, shaded while its arrow is hovered. */}
      {patternHover?.band && (
        <div
          className="pointer-events-none absolute top-0 z-[5] border-x border-dashed border-white/40 bg-white/[0.07]"
          style={{ left: patternHover.band.left, width: patternHover.band.width, height: patternHover.band.height }}
          data-testid="pattern-hover-band"
        />
      )}
      {patternHover && (
        <PatternHoverCard info={patternHover.info} left={patternHover.card.left} top={patternHover.card.top} />
      )}

      {/* Labels preview */}
      {labelMarkers.length > 0 && (
        <div className="absolute top-12 right-2 flex flex-col gap-0.5 text-[9px] font-mono bg-violet-500/10 backdrop-blur-md rounded-md px-2.5 py-2 border border-violet-500/20 shadow-md">
          <span className="text-violet-400 font-semibold mb-1 text-[9px] tracking-wide">
            {labelLegend.patternName ?? 'Labels'}
          </span>
          <div className="flex gap-2.5">
            <span className="text-[hsl(var(--data-pos))]">&#9650; {labelLegend.up}</span>
            <span className="text-[hsl(var(--data-neg))]">&#9660; {labelLegend.down}</span>
            <span className="text-gray-400">&#9679; {labelLegend.flat}</span>
          </div>
          {labelLegend.patternName && (
            <span className="mt-1 text-[9px] text-muted-foreground">hover an arrow</span>
          )}
        </div>
      )}

      {/* Another source's overlay on THIS chart — the Model Cycle run's legend,
          key, follow control and readout. Rendered last, so it sits above the
          market HUD and the label legend rather than under them. */}
      {chrome}

      {/* Bottom-right help */}
      <div className="absolute bottom-2 right-2 text-[9px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors duration-300 font-mono flex items-center gap-3">
        {dataDateRange && <span>{dataDateRange}</span>}
        <span className="flex items-center gap-1.5">
          <kbd className="px-1 py-0.5 rounded border border-white/10 bg-white/5 text-[8px]">scroll</kbd> zoom
          <span className="text-muted-foreground/20 mx-0.5">Â·</span>
          <kbd className="px-1 py-0.5 rounded border border-white/10 bg-white/5 text-[8px]">drag</kbd> pan
        </span>
      </div>
    </div>
  );
});

export default TradingChart;






