import { useState, useMemo, useCallback, useEffect } from 'react';
import { getIndicatorColor } from '@/lib/indicatorColors';
import { scanPatterns } from '@/lib/candlePatterns';

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

/** Normalize timestamp to milliseconds (number). */
function toMs(ts: number | string): number {
  if (typeof ts === 'string') {
    const n = parseInt(ts, 10);
    return isNaN(n) ? new Date(ts).getTime() : (n < 2e10 ? n * 1000 : n);
  }
  return ts < 2e10 ? ts * 1000 : ts;
}

// --- Hook ---

/**
 * Pattern data hook — manages CDL candlestick pattern selection and
 * client-side computation from OHLCV bars.
 *
 * Indicators are managed by useActiveIndicators. This hook only handles:
 * - CDL pattern selection (persisted to localStorage)
 * - Client-side pattern detection from the chart's own OHLCV data
 *
 * No API calls are needed — patterns are computed directly from ohlcvBars
 * so they work for all symbols on all time ranges.
 *
 * @param _symbol - Trading symbol (unused, kept for API compat)
 * @param _timeframeMinutes - Chart timeframe in minutes (unused)
 * @param _isFutures - Whether the symbol is a futures root (unused)
 * @param ohlcvBars - Current chart OHLCV bars to compute patterns from
 */
export function useIndicatorData(
  _symbol: string,
  _timeframeMinutes: number,
  _isFutures: boolean,
  ohlcvBars: OHLCVBarInput[] = [],
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

  // Convert OHLCV bars to the format scanPatterns expects (numeric timestamps)
  const numericBars = useMemo(() => {
    return ohlcvBars.map(b => ({
      timestamp: toMs(b.timestamp),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
  }, [ohlcvBars]);

  // Compute patterns client-side from OHLCV data
  const patternOverlays = useMemo<IndicatorOverlay[]>(() => {
    if (selectedPatterns.length === 0 || numericBars.length === 0) return [];

    const patternMap = scanPatterns(numericBars, selectedPatterns);
    const result: IndicatorOverlay[] = [];

    for (const col of selectedPatterns) {
      const hits = patternMap.get(col);
      if (hits && hits.length > 0) {
        result.push({
          column: col,
          data: hits,
          color: getIndicatorColor(col),
          displayType: 'marker',
          lineWidth: 1,
        });
      }
    }

    return result;
  }, [selectedPatterns, numericBars]);

  return {
    catalog: null,
    catalogLoading: false,
    selectedPatterns,
    setSelectedPatterns,
    patternOverlays,
    isLoading: false,
  };
}
