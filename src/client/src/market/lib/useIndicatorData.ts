import { useState, useMemo, useCallback, useEffect } from 'react';
import { getIndicatorColor } from '@/market/lib/indicator_colors';
import { scanPatterns } from "@/market/lib/candle_patterns";
import { BROWSER_DETECTORS_FOR_LAKE_PATTERN } from '@/market/lib/candlePatternCatalog';
import {
  isTalibPatternColumn,
  useTalibPatternOverlays,
} from "@/market/lib/useTalibPatternOverlays";

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
  symbol: string,
  timeframeMinutes: number,
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

  // Only ask the lake for the span the chart is holding. `numericBars` arrives
  // sorted ascending from the loader, so its ends are the range.
  const barRange = useMemo(() => {
    if (numericBars.length === 0) return null;
    return {
      fromMs: numericBars[0]!.timestamp,
      toMs: numericBars[numericBars.length - 1]!.timestamp,
    };
  }, [numericBars]);

  // TA-Lib's own firings, read back from the lake for the same symbol/timeframe.
  // Asked FIRST, because whether the lake could answer decides whether the
  // browser detector has to stand in below.
  const talib = useTalibPatternOverlays(
    symbol, timeframeMinutes, selectedPatterns, barRange,
  );

  /** Lake columns that actually came back with firings for this view. */
  const lakeColumnsWithData = useMemo(
    () => new Set(talib.overlays.filter(o => o.data.length > 0).map(o => o.column)),
    [talib.overlays],
  );

  // Two vocabularies share one selection list: `CDL_*` names are rewritten in
  // TypeScript and scanned from the bars on screen, `talib:*` names are the C
  // library's own output fetched from the lake.
  //
  // The lake is preferred, but it only covers part of the series (see
  // BROWSER_DETECTORS_FOR_LAKE_PATTERN). A selected lake pattern that came back
  // empty falls back to its browser detector, so choosing a pattern always draws
  // something rather than silently drawing nothing outside the covered window.
  const browserPatterns = useMemo(() => {
    const columns = new Set(selectedPatterns.filter(col => !isTalibPatternColumn(col)));
    if (!talib.isLoading) {
      for (const column of selectedPatterns) {
        if (!isTalibPatternColumn(column)) continue;
        if (lakeColumnsWithData.has(column)) continue;
        for (const detector of BROWSER_DETECTORS_FOR_LAKE_PATTERN[column] ?? []) {
          columns.add(detector);
        }
      }
    }
    return [...columns];
  }, [selectedPatterns, lakeColumnsWithData, talib.isLoading]);

  // Compute the browser-side detectors from the chart's own OHLCV data
  const patternOverlays = useMemo<IndicatorOverlay[]>(() => {
    if (browserPatterns.length === 0 || numericBars.length === 0) return [];

    const patternMap = scanPatterns(numericBars, browserPatterns);
    const result: IndicatorOverlay[] = [];

    for (const col of browserPatterns) {
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
  }, [browserPatterns, numericBars]);

  const allPatternOverlays = useMemo<IndicatorOverlay[]>(
    () => [...patternOverlays, ...talib.overlays],
    [patternOverlays, talib.overlays],
  );

  return {
    catalog: null,
    catalogLoading: false,
    selectedPatterns,
    setSelectedPatterns,
    patternOverlays: allPatternOverlays,
    /** Firings drawn from the lake, so "none fired" reads differently to "failed". */
    talibFiringCount: talib.firingCount,
    talibError: talib.error,
    isLoading: talib.isLoading,
  };
}
