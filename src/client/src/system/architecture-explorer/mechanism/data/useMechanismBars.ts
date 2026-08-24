/**
 * Real bars for the mechanism tab, plus the derived feature matrix.
 *
 * Every animation in this tab consumes REAL OHLCV from GET /api/charts/ohlcv —
 * never synthetic points. The pure `deriveMechanismData` half is separated from
 * the query half so the derivation is unit-testable without React or a server.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { chartApi } from '@/infrastructure/api/api_service';
import { QUERY_KEYS } from '@/shared/utils/types';
import { minutesToApiKey } from '@/market/lib/timeframes';
import type { OHLCVBar } from '@shared/ohlcv';
import {
  computeCandleGeometry,
  toFeatureMatrix,
  FEATURE_NAMES,
  DEFAULT_Z_WINDOW,
  type FeatureMatrix,
} from './candleGeometry';

export interface MechanismData {
  bars: OHLCVBar[];
  features: FeatureMatrix;
  /** True once at least one complete (non-warmup) feature row exists. */
  ready: boolean;
  /** Bars of history the causal z-window needs before any row is complete. */
  warmupNeeded: number;
  barCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
}

function isOhlcvBar(v: unknown): v is OHLCVBar {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.timestamp === 'number' &&
    typeof r.open === 'number' &&
    typeof r.high === 'number' &&
    typeof r.low === 'number' &&
    typeof r.close === 'number'
  );
}

/** Pure derivation — no React, no network. Unit-tested directly. */
export function deriveMechanismData(
  bars: readonly OHLCVBar[],
  zWindow: number = DEFAULT_Z_WINDOW,
): MechanismData {
  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp);
  const features = toFeatureMatrix(
    computeCandleGeometry(sorted, zWindow),
    FEATURE_NAMES,
  );
  return {
    bars: sorted,
    features,
    ready: features.rows.length > 0,
    warmupNeeded: zWindow,
    barCount: sorted.length,
    firstTimestamp: sorted.length ? sorted[0]!.timestamp : null,
    lastTimestamp: sorted.length ? sorted[sorted.length - 1]!.timestamp : null,
  };
}

export interface UseMechanismBarsResult {
  data: MechanismData;
  isLoading: boolean;
  error: Error | null;
}

/**
 * The last `limit` real bars for (symbol, timeframe), with features derived.
 * `limit` must exceed the z-window or nothing will ever be ready — the default
 * is 340 (100 warmup + 240 usable).
 */
export function useMechanismBars(
  symbol: string,
  timeframeMinutes: number,
  limit = 340,
  zWindow: number = DEFAULT_Z_WINDOW,
): UseMechanismBarsResult {
  const apiTimeframe = useMemo(
    () => minutesToApiKey(timeframeMinutes),
    [timeframeMinutes],
  );

  const query = useQuery<OHLCVBar[]>({
    queryKey: [...QUERY_KEYS.chartOhlcv(symbol, apiTimeframe), 'mechanism', limit],
    queryFn: async ({ signal }) => {
      const raw = await chartApi.getOhlcv(
        { symbol, timeframe: apiTimeframe, limit: String(limit), order: 'asc' },
        signal,
      );
      if (!Array.isArray(raw)) {
        throw new Error('OHLCV endpoint did not return an array of bars');
      }
      const bars = raw.filter(isOhlcvBar);
      bars.sort((a, b) => a.timestamp - b.timestamp);
      return bars.slice(-limit);
    },
    staleTime: 10 * 60 * 1000,
  });

  const data = useMemo(
    () => deriveMechanismData(query.data ?? [], zWindow),
    [query.data, zWindow],
  );

  return {
    data,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}
