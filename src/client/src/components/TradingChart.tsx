import { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { createChart, type IChartApi, type CandlestickData, type Time, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers, type LogicalRange } from 'lightweight-charts';
import type { IndicatorOverlay } from '@/hooks/useIndicatorData';
import type { SupportResistanceLevel, ZigZagPoint } from '@/lib/chartOverlays';
import type { TradeMarker, PredictionMarker } from '@/contexts/UnifiedDashboardContext';
import type { ContinuousOHLCVBar } from '@shared/ohlcv';

import {
  futuresTickInfo, forexPipInfo, getBaseSymbol,
  REGIME_FILLS, dedupByTime,
  createChartOptions, candleSeriesOptions, volumeSeriesOptions, volumeScaleMargins,
} from './chart/chartConfig';
import { useSeriesMarkers, buildCandleTimeSet, alignTimestamp, type ChartMarker } from './chart/useSeriesMarkers';
import { useChartOverlays } from './chart/useChartOverlays';

// Use the shared OHLCV type (with optional activeContract for continuous contracts)
type OhlcvData = ContinuousOHLCVBar;

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
  labelMarkers?: LabelMarker[];
  indicatorOverlays?: IndicatorOverlay[];
  onVisibleLogicalRangeChange?: (range: LogicalRange) => void;
  showTimeAxis?: boolean;
  supportResistanceLevels?: SupportResistanceLevel[];
  zigZagPoints?: ZigZagPoint[];
  swingZigZagPoints?: ZigZagPoint[];
  tradeMarkers?: TradeMarker[];
  predictionMarkers?: PredictionMarker[];
  isReplayActive?: boolean;
  regimeColorMap?: Map<number, number>;
  trainTestSplitTime?: number;
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
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ReturnType<typeof createSeriesMarkers> | any>(null);
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
  const srPriceLinesRef = useRef<any[]>([]);
  const zigZagSeriesRef = useRef<any>(null);
  const zigZagMarkersRef = useRef<any>(null);
  const swingZZSeriesRef = useRef<any>(null);
  const swingZZMarkersRef = useRef<any>(null);
  const [priceInfo, setPriceInfo] = useState<{ open: number; high: number; low: number; close: number; time: string; activeContract?: string } | null>(null);

  // Track whether we've already scrolled to the oldest bar for the current regime training session
  const hasScrolledToRegimeStartRef = useRef(false);

  // Stable ref for the range-change callback
  const onRangeChangeRef = useRef(onVisibleLogicalRangeChange);
  onRangeChangeRef.current = onVisibleLogicalRangeChange;

  // ── Marker refs (managed by useSeriesMarkers hook) ──
  const labelMarkersSeriesRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const tradeMarkersSeriesRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const predictionMarkersSeriesRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const contractTransitionMarkersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const splitMarkerRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);

  // Expose imperative handle for time sync from parent layout
  useImperativeHandle(ref, () => ({
    setVisibleLogicalRange: (range: LogicalRange) => {
      try { chartRef.current?.timeScale().setVisibleLogicalRange(range); } catch { /* chart disposed */ }
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

  // ── Contract metadata ────────────────────────────────────────────────────

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

  const currentFrontMonth = useMemo(() => {
    if (!isFutures || data.length === 0) return null;
    for (let i = data.length - 1; i >= 0; i--) {
      const bar = data[i]!;
      if (bar.activeContract) return bar.activeContract;
    }
    return null;
  }, [data, isFutures]);

  const contractTransitions = useMemo(() => {
    if (!isFutures || data.length < 2) return [];
    const transitions: { time: number; from: string; to: string }[] = [];
    let prevContract: string | undefined = data[0]!.activeContract;
    for (let i = 1; i < data.length; i++) {
      const bar = data[i]!;
      const curr = bar.activeContract;
      if (curr && prevContract && curr !== prevContract) {
        transitions.push({ time: Math.floor(bar.timestamp / 1000), from: prevContract, to: curr });
      }
      if (curr) prevContract = curr;
    }
    return transitions;
  }, [data, isFutures]);

  // ── Process OHLCV data into chart format ─────────────────────────────────

  const processedData = useMemo(() => {
    if (data.length === 0) return { candles: [] as CandlestickData<Time>[], volumes: [] as { time: Time; value: number; color: string }[] };

    const candles: CandlestickData<Time>[] = [];
    const volumes: { time: Time; value: number; color: string }[] = [];
    let lastTimeKey = -1;
    const hasRegimeColors = regimeColorMap && regimeColorMap.size > 0;

    for (let i = 0; i < data.length; i++) {
      const d = data[i]!;
      const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
      if (!ts || isNaN(d.open) || isNaN(d.close)) continue;

      const timeKey = Math.floor(ts / 1000);
      if (timeKey === lastTimeKey) continue;
      lastTimeKey = timeKey;

      const regimeIdx = hasRegimeColors ? regimeColorMap!.get(timeKey) : undefined;
      if (regimeIdx !== undefined) {
        const fill = REGIME_FILLS[regimeIdx % REGIME_FILLS.length];
        candles.push({
          time: timeKey as Time, open: d.open, high: d.high, low: d.low, close: d.close,
          color: fill, borderColor: fill, wickColor: fill,
        });
      } else {
        candles.push({
          time: timeKey as Time, open: d.open, high: d.high, low: d.low, close: d.close,
        });
      }

      if (!isNaN(d.volume)) {
        const volColor = regimeIdx !== undefined
          ? REGIME_FILLS[regimeIdx % REGIME_FILLS.length] + '66'
          : d.close >= d.open ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)';
        volumes.push({ time: timeKey as Time, value: d.volume, color: volColor });
      }
    }

    return { candles, volumes };
  }, [data, regimeColorMap]);

  // ── Chart initialization ─────────────────────────────────────────────────

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, createChartOptions());
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, candleSeriesOptions(decimals, minMove));
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, volumeSeriesOptions);
    volumeSeries.priceScale().applyOptions({ scaleMargins: volumeScaleMargins });
    volumeSeriesRef.current = volumeSeries;

    chart.subscribeCrosshairMove((param) => {
      if (param.time && candleSeriesRef.current) {
        const data = param.seriesData.get(candleSeriesRef.current) as CandlestickData<Time> | undefined;
        if (data) {
          const timeValue = param.time as number;
          const date = new Date(timeValue * 1000);
          setPriceInfo({
            open: data.open, high: data.high, low: data.low, close: data.close,
            time: date.toLocaleString(),
            activeContract: contractLookupRef.current.get(timeValue),
          });
        }
      }
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && onRangeChangeRef.current) onRangeChangeRef.current(range);
    });

    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    });
    if (chartContainerRef.current) resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      srPriceLinesRef.current = [];
      zigZagSeriesRef.current = null;
      zigZagMarkersRef.current = null;
      swingZZSeriesRef.current = null;
      swingZZMarkersRef.current = null;
      labelMarkersSeriesRef.current = null;
      tradeMarkersSeriesRef.current = null;
      predictionMarkersSeriesRef.current = null;
      chart.remove();
    };
  }, [decimals, isFutures, tickInfo, minMove]);

  // Toggle time axis visibility
  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { visible: showTimeAxis !== false } });
  }, [showTimeAxis]);

  // ── Infinite scroll (load-more) ──────────────────────────────────────────

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

      const visibleBars = Math.max(1, to - from);
      const threshold = Math.min(200, Math.max(50, Math.floor(visibleBars * 0.5)));

      if (from < threshold && hasMoreLeftRef.current) {
        loadingMoreRef.current = true;
        savedRangeRef.current = visibleRange;
        isLoadMoreUpdateRef.current = true;
        prevDataLengthRef.current = dataLength;
        prevFirstTimeRef.current = processedData.candles.length > 0 ? (processedData.candles[0]!.time as number) : null;
        loadMoreDirectionRef.current = 'left';
        onLoadMoreRef.current?.('left', currentData[0]!.timestamp);
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
        onLoadMoreRef.current?.('right', currentData[currentData.length - 1]!.timestamp);
        if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
        loadMoreTimerRef.current = setTimeout(() => { loadingMoreRef.current = false; }, 2000);
      }
    };

    timeScale.subscribeVisibleLogicalRangeChange(handleVisibleTimeRangeChange);

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleTimeRangeChange);
      if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.length, processedData.candles]);

  // ── Data update logic ────────────────────────────────────────────────────

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

    // Load-more: save range, update data, restore range offset
    if (isLoadMoreUpdateRef.current && savedRangeRef.current && !symbolChanged && !timeframeChanged) {
      const savedRange = savedRangeRef.current;
      const prevFirstTime = prevFirstTimeRef.current;

      candleSeriesRef.current.setData(processedData.candles);
      volumeSeriesRef.current.setData(processedData.volumes);

      if (chartRef.current) {
        try {
          if (loadMoreDirectionRef.current === 'left' && prevFirstTime !== null) {
            const candles = processedData.candles;
            let lo = 0, hi = candles.length - 1, barsAdded = 0;
            while (lo <= hi) {
              const mid = (lo + hi) >>> 1;
              const midTime = candles[mid]!.time as number;
              if (midTime < prevFirstTime) lo = mid + 1;
              else if (midTime > prevFirstTime) hi = mid - 1;
              else { barsAdded = mid; break; }
            }
            if (lo > hi) barsAdded = lo;
            if (barsAdded > 0) {
              chartRef.current.timeScale().setVisibleLogicalRange({
                from: savedRange.from + barsAdded, to: savedRange.to + barsAdded,
              });
            }
          } else {
            chartRef.current.timeScale().setVisibleLogicalRange(savedRange);
          }
        } catch { /* range errors on disposed chart */ }
      }

      isLoadMoreUpdateRef.current = false;
      savedRangeRef.current = null;
      return;
    }

    candleSeriesRef.current.setData(processedData.candles);
    volumeSeriesRef.current.setData(processedData.volumes);

    if (chartRef.current && (isInitialLoadRef.current || symbolChanged || timeframeChanged)) {
      const totalBars = processedData.candles.length;
      const visibleBars = Math.min(250, totalBars);
      chartRef.current.timeScale().setVisibleLogicalRange({ from: 0, to: visibleBars });
      isInitialLoadRef.current = false;
    } else if (chartRef.current && isReplayActive) {
      const totalBars = processedData.candles.length;
      const windowSize = Math.min(150, totalBars);
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: totalBars - windowSize, to: totalBars + 5,
      });
    }
  }, [processedData, symbol, timeframe, isReplayActive]);

  // Reset regime-scroll flag when regime colors are cleared
  useEffect(() => {
    if (!regimeColorMap || regimeColorMap.size === 0) {
      hasScrolledToRegimeStartRef.current = false;
    }
  }, [regimeColorMap]);

  // Scroll chart to first bar when regime colors first arrive
  useEffect(() => {
    if (
      regimeColorMap && regimeColorMap.size > 0 &&
      !hasScrolledToRegimeStartRef.current &&
      chartRef.current && processedData.candles.length > 0
    ) {
      hasScrolledToRegimeStartRef.current = true;
      const totalBars = processedData.candles.length;
      const visibleBars = Math.min(250, totalBars);
      chartRef.current.timeScale().setVisibleLogicalRange({ from: 0, to: visibleBars });
    }
  }, [regimeColorMap, processedData]);

  useEffect(() => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => updateChartData());
    return () => { if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); };
  }, [updateChartData]);

  // ── Markers via shared hook ──────────────────────────────────────────────

  const timeframeSec = timeframe * 60;
  const validCandleSet = useMemo(() => buildCandleTimeSet(processedData.candles), [processedData.candles]);

  // Label markers
  const prevMarkerSymbolRef = useRef<string>(symbol);
  const computedLabelMarkers = useMemo((): ChartMarker[] => {
    if (prevMarkerSymbolRef.current !== symbol) {
      prevMarkerSymbolRef.current = symbol;
      return [];
    }

    const candleTimes = processedData.candles.map(d => d.time as number);
    const minTime = candleTimes.length > 0 ? candleTimes[0]! : 0;
    const maxTime = candleTimes.length > 0 ? candleTimes[candleTimes.length - 1]! : 0;

    const markers = labelMarkers
      .filter(m => m.label !== null && m.label !== undefined)
      .map(m => {
        const alignedTime = alignTimestamp(m.timestamp, timeframeSec);
        if (alignedTime < minTime || alignedTime > maxTime || !validCandleSet.has(alignedTime)) return null;
        const label = Number(m.label);
        if (label === 1) return { time: alignedTime as Time, position: 'belowBar' as const, color: '#22c55e', shape: 'arrowUp' as const, text: '' };
        if (label === -1) return { time: alignedTime as Time, position: 'aboveBar' as const, color: '#ef4444', shape: 'arrowDown' as const, text: '' };
        return { time: alignedTime as Time, position: 'inBar' as const, color: '#6366f1', shape: 'circle' as const, text: '' };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    // Dedup: keep buy/sell signals over hold
    const markerMap = new Map<number, (typeof markers)[0]>();
    for (const marker of markers) {
      const existing = markerMap.get(marker.time as number);
      if (!existing || (existing.shape === 'circle' && marker.shape !== 'circle')) {
        markerMap.set(marker.time as number, marker);
      }
    }
    return Array.from(markerMap.values()).sort((a, b) => (a.time as number) - (b.time as number));
  }, [labelMarkers, processedData, symbol, timeframeSec, validCandleSet]);

  useSeriesMarkers(labelMarkersSeriesRef, candleSeriesRef, computedLabelMarkers);

  // Trade markers
  const computedTradeMarkers = useMemo((): ChartMarker[] => {
    if (!tradeMarkers || tradeMarkers.length === 0) return [];
    return tradeMarkers
      .map(tm => {
        const alignedTime = alignTimestamp(tm.timestamp, timeframeSec);
        if (!validCandleSet.has(alignedTime)) return null;
        if (tm.type === 'entry') {
          return {
            time: alignedTime as Time,
            position: (tm.side === 'long' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
            color: tm.side === 'long' ? '#10b981' : '#f43f5e',
            shape: (tm.side === 'long' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
            text: tm.label || (tm.side === 'long' ? 'BUY' : 'SELL'),
          };
        } else {
          const pnlColor = (tm.pnl ?? 0) >= 0 ? '#10b981' : '#f43f5e';
          return {
            time: alignedTime as Time, position: 'aboveBar' as const, color: pnlColor,
            shape: 'square' as const,
            text: tm.pnl != null ? `${tm.pnl >= 0 ? '+' : ''}${tm.pnl.toFixed(1)}` : 'EXIT',
          };
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [tradeMarkers, timeframeSec, validCandleSet]);

  useSeriesMarkers(tradeMarkersSeriesRef, candleSeriesRef, computedTradeMarkers);

  // Prediction markers
  const computedPredictionMarkers = useMemo((): ChartMarker[] => {
    if (!predictionMarkers || predictionMarkers.length === 0) return [];
    return predictionMarkers
      .map(pm => {
        const alignedTime = alignTimestamp(pm.timestamp, timeframeSec);
        if (!validCandleSet.has(alignedTime)) return null;
        if (pm.direction === 1) return { time: alignedTime as Time, position: 'belowBar' as const, color: 'rgba(34,197,94,0.5)', shape: 'arrowUp' as const, text: pm.confidence ? `${(pm.confidence * 100).toFixed(0)}%` : '' };
        if (pm.direction === -1) return { time: alignedTime as Time, position: 'aboveBar' as const, color: 'rgba(239,68,68,0.5)', shape: 'arrowDown' as const, text: pm.confidence ? `${(pm.confidence * 100).toFixed(0)}%` : '' };
        return { time: alignedTime as Time, position: 'inBar' as const, color: 'rgba(99,102,241,0.3)', shape: 'circle' as const, text: '' };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [predictionMarkers, timeframeSec, validCandleSet]);

  useSeriesMarkers(predictionMarkersSeriesRef, candleSeriesRef, computedPredictionMarkers);

  // Contract transition markers
  const computedContractTransitionMarkers = useMemo((): ChartMarker[] => {
    if (!isFutures || contractTransitions.length === 0) return [];
    return contractTransitions
      .filter(t => validCandleSet.has(t.time))
      .map(t => ({
        time: t.time as Time, position: 'aboveBar' as const,
        color: '#f59e0b', shape: 'square' as const, text: `${t.to}`,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [isFutures, contractTransitions, validCandleSet]);

  useSeriesMarkers(contractTransitionMarkersRef, candleSeriesRef, computedContractTransitionMarkers);

  // Train/test split marker
  const computedSplitMarkers = useMemo((): ChartMarker[] => {
    if (!trainTestSplitTime || !validCandleSet.has(trainTestSplitTime)) return [];
    return [{
      time: trainTestSplitTime as Time, position: 'aboveBar' as const,
      color: 'rgba(255, 255, 255, 0.4)', shape: 'arrowDown' as const, text: 'TEST',
    }];
  }, [trainTestSplitTime, validCandleSet]);

  useSeriesMarkers(splitMarkerRef, candleSeriesRef, computedSplitMarkers);

  // ── Indicator overlays (delegated to hook) ───────────────────────────────

  useChartOverlays(chartRef, candleSeriesRef, indicatorOverlays, processedData.candles);

  // ── Support / Resistance price lines ─────────────────────────────────────

  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const series = candleSeriesRef.current;

    for (const pl of srPriceLinesRef.current) {
      try { series.removePriceLine(pl); } catch { /* price line already removed */ }
    }
    srPriceLinesRef.current = [];

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
  }, [supportResistanceLevels]);

  // ── ZigZag line + markers ────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

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
  }, [zigZagPoints, decimals]);

  // ── Swing ZigZag line + markers ──────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

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
  }, [swingZigZagPoints]);

  // Clean up all marker refs on unmount
  useEffect(() => {
    return () => {
      labelMarkersSeriesRef.current = null;
      contractTransitionMarkersRef.current = null;
      tradeMarkersSeriesRef.current = null;
      predictionMarkersSeriesRef.current = null;
    };
  }, []);

  // ── HUD ──────────────────────────────────────────────────────────────────

  const tickOrPipLabel = isFutures
    ? `Tick: ${tickInfo?.tickSize ?? 'N/A'} = $${tickInfo?.tickValue ?? 'N/A'}`
    : `Pip: ${pipInfo?.pipValue ?? 0.0001}`;

  const dataDateRange = useMemo(() => {
    if (processedData.candles.length === 0) return null;
    const first = new Date((processedData.candles[0]!.time as number) * 1000);
    const last = new Date((processedData.candles[processedData.candles.length - 1]!.time as number) * 1000);
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

      {/* Loading overlay */}
      {isLoadingMore && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-violet-500/30 overflow-hidden z-10">
          <div className="h-full bg-violet-500 animate-pulse" style={{ width: '100%' }} />
        </div>
      )}

      <div className="absolute top-2 left-2 flex items-center gap-4 text-[10px] font-mono bg-black/40 backdrop-blur-sm rounded-lg px-3 py-1.5">
        <span className="text-primary font-bold">{symbol}</span>
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

      {isFutures && (contractTransitions.length > 0 || currentFrontMonth) && (
        <div className="absolute top-12 left-2 flex flex-col gap-0.5 text-[8px] font-mono bg-amber-500/10 backdrop-blur-sm rounded px-1.5 py-1 border border-amber-500/20 max-w-[200px]">
          {currentFrontMonth && (
            <span className="text-amber-300 font-semibold">Front: {currentFrontMonth}</span>
          )}
          {contractTransitions.length > 0 && (
            <>
              <span className="text-amber-400/70">{contractTransitions.length} transition{contractTransitions.length !== 1 ? 's' : ''} in view</span>
              {contractTransitions.slice(-3).map((t, i) => (
                <span key={i} className="text-amber-500/60 truncate">{t.from} → {t.to}</span>
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
