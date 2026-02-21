import { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { createChart, ColorType, type IChartApi, type CandlestickData, type Time, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers, type LogicalRange } from 'lightweight-charts';
import type { IndicatorOverlay } from '@/hooks/useIndicatorData';
import type { SupportResistanceLevel, ZigZagPoint } from '@/lib/chartOverlays';
import type { TradeMarker, PredictionMarker } from '@/contexts/UnifiedDashboardContext';

/** Deduplicate & sort series data by time (last-write-wins for dupes) */
function dedupByTime<T extends { time: Time }>(arr: T[]): T[] {
  const map = new Map<number, T>();
  for (const item of arr) map.set(item.time as number, item);
  const result: T[] = [];
  map.forEach(v => result.push(v));
  return result.sort((a, b) => (a.time as number) - (b.time as number));
}

interface OhlcvData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  activeContract?: string;
}

interface ContractRollover {
  id?: number;
  baseSymbol?: string;
  fromContract: string;
  toContract: string;
  rolloverTimestamp?: number;
  timestamp?: number;
  priceAdjustment: number;
  rolloverType?: string;
}

export interface LabelMarker {
  timestamp: number;
  label: number | null;
  close?: number;
}

export interface TradingChartHandle {
  setVisibleLogicalRange: (range: LogicalRange) => void;
  getVisibleLogicalRange: () => LogicalRange | null;
}

export interface TradingChartProps {
  data: OhlcvData[];
  symbol: string;
  isFutures: boolean;
  timeframe?: number;
  onLoadMore?: (direction: 'left' | 'right', timestamp: number) => void;
  isLoadingMore?: boolean;
  hasMoreLeft?: boolean;
  hasMoreRight?: boolean;
  rollovers?: ContractRollover[];
  labelMarkers?: LabelMarker[];
  indicatorOverlays?: IndicatorOverlay[];
  /** Callback when visible time range changes (for subchart sync). */
  onVisibleLogicalRangeChange?: (range: LogicalRange) => void;
  /** Show or hide the time axis. Default true. */
  showTimeAxis?: boolean;
  /** Support/resistance levels to render as horizontal price lines. */
  supportResistanceLevels?: SupportResistanceLevel[];
  /** ZigZag turning points to render as a line overlay (ATR-filtered). */
  zigZagPoints?: ZigZagPoint[];
  /** Swing ZigZag — every swing high/low, no threshold filtering. */
  swingZigZagPoints?: ZigZagPoint[];
  /** Trade entry/exit markers from backtest or live trading */
  tradeMarkers?: TradeMarker[];
  /** Model prediction markers (up/down/neutral) */
  predictionMarkers?: PredictionMarker[];
}

const futuresTickInfo: Record<string, { tickSize: number; tickValue: number; decimals: number }> = {
  ES: { tickSize: 0.25, tickValue: 12.50, decimals: 2 },
  MES: { tickSize: 0.25, tickValue: 1.25, decimals: 2 },
  NQ: { tickSize: 0.25, tickValue: 5.00, decimals: 2 },
  MNQ: { tickSize: 0.25, tickValue: 0.50, decimals: 2 },
  RTY: { tickSize: 0.10, tickValue: 5.00, decimals: 2 },
  M2K: { tickSize: 0.10, tickValue: 0.50, decimals: 2 },
  YM: { tickSize: 1.00, tickValue: 5.00, decimals: 0 },
  MYM: { tickSize: 1.00, tickValue: 0.50, decimals: 0 },
};

const forexPipInfo: Record<string, { pipLocation: number; pipValue: number; decimals: number }> = {
  EURUSD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  GBPUSD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  AUDUSD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  NZDUSD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  USDCAD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  USDCHF: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  USDJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  EURJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  GBPJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  AUDJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  CADJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  EURGBP: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  EURAUD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  EURCHF: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  AUDNZD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  GBPAUD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  GBPCHF: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
};

function getBaseSymbol(symbol: string): string {
  return symbol.replace(/[A-Z]\d{1,2}$/, '').replace(/\d{4}$/, '');
}

