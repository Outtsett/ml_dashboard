import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
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

export function SymbolProvider({ children }: { children: React.ReactNode }) {
  const [symbol, setSymbolRaw] = useState('MNQ');
  const [assetType, setAssetType] = useState<AssetType>('futures');
  const [timeframeMinutes, setTimeframeMinutes] = useState(1);

  const setSymbol = useCallback((s: string) => {
    setSymbolRaw(s);
    const isFutures = FUTURES_ROOTS.some(root => s.startsWith(root) && s.length <= root.length + 2);
    setAssetType(isFutures ? 'futures' : 'forex');
  }, []);

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
