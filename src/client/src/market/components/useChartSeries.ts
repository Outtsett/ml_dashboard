import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { IChartApi, CandlestickData, Time, LogicalRange } from 'lightweight-charts';
import {
  REGIME_FILLS,
  CANDLE_UP_COLOR,
  CANDLE_DOWN_COLOR,
  VOLUME_UP_FILL,
  VOLUME_DOWN_FILL,
} from './chartConfig';
import type { OhlcvData, ProcessedChartData } from "@/market/components/types";

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
  onPrefetch?: (direction: 'left' | 'right', edgeTimestamp: number) => void;
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
  data, symbol, timeframe, isFutures: _isFutures,
  regimeColorMap, isReplayActive,
  onLoadMore, onPrefetch, isLoadingMore, hasMoreLeft, hasMoreRight,
}: ChartSeriesOptions): ChartSeriesResult {

  // ── Internal refs ────────────────────────────────────────────────────────

  const isInitialLoadRef = useRef(true);
  const prevSymbolRef = useRef(symbol);
  const prevTimeframeRef = useRef(timeframe);
  // Per-direction cooldowns (500ms) instead of a single global 2000ms lock
  const loadingLeftRef = useRef(false);
  const loadingRightRef = useRef(false);
  const loadLeftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastDataHashRef = useRef('');
  const isLoadMoreUpdateRef = useRef(false);
  const savedRangeRef = useRef<LogicalRange | null>(null);
  const prevDataLengthRef = useRef(0);
  const prevFirstTimeRef = useRef<number | null>(null);
  const loadMoreDirectionRef = useRef<'left' | 'right'>('left');
  const hasScrolledToRegimeStartRef = useRef(false);
  const LOAD_MORE_COOLDOWN_MS = 500;

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
  const onPrefetchRef = useRef(onPrefetch);
  onPrefetchRef.current = onPrefetch;

  // ── Process OHLCV → chart-ready arrays ─────────────────────────────────

  const processedData = useMemo((): ProcessedChartData => {
    if (data.length === 0) return { candles: [], volumes: [], activeContractMap: new Map(), anatomyMap: new Map() };

    const candles: CandlestickData<Time>[] = [];
    const volumes: { time: Time; value: number; color: string }[] = [];
    const activeContractMap = new Map<number, string>();
    const anatomyMap = new Map<number, any>();
    let lastTimeKey = -1;
    // Close of the last accepted bar. Drives up/down direction: a bar is "up"
    // when it closes above the PREVIOUS candle's close, not above its own open.
    let prevClose: number | null = null;
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

      // Track active contract for rollover HUD display
      if (d.activeContract) {
        activeContractMap.set(timeKey, d.activeContract);
      }

      // Track candle anatomy
      anatomyMap.set(timeKey, {
        body_magnitude: d.body_magnitude ?? 0,
        upper_wick_pct: d.upper_wick_pct ?? 0,
        lower_wick_pct: d.lower_wick_pct ?? 0,
        is_bullish: !!d.is_bullish,
      });

      // Exact match first, then nearest regime for bars outside assignment range
      let regimeIdx = hasRegimeColors ? regimeColorMap!.get(timeKey) : undefined;
      if (regimeIdx === undefined && hasRegimeColors) {
        regimeIdx = findNearestRegime(timeKey);
      }

      // Close-to-close direction. The very first bar has no predecessor, so it
      // falls back to its own body direction — the only reference it has.
      const isUp = prevClose === null ? d.close >= d.open : d.close >= prevClose;

      if (regimeIdx !== undefined) {
        const fill = REGIME_FILLS[regimeIdx % REGIME_FILLS.length];
        candles.push({
          time: timeKey as Time, open: d.open, high: d.high, low: d.low, close: d.close,
          color: fill, borderColor: fill, wickColor: fill,
        });
      } else {
        const fill = isUp ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR;
        candles.push({
          time: timeKey as Time, open: d.open, high: d.high, low: d.low, close: d.close,
          color: fill, borderColor: fill, wickColor: fill,
        });
      }

      if (!isNaN(d.volume)) {
        const volColor = regimeIdx !== undefined
          ? REGIME_FILLS[regimeIdx % REGIME_FILLS.length] + '66'
          : isUp ? VOLUME_UP_FILL : VOLUME_DOWN_FILL;
        volumes.push({ time: timeKey as Time, value: d.volume, color: volColor });
      }

      prevClose = d.close;
    }

    return { candles, volumes, activeContractMap, anatomyMap };
  }, [data, regimeColorMap]);

  // ── Infinite scroll (per-direction cooldowns for smooth panning) ────────

  useEffect(() => {
    if (!chartRef.current || !onLoadMore || data.length === 0) return;

    const chart = chartRef.current;
    const timeScale = chart.timeScale();

    const handleVisibleTimeRangeChange = () => {
      if (isLoadingMoreRef.current) return;

      const visibleRange = timeScale.getVisibleLogicalRange();
      if (!visibleRange) return;

      const currentData = dataRef.current;
      const dataLength = currentData.length;
      const { from, to } = visibleRange;

      const visibleBars = Math.max(1, to - from);
      const threshold = Math.min(400, Math.max(100, Math.floor(visibleBars * 0.8)));
      const prefetchThreshold = Math.min(400, Math.max(100, Math.floor(visibleBars * 1.0)));

      // Prefetch triggers — start background fetch when user is approaching edges
      if (onPrefetchRef.current && currentData.length > 0) {
        if (from < prefetchThreshold && hasMoreLeftRef.current) {
          onPrefetchRef.current('left', currentData[0]!.timestamp);
        }
        if (to > dataLength - prefetchThreshold && hasMoreRightRef.current) {
          onPrefetchRef.current('right', currentData[currentData.length - 1]!.timestamp);
        }
      }

      // Left edge — load older data (independent cooldown)
      if (from < threshold && hasMoreLeftRef.current && !loadingLeftRef.current) {
        loadingLeftRef.current = true;
        savedRangeRef.current = visibleRange;
        isLoadMoreUpdateRef.current = true;
        prevDataLengthRef.current = dataLength;
        prevFirstTimeRef.current = processedData.candles.length > 0
          ? (processedData.candles[0]!.time as number)
          : null;
        loadMoreDirectionRef.current = 'left';
        onLoadMoreRef.current?.('left', currentData[0]!.timestamp);
        if (loadLeftTimerRef.current) clearTimeout(loadLeftTimerRef.current);
        loadLeftTimerRef.current = setTimeout(() => { loadingLeftRef.current = false; }, LOAD_MORE_COOLDOWN_MS);
      }

      // Right edge — load newer data (independent cooldown)
      if (to > dataLength - threshold && hasMoreRightRef.current && !loadingRightRef.current) {
        loadingRightRef.current = true;
        savedRangeRef.current = visibleRange;
        isLoadMoreUpdateRef.current = true;
        prevDataLengthRef.current = dataLength;
        prevFirstTimeRef.current = null;
        loadMoreDirectionRef.current = 'right';
        onLoadMoreRef.current?.('right', currentData[currentData.length - 1]!.timestamp);
        if (loadRightTimerRef.current) clearTimeout(loadRightTimerRef.current);
        loadRightTimerRef.current = setTimeout(() => { loadingRightRef.current = false; }, LOAD_MORE_COOLDOWN_MS);
      }
    };

    timeScale.subscribeVisibleLogicalRangeChange(handleVisibleTimeRangeChange);

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleTimeRangeChange);
      if (loadLeftTimerRef.current) clearTimeout(loadLeftTimerRef.current);
      if (loadRightTimerRef.current) clearTimeout(loadRightTimerRef.current);
    };
   
  }, [data.length, processedData.candles]);

  // ── Data update logic (smooth range restoration) ────────────────────────

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

    // Load-more: update data then restore view position so user doesn't lose their place
    if (isLoadMoreUpdateRef.current && savedRangeRef.current && !symbolChanged && !timeframeChanged) {
      const savedRange = savedRangeRef.current;
      const prevFirstTime = prevFirstTimeRef.current;

      candleSeriesRef.current.setData(processedData.candles);
      volumeSeriesRef.current.setData(processedData.volumes);

      if (chartRef.current) {
        try {
          if (loadMoreDirectionRef.current === 'left' && prevFirstTime !== null) {
            // Time-based range restoration: find where the old first candle
            // now sits in the new array, then offset the saved range by that count.
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
                from: savedRange.from + barsAdded,
                to: savedRange.to + barsAdded,
              });
            }
          } else {
            // Right load-more: keep the same view position
            chartRef.current.timeScale().setVisibleLogicalRange(savedRange);
          }
        } catch { /* range errors on disposed chart */ }
      }

      // Release per-direction cooldowns immediately after data arrives
      loadingLeftRef.current = false;
      loadingRightRef.current = false;
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
