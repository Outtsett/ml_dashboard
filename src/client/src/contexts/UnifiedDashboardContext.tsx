/**
 * UnifiedDashboardContext - Composer
 *
 * Nests the 4 focused context providers (Symbol, ChartOverlay, ActiveModel,
 * DashboardLog) and re-exports a backward-compatible useDashboard() hook
 * that aggregates all of them.
 *
 * Migration path:
 *  - Existing useDashboard() callers continue to work unchanged
 *  - useSymbol() now reads from SymbolContext directly (faster re-renders)
 *  - useChartOverlays() reads from ChartOverlayContext directly
 *  - New code should use the focused hooks instead of useDashboard()
 */

import React, { useCallback, useMemo } from 'react';

// ── Re-export types for backward-compatible import paths ─────────────────
export type {
  TradeMarker, PredictionMarker, TrainingBarContext,
  ChartOverlays, AssetType, DashboardLog,
} from './dashboardTypes';

// ── Focused providers ────────────────────────────────────────────────────
import { SymbolProvider, useSymbolContext } from './SymbolContext';
import { ChartOverlayProvider, useChartOverlayContext } from './ChartOverlayContext';
import { ActiveModelProvider, useActiveModelContext } from './ActiveModelContext';
import { DashboardLogProvider, useDashboardLogContext } from './DashboardLogContext';

// Re-export focused hooks for direct use
export { useSymbolContext } from './SymbolContext';
export { useChartOverlayContext } from './ChartOverlayContext';
export { useActiveModelContext } from './ActiveModelContext';
export { useDashboardLogContext } from './DashboardLogContext';

// ═══════════════════════════════════════════════════════════════
// COMPOSER PROVIDER
// ═══════════════════════════════════════════════════════════════

export function UnifiedDashboardProvider({ children }: { children: React.ReactNode }) {
  return (
    <SymbolProvider>
      <ChartOverlayProvider>
        <ActiveModelProvider>
          <DashboardLogProvider>
            {children}
          </DashboardLogProvider>
        </ActiveModelProvider>
      </ChartOverlayProvider>
    </SymbolProvider>
  );
}

// ═══════════════════════════════════════════════════════════════
// BACKWARD-COMPATIBLE HOOKS
// ═══════════════════════════════════════════════════════════════

/**
 * Full dashboard context — reads from all 4 focused contexts.
 * Prefer useSymbol(), useChartOverlays(), etc. for narrower subscriptions.
 */
export function useDashboard() {
  const sym = useSymbolContext();
  const overlay = useChartOverlayContext();
  const model = useActiveModelContext();
  const log = useDashboardLogContext();

  // Navigation helpers (stateless, no context needed)
  const navigateToChart = useCallback(() => {
    window.location.hash = '';
    window.history.pushState(null, '', '/');
  }, []);

  const navigateToMLHub = useCallback((tab?: string) => {
    window.history.pushState(null, '', '/');
    if (tab) {
      window.dispatchEvent(new CustomEvent('mlhub-tab', { detail: { tab } }));
    }
  }, []);

  return useMemo(() => ({
    // Symbol
    symbol: sym.symbol,
    setSymbol: sym.setSymbol,
    assetType: sym.assetType,
    setAssetType: sym.setAssetType,
    timeframeMinutes: sym.timeframeMinutes,
    setTimeframeMinutes: sym.setTimeframeMinutes,
    // Overlays
    overlays: overlay.overlays,
    setTradeMarkers: overlay.setTradeMarkers,
    addTradeMarkers: overlay.addTradeMarkers,
    clearTradeMarkers: overlay.clearTradeMarkers,
    setPredictionMarkers: overlay.setPredictionMarkers,
    addPredictionMarkers: overlay.addPredictionMarkers,
    clearPredictionMarkers: overlay.clearPredictionMarkers,
    setHighlightRange: overlay.setHighlightRange,
    // Active model + training
    trainingContext: model.trainingContext,
    setTrainingContext: model.setTrainingContext,
    isTraining: model.isTraining,
    activeModelId: model.activeModelId,
    activeModelName: model.activeModelName,
    setActiveModel: model.setActiveModel,
    // Navigation
    navigateToChart,
    navigateToMLHub,
    // Logs
    logs: log.logs,
    addLog: log.addLog,
    clearLogs: log.clearLogs,
  }), [sym, overlay, model, log, navigateToChart, navigateToMLHub]);
}

/** Convenience: just the symbol/timeframe without overlay noise */
export function useSymbol() {
  const { symbol, setSymbol, assetType, setAssetType, timeframeMinutes, setTimeframeMinutes } = useSymbolContext();
  return { symbol, setSymbol, assetType, setAssetType, timeframeMinutes, setTimeframeMinutes };
}

/** Convenience: just the overlays for chart rendering */
export function useChartOverlays() {
  const {
    overlays, setTradeMarkers, addTradeMarkers, clearTradeMarkers,
    setPredictionMarkers, addPredictionMarkers, clearPredictionMarkers,
    setHighlightRange,
  } = useChartOverlayContext();
  return {
    overlays, setTradeMarkers, addTradeMarkers, clearTradeMarkers,
    setPredictionMarkers, addPredictionMarkers, clearPredictionMarkers,
    setHighlightRange,
  };
}
