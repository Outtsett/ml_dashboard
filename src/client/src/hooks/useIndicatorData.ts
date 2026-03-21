import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getIndicatorColor, getIndicatorLineWidth } from '@/lib/indicatorColors';
import { minutesToApiKey } from '@/lib/timeframes';
import { QUERY_KEYS } from '@/lib/types';
import { computeOverlay } from '@/lib/overlayCalculators';

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

const STORAGE_KEY = 'indicator-selection';

/** Prefixes that render as overlays on the price chart (share Y-axis with candles).
 *  These indicators MUST be computed from raw OHLCV data (client-side) because
 *  talib_features stores z-scored (normalized) values unsuitable for overlay. */
const OVERLAY_PREFIXES = [
  'SMA_', 'EMA_', 'WMA_', 'DEMA_', 'TEMA_', 'T3_', 'KAMA_', 'FWMA_', 'HMA_',
  'ALMA_', 'TRIMA_', 'VIDYA_', 'VWMA_', 'SWMA_', 'SINWMA_', 'PWMA_', 'RMA_',
  'ZL_', 'LINREG_', 'MIDPOINT_', 'MIDPRICE_',
  'BBL_', 'BBM_', 'BBU_',
  'KCL', 'KCB', 'KCU',
  'DCL_', 'DCM_', 'DCU_',
  'ACCBL_', 'ACCBM_', 'ACCBU_',
  'SUPERTREND', 'SUPERTd', 'SUPERTl', 'SUPERTs',
  'ISA_', 'ISB_', 'ITS_', 'IKS_', 'ICS_',
  'PSARl_', 'PSARs_', 'PSARaf_', 'PSARr_',
  'VWAP_', 'HWMA_',
  'HA_', 'HILO',
  'HILOl_', 'HILOs_',
  // Additional talib overlay display names not caught by existing prefixes
  'MA_', 'TSF_',
  'HT_TRENDLINE',
  'AVGPRICE', 'MEDPRICE', 'TYPPRICE', 'WCLPRICE',
  'MAMA', 'FAMA',
  'LINREG_INTERCEPT_',
];

/** Exact matches for overlay indicators without trailing underscore/params */
const OVERLAY_EXACT = new Set(['PSAR', 'PSAREXT', 'HT_TRENDLINE', 'MAMA', 'FAMA',
  'AVGPRICE', 'MEDPRICE', 'TYPPRICE', 'WCLPRICE']);

/** Prefixes that render as markers on candles. */
const MARKER_PREFIXES = ['CDL_'];

// --- Helpers ---

function classifyColumn(column: string): IndicatorDisplayType {
  for (const prefix of MARKER_PREFIXES) {
    if (column.startsWith(prefix)) return 'marker';
  }
  if (OVERLAY_EXACT.has(column)) return 'overlay';
  for (const prefix of OVERLAY_PREFIXES) {
    if (column.startsWith(prefix)) return 'overlay';
  }
  return 'subchart';
}

function loadSelection(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveSelection(columns: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // ignore quota errors
  }
}

// --- Hook ---

/**
 * Indicator data hook with dual-path strategy:
 *  - Overlay indicators: computed client-side from OHLCV data (raw price values)
 *  - Subchart indicators: fetched from talib_features (values on own scale)
 *  - Marker indicators: fetched from talib_features patterns endpoint
 *
 * @param symbol - Trading symbol (e.g. "ES", "EURUSD")
 * @param timeframeMinutes - Chart timeframe in minutes
 * @param isFutures - Whether the symbol is a futures instrument
 * @param ohlcvBars - Raw OHLCV bars from the chart (for client-side overlay computation)
 */
