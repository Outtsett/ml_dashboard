import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import {
  getCachedBars,
  cacheBars,
  getCacheRange,
  isCacheStale,
  prefetchAdjacentData,
  OHLCVBar
} from '../lib/indexeddb';

interface OhlcvData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface UseMarketDataOptions {
  symbol: string;
  isFutures: boolean;
  timeframe?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  enabled?: boolean;
}

async function fetchFromAPI(
  symbol: string,
  isFutures: boolean,
  timeframe: string,
  startTs?: number,
  endTs?: number
): Promise<OhlcvData[]> {
  const params = new URLSearchParams({ symbol, timeframe });
  if (startTs) params.set('start', startTs.toString());
  if (endTs) params.set('end', endTs.toString());
  
  const endpoint = isFutures ? '/api/ohlcv/futures' : '/api/ohlcv/forex';
  const response = await fetch(`${endpoint}?${params}`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch market data: ${response.statusText}`);
  }
  
  return response.json();
}

export function useMarketData({
  symbol,
  isFutures,
  timeframe = '1m',
  startTimestamp,
  endTimestamp,
  enabled = true
}: UseMarketDataOptions) {
  const queryClient = useQueryClient();
  
  const queryKey = ['marketData', symbol, isFutures, timeframe, startTimestamp, endTimestamp];
  
  const fetchWithCache = useCallback(async (): Promise<OhlcvData[]> => {
    if (!symbol) return [];
    
    const now = Date.now();
    const defaultStart = startTimestamp ?? now - 7 * 24 * 60 * 60 * 1000;
    const defaultEnd = endTimestamp ?? now;
    
    const cachedBars = await getCachedBars(symbol, timeframe, defaultStart, defaultEnd);
    const stale = await isCacheStale(symbol, timeframe, 60 * 1000);
    
    if (cachedBars.length > 0 && !stale) {
      const cacheRange = await getCacheRange(symbol, timeframe);
      
      if (cacheRange && cacheRange.start <= defaultStart && cacheRange.end >= defaultEnd) {
        return cachedBars.map(bar => ({
          timestamp: bar.timestamp,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume
        }));
      }
    }
    
    const freshData = await fetchFromAPI(symbol, isFutures, timeframe, defaultStart, defaultEnd);
    
    if (freshData.length > 0) {
      await cacheBars(symbol, timeframe, freshData);
    }
    
    return freshData;
  }, [symbol, isFutures, timeframe, startTimestamp, endTimestamp]);
  
  const query = useQuery({
    queryKey,
    queryFn: fetchWithCache,
    enabled: enabled && !!symbol,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });
  
  useEffect(() => {
    if (!query.data || query.data.length === 0) return;
    
    const now = Date.now();
    const defaultStart = startTimestamp ?? now - 7 * 24 * 60 * 60 * 1000;
    const defaultEnd = endTimestamp ?? now;
    
    prefetchAdjacentData(
      symbol,
      timeframe,
      defaultStart,
      defaultEnd,
      async (start, end) => fetchFromAPI(symbol, isFutures, timeframe, start, end)
    ).catch(() => {});
  }, [query.data, symbol, isFutures, timeframe, startTimestamp, endTimestamp]);
  
  const invalidateCache = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['marketData', symbol] });
  }, [queryClient, symbol]);
  
  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    invalidateCache
  };
}

export function usePrefetchMarketData() {
  const queryClient = useQueryClient();
  
  return useCallback(async (
    symbol: string,
    isFutures: boolean,
    timeframe: string,
    startTs: number,
    endTs: number
  ) => {
    await queryClient.prefetchQuery({
      queryKey: ['marketData', symbol, isFutures, timeframe, startTs, endTs],
      queryFn: async () => {
        const cached = await getCachedBars(symbol, timeframe, startTs, endTs);
        if (cached.length > 0) {
          return cached.map(bar => ({
            timestamp: bar.timestamp,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume
          }));
        }
        
        const fresh = await fetchFromAPI(symbol, isFutures, timeframe, startTs, endTs);
        if (fresh.length > 0) {
          await cacheBars(symbol, timeframe, fresh);
        }
        return fresh;
      },
      staleTime: 30 * 1000
    });
  }, [queryClient]);
}
