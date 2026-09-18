import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { AssetType } from './dashboardTypes';

// ── Context interface ──────────────────────────────────────────────────────

export interface SymbolContextType {
  symbol: string;
  setSymbol: (s: string) => void;
  assetType: AssetType;
  setAssetType: (t: AssetType) => void;
  timeframeMinutes: number;
  setTimeframeMinutes: (m: number) => void;
}

// ── Provider ───────────────────────────────────────────────────────────────

const SymbolContext = createContext<SymbolContextType | null>(null);

const FUTURES_ROOTS = ['ES', 'NQ', 'YM', 'RTY', 'MES', 'MNQ', 'MYM', 'M2K'];

function assetTypeOf(s: string): AssetType {
  const isFutures = FUTURES_ROOTS.some(root => s.startsWith(root) && s.length <= root.length + 2);
  return isFutures ? 'futures' : 'forex';
}

// The selection is the one thing every page shares -- Market draws it, ML
// Studio trains on it -- so it survives a reload. It used to be plain state:
// every refresh snapped the whole dashboard back to MNQ 1m.
const STORAGE_KEY = 'dashboard-selection-v1';

interface StoredSelection {
  symbol: string;
  timeframeMinutes: number;
}

function loadSelection(): StoredSelection {
  const fallback: StoredSelection = { symbol: 'MNQ', timeframeMinutes: 1 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const { symbol, timeframeMinutes } = parsed as Partial<StoredSelection>;
    if (typeof symbol !== 'string' || symbol.length === 0) return fallback;
    if (typeof timeframeMinutes !== 'number' || !(timeframeMinutes > 0)) return fallback;
    return { symbol, timeframeMinutes };
  } catch {
    // Private window, blocked site data, malformed entry: the defaults are fine.
    return fallback;
  }
}

export function SymbolProvider({ children }: { children: React.ReactNode }) {
  const [initial] = useState(loadSelection);
  const [symbol, setSymbolRaw] = useState(initial.symbol);
  const [assetType, setAssetType] = useState<AssetType>(() => assetTypeOf(initial.symbol));
  const [timeframeMinutes, setTimeframeMinutes] = useState(initial.timeframeMinutes);

  const setSymbol = useCallback((s: string) => {
    setSymbolRaw(s);
    setAssetType(assetTypeOf(s));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ symbol, timeframeMinutes }));
    } catch {
      // Storage unavailable: the selection simply does not outlive the tab.
    }
  }, [symbol, timeframeMinutes]);

  const value = useMemo(() => ({
    symbol, setSymbol, assetType, setAssetType, timeframeMinutes, setTimeframeMinutes,
  }), [symbol, setSymbol, assetType, timeframeMinutes]);

  return <SymbolContext.Provider value={value}>{children}</SymbolContext.Provider>;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useSymbolContext(): SymbolContextType {
  const ctx = useContext(SymbolContext);
  if (!ctx) throw new Error('useSymbolContext must be used within SymbolProvider');
  return ctx;
}
