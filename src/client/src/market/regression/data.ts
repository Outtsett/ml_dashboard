/**
 * Data for the regression tab: the Market's bars, the lake columns that can
 * stand on the X axis, and those columns aligned bar by bar.
 *
 * The bars come from /api/charts/ohlcv with the chart's own parameters, so the
 * Y axis is the price the Market chart draws (front-month stitched and
 * ratio-adjusted for a futures root). Lake values arrive keyed by bucket start
 * in epoch SECONDS; the bars are epoch MILLISECONDS. The conversion happens in
 * exactly one place, alignColumns, and how many bars found a value is kept per
 * column so a misalignment shows up as a coverage number, not a silent blank.
 */

import { useQuery } from "@tanstack/react-query";
import type { OhlcvData } from "@/market/components/types";
import {
  REGRESSION_MAX_COLUMNS,
  type RegressionColumnsResponse,
  type RegressionVariablesResponse,
} from "@shared/regression/types";

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Not JSON: keep the status line.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function useRegressionBars(symbol: string, timeframeApiKey: string, barCount: number) {
  return useQuery({
    queryKey: ["regression-bars", symbol, timeframeApiKey, barCount],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        symbol,
        timeframe: timeframeApiKey,
        limit: String(barCount),
        order: "asc",
      });
      const result = await fetchJson<OhlcvData[] | { data: OhlcvData[] }>(`/api/charts/ohlcv?${params}`, signal);
      const bars = Array.isArray(result) ? result : result.data ?? [];
      return [...bars].sort((left, right) => left.timestamp - right.timestamp);
    },
    staleTime: 5 * 60_000,
  });
}

export function useRegressionVariables(symbol: string, timeframeApiKey: string) {
  return useQuery({
    queryKey: ["regression-variables", symbol, timeframeApiKey],
    queryFn: ({ signal }) =>
      fetchJson<RegressionVariablesResponse>(
        `/api/charts/regression/variables?${new URLSearchParams({ symbol, timeframe: timeframeApiKey })}`,
        signal,
      ),
    staleTime: 5 * 60_000,
  });
}

export interface AlignedColumn {
  id: string;
  /** One value per bar, in bar order. Null where the lake has nothing for that bar. */
  values: Array<number | null>;
  /** Bars that found a value. */
  matchedBars: number;
  emptyReason?: string;
}

export function useRegressionColumns(
  symbol: string,
  timeframeApiKey: string,
  timeframeSeconds: number,
  bars: ReadonlyArray<OhlcvData> | undefined,
  ids: ReadonlyArray<string>,
) {
  const sortedIds = [...ids].sort();
  const first = bars?.[0]?.timestamp;
  const last = bars?.[bars.length - 1]?.timestamp;
  const fromSeconds = first === undefined ? 0 : Math.floor(first / 1000);
  const toSeconds = last === undefined ? 0 : Math.floor(last / 1000) + timeframeSeconds;

  return useQuery({
    queryKey: ["regression-columns", symbol, timeframeApiKey, fromSeconds, toSeconds, sortedIds.join(",")],
    enabled: Boolean(bars && bars.length > 0 && sortedIds.length > 0),
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const chunks: string[][] = [];
      for (let start = 0; start < sortedIds.length; start += REGRESSION_MAX_COLUMNS) {
        chunks.push(sortedIds.slice(start, start + REGRESSION_MAX_COLUMNS));
      }
      const responses = await Promise.all(
        chunks.map((chunk) =>
          fetchJson<RegressionColumnsResponse>(
            `/api/charts/regression/columns?${new URLSearchParams({
              ids: chunk.join(","),
              symbol,
              timeframe: timeframeApiKey,
              from: String(fromSeconds),
              to: String(toSeconds),
            })}`,
            signal,
          ),
        ),
      );
      return alignColumns(bars ?? [], responses);
    },
  });
}

/**
 * Identifies a bar window. Aligned columns carry the key of the bars they were
 * aligned to, and are only ever paired with bars that have the same key — an
 * array aligned to one window, indexed against another, would pair every value
 * with the wrong bar and nothing would look wrong.
 */
export function barsKey(bars: ReadonlyArray<OhlcvData> | undefined): string {
  if (!bars || bars.length === 0) return "empty";
  return `${bars.length}:${bars[0]!.timestamp}:${bars[bars.length - 1]!.timestamp}`;
}

export interface AlignedColumns {
  barsKey: string;
  columns: Map<string, AlignedColumn>;
}

/** Put every lake value on the bar it belongs to. */
export function alignColumns(
  bars: ReadonlyArray<OhlcvData>,
  responses: ReadonlyArray<RegressionColumnsResponse>,
): AlignedColumns {
  const barSeconds = bars.map((bar) => Math.floor(bar.timestamp / 1000));
  const aligned = new Map<string, AlignedColumn>();
  for (const response of responses) {
    for (const failure of response.failures) {
      aligned.set(failure.id, { id: failure.id, values: [], matchedBars: 0, emptyReason: failure.reason });
    }
    for (const block of response.blocks) {
      const position = new Map<number, number>();
      block.bucketSeconds.forEach((seconds, index) => position.set(seconds, index));
      for (const column of block.columns) {
        let matchedBars = 0;
        const values = barSeconds.map((seconds) => {
          const index = position.get(seconds);
          if (index === undefined) return null;
          const value = column.values[index];
          if (value === null || value === undefined) return null;
          matchedBars += 1;
          return value;
        });
        aligned.set(column.id, {
          id: column.id,
          values,
          matchedBars,
          ...(column.emptyReason ? { emptyReason: column.emptyReason } : {}),
          ...(!column.emptyReason && matchedBars === 0
            ? { emptyReason: "no lake bucket lines up with a loaded bar" }
            : {}),
        });
      }
    }
  }
  return { barsKey: barsKey(bars), columns: aligned };
}
