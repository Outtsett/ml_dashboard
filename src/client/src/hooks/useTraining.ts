/**
 * useTraining — Model-agnostic training orchestrator.
 *
 * Think of it as: the Run button's brain. No matter which model type you
 * select, you get the same interface: start, stop, progress, metrics, chart
 * overlay data. The model type just changes what metrics appear and what gets
 * painted on the chart.
 *
 * Delegates config fetching to useTrainingConfig and SSE streaming to
 * useTrainingSSE. This hook owns state + start/stop logic.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { trainingApi } from "@/lib/api_service";
import { minutesToLabel } from "@/lib/timeframes";
import { buildSSECallbacks } from "@/lib/training/sse_handlers";
import { useTrainingConfig } from "./useTrainingConfig";
import { useTrainingSSE } from "./useTrainingSSE";
import { useTrainingLiveState } from "./useTrainingLiveState";
import { QUERY_KEYS } from "@/lib/types";
import type {
  TrainingRequest,
  TrainingState,
  ModelRegistryEntry,
} from "@shared/trainingTypes";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse API error responses — server returns "429: {"error":"..."}" format. */
function parseApiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const jsonIdx = raw.indexOf("{");
  if (jsonIdx >= 0) {
    try { return JSON.parse(raw.slice(jsonIdx)).error || raw; } catch { /* keep raw */ }
  }
  return raw;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTraining(): TrainingState & {
  /** True from button press until API responds — gives instant visual feedback */
  isPending: boolean;
  /** Available model types from config/models.json */
  availableModels: Record<string, ModelRegistryEntry>;
  /** Currently selected model type */
  selectedModelType: string;
  setSelectedModelType: (type: string) => void;
  /** Current timeframe label derived from chart context */
  timeframeLabel: string;
  /** Whether the SSE EventSource is currently connected */
  sseConnected: boolean;
  /** SSE connection error (reconnect failures, connection lost) */
  sseError: string | null;
} {
  const dashboard = useDashboard();
  const queryClient = useQueryClient();

  // ── Model selection ──────────────────────────────────────────────────────
  const [selectedModelType, setSelectedModelType] = useState("");

  // ── Session state (slow-changing, lifecycle events) ─────────────────────
  const [modelType, setModelType] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState(0);
  const [config, setConfig] = useState<TrainingRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedModelId, setCompletedModelId] = useState<string | null>(null);

  // ── Live state (fast-changing, per-iteration SSE updates — SRP sub-hook) ──
  const {
    state: liveState,
    setters: liveSetters,
    resetLiveState,
    startElapsedTimer,
    clearElapsedTimer,
  } = useTrainingLiveState();

  // ── Timeframe from dashboard ─────────────────────────────────────────────
  const timeframeLabel = minutesToLabel(dashboard.timeframeMinutes);

  // ── Config (models registry) ─────────────────────────────────────────────
  const { data: trainingConfig } = useTrainingConfig();
  const availableModels = trainingConfig?.models ?? {};

  // Auto-select first model when registry loads and nothing is selected yet
  useEffect(() => {
    if (!selectedModelType && availableModels) {
      const keys = Object.keys(availableModels);
      if (keys.length > 0) setSelectedModelType(keys[0]!);
    }
  }, [availableModels, selectedModelType, setSelectedModelType]);

  // ── SSE callbacks → state updates (extracted to sseHandlers.ts — SRP) ────
  const { connect: connectSSE, disconnect: disconnectSSE, connected: sseConnected, error: sseError } = useTrainingSSE(
    buildSSECallbacks({
      // Session setters (this hook)
      setModelType, setPhase, setProgress,
      setCompletedModelId, setError, setIsTraining,
      // Live data setters (sub-hook)
      setDataRange: liveSetters.setDataRange,
      setTotalBars: liveSetters.setTotalBars,
      setLogs: liveSetters.setLogs,
      setMetrics: liveSetters.setMetrics,
      setIterationHistory: liveSetters.setIterationHistory,
      setOverlayType: liveSetters.setOverlayType,
      setOverlayData: liveSetters.setOverlayData,
      setLiveRegimeTimestamps: liveSetters.setLiveRegimeTimestamps,
      setLiveRegimeAssignments: liveSetters.setLiveRegimeAssignments,
      setDiagnostics: liveSetters.setDiagnostics,
      setMetricDeclarations: liveSetters.setMetricDeclarations,
      setElapsedSec: liveSetters.setElapsedSec,
      setModelState: liveSetters.setModelState,
      setModelStateHistory: liveSetters.setModelStateHistory,
      clearElapsedTimer,
      // External side effects
      setTrainingContext: dashboard.setTrainingContext,
      invalidateModels: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.regimeModels }),
    })
  );

  // ── Reset state when model type changes (multi-model isolation) ─────────
  // When the user switches model type in the dropdown, clear stale data from
  // the previous model so metrics/overlays/diagnostics don't bleed across.
  const prevModelTypeRef = useRef(selectedModelType);
  useEffect(() => {
    if (prevModelTypeRef.current && prevModelTypeRef.current !== selectedModelType) {
      // Only reset if not actively training — don't nuke a live session
      if (!isTraining) {
        disconnectSSE();
        resetLiveState();
        clearElapsedTimer();
        setModelType(null);
        setSessionId(null);
        setModelId(null);
        setCompletedModelId(null);
        setConfig(null);
        setError(null);
        setIsPending(false);
        setPhase("");
        setProgress(0);
      }
    }
    prevModelTypeRef.current = selectedModelType;
  }, [selectedModelType, isTraining, disconnectSSE, resetLiveState, clearElapsedTimer]);

  // ── Start Training ───────────────────────────────────────────────────────
  const startTraining = useCallback(async (request: TrainingRequest) => {
    // Immediate visual feedback — button changes the instant you press it
    setIsPending(true);
    setError(null);
    setCompletedModelId(null);
    setProgress(0);
    setPhase("starting");
    resetLiveState();

    const enriched: TrainingRequest = {
      ...request,
      symbol: request.symbol,
      timeframe: request.timeframe || timeframeLabel,
    };

    try {
      const result = await trainingApi.start(enriched) as { sessionId: string; modelId: string };
      setSessionId(result.sessionId);
      setModelId(result.modelId);
      setModelType(request.modelType);
      setConfig(request);
      setIsTraining(true);
      setIsPending(false);
      startElapsedTimer();
      connectSSE(result.modelId);
    } catch (err: unknown) {
      setError(parseApiError(err));
      setIsTraining(false);
      setIsPending(false);
    }
  }, [connectSSE, dashboard.symbol, timeframeLabel, startElapsedTimer, resetLiveState]);

  // ── Stop Training ────────────────────────────────────────────────────────
  const stopTraining = useCallback(() => {
    if (modelId) {
      trainingApi.stop(modelId).catch(() => {});
    }
    disconnectSSE();
    resetLiveState();
    setIsTraining(false);
    dashboard.setTrainingContext(null);
    clearElapsedTimer();
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.regimeModels });
  }, [modelId, dashboard, disconnectSSE, resetLiveState, clearElapsedTimer, queryClient]);

  return {
    // Session state
    modelType, sessionId, modelId,
    isTraining, isPending,
    phase, progress, config,
    error, completedModelId,
    // SSE connection state
    sseConnected, sseError,
    // Live state (from sub-hook)
    ...liveState,
    // Actions
    startTraining, stopTraining,
    // Config
    availableModels, selectedModelType, setSelectedModelType,
    timeframeLabel,
  };
}
