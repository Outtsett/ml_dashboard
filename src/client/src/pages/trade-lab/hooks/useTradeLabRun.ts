/**
 * useTradeLabRun — fetches /api/backtest/trades/:runId.
 *
 * Returns the trades array + chart-ready trade markers (id-tagged so click
 * resolves back to the trade). Disabled when runId is null.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { TradeMarker } from '@/shared/contexts/dashboardTypes';
import { QUERY_KEYS } from '@/shared/utils/types';

/** Trade row shape returned by /api/backtest/trades/:runId. */
export interface BacktestTradeRow {
  id: number;
  symbol: string;
  side: 'long' | 'short';
  entryTimestamp: number;
  exitTimestamp?: number | null;
  entryPrice: number;
  exitPrice?: number | null;
  quantity: number;
  pnl?: number | null;
  netPnl?: number | null;
  pnlPct?: number | null;
  commission?: number | null;
  slippage?: number | null;
  spreadCost?: number | null;
  signalConfidence?: number | null;
  modelId?: number | null;
  regimeId?: number | null;
  exitReason?: string | null;
  barsHeld?: number | null;
  maxFavorableExcursion?: number | null;
  maxAdverseExcursion?: number | null;
  status?: string;
}

interface TradeLabRunResponse {
  trades: BacktestTradeRow[];
  chartMarkers: Array<{
    timestamp: number;
    type: 'entry' | 'exit';
    side: 'long' | 'short';
    price: number;
    label?: string;
    pnl?: number;
  }>;
  count: number;
}

export interface TradeLabRunData {
  trades: BacktestTradeRow[];
  /** TradeMarker[] enriched with stable ids that encode the source trade row. */
  markers: TradeMarker[];
  count: number;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/** Encode {tradeId, type} into a marker id so click resolution is O(1). */
export function buildMarkerId(tradeId: number, type: 'entry' | 'exit'): string {
  return `tl-${tradeId}-${type}`;
}

/** Reverse of buildMarkerId. Returns null on malformed input. */
export function parseMarkerId(markerId: string): { tradeId: number; type: 'entry' | 'exit' } | null {
  const m = /^tl-(\d+)-(entry|exit)$/.exec(markerId);
  if (!m) return null;
  return { tradeId: Number(m[1]), type: m[2] as 'entry' | 'exit' };
}

export function useTradeLabRun(runId: number | null): TradeLabRunData {
  const queryKey = QUERY_KEYS.backtestTrades(String(runId ?? 'none'));

  const { data, isLoading, isError, error, refetch } = useQuery<TradeLabRunResponse>({
    queryKey,
    queryFn: async ({ signal }) => {
      if (runId == null) throw new Error('runId is null');
      const res = await fetch(`/api/backtest/trades/${runId}?limit=10000`, { signal });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`backtest trades fetch ${res.status}: ${body || res.statusText}`);
      }
      const json = (await res.json()) as TradeLabRunResponse;
      return json;
    },
    enabled: runId != null,
    staleTime: 60_000,
  });

  const markers = useMemo<TradeMarker[]>(() => {
    if (!data?.trades) return [];
    const out: TradeMarker[] = [];
    for (const t of data.trades) {
      out.push({
        id: buildMarkerId(t.id, 'entry'),
        timestamp: Number(t.entryTimestamp),
        type: 'entry',
        side: t.side,
        price: t.entryPrice,
        label: t.side === 'long' ? 'BUY' : 'SELL',
        source: 'backtest',
      });
      if (t.exitTimestamp != null && t.exitPrice != null) {
        out.push({
          id: buildMarkerId(t.id, 'exit'),
          timestamp: Number(t.exitTimestamp),
          type: 'exit',
          side: t.side,
          price: t.exitPrice,
          label: `${(t.exitReason ?? 'EXIT').toUpperCase()} ${(t.netPnl ?? t.pnl ?? 0) >= 0 ? '+' : ''}${((t.netPnl ?? t.pnl ?? 0) as number).toFixed(2)}`,
          pnl: (t.netPnl ?? t.pnl) as number | undefined,
          source: 'backtest',
        });
      }
    }
    return out;
  }, [data?.trades]);

  return {
    trades: data?.trades ?? [],
    markers,
    count: data?.count ?? 0,
    isLoading,
    isError,
    error: (error as Error | null) ?? null,
    refetch: () => { void refetch(); },
  };
}
