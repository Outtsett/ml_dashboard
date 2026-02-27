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

import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { trainingApi } from "@/lib/apiService";
import { minutesToLabel } from "@/lib/timeframes";
import { buildSSECallbacks } from "@/lib/training/sseHandlers";
import { useTrainingConfig } from "./useTrainingConfig";
import { useTrainingSSE } from "./useTrainingSSE";
import { useTrainingLiveState } from "./useTrainingLiveState";
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
  const { connect: connectSSE, disconnect: disconnectSSE } = useTrainingSSE(
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
      setElapsedSec: liveSetters.setElapsedSec,
      clearElapsedTimer,
      // External side effects
      setTrainingContext: dashboard.setTrainingContext,
      invalidateModels: () => queryClient.invalidateQueries({ queryKey: ["regime", "models"] }),
    })
  );

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
    setIsTraining(false);
    dashboard.setTrainingContext(null);
    clearElapsedTimer();
  }, [modelId, dashboard, disconnectSSE, clearElapsedTimer]);

  return {
    // Session state
    modelType, sessionId, modelId,
    isTraining, isPending,
    phase, progress, config,
    error, completedModelId,
    // Live state (from sub-hook)
    ...liveState,
    // Actions
    startTraining, stopTraining,
    // Config
    availableModels, selectedModelType, setSelectedModelType,
    timeframeLabel,
  };
}
