/**
 * UnifiedDashboardContext — The "Mission Control Radio" for the entire dashboard
 * 
 * Think of it as: Every page is a different screen in the same cockpit.
 * This context is the radio channel they all share — when you select a symbol
 * on the chart page, ML Hub hears it. When training finishes, the chart page
 * knows about it. When backtesting generates trades, the chart page draws them.
 * 
 * One symbol, one timeframe, one context — every page reads from the same playbook.
 */

import React, { createContext, useContext, useState, useCallback, useRef, useMemo, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

/** A trade entry/exit marker to render on the price chart */
export interface TradeMarker {
  id: string;
  timestamp: number;       // ms epoch
  type: "entry" | "exit";
  side: "long" | "short";
  price: number;
  label?: string;          // e.g. "Buy @1850.25" or "Exit +$42"
  pnl?: number;            // only on exits
  source: "backtest" | "live" | "model"; // where did this come from?
  modelName?: string;
}

/** A model prediction marker to render on the price chart */
export interface PredictionMarker {
  timestamp: number;       // ms epoch — which bar this prediction is FOR
  direction: 1 | 0 | -1;  // up / neutral / down  
  confidence?: number;     // 0–1
  modelName: string;
  source: "backtest" | "live" | "forecast";
}

/** Training progress with bar-level context for chart replay */
export interface TrainingBarContext {
  /** The date range being used for training */
  dataStart: string;       // ISO
  dataEnd: string;         // ISO
  /** Current epoch progress */
  epoch: number;
  totalEpochs: number;
  loss: number;
  valLoss: number;
  accuracy: number;
  valAccuracy: number;
  /** Original status fields */
  status: "training" | "completed" | "error" | "stopped";
  message?: string;
  /** How much of the data has been seen this epoch (0–1) */
  progress?: number;
  /** Bar-level: which bar indices are currently in the batch window */
  currentBatchStart?: number;
  currentBatchEnd?: number;
  trainSize?: number;
  valSize?: number;
  symbol: string;
  modelName?: string;
}

/** Active overlay configuration */
export interface ChartOverlays {
  tradeMarkers: TradeMarker[];
  predictionMarkers: PredictionMarker[];
  /** Highlight a time range on the chart (e.g., training data range) */
  highlightRange?: {
    start: number;  // ms
    end: number;    // ms
    label: string;
    color: string;
  };
}

export type AssetType = "futures" | "forex";

// ═══════════════════════════════════════════════════════════════
// CONTEXT INTERFACE
// ═══════════════════════════════════════════════════════════════

interface UnifiedDashboardContextType {
  // ── Symbol & Timeframe (the cockpit instruments) ──
  symbol: string;
  setSymbol: (s: string) => void;
  assetType: AssetType;
  setAssetType: (t: AssetType) => void;
  timeframeMinutes: number;
  setTimeframeMinutes: (m: number) => void;

  // ── Chart Overlays (what's painted on the chart) ──
  overlays: ChartOverlays;
  setTradeMarkers: (markers: TradeMarker[]) => void;
  addTradeMarkers: (markers: TradeMarker[]) => void;
  clearTradeMarkers: (source?: TradeMarker["source"]) => void;
  setPredictionMarkers: (markers: PredictionMarker[]) => void;
  addPredictionMarkers: (markers: PredictionMarker[]) => void;
  clearPredictionMarkers: (source?: PredictionMarker["source"]) => void;
  setHighlightRange: (range: ChartOverlays["highlightRange"]) => void;

  // ── Training Context (live training state) ──
  trainingContext: TrainingBarContext | null;
  setTrainingContext: (ctx: TrainingBarContext | null) => void;
  isTraining: boolean;

  // ── Active Model (currently selected for prediction/backtest) ──
  activeModelId: number | null;
  activeModelName: string | null;
  setActiveModel: (id: number | null, name?: string) => void;

  // ── Cross-page Navigation ──
  /** Navigate to market data chart with current symbol + overlays */
  navigateToChart: () => void;
  /** Navigate to ML Hub and optionally select a tab */
  navigateToMLHub: (tab?: string) => void;

  // ── Event Log (unified activity stream) ──
  logs: DashboardLog[];
  addLog: (entry: Omit<DashboardLog, "id" | "timestamp">) => void;
  clearLogs: () => void;
}

export interface DashboardLog {
  id: string;
  timestamp: number;
  level: "info" | "success" | "warning" | "error";
  source: "training" | "backtest" | "forecast" | "data" | "system";
  message: string;
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT + PROVIDER
// ═══════════════════════════════════════════════════════════════

const UnifiedDashboardContext = createContext<UnifiedDashboardContextType | null>(null);

export function UnifiedDashboardProvider({ children }: { children: React.ReactNode }) {
  // ── Core state ──
  const [symbol, setSymbolRaw] = useState("MNQ");
  const [assetType, setAssetType] = useState<AssetType>("futures");
  const [timeframeMinutes, setTimeframeMinutes] = useState(1);
  const [activeModelId, setActiveModelId] = useState<number | null>(null);
  const [activeModelName, setActiveModelName] = useState<string | null>(null);

  // ── Overlays ──
  const [tradeMarkers, setTradeMarkers] = useState<TradeMarker[]>([]);
  const [predictionMarkers, setPredictionMarkers] = useState<PredictionMarker[]>([]);
  const [highlightRange, setHighlightRange] = useState<ChartOverlays["highlightRange"]>();

  // ── Training ──
  const [trainingContext, setTrainingContext] = useState<TrainingBarContext | null>(null);

  // ── Logs ──
  const [logs, setLogs] = useState<DashboardLog[]>([]);
  const logIdRef = useRef(0);

  // ── Derived ──
  const isTraining = trainingContext?.status === "training";

  // ── Symbol setter with auto asset-type detection ──
  const setSymbol = useCallback((s: string) => {
    setSymbolRaw(s);
    // Auto-detect asset type from symbol
    const futuresRoots = ["ES", "NQ", "YM", "RTY", "MES", "MNQ", "MYM", "M2K"];
    const isFutures = futuresRoots.some(root => s.startsWith(root) && (s.length <= root.length + 2));
    setAssetType(isFutures ? "futures" : "forex");
  }, []);

  // ── Active model ──
  const setActiveModel = useCallback((id: number | null, name?: string) => {
    setActiveModelId(id);
    setActiveModelName(name || null);
  }, []);

  // ── Trade markers ──
  const addTradeMarkers = useCallback((markers: TradeMarker[]) => {
    setTradeMarkers(prev => [...prev, ...markers]);
  }, []);

  const clearTradeMarkers = useCallback((source?: TradeMarker["source"]) => {
    if (source) {
      setTradeMarkers(prev => prev.filter(m => m.source !== source));
    } else {
      setTradeMarkers([]);
    }
  }, []);

  // ── Prediction markers ──
  const addPredictionMarkers = useCallback((markers: PredictionMarker[]) => {
    setPredictionMarkers(prev => [...prev, ...markers]);
  }, []);

  const clearPredictionMarkers = useCallback((source?: PredictionMarker["source"]) => {
    if (source) {
      setPredictionMarkers(prev => prev.filter(m => m.source !== source));
    } else {
      setPredictionMarkers([]);
    }
  }, []);

  // ── Logging ──
  const addLog = useCallback((entry: Omit<DashboardLog, "id" | "timestamp">) => {
    const log: DashboardLog = {
      ...entry,
      id: `log-${++logIdRef.current}`,
      timestamp: Date.now(),
    };
    setLogs(prev => [log, ...prev].slice(0, 500)); // keep last 500
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  // ── Navigation helpers ──
  const navigateToChart = useCallback(() => {
    // Wouter uses window.location for navigation
    window.location.hash = "";
    window.history.pushState(null, "", "/");
  }, []);

  const navigateToMLHub = useCallback((tab?: string) => {
    // ML Hub is now integrated into MarketData's bottom panel
    window.history.pushState(null, "", "/");
    if (tab) {
      window.dispatchEvent(new CustomEvent("mlhub-tab", { detail: { tab } }));
    }
  }, []);

  // ── Build overlays object ──
  const overlays = useMemo<ChartOverlays>(() => ({
    tradeMarkers,
    predictionMarkers,
    highlightRange,
  }), [tradeMarkers, predictionMarkers, highlightRange]);

  // ── Context value (memoized) ──
  const value = useMemo<UnifiedDashboardContextType>(() => ({
    symbol,
    setSymbol,
    assetType,
    setAssetType,
    timeframeMinutes,
    setTimeframeMinutes,
    overlays,
    setTradeMarkers,
    addTradeMarkers,
    clearTradeMarkers,
    setPredictionMarkers,
    addPredictionMarkers,
    clearPredictionMarkers,
    setHighlightRange,
    trainingContext,
    setTrainingContext,
    isTraining,
    activeModelId,
    activeModelName,
    setActiveModel,
    navigateToChart,
    navigateToMLHub,
    logs,
    addLog,
    clearLogs,
  }), [
    symbol, setSymbol, assetType, timeframeMinutes,
    overlays, setTradeMarkers, addTradeMarkers, clearTradeMarkers,
    setPredictionMarkers, addPredictionMarkers, clearPredictionMarkers,
    setHighlightRange,
    trainingContext, isTraining,
    activeModelId, activeModelName, setActiveModel,
    navigateToChart, navigateToMLHub,
    logs, addLog, clearLogs,
  ]);

  return (
    <UnifiedDashboardContext.Provider value={value}>
      {children}
    </UnifiedDashboardContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════

export function useDashboard(): UnifiedDashboardContextType {
  const ctx = useContext(UnifiedDashboardContext);
  if (!ctx) {
    throw new Error("useDashboard must be used within UnifiedDashboardProvider");
  }
  return ctx;
}

/** Convenience: just the symbol/timeframe without overlay noise */
export function useSymbol() {
  const { symbol, setSymbol, assetType, setAssetType, timeframeMinutes, setTimeframeMinutes } = useDashboard();
  return { symbol, setSymbol, assetType, setAssetType, timeframeMinutes, setTimeframeMinutes };
}

/** Convenience: just the overlays for chart rendering */
export function useChartOverlays() {
  const { overlays, setTradeMarkers, addTradeMarkers, clearTradeMarkers,
    setPredictionMarkers, addPredictionMarkers, clearPredictionMarkers,
    setHighlightRange } = useDashboard();
  return {
    overlays, setTradeMarkers, addTradeMarkers, clearTradeMarkers,
    setPredictionMarkers, addPredictionMarkers, clearPredictionMarkers,
    setHighlightRange,
  };
}