export function useIndicatorData(
  symbol: string,
  timeframeMinutes: number,
  isFutures: boolean,
  ohlcvBars: OHLCVBarInput[] = [],
) {
  const [selectedColumns, setSelectedColumnsRaw] = useState<string[]>(loadSelection);

  const setSelectedColumns = useCallback((cols: string[]) => {
    setSelectedColumnsRaw(cols);
    saveSelection(cols);
  }, []);

  // Persist on mount (sync from localStorage in case another tab changed it)
  useEffect(() => {
    const stored = loadSelection();
    if (stored.length > 0) setSelectedColumnsRaw(stored);
  }, []);

  const tfKey = minutesToApiKey(timeframeMinutes);

  const apiSymbol = symbol;

  // ── Classify selected columns into three groups ──
  const { overlayColumns, subchartColumns, markerColumns } = useMemo(() => {
    const overlay: string[] = [];
    const subchart: string[] = [];
    const marker: string[] = [];
    for (const col of selectedColumns) {
      const type = classifyColumn(col);
      if (type === 'overlay') overlay.push(col);
      else if (type === 'marker') marker.push(col);
      else subchart.push(col);
    }
    return { overlayColumns: overlay, subchartColumns: subchart, markerColumns: marker };
  }, [selectedColumns]);

  // 1) Fetch catalog (cached indefinitely)
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

  // 2) Fetch SUBCHART indicator data from talib_features (own Y-axis, z-scored is fine)
  const dataQuery = useQuery({
    queryKey: [...QUERY_KEYS.indicatorData(apiSymbol, tfKey), 'subchart', subchartColumns.sort().join(',')],
    queryFn: async () => {
      if (subchartColumns.length === 0) return { data: [] };
      const params = new URLSearchParams({
        timeframe: tfKey,
        columns: subchartColumns.join(','),
        limit: '2000',
      });
      const res = await fetch(`/api/indicators/data/${apiSymbol}?${params}`);
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled: subchartColumns.length > 0,
    staleTime: 60_000,
  });

  // 3) Fetch pattern data for selected CDL columns
  const patternQuery = useQuery({
    queryKey: [...QUERY_KEYS.indicatorPatterns(apiSymbol, tfKey), markerColumns.sort().join(',')],
    queryFn: async () => {
      const params = new URLSearchParams({ timeframe: tfKey, limit: '2000' });
      const res = await fetch(`/api/indicators/patterns/${apiSymbol}?${params}`);
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled: markerColumns.length > 0,
    staleTime: 60_000,
  });

  // 4) Build overlays from all three sources
  const overlays = useMemo<IndicatorOverlay[]>(() => {
    const result: IndicatorOverlay[] = [];

    // ── A) OVERLAY indicators: computed client-side from OHLCV data ──
    if (overlayColumns.length > 0 && ohlcvBars.length > 0) {
      // Normalize bars for the calculator
      const normalizedBars = ohlcvBars.map(b => ({
        timestamp: typeof b.timestamp === 'string' ? parseInt(b.timestamp) : b.timestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));

      for (const col of overlayColumns) {
        const points = computeOverlay(col, normalizedBars);
        if (points && points.length > 0) {
          result.push({
            column: col,
            data: points,
            color: getIndicatorColor(col),
            displayType: 'overlay',
            lineWidth: getIndicatorLineWidth(col),
          });
        }
      }
    }

    // ── B) SUBCHART indicators: from talib_features (line series) ──
    if (dataQuery.data?.data?.length) {
      const rows = dataQuery.data.data as Record<string, number | null>[];
      for (const col of subchartColumns) {
        const pointMap = new Map<number, number>();
        for (const row of rows) {
          const ts = row.timestamp;
          const val = row[col];
          if (ts != null && val != null && !isNaN(val as number)) {
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
            displayType: 'subchart',
            lineWidth: getIndicatorLineWidth(col),
          });
        }
      }
    }

    // ── C) MARKER overlays: CDL patterns from talib_features ──
    if (patternQuery.data?.data?.length) {
      const rows = patternQuery.data.data as Record<string, number | null>[];
      for (const col of markerColumns) {
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
  }, [overlayColumns, subchartColumns, markerColumns, ohlcvBars, dataQuery.data, patternQuery.data]);

  return {
    catalog: catalogQuery.data ?? null,
    catalogLoading: catalogQuery.isLoading,
    selectedColumns,
    setSelectedColumns,
    overlays,
    isLoading: dataQuery.isLoading || patternQuery.isLoading,
  };
}
