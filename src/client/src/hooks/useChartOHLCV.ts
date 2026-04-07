import { useSSEConnection } from "./useSSEConnection";
/**
 * useChartOHLCV — Shared hook for chart OHLCV data with infinite scroll.
 *
 * SRP: One hook for one data concern (OHLCV bars for the chart).
 * DIP: Uses apiService / fetch abstraction, not raw fetch inline in components.
 */

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getFetchLimit, minutesToApiKey } from '@/lib/timeframes';
import { getCachedBars, storeBars } from '@/lib/ohlcv_cache';
import { decode as msgpackDecode } from '@msgpack/msgpack';
import type { OhlcvData } from '@/pages/market-data/types';

const MAX_BARS_IN_MEMORY = 100_000;

// Prefetch cache: stores pre-fetched pages keyed by URL so load-more is instant
const prefetchCache = new Map<string, { data: OhlcvData[]; ts: number }>();
const PREFETCH_TTL = 5 * 60 * 1000; // 5 min

function getPrefetchUrl(symbol: string, apiTimeframe: string, fetchLimit: number, direction: 'left' | 'right', edgeTimestamp: number): string {
  let url = `/api/charts/ohlcv?nm=true&symbol=${symbol}&timeframe=${apiTimeframe}&limit=${fetchLimit}&order=asc`;
  if (direction === 'left') url += `&endTime=${edgeTimestamp - 1}`;
  else url += `&startTime=${edgeTimestamp + 1}`;
  return url;
}

async function fetchAndCachePage(url: string, signal?: AbortSignal): Promise<OhlcvData[] | null> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const result = await response.json();
    const data: OhlcvData[] = Array.isArray(result) ? result : (result.data || []);
    prefetchCache.set(url, { data, ts: Date.now() });
    // Evict stale entries
    for (const [key, entry] of prefetchCache) {
      if (Date.now() - entry.ts > PREFETCH_TTL) prefetchCache.delete(key);
    }
    return data;
  } catch {
    return null;
  }
}

function getCachedPage(url: string): OhlcvData[] | null {
  const entry = prefetchCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.ts > PREFETCH_TTL) { prefetchCache.delete(url); return null; }
  return entry.data;
}

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
      // L0: Check IndexedDB cache first — instant load on revisit
      const cached = await getCachedBars(symbol, apiTimeframe);
      if (cached && cached.length > 0) {
        return cached as unknown as OhlcvData[];
      }

      // L1: Fetch from server (prefer MessagePack for ~50% smaller payload)
      const url = `/api/charts/ohlcv?nm=true&symbol=${symbol}&timeframe=${apiTimeframe}&limit=${FETCH_LIMIT}&order=asc`;
      const response = await fetch(url, {
        signal,
        headers: { 'Accept': 'application/msgpack' },
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to load chart data: ${errText}`);
      }

      let bars: OhlcvData[];
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/msgpack')) {
        const buffer = await response.arrayBuffer();
        bars = msgpackDecode(new Uint8Array(buffer)) as OhlcvData[];
      } else {
        bars = await response.json() as OhlcvData[];
      }

      // Persist to IndexedDB for next visit (fire-and-forget)
      storeBars(symbol, apiTimeframe, bars);

      return bars;
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

  // ── Infinite scroll handler (uses prefetch cache for instant loads) ──
  const handleLoadMore = useCallback(async (direction: 'left' | 'right', timestamp: number) => {
    if (isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const url = getPrefetchUrl(symbol, apiTimeframe, FETCH_LIMIT, direction, timestamp);

      // Try prefetch cache first — instant load if available
      let newData = getCachedPage(url);
      if (!newData) {
        newData = await fetchAndCachePage(url);
      }
      prefetchCache.delete(url); // consumed

      if (!newData || newData.length === 0) {
        if (direction === 'left') setHasMoreLeft(false);
        else setHasMoreRight(false);
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
        return;
      }

      // Persist load-more pages to IndexedDB (fire-and-forget)
      storeBars(symbol, apiTimeframe, newData);

      setVisibleData(prev => {
        const combined = direction === 'left' ? [...newData!, ...prev] : [...prev, ...newData!];
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

  // ── Background prefetch — fires when user is near an edge ──
  const prefetchAbortRef = useRef<AbortController | null>(null);

  const triggerPrefetch = useCallback((direction: 'left' | 'right', edgeTimestamp: number) => {
    const url = getPrefetchUrl(symbol, apiTimeframe, FETCH_LIMIT, direction, edgeTimestamp);
    if (getCachedPage(url)) return; // already prefetched
    // Abort any in-flight prefetch to avoid stacking
    prefetchAbortRef.current?.abort();
    const controller = new AbortController();
    prefetchAbortRef.current = controller;
    fetchAndCachePage(url, controller.signal);
  }, [symbol, apiTimeframe, FETCH_LIMIT]);

  const rawData = visibleData.length > 0 ? visibleData : (chartQueryData || []);

  const resetScrollState = useCallback(() => {
    setVisibleData([]);
    setHasMoreLeft(true);
    setHasMoreRight(false);
    isLoadingMoreRef.current = false;
    prefetchCache.clear();
  }, []);

  const resetChart = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['/api/charts/ohlcv', symbol, apiTimeframe] });
    resetScrollState();
  }, [queryClient, symbol, apiTimeframe, resetScrollState]);

  const useInfiniteScroll = visibleData.length > 0;


  // --- ZERO LATENCY PULSE LISTENER ---
  // Listens for 'market.data.updated' via the 'pipeline' channel
  useSSEConnection({
    url: '/api/events/pipeline',
    eventMap: {
      'market.data.updated': (event: any) => {
        const payload = event.payload || {};
        if (payload.symbol === symbol) {
          // Instant invalidate to trigger re-fetch of recent bars
          queryClient.invalidateQueries({ queryKey: ['/api/charts/ohlcv', symbol, apiTimeframe] });
        }
      }
    }
  });

  return {
    chartData: rawData,
    isFetching,
    isLoadingMore,
    hasMoreLeft,
    hasMoreRight,
    handleLoadMore,
    triggerPrefetch,
    resetScrollState,
    resetChart,
    useInfiniteScroll,
  };
}
