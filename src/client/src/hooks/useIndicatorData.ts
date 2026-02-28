import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getIndicatorColor, getIndicatorLineWidth } from '@/lib/indicatorColors';
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

// --- Constants ---

const STORAGE_KEY = 'indicator-selection';

// TIMEFRAME_MAP removed — use minutesToApiKey() from lib/timeframes

/** Prefixes that render as overlays on the price chart (share Y-axis with candles). */
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
];

/** Prefixes that render as markers on candles. */
const MARKER_PREFIXES = ['CDL_'];

// --- Helpers ---

function classifyColumn(column: string): IndicatorDisplayType {
  for (const prefix of MARKER_PREFIXES) {
    if (column.startsWith(prefix)) return 'marker';
  }
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

export function useIndicatorData(
  symbol: string,
  timeframeMinutes: number,
  isFutures: boolean,
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

  // 2) Fetch indicator data for selected columns
  const nonMarkerColumns = selectedColumns.filter(c => !c.startsWith('CDL_'));
  const markerColumns = selectedColumns.filter(c => c.startsWith('CDL_'));

  const dataQuery = useQuery({
    queryKey: [...QUERY_KEYS.indicatorData(apiSymbol), tfKey, nonMarkerColumns.sort().join(',')],
    queryFn: async () => {
      if (nonMarkerColumns.length === 0) return { data: [] };
      const params = new URLSearchParams({
        timeframe: tfKey,
        columns: nonMarkerColumns.join(','),
        limit: '2000',
      });
      const res = await fetch(`/api/indicators/data/${apiSymbol}?${params}`);
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled: nonMarkerColumns.length > 0,
    staleTime: 60_000,
  });

  // 3) Fetch pattern data for selected CDL columns
  const patternQuery = useQuery({
    queryKey: [...QUERY_KEYS.indicatorPatterns(apiSymbol), tfKey, markerColumns.sort().join(',')],
    queryFn: async () => {
      const params = new URLSearchParams({ timeframe: tfKey, limit: '2000' });
      const res = await fetch(`/api/indicators/patterns/${apiSymbol}?${params}`);
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled: markerColumns.length > 0,
    staleTime: 60_000,
  });

  // 4) Build overlays from fetched data
  const overlays = useMemo<IndicatorOverlay[]>(() => {
    const result: IndicatorOverlay[] = [];

    // Non-marker overlays (line series)
    if (dataQuery.data?.data?.length) {
      const rows = dataQuery.data.data as Record<string, number | null>[];
      for (const col of nonMarkerColumns) {
        const displayType = classifyColumn(col);
        const pointMap = new Map<number, number>();
        for (const row of rows) {
          const ts = row.timestamp;
          const val = row[col];
          if (ts != null && val != null && !isNaN(val as number)) {
            // Timestamps from indicator tables are already in seconds
            const timeSec = ts as number;
            pointMap.set(timeSec, val as number);
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
            displayType,
            lineWidth: getIndicatorLineWidth(col),
          });
        }
      }
    }

    // Marker overlays (CDL patterns)
    if (patternQuery.data?.data?.length) {
      const rows = patternQuery.data.data as Record<string, number | null>[];
      for (const col of markerColumns) {
        const pointMap = new Map<number, number>();
        for (const row of rows) {
          const ts = row.timestamp;
          const val = row[col];
          if (ts != null && val != null && val !== 0) {
            // Timestamps from pattern tables are already in seconds
            const timeSec = ts as number;
            pointMap.set(timeSec, val as number);
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
  }, [dataQuery.data, patternQuery.data, nonMarkerColumns, markerColumns]);

  return {
    catalog: catalogQuery.data ?? null,
    catalogLoading: catalogQuery.isLoading,
    selectedColumns,
    setSelectedColumns,
    overlays,
    isLoading: dataQuery.isLoading || patternQuery.isLoading,
  };
}
