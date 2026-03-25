import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { IChartApi, CandlestickData, Time, LogicalRange } from 'lightweight-charts';
import { REGIME_FILLS } from './chartConfig';
import type { OhlcvData, ProcessedChartData } from './types';

// ── Types ──────────────────────────────────────────────────────────────────

interface ChartSeriesOptions {
  chartRef: React.MutableRefObject<IChartApi | null>;
  candleSeriesRef: React.MutableRefObject<any>;
  volumeSeriesRef: React.MutableRefObject<any>;
  data: OhlcvData[];
  symbol: string;
  timeframe: number;
  isFutures: boolean;
  regimeColorMap?: Map<number, number>;
  isReplayActive: boolean;
  onLoadMore?: (direction: 'left' | 'right', timestamp: number) => void;
  isLoadingMore: boolean;
  hasMoreLeft: boolean;
  hasMoreRight: boolean;
}

interface ChartSeriesResult {
  processedData: ProcessedChartData;
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Manages the chart's data lifecycle:
 *  - Processes OHLCV into chart-ready candle + volume arrays (with regime colors)
 *  - Handles data updates (symbol/TF change, load-more, replay ticker)
 *  - Implements infinite scroll (load-more on edge approach)
 *  - Schedules updates via requestAnimationFrame
 *  - Scrolls to start on first regime color arrival
 */
export function useChartSeries({
  chartRef, candleSeriesRef, volumeSeriesRef,
  data, symbol, timeframe, isFutures,
  regimeColorMap, isReplayActive,
  onLoadMore, isLoadingMore, hasMoreLeft, hasMoreRight,
}: ChartSeriesOptions): ChartSeriesResult {

  // ── Internal refs ────────────────────────────────────────────────────────

  const isInitialLoadRef = useRef(true);
  const prevSymbolRef = useRef(symbol);
  const prevTimeframeRef = useRef(timeframe);
  const loadingMoreRef = useRef(false);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastDataHashRef = useRef('');
  const isLoadMoreUpdateRef = useRef(false);
  const savedRangeRef = useRef<LogicalRange | null>(null);
  const prevDataLengthRef = useRef(0);
  const prevFirstTimeRef = useRef<number | null>(null);
  const loadMoreDirectionRef = useRef<'left' | 'right'>('left');
  const hasScrolledToRegimeStartRef = useRef(false);

  // Stable-ref bridges for values read inside effects / callbacks
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

  // ── Process OHLCV → chart-ready arrays ─────────────────────────────────

  const processedData = useMemo((): ProcessedChartData => {
    if (data.length === 0) return { candles: [], volumes: [] };

    const candles: CandlestickData<Time>[] = [];
    const volumes: { time: Time; value: number; color: string }[] = [];
    let lastTimeKey = -1;
    const hasRegimeColors = regimeColorMap && regimeColorMap.size > 0;

    // Build sorted timestamp array for nearest-regime lookup when bars fall outside assignment range
    let sortedRegimeKeys: number[] | null = null;
    let sortedRegimeVals: number[] | null = null;
    if (hasRegimeColors) {
      const entries = Array.from(regimeColorMap!.entries()).sort((a, b) => a[0] - b[0]);
      sortedRegimeKeys = entries.map(e => e[0]);
      sortedRegimeVals = entries.map(e => e[1]);
    }

    // Binary search for nearest regime assignment
    const findNearestRegime = (timeKey: number): number | undefined => {
      if (!sortedRegimeKeys || !sortedRegimeVals || sortedRegimeKeys.length === 0) return undefined;
      let lo = 0, hi = sortedRegimeKeys.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedRegimeKeys[mid]! < timeKey) lo = mid + 1;
        else hi = mid;
      }
      // Pick closest between lo and lo-1
      if (lo === 0) return sortedRegimeVals[0];
      const distLo = Math.abs(sortedRegimeKeys[lo]! - timeKey);
      const distPrev = Math.abs(sortedRegimeKeys[lo - 1]! - timeKey);
      return distPrev <= distLo ? sortedRegimeVals[lo - 1] : sortedRegimeVals[lo];
    };

    for (let i = 0; i < data.length; i++) {
      const d = data[i]!;
      const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
      if (!ts || isNaN(d.open) || isNaN(d.close)) continue;

      const timeKey = Math.floor(ts / 1000);
      if (timeKey === lastTimeKey) continue;
      lastTimeKey = timeKey;

      // Exact match first, then nearest regime for bars outside assignment range
      let regimeIdx = hasRegimeColors ? regimeColorMap!.get(timeKey) : undefined;
      if (regimeIdx === undefined && hasRegimeColors) {
        regimeIdx = findNearestRegime(timeKey);
      }

      if (regimeIdx !== undefined) {
        const fill = REGIME_FILLS[regimeIdx % REGIME_FILLS.length];
        candles.push({
          time: timeKey as Time, open: d.open, high: d.high, low: d.low, close: d.close,
          color: fill, borderColor: fill, wickColor: fill,
        });
      } else {
        candles.push({ time: timeKey as Time, open: d.open, high: d.high, low: d.low, close: d.close });
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

  // ── Infinite scroll ────────────────────────────────────────────────────

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
        prevFirstTimeRef.current = processedData.candles.length > 0
          ? (processedData.candles[0]!.time as number)
          : null;
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

  // ── Data update logic ──────────────────────────────────────────────────

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
  }, [processedData, symbol, timeframe, isReplayActive, chartRef, candleSeriesRef, volumeSeriesRef]);

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
  }, [regimeColorMap, processedData, chartRef]);

  // Schedule data update via RAF
  useEffect(() => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => updateChartData());
    return () => { if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); };
  }, [updateChartData]);

  return { processedData };
}
