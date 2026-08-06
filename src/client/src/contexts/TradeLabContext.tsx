/**
 * TradeLabContext — selection + filter state for the Trade Lab page.
 *
 * Kept separate from UnifiedDashboardContext (which already nests 4 focused
 * contexts) so subscribers outside Trade Lab don't re-render when a trade
 * is selected. Provider only wraps the /trade-lab route.
 */
import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

export type TradeSideFilter = 'long' | 'short' | 'all';

export interface TradeLabFilters {
  side: TradeSideFilter;
  minConfidence: number;          // 0..1
  regime: string | 'any';
}

export interface VisibleRange {
  /** seconds-epoch (matches lightweight-charts time axis) */
  from: number;
  /** seconds-epoch */
  to: number;
}

export interface TradeLabContextType {
  selectedRunId: number | null;
  setSelectedRunId: (id: number | null) => void;
  selectedTradeId: number | null;
  setSelectedTradeId: (id: number | null) => void;
  filters: TradeLabFilters;
  setFilters: (f: TradeLabFilters | ((prev: TradeLabFilters) => TradeLabFilters)) => void;
  visibleRange: VisibleRange | null;
  setVisibleRange: (r: VisibleRange | null) => void;
}

const TradeLabContext = createContext<TradeLabContextType | null>(null);

const DEFAULT_FILTERS: TradeLabFilters = {
  side: 'all',
  minConfidence: 0,
  regime: 'any',
};

export function TradeLabProvider({ children }: { children: React.ReactNode }) {
  const [selectedRunId, setSelectedRunIdState] = useState<number | null>(null);
  const [selectedTradeId, setSelectedTradeIdState] = useState<number | null>(null);
  const [filters, setFiltersState] = useState<TradeLabFilters>(DEFAULT_FILTERS);
  const [visibleRange, setVisibleRangeState] = useState<VisibleRange | null>(null);

  const setSelectedRunId = useCallback((id: number | null) => {
    setSelectedRunIdState(id);
    setSelectedTradeIdState(null);
  }, []);

  const setSelectedTradeId = useCallback((id: number | null) => {
    setSelectedTradeIdState(id);
  }, []);

  const setFilters = useCallback(
    (f: TradeLabFilters | ((prev: TradeLabFilters) => TradeLabFilters)) => {
      setFiltersState(f);
    },
    []
  );

  const setVisibleRange = useCallback((r: VisibleRange | null) => {
    setVisibleRangeState(r);
  }, []);

  const value = useMemo<TradeLabContextType>(
    () => ({
      selectedRunId, setSelectedRunId,
      selectedTradeId, setSelectedTradeId,
      filters, setFilters,
      visibleRange, setVisibleRange,
    }),
    [
      selectedRunId, setSelectedRunId,
      selectedTradeId, setSelectedTradeId,
      filters, setFilters,
      visibleRange, setVisibleRange,
    ]
  );

  return <TradeLabContext.Provider value={value}>{children}</TradeLabContext.Provider>;
}

export function useTradeLab(): TradeLabContextType {
  const ctx = useContext(TradeLabContext);
  if (!ctx) throw new Error('useTradeLab must be used within TradeLabProvider');
  return ctx;
}
