import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { TradeMarker, PredictionMarker, ChartOverlays } from './dashboardTypes';

// ── Context interface ──────────────────────────────────────────────────────

export interface ChartOverlayContextType {
  overlays: ChartOverlays;
  setTradeMarkers: (markers: TradeMarker[]) => void;
  addTradeMarkers: (markers: TradeMarker[]) => void;
  clearTradeMarkers: (source?: TradeMarker['source']) => void;
  setPredictionMarkers: (markers: PredictionMarker[]) => void;
  addPredictionMarkers: (markers: PredictionMarker[]) => void;
  clearPredictionMarkers: (source?: PredictionMarker['source']) => void;
  setHighlightRange: (range: ChartOverlays['highlightRange']) => void;
}

// ── Provider ───────────────────────────────────────────────────────────────

const ChartOverlayContext = createContext<ChartOverlayContextType | null>(null);

export function ChartOverlayProvider({ children }: { children: React.ReactNode }) {
  const [tradeMarkers, setTradeMarkers] = useState<TradeMarker[]>([]);
  const [predictionMarkers, setPredictionMarkers] = useState<PredictionMarker[]>([]);
  const [highlightRange, setHighlightRange] = useState<ChartOverlays['highlightRange']>();

  const addTradeMarkers = useCallback((markers: TradeMarker[]) => {
    setTradeMarkers(prev => [...prev, ...markers]);
  }, []);

  const clearTradeMarkers = useCallback((source?: TradeMarker['source']) => {
    if (source) setTradeMarkers(prev => prev.filter(m => m.source !== source));
    else setTradeMarkers([]);
  }, []);

  const addPredictionMarkers = useCallback((markers: PredictionMarker[]) => {
    setPredictionMarkers(prev => [...prev, ...markers]);
  }, []);

  const clearPredictionMarkers = useCallback((source?: PredictionMarker['source']) => {
    if (source) setPredictionMarkers(prev => prev.filter(m => m.source !== source));
    else setPredictionMarkers([]);
  }, []);

  const overlays = useMemo<ChartOverlays>(() => ({
    tradeMarkers, predictionMarkers, highlightRange,
  }), [tradeMarkers, predictionMarkers, highlightRange]);

  const value = useMemo(() => ({
    overlays, setTradeMarkers, addTradeMarkers, clearTradeMarkers,
    setPredictionMarkers, addPredictionMarkers, clearPredictionMarkers,
    setHighlightRange,
  }), [overlays, addTradeMarkers, clearTradeMarkers, addPredictionMarkers, clearPredictionMarkers]);

  return <ChartOverlayContext.Provider value={value}>{children}</ChartOverlayContext.Provider>;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useChartOverlayContext(): ChartOverlayContextType {
  const ctx = useContext(ChartOverlayContext);
  if (!ctx) throw new Error('useChartOverlayContext must be used within ChartOverlayProvider');
  return ctx;
}