const TradingChart = forwardRef<TradingChartHandle, TradingChartProps>(function TradingChart({ 
  data, 
  symbol, 
  isFutures, 
  timeframe = 1,
  onLoadMore,
  isLoadingMore = false,
  hasMoreLeft = true,
  hasMoreRight = false,
  rollovers = [],
  labelMarkers = [],
  indicatorOverlays = [],
  onVisibleLogicalRangeChange,
  showTimeAxis = true,
  supportResistanceLevels = [],
  zigZagPoints = [],
  swingZigZagPoints = [],
  tradeMarkers = [],
  predictionMarkers = [],
}, ref) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumeSeriesRef = useRef<any>(null);
  const isInitialLoadRef = useRef<boolean>(true);
  const prevSymbolRef = useRef<string>(symbol);
  const prevTimeframeRef = useRef<number>(timeframe);
  const loadingMoreRef = useRef<boolean>(false);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastDataHashRef = useRef<string>('');
  const isLoadMoreUpdateRef = useRef<boolean>(false);
  const savedRangeRef = useRef<LogicalRange | null>(null);
  const prevDataLengthRef = useRef<number>(0);
  const prevFirstTimeRef = useRef<number | null>(null);
  const loadMoreDirectionRef = useRef<'left' | 'right'>('left');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlaySeriesRef = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const srPriceLinesRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zigZagSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zigZagMarkersRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const swingZZSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const swingZZMarkersRef = useRef<any>(null);
  const [priceInfo, setPriceInfo] = useState<{ open: number; high: number; low: number; close: number; time: string; activeContract?: string } | null>(null);

  // Stable ref for the range-change callback
  const onRangeChangeRef = useRef(onVisibleLogicalRangeChange);
  onRangeChangeRef.current = onVisibleLogicalRangeChange;

  // Expose imperative handle for time sync from parent layout
  useImperativeHandle(ref, () => ({
    setVisibleLogicalRange: (range: LogicalRange) => {
      try { chartRef.current?.timeScale().setVisibleLogicalRange(range); } catch { /* ignore */ }
    },
    getVisibleLogicalRange: () => {
      try { return chartRef.current?.timeScale().getVisibleLogicalRange() ?? null; } catch { return null; }
    },
  }), []);

  const baseSymbol = getBaseSymbol(symbol);
  const tickInfo = futuresTickInfo[baseSymbol];
  const pipInfo = forexPipInfo[symbol.toUpperCase()];
  
  const decimals = isFutures 
    ? (tickInfo?.decimals ?? 2) 
    : (pipInfo?.decimals ?? 5);
  
  const minMove = isFutures 
    ? (tickInfo?.tickSize ?? 0.01) 
    : (pipInfo?.pipValue ?? 0.00001);

  // Build lookup map from timestamp (seconds) → activeContract for crosshair display
  const contractLookup = useMemo(() => {
    if (!isFutures) return new Map<number, string>();
    const map = new Map<number, string>();
    for (const d of data) {
      if (d.activeContract) {
        const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
        map.set(Math.floor(ts / 1000), d.activeContract);
      }
    }
    return map;
  }, [data, isFutures]);
  const contractLookupRef = useRef(contractLookup);
  contractLookupRef.current = contractLookup;

  // Current front month: the active contract at the latest bar in the dataset
  const currentFrontMonth = useMemo(() => {
    if (!isFutures || data.length === 0) return null;
    // Walk backwards to find most recent bar with activeContract
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].activeContract) return data[i].activeContract;
    }
    return null;
  }, [data, isFutures]);

  // Build rollover transition info: detect contract changes within loaded data
  const contractTransitions = useMemo(() => {
    if (!isFutures || data.length < 2) return [];
    const transitions: { time: number; from: string; to: string }[] = [];
    let prevContract: string | undefined = data[0].activeContract;
    for (let i = 1; i < data.length; i++) {
      const curr = data[i].activeContract;
      if (curr && prevContract && curr !== prevContract) {
        const ts = data[i].timestamp;
        const from = prevContract;
        transitions.push({ time: Math.floor(ts / 1000), from, to: curr });
      }
      if (curr) prevContract = curr;
    }
    return transitions;
  }, [data, isFutures]);

  const processedData = useMemo(() => {
    if (data.length === 0) return { candles: [] as CandlestickData<Time>[], volumes: [] as { time: Time; value: number; color: string }[] };

    // Fast path: data from MarketData.tsx is already deduped & sorted by timestamp.
    // Skip the Map-based dedup — just convert directly to chart format.
    const candles: CandlestickData<Time>[] = [];
    const volumes: { time: Time; value: number; color: string }[] = [];
    let lastTimeKey = -1;

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
      if (!ts || isNaN(d.open) || isNaN(d.close)) continue;
      
      const timeKey = Math.floor(ts / 1000);
      // Skip duplicates (data is sorted, so dupes are adjacent)
      if (timeKey === lastTimeKey) continue;
      lastTimeKey = timeKey;

      candles.push({
        time: timeKey as Time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      });

      if (!isNaN(d.volume)) {
        volumes.push({
          time: timeKey as Time,
          value: d.volume,
          color: d.close >= d.open ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)',
        });
      }
    }

    return { candles, volumes };
  }, [data]);

  const rolloverPriceLines = useMemo(() => {
    if (!isFutures || rollovers.length === 0) return [];
    
    return rollovers
      .filter(r => {
        const ts = r.rolloverTimestamp || r.timestamp || 0;
        if (ts === 0) return false;
        const rolloverTime = Math.floor(ts / 1000);
        const minTime = processedData.candles.length > 0 ? (processedData.candles[0].time as number) : 0;
        const maxTime = processedData.candles.length > 0 ? (processedData.candles[processedData.candles.length - 1].time as number) : 0;
        return rolloverTime >= minTime && rolloverTime <= maxTime;
      })
      .map(r => ({
        time: Math.floor((r.rolloverTimestamp || r.timestamp || 0) / 1000),
        from: r.fromContract,
        to: r.toContract,
        adjustment: r.priceAdjustment,
      }));
  }, [isFutures, rollovers, processedData.candles]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(255, 255, 255, 0.6)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(139, 92, 246, 0.08)' },
        horzLines: { color: 'rgba(139, 92, 246, 0.08)' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: 'rgba(139, 92, 246, 0.5)',
          width: 1,
          style: 2,
          labelBackgroundColor: 'rgba(139, 92, 246, 0.8)',
        },
        horzLine: {
          color: 'rgba(139, 92, 246, 0.5)',
          width: 1,
          style: 2,
          labelBackgroundColor: 'rgba(139, 92, 246, 0.8)',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(139, 92, 246, 0.2)',
        scaleMargins: { top: 0.05, bottom: 0.15 },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(139, 92, 246, 0.2)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 6,
        minBarSpacing: 0.5,
        fixLeftEdge: false,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: decimals,
        minMove: minMove,
      },
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(139, 92, 246, 0.3)',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    chart.subscribeCrosshairMove((param) => {
      if (param.time && candleSeriesRef.current) {
        const data = param.seriesData.get(candleSeriesRef.current) as CandlestickData<Time> | undefined;
        if (data) {
          const timeValue = param.time as number;
          const date = new Date(timeValue * 1000);
          setPriceInfo({
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
            time: date.toLocaleString(),
            activeContract: contractLookupRef.current.get(timeValue),
          });
        }
      }
    });

    // Time sync: notify parent when visible range changes
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && onRangeChangeRef.current) {
        onRangeChangeRef.current(range);
      }
    });

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    // Use ResizeObserver to react to container size changes (e.g. resizable panels)
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }
    handleResize();

    return () => {
      resizeObserver.disconnect();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      overlaySeriesRef.current.clear();
      srPriceLinesRef.current = [];
      zigZagSeriesRef.current = null;
      zigZagMarkersRef.current = null;
      swingZZSeriesRef.current = null;
      swingZZMarkersRef.current = null;
      seriesMarkersRef.current = null;
      rolloverMarkersRef.current = null;
      tradeMarkersSeriesRef.current = null;
      predictionMarkersSeriesRef.current = null;
      chart.remove();
    };
  }, [decimals, isFutures, tickInfo, minMove]);

  // Toggle time axis visibility without recreating chart (for subchart layout)
  useEffect(() => {
    chartRef.current?.applyOptions({
      timeScale: { visible: showTimeAxis !== false },
    });
  }, [showTimeAxis]);

  // Stable refs for load-more props to avoid effect re-subscription
  const isLoadingMoreRef = useRef(isLoadingMore);
  isLoadingMoreRef.current = isLoadingMore;
  const hasMoreLeftRef = useRef(hasMoreLeft);
  hasMoreLeftRef.current = hasMoreLeft;
  const hasMoreRightRef = useRef(hasMoreRight);
  hasMoreRightRef.current = hasMoreRight;
  const dataRef = useRef(data);
  dataRef.current = data;
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (!chartRef.current || !onLoadMore || data.length === 0) return;
    
    const chart = chartRef.current;
    const timeScale = chart.timeScale();
    
    const handleVisibleTimeRangeChange = () => {
      if (loadingMoreRef.current || isLoadingMoreRef.current) return;
      
      const visibleRange = timeScale.getVisibleLogicalRange();
      if (!visibleRange) return;
      
      const currentData = dataRef.current;
      const dataLength = currentData.length;
      const { from, to } = visibleRange;
      
      // Adaptive trigger threshold: fire earlier when zoomed out (more visible bars)
      // Min 50 bars, max 200 bars, scales with visible range
      const visibleBars = Math.max(1, to - from);
      const threshold = Math.min(200, Math.max(50, Math.floor(visibleBars * 0.5)));
      
      if (from < threshold && hasMoreLeftRef.current) {
        loadingMoreRef.current = true;
        // Save visible range and first candle time for offset calculation after prepend
        savedRangeRef.current = visibleRange;
        isLoadMoreUpdateRef.current = true;
        prevDataLengthRef.current = dataLength;
        prevFirstTimeRef.current = processedData.candles.length > 0 ? (processedData.candles[0].time as number) : null;
        loadMoreDirectionRef.current = 'left';
        const earliestTimestamp = currentData[0].timestamp;
        onLoadMoreRef.current?.('left', earliestTimestamp);
        if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
        loadMoreTimerRef.current = setTimeout(() => { loadingMoreRef.current = false; }, 2000);
      }

      if (to > dataLength - threshold && hasMoreRightRef.current) {
        loadingMoreRef.current = true;
        savedRangeRef.current = visibleRange;
        isLoadMoreUpdateRef.current = true;
        prevDataLengthRef.current = dataLength;
        prevFirstTimeRef.current = null;
        loadMoreDirectionRef.current = 'right';
        const latestTimestamp = currentData[currentData.length - 1].timestamp;
        onLoadMoreRef.current?.('right', latestTimestamp);
        if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
        loadMoreTimerRef.current = setTimeout(() => { loadingMoreRef.current = false; }, 2000);
      }
    };
    
    timeScale.subscribeVisibleLogicalRangeChange(handleVisibleTimeRangeChange);
    
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleTimeRangeChange);
      if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
    };
  // deps: only data.length and processedData.candles — all mutable state accessed via refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.length, processedData.candles]);

  const updateChartData = useCallback(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    if (processedData.candles.length === 0) return;

    const dataHash = `${symbol}-${timeframe}-${processedData.candles.length}-${processedData.candles[0]?.time}-${processedData.candles[processedData.candles.length - 1]?.time}`;
    
    if (dataHash === lastDataHashRef.current) return;
    lastDataHashRef.current = dataHash;

    const symbolChanged = prevSymbolRef.current !== symbol;
    const timeframeChanged = prevTimeframeRef.current !== timeframe;
    prevSymbolRef.current = symbol;
    prevTimeframeRef.current = timeframe;

    // For load-more updates: save range, update data, restore range offset
    if (isLoadMoreUpdateRef.current && savedRangeRef.current && !symbolChanged && !timeframeChanged) {
      const savedRange = savedRangeRef.current;
      const prevFirstTime = prevFirstTimeRef.current;
      
      candleSeriesRef.current.setData(processedData.candles);
      volumeSeriesRef.current.setData(processedData.volumes);

      if (chartRef.current) {
        try {
          if (loadMoreDirectionRef.current === 'left' && prevFirstTime !== null) {
            // Binary search for where the old first bar is in the new dataset
            // This gives us the exact prepend count, even after trimming
            const candles = processedData.candles;
            let lo = 0, hi = candles.length - 1, barsAdded = 0;
            while (lo <= hi) {
              const mid = (lo + hi) >>> 1;
              const midTime = candles[mid].time as number;
              if (midTime < prevFirstTime) {
                lo = mid + 1;
              } else if (midTime > prevFirstTime) {
                hi = mid - 1;
              } else {
                barsAdded = mid;
                break;
              }
            }
            // If exact match not found, lo is the insertion point (first >= prevFirstTime)
            if (lo > hi) barsAdded = lo;
            if (barsAdded > 0) {
              chartRef.current.timeScale().setVisibleLogicalRange({
                from: savedRange.from + barsAdded,
                to: savedRange.to + barsAdded,
              });
            }
          } else {
            // Right load: keep the same view position
            chartRef.current.timeScale().setVisibleLogicalRange(savedRange);
          }
        } catch { /* ignore range errors */ }
      }
      
      isLoadMoreUpdateRef.current = false;
      savedRangeRef.current = null;
      return;
    }

    candleSeriesRef.current.setData(processedData.candles);
    volumeSeriesRef.current.setData(processedData.volumes);

    if (chartRef.current && (isInitialLoadRef.current || symbolChanged || timeframeChanged)) {
      // Show the LATEST ~250 bars at proper spacing (user scrolls left for history)
      const totalBars = processedData.candles.length;
      const visibleBars = Math.min(250, totalBars);
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: totalBars - visibleBars,
        to: totalBars,
      });
      isInitialLoadRef.current = false;
    }
  }, [processedData, symbol, timeframe]);

  useEffect(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    rafIdRef.current = requestAnimationFrame(() => {
      updateChartData();
    });

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [updateChartData]);

  // Apply label markers to the chart using lightweight-charts v5 createSeriesMarkers API
  const seriesMarkersRef = useRef<any>(null);
  const prevMarkerSymbolRef = useRef<string>(symbol);

  useEffect(() => {
    if (!candleSeriesRef.current) return;
    
    // Clear markers when symbol changes to prevent stale dots
    const symbolChanged = prevMarkerSymbolRef.current !== symbol;
    if (symbolChanged) {
      prevMarkerSymbolRef.current = symbol;
      if (seriesMarkersRef.current) {
        seriesMarkersRef.current.setMarkers([]);
      }
    }

    // Get the time range of visible candles to filter markers
    const candleTimes = processedData.candles.map(d => d.time as number);
    const minTime = candleTimes.length > 0 ? candleTimes[0] : 0;
    const maxTime = candleTimes.length > 0 ? candleTimes[candleTimes.length - 1] : 0;
    const validCandleSet = new Set(candleTimes);

    // Build markers array from label data
    // Align timestamps to candle boundaries based on the active timeframe
    const timeframeSec = timeframe * 60;
    const markers = labelMarkers
      .filter(m => m.label !== null && m.label !== undefined)
      .map(m => {
        // Floor timestamp to nearest minute to align with candle data
        const timestampSec = Math.floor(m.timestamp / 1000);
        const alignedTime = Math.floor(timestampSec / timeframeSec) * timeframeSec;
        const label = Number(m.label);
        
        // Only include markers within the visible candle range AND matching a candle
        if (alignedTime < minTime || alignedTime > maxTime) {
          return null;
        }
        // Try to find a matching candle time
        if (!validCandleSet.has(alignedTime)) {
          return null;
        }
        
        if (label === 1) {
          return {
            time: alignedTime as Time,
            position: 'belowBar' as const,
            color: '#22c55e',
            shape: 'arrowUp' as const,
            text: '',
          };
        } else if (label === -1) {
          return {
            time: alignedTime as Time,
            position: 'aboveBar' as const,
            color: '#ef4444',
            shape: 'arrowDown' as const,
            text: '',
          };
        } else {
          return {
            time: alignedTime as Time,
            position: 'inBar' as const,
            color: '#6366f1',
            shape: 'circle' as const,
            text: '',
          };
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));
    
    // Deduplicate markers by time, keeping buy/sell signals over hold
    const markerMap = new Map<number, typeof markers[0]>();
    for (const marker of markers) {
      const existing = markerMap.get(marker.time as number);
      if (!existing || (existing.shape === 'circle' && marker.shape !== 'circle')) {
        markerMap.set(marker.time as number, marker);
      }
    }
    const dedupedMarkers = Array.from(markerMap.values())
      .sort((a, b) => (a.time as number) - (b.time as number));
    
    console.log(`[LabelMarkers] Total: ${labelMarkers.length}, Matched: ${dedupedMarkers.length}, Range: ${minTime}-${maxTime}`);

    // Create or update series markers
    if (dedupedMarkers.length > 0) {
      if (seriesMarkersRef.current) {
        seriesMarkersRef.current.setMarkers(dedupedMarkers);
      } else {
        seriesMarkersRef.current = createSeriesMarkers(candleSeriesRef.current, dedupedMarkers);
      }
    } else if (seriesMarkersRef.current) {
      seriesMarkersRef.current.setMarkers([]);
    }
  }, [labelMarkers, processedData, symbol, timeframe]);

  // ── Trade Markers: render backtest/live trade entry/exit arrows on the chart ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tradeMarkersSeriesRef = useRef<any>(null);

  useEffect(() => {
    if (!candleSeriesRef.current) return;

    if (!tradeMarkers || tradeMarkers.length === 0) {
      if (tradeMarkersSeriesRef.current) {
        tradeMarkersSeriesRef.current.setMarkers([]);
      }
      return;
    }

    const timeframeSec = timeframe * 60;
    const candleTimes = processedData.candles.map(d => d.time as number);
    const validCandleSet = new Set(candleTimes);

    const markers = tradeMarkers
      .map(tm => {
        const timestampSec = Math.floor(tm.timestamp / 1000);
        const alignedTime = Math.floor(timestampSec / timeframeSec) * timeframeSec;
        if (!validCandleSet.has(alignedTime)) return null;

        if (tm.type === "entry") {
          // Entry: green triangle up for long, red triangle down for short
          return {
            time: alignedTime as Time,
            position: tm.side === "long" ? ("belowBar" as const) : ("aboveBar" as const),
            color: tm.side === "long" ? "#10b981" : "#f43f5e",
            shape: tm.side === "long" ? ("arrowUp" as const) : ("arrowDown" as const),
            text: tm.label || (tm.side === "long" ? "BUY" : "SELL"),
          };
        } else {
          // Exit: square with P&L color
          const pnlColor = (tm.pnl ?? 0) >= 0 ? "#10b981" : "#f43f5e";
          return {
            time: alignedTime as Time,
            position: "aboveBar" as const,
            color: pnlColor,
            shape: "square" as const,
            text: tm.pnl != null ? `${tm.pnl >= 0 ? "+" : ""}${tm.pnl.toFixed(1)}` : "EXIT",
          };
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));

    if (markers.length > 0) {
      if (tradeMarkersSeriesRef.current) {
        tradeMarkersSeriesRef.current.setMarkers(markers);
      } else {
        tradeMarkersSeriesRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
      }
    } else if (tradeMarkersSeriesRef.current) {
      tradeMarkersSeriesRef.current.setMarkers([]);
    }
  }, [tradeMarkers, processedData, timeframe]);

  // ── Prediction Markers: model predictions as colored dots on bars ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const predictionMarkersSeriesRef = useRef<any>(null);

  useEffect(() => {
    if (!candleSeriesRef.current) return;

    if (!predictionMarkers || predictionMarkers.length === 0) {
      if (predictionMarkersSeriesRef.current) {
        predictionMarkersSeriesRef.current.setMarkers([]);
      }
      return;
    }

    const timeframeSec = timeframe * 60;
    const candleTimes = processedData.candles.map(d => d.time as number);
    const validCandleSet = new Set(candleTimes);

    const markers = predictionMarkers
      .map(pm => {
        const timestampSec = Math.floor(pm.timestamp / 1000);
        const alignedTime = Math.floor(timestampSec / timeframeSec) * timeframeSec;
        if (!validCandleSet.has(alignedTime)) return null;

        // Use muted colors so predictions don't overwhelm trade markers
        if (pm.direction === 1) {
          return {
            time: alignedTime as Time,
            position: "belowBar" as const,
            color: "rgba(34,197,94,0.5)",
            shape: "arrowUp" as const,
            text: pm.confidence ? `${(pm.confidence * 100).toFixed(0)}%` : "",
          };
        } else if (pm.direction === -1) {
          return {
            time: alignedTime as Time,
            position: "aboveBar" as const,
            color: "rgba(239,68,68,0.5)",
            shape: "arrowDown" as const,
            text: pm.confidence ? `${(pm.confidence * 100).toFixed(0)}%` : "",
          };
        } else {
          return {
            time: alignedTime as Time,
            position: "inBar" as const,
            color: "rgba(99,102,241,0.3)",
            shape: "circle" as const,
            text: "",
          };
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));

    if (markers.length > 0) {
      if (predictionMarkersSeriesRef.current) {
        predictionMarkersSeriesRef.current.setMarkers(markers);
      } else {
        predictionMarkersSeriesRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
      }
    } else if (predictionMarkersSeriesRef.current) {
      predictionMarkersSeriesRef.current.setMarkers([]);
    }
  }, [predictionMarkers, processedData, timeframe]);

  // Draw rollover transition markers on the chart at contract boundaries
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rolloverMarkersRef = useRef<any>(null);
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    if (!isFutures || contractTransitions.length === 0) {
      if (rolloverMarkersRef.current) {
        rolloverMarkersRef.current.setMarkers([]);
      }
      return;
    }

    // Filter transitions to only those within the candle time range
    const candleTimes = new Set(processedData.candles.map(d => d.time as number));
    const markers = contractTransitions
      .filter(t => candleTimes.has(t.time))
      .map(t => ({
        time: t.time as Time,
        position: 'aboveBar' as const,
        color: '#f59e0b', // amber
        shape: 'square' as const,
        text: `${t.to}`,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    if (markers.length > 0) {
      if (rolloverMarkersRef.current) {
        rolloverMarkersRef.current.setMarkers(markers);
      } else {
        rolloverMarkersRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
      }
    } else if (rolloverMarkersRef.current) {
      rolloverMarkersRef.current.setMarkers([]);
    }
  }, [isFutures, contractTransitions, processedData.candles]);

  // Manage indicator overlay series — only handles 'overlay' type.
  // Subchart indicators are rendered by separate SubchartPanel components.
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
          try { chart.removeSeries(series); } catch { /* already removed */ }
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
        // Create new LineSeries on the main price scale
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

    // Handle CDL markers — merge with existing label markers
    if (candleSeriesRef.current) {
      const cdlOverlays = indicatorOverlays.filter(o => o.displayType === 'marker');
      if (cdlOverlays.length > 0) {
        const candleTimes = processedData.candles.map(d => d.time as number);
        const validCandleSet = new Set(candleTimes);

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
          // Store CDL markers ref for cleanup
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
  }, [indicatorOverlays, processedData.candles]);

  // ── Support / Resistance price lines ──
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const series = candleSeriesRef.current;

    // Remove old price lines
    for (const pl of srPriceLinesRef.current) {
      try { series.removePriceLine(pl); } catch { /* */ }
    }
    srPriceLinesRef.current = [];

    // Add new ones
    for (const level of supportResistanceLevels) {
      const isSupport = level.type === 'support';
      const alpha = 0.25 + level.strength * 0.55; // 0.25–0.80
      const color = isSupport
        ? `rgba(34, 197, 94, ${alpha})`   // green
        : `rgba(239, 68, 68, ${alpha})`;   // red

      try {
        const pl = series.createPriceLine({
          price: level.price,
          color,
          lineWidth: level.touches >= 4 ? 2 : 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `${isSupport ? 'S' : 'R'} (${level.touches})`,
        });
        srPriceLinesRef.current.push(pl);
      } catch { /* ignore */ }
    }
  }, [supportResistanceLevels]);

  // ── ZigZag line + markers ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove old zigzag series
    if (zigZagSeriesRef.current) {
      try { chart.removeSeries(zigZagSeriesRef.current); } catch { /* */ }
      zigZagSeriesRef.current = null;
    }
    if (zigZagMarkersRef.current) {
      try { zigZagMarkersRef.current.setMarkers([]); } catch { /* */ }
      zigZagMarkersRef.current = null;
    }

    if (zigZagPoints.length < 2) return;

    // Line connecting all ZZ points
    const zzSeries = chart.addSeries(LineSeries, {
      color: 'rgba(250, 204, 21, 0.7)', // yellow
      lineWidth: 2,
      priceScaleId: 'right',
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      lineStyle: 0, // Solid
      autoscaleInfoProvider: () => null, // don't expand Y-range beyond candles
    });

    const lineData = dedupByTime(zigZagPoints
      .map(p => ({ time: p.time as Time, value: p.value })));
    zzSeries.setData(lineData);
    zigZagSeriesRef.current = zzSeries;

    // Diamond markers at each turning point
    const markers = zigZagPoints
      .map(p => ({
        time: p.time as Time,
        position: (p.type === 'high' ? 'aboveBar' : 'belowBar') as 'aboveBar' | 'belowBar',
        color: p.type === 'high' ? '#ef4444' : '#22c55e',
        shape: 'circle' as const,
        text: p.value.toFixed(decimals),
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    if (markers.length > 0) {
      zigZagMarkersRef.current = createSeriesMarkers(zzSeries, markers);
    }
  }, [zigZagPoints, decimals]);

  // ── Swing ZigZag line + markers (every high/low, no filtering) ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove old swing ZZ series
    if (swingZZSeriesRef.current) {
      try { chart.removeSeries(swingZZSeriesRef.current); } catch { /* */ }
      swingZZSeriesRef.current = null;
    }
    if (swingZZMarkersRef.current) {
      try { swingZZMarkersRef.current.setMarkers([]); } catch { /* */ }
      swingZZMarkersRef.current = null;
    }

    if (swingZigZagPoints.length < 2) return;

    // Cyan line connecting every swing point
    const swSeries = chart.addSeries(LineSeries, {
      color: 'rgba(6, 182, 212, 0.55)', // cyan
      lineWidth: 1,
      priceScaleId: 'right',
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      lineStyle: 0,
      autoscaleInfoProvider: () => null, // don't expand Y-range beyond candles
    });

    const lineData = dedupByTime(swingZigZagPoints
      .map(p => ({ time: p.time as Time, value: p.value })));
    swSeries.setData(lineData);
    swingZZSeriesRef.current = swSeries;

    // Small triangle markers at each turning point
    const markers = swingZigZagPoints
      .map(p => ({
        time: p.time as Time,
        position: (p.type === 'high' ? 'aboveBar' : 'belowBar') as 'aboveBar' | 'belowBar',
        color: p.type === 'high' ? 'rgba(239, 68, 68, 0.6)' : 'rgba(34, 197, 94, 0.6)',
        shape: 'arrowDown' as const,
        text: '',
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    // Use small arrows: high = arrowDown above, low = arrowUp below
    const fixedMarkers = markers.map(m => ({
      ...m,
      shape: (m.position === 'aboveBar' ? 'arrowDown' : 'arrowUp') as 'arrowDown' | 'arrowUp',
    }));

    if (fixedMarkers.length > 0) {
      swingZZMarkersRef.current = createSeriesMarkers(swSeries, fixedMarkers);
    }
  }, [swingZigZagPoints]);

  // Clean up markers when component unmounts
  useEffect(() => {
    return () => {
      if (seriesMarkersRef.current) {
        seriesMarkersRef.current.setMarkers([]);
      }
      seriesMarkersRef.current = null;
      if (rolloverMarkersRef.current) {
        rolloverMarkersRef.current.setMarkers([]);
      }
      rolloverMarkersRef.current = null;
      if (tradeMarkersSeriesRef.current) {
        tradeMarkersSeriesRef.current.setMarkers([]);
      }
      tradeMarkersSeriesRef.current = null;
      if (predictionMarkersSeriesRef.current) {
        predictionMarkersSeriesRef.current.setMarkers([]);
      }
      predictionMarkersSeriesRef.current = null;
    };
  }, []);

  const tickOrPipLabel = isFutures 
    ? `Tick: ${tickInfo?.tickSize ?? 'N/A'} = $${tickInfo?.tickValue ?? 'N/A'}`
    : `Pip: ${pipInfo?.pipValue ?? 0.0001}`;

  // Compute date range of loaded data for status display
  const dataDateRange = useMemo(() => {
    if (processedData.candles.length === 0) return null;
    const first = new Date((processedData.candles[0].time as number) * 1000);
    const last = new Date((processedData.candles[processedData.candles.length - 1].time as number) * 1000);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    return `${fmt(first)} – ${fmt(last)}`;
  }, [processedData.candles]);

  return (
    <div className="relative w-full h-full">
      <div 
        ref={chartContainerRef} 
        className="w-full h-full"
        data-testid="trading-chart"
      />
      
      {/* Loading overlay — subtle edge indicator */}
      {isLoadingMore && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-violet-500/30 overflow-hidden z-10">
          <div className="h-full bg-violet-500 animate-pulse" style={{ width: '100%' }} />
        </div>
      )}
      
      <div className="absolute top-2 left-2 flex items-center gap-4 text-[10px] font-mono bg-black/40 backdrop-blur-sm rounded-lg px-3 py-1.5">
        <span className="text-primary font-bold">{symbol}</span>
        {/* Persistent front month: always show current contract, crosshair overrides it */}
        {(priceInfo?.activeContract || currentFrontMonth) && (
          <span className="text-amber-400 font-semibold text-[10px]">
            {priceInfo?.activeContract || currentFrontMonth}
          </span>
        )}
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
      
      {/* Contract transitions visible in current view */}
      {isFutures && (contractTransitions.length > 0 || currentFrontMonth) && (
        <div className="absolute top-12 left-2 flex flex-col gap-0.5 text-[8px] font-mono bg-amber-500/10 backdrop-blur-sm rounded px-1.5 py-1 border border-amber-500/20 max-w-[200px]">
          {currentFrontMonth && (
            <span className="text-amber-300 font-semibold">Front: {currentFrontMonth}</span>
          )}
          {contractTransitions.length > 0 && (
            <>
              <span className="text-amber-400/70">{contractTransitions.length} rollover{contractTransitions.length !== 1 ? 's' : ''} in view</span>
              {contractTransitions.slice(-3).map((t, i) => (
                <span key={i} className="text-amber-500/60 truncate">
                  {t.from} → {t.to}
                </span>
              ))}
            </>
          )}
        </div>
      )}
      
      {labelMarkers.length > 0 && (
        <div className="absolute top-12 right-2 flex flex-col gap-0.5 text-[8px] font-mono bg-violet-500/10 backdrop-blur-sm rounded px-2 py-1.5 border border-violet-500/20">
          <span className="text-violet-400 font-semibold mb-1">Labels Preview</span>
          <div className="flex gap-2">
            <span className="text-green-400">▲ {labelMarkers.filter(m => m.label === 1).length}</span>
            <span className="text-rose-400">▼ {labelMarkers.filter(m => m.label === -1).length}</span>
            <span className="text-gray-400">● {labelMarkers.filter(m => m.label === 0).length}</span>
          </div>
        </div>
      )}
      
      <div className="absolute bottom-2 right-2 text-[9px] text-muted-foreground/50 font-mono flex items-center gap-2">
        {dataDateRange && <span>{dataDateRange}</span>}
        <span>Scroll to zoom • Drag to pan</span>
      </div>
    </div>
  );
});

export default TradingChart;
