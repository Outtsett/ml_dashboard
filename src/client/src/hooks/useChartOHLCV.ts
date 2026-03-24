/**
 * useChartOHLCV — Shared hook for chart OHLCV data with infinite scroll.
 *
 * SRP: One hook for one data concern (OHLCV bars for the chart).
 * DIP: Uses apiService / fetch abstraction, not raw fetch inline in components.
 */

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getFetchLimit, minutesToApiKey } from '@/lib/timeframes';
import type { OhlcvData } from '@/pages/market-data/types';

const MAX_BARS_IN_MEMORY = 50_000;

export function useChartOHLCV(symbol: string, timeframeMinutes: number) {
  const queryClient = useQueryClient();
  const [visibleData, setVisibleData] = useState<OhlcvData[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreLeft, setHasMoreLeft] = useState(true);
  const [hasMoreRight, setHasMoreRight] = useState(false);
  const isLoadingMoreRef = useRef(false);

  const FETCH_LIMIT = useMemo(() => getFetchLimit(timeframeMinutes), [timeframeMinutes]);
  const apiTimeframe = useMemo(() => minutesToApiKey(timeframeMinutes), [timeframeMinutes]);

  // Reset scroll state on symbol/timeframe change
  useEffect(() => {
    setVisibleData([]);
    setHasMoreLeft(true);
    setHasMoreRight(false);
    isLoadingMoreRef.current = false;
  }, [symbol, timeframeMinutes]);

  // ── Primary data query ──
  const { data: chartQueryData, isFetching } = useQuery<OhlcvData[]>({
    queryKey: ['/api/charts/ohlcv', symbol, apiTimeframe],
    queryFn: async ({ signal }) => {
      const url = `/api/charts/ohlcv?symbol=${symbol}&timeframe=${apiTimeframe}&limit=${FETCH_LIMIT}&order=asc`;
      const response = await fetch(url, { signal });
      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to load chart data: ${errText}`);
      }
      return await response.json() as OhlcvData[];
    },
    staleTime: 10 * 60 * 1000, // 10 min — historical OHLCV rarely changes
    // Don't use placeholderData — showing a different symbol's data
    // while the new one loads causes a confusing "cycling" effect
  });

  // Sync visible state when primary query data arrives (not inside queryFn)
  useEffect(() => {
    if (chartQueryData) {
      setVisibleData(chartQueryData);
      setHasMoreLeft(false);
      setHasMoreRight(chartQueryData.length >= FETCH_LIMIT);
    }
  }, [chartQueryData, FETCH_LIMIT]);

  // ── Infinite scroll handler ──
  const handleLoadMore = useCallback(async (direction: 'left' | 'right', timestamp: number) => {
    if (isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      let url = `/api/charts/ohlcv?symbol=${symbol}&timeframe=${apiTimeframe}&limit=${FETCH_LIMIT}&order=asc`;
      if (direction === 'left') url += `&endTime=${timestamp - 1}`;
      else url += `&startTime=${timestamp + 1}`;

      const response = await fetch(url);
      if (!response.ok) { isLoadingMoreRef.current = false; setIsLoadingMore(false); return; }

      const result = await response.json();
      const newData: OhlcvData[] = Array.isArray(result) ? result : (result.data || []);

      if (newData.length === 0) {
        if (direction === 'left') setHasMoreLeft(false);
        else setHasMoreRight(false);
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
        return;
      }

      setVisibleData(prev => {
        const combined = direction === 'left' ? [...newData, ...prev] : [...prev, ...newData];
        const seen = new Set<number>();
        const deduped = combined.filter(d => {
          const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp) : d.timestamp;
          if (seen.has(ts)) return false;
          seen.add(ts);
          return true;
        }).sort((a, b) => {
          const tsA = typeof a.timestamp === 'string' ? parseInt(a.timestamp) : a.timestamp;
          const tsB = typeof b.timestamp === 'string' ? parseInt(b.timestamp) : b.timestamp;
          return tsA - tsB;
        });

        if (deduped.length > MAX_BARS_IN_MEMORY) {
          if (direction === 'left') {
            setHasMoreRight(true);
            return deduped.slice(0, MAX_BARS_IN_MEMORY);
          } else {
            setHasMoreLeft(true);
            return deduped.slice(-MAX_BARS_IN_MEMORY);
          }
        }
        return deduped;
      });

      if (newData.length < FETCH_LIMIT) {
        if (direction === 'left') setHasMoreLeft(false);
        else setHasMoreRight(false);
      }
    } catch (error) {
      console.error('Error loading more data:', error);
    }
    isLoadingMoreRef.current = false;
    setIsLoadingMore(false);
  }, [symbol, apiTimeframe, FETCH_LIMIT]);

  const rawData = visibleData.length > 0 ? visibleData : (chartQueryData || []);

  const resetScrollState = useCallback(() => {
    setVisibleData([]);
    setHasMoreLeft(true);
    setHasMoreRight(false);
  }, []);

  const resetChart = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['/api/charts/ohlcv', symbol, apiTimeframe] });
    resetScrollState();
  }, [queryClient, symbol, apiTimeframe, resetScrollState]);

  const useInfiniteScroll = visibleData.length > 0;

  return {
    chartData: rawData,
    isFetching,
    isLoadingMore,
    hasMoreLeft,
    hasMoreRight,
    handleLoadMore,
    resetScrollState,
    resetChart,
    useInfiniteScroll,
  };
}
