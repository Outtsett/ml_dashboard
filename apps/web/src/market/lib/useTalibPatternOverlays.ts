import { useEffect, useMemo, useRef, useState } from 'react';
import { getIndicatorColor } from '@/market/lib/indicator_colors';
import type { IndicatorOverlay } from '@/market/lib/useIndicatorData';

/**
 * TA-Lib pattern firings for the chart, read from the lake rather than recomputed.
 *
 * The 60 detectors in `candles/registry.ts` are TypeScript rewrites that run in
 * the browser over the bars on screen. This hook fetches the C library's own
 * output from `/api/charts/candle-patterns`, which reads the materialized
 * `talib_candle_patterns` table. They disagree on real bars — a browser hammer is
 * not always a `CDLHAMMER` — so the two never share a namespace: everything here
 * is keyed `talib:<name>`.
 *
 * Marker sign comes from the value's sign, which is what
 * `useChartOverlays` already reads to choose arrow direction and colour, so no
 * rendering change is needed downstream.
 */

/** Prefix that separates lake-sourced TA-Lib patterns from the browser detectors. */
export const TALIB_PATTERN_PREFIX = 'talib:';

export function isTalibPatternColumn(column: string): boolean {
  return column.startsWith(TALIB_PATTERN_PREFIX);
}

export function talibPatternName(column: string): string {
  return column.slice(TALIB_PATTERN_PREFIX.length);
}

export function talibPatternColumn(name: string): string {
  return `${TALIB_PATTERN_PREFIX}${name}`;
}

interface CandlePatternResponse {
  symbol: string;
  timeframe: string;
  requested: number;
  firingCount: number;
  patterns: { pattern: string; points: { time: number; value: number }[] }[];
}

export interface TalibPatternState {
  overlays: IndicatorOverlay[];
  isLoading: boolean;
  /** Present when the lake could not answer — surfaced rather than swallowed. */
  error: string | null;
  /** Total firings drawn, so a caller can say "nothing fired" rather than "broken". */
  firingCount: number;
}

const EMPTY: TalibPatternState = {
  overlays: [], isLoading: false, error: null, firingCount: 0,
};

/**
 * @param symbol      Instrument root, e.g. `MNQ`.
 * @param timeframeMinutes Chart timeframe; matched against the ingest key, never assumed.
 * @param selected    Columns from the shared pattern selection; non-`talib:` entries ignored.
 * @param range       Bars on screen, in unix ms. The 13 single-candle patterns alone
 *                    are 121,742 firings across the whole 1m table, and a marker
 *                    outside the drawn range is a marker nobody can see, so the
 *                    request is bounded to what the chart is actually holding.
 */
export function useTalibPatternOverlays(
  symbol: string,
  timeframeMinutes: number,
  selected: string[],
  range?: { fromMs: number; toMs: number } | null,
): TalibPatternState {
  const names = useMemo(
    () => selected.filter(isTalibPatternColumn).map(talibPatternName).sort(),
    [selected],
  );
  const key = names.join(',');
  const fromMs = range?.fromMs ?? null;
  const toMs = range?.toMs ?? null;

  const [state, setState] = useState<TalibPatternState>(EMPTY);
  // A slow response for a symbol the user already switched away from must not
  // overwrite the current one; the request that resolves last is not necessarily
  // the one that was asked for last.
  const requestRef = useRef(0);

  useEffect(() => {
    if (!symbol || names.length === 0) {
      setState(EMPTY);
      return;
    }

    const request = ++requestRef.current;
    const controller = new AbortController();
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    const bounds =
      fromMs !== null && toMs !== null
        ? `&from=${Math.floor(fromMs)}&to=${Math.ceil(toMs)}`
        : '';
    const url =
      `/api/charts/candle-patterns?symbol=${encodeURIComponent(symbol)}` +
      `&timeframe=${timeframeMinutes}&patterns=${encodeURIComponent(key)}${bounds}`;

    fetch(url, { signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
        return body as CandlePatternResponse;
      })
      .then(body => {
        if (request !== requestRef.current) return;
        const overlays: IndicatorOverlay[] = body.patterns.map(series => ({
          column: talibPatternColumn(series.pattern),
          data: series.points,
          color: getIndicatorColor(talibPatternColumn(series.pattern)),
          displayType: 'marker',
          lineWidth: 1,
        }));
        setState({
          overlays,
          isLoading: false,
          error: null,
          firingCount: body.firingCount,
        });
      })
      .catch(error => {
        if (controller.signal.aborted || request !== requestRef.current) return;
        setState({
          overlays: [], isLoading: false,
          error: (error as Error).message, firingCount: 0,
        });
      });

    return () => controller.abort();
  }, [symbol, timeframeMinutes, key, names.length, fromMs, toMs]);

  return state;
}
