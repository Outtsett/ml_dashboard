import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getIndicatorColor } from '@/lib/indicatorColors';
import { minutesToApiKey } from '@/lib/timeframes';
import { QUERY_KEYS } from '@/lib/types';

// --- Types ---

export type IndicatorDisplayType = 'overlay' | 'subchart' | 'marker';

export interface IndicatorOverlay {
  column: string;
  data: { time: number; value: number }[];
  color: string;
  displayType: IndicatorDisplayType;
  lineWidth: number;
}

export interface IndicatorCatalog {
  categories: Record<string, string[]>;
  total: number;
  columns: string[];
}

/** OHLCV bar shape expected by the hook (matches StitchedOHLCVBar). */
export interface OHLCVBarInput {
  timestamp: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// --- Constants ---

const PATTERN_STORAGE_KEY = 'pattern-selection';

// --- Helpers ---

function loadPatternSelection(): string[] {
  try {
    const stored = localStorage.getItem(PATTERN_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function savePatternSelection(columns: string[]) {
  try {
    localStorage.setItem(PATTERN_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // ignore quota errors
  }
}

// --- Hook ---

/**
 * Pattern data hook — manages CDL candlestick pattern selection and fetching.
 *
 * Indicators are now managed by useActiveIndicators. This hook only handles:
 * - Fetching the indicator catalog (for the CDL patterns list in the UI)
 * - CDL pattern selection and data fetching from talib_features
 *
 * @param symbol - Trading symbol (e.g. "ES", "EURUSD")
 * @param timeframeMinutes - Chart timeframe in minutes
 */
export function useIndicatorData(
  symbol: string,
  timeframeMinutes: number,
  _isFutures: boolean,
  _ohlcvBars: OHLCVBarInput[] = [],
) {
  const [selectedPatterns, setSelectedPatternsRaw] = useState<string[]>(loadPatternSelection);

  const setSelectedPatterns = useCallback((cols: string[]) => {
    setSelectedPatternsRaw(cols);
    savePatternSelection(cols);
  }, []);

  // Persist on mount (sync from localStorage in case another tab changed it)
  useEffect(() => {
    const stored = loadPatternSelection();
    if (stored.length > 0) setSelectedPatternsRaw(stored);
  }, []);

  const tfKey = minutesToApiKey(timeframeMinutes);

  // 1) Fetch catalog (cached indefinitely) — used by IndicatorSelector for patterns list
  const catalogQuery = useQuery<IndicatorCatalog>({
    queryKey: ["/api/indicators/catalog"],
    queryFn: async () => {
      const res = await fetch('/api/indicators/catalog');
      if (!res.ok) throw new Error('Failed to fetch indicator catalog');
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // 2) Fetch pattern data for selected CDL columns
  const patternQuery = useQuery({
    queryKey: [...QUERY_KEYS.indicatorPatterns(symbol, tfKey), selectedPatterns.sort().join(',')],
    queryFn: async () => {
      const params = new URLSearchParams({ timeframe: tfKey, limit: '2000' });
      const res = await fetch(`/api/indicators/patterns/${symbol}?${params}`);
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled: selectedPatterns.length > 0,
    staleTime: 60_000,
  });

  // 3) Build marker overlays from pattern data
  const patternOverlays = useMemo<IndicatorOverlay[]>(() => {
    const result: IndicatorOverlay[] = [];

    if (patternQuery.data?.data?.length) {
      const rows = patternQuery.data.data as Record<string, number | null>[];
      for (const col of selectedPatterns) {
        const pointMap = new Map<number, number>();
        for (const row of rows) {
          const ts = row.timestamp;
          const val = row[col];
          if (ts != null && val != null && val !== 0) {
            const timeSec = typeof ts === 'string'
              ? Math.floor(new Date(ts).getTime() / 1000)
              : (ts as number);
            if (!isNaN(timeSec)) {
              pointMap.set(timeSec, val as number);
            }
          }
        }
        if (pointMap.size > 0) {
          const points = Array.from(pointMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([t, v]) => ({ time: t, value: v }));
          result.push({
            column: col,
            data: points,
            color: getIndicatorColor(col),
            displayType: 'marker',
            lineWidth: 1,
          });
        }
      }
    }

    return result;
  }, [selectedPatterns, patternQuery.data]);

  return {
    catalog: catalogQuery.data ?? null,
    catalogLoading: catalogQuery.isLoading,
    selectedPatterns,
    setSelectedPatterns,
    patternOverlays,
    isLoading: patternQuery.isLoading,
  };
}
