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

import { useState, useCallback, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { trainingApi } from "@/lib/apiService";
import { minutesToLabel } from "@/lib/timeframes";
import { useTrainingConfig } from "./useTrainingConfig";
import { useTrainingSSE } from "./useTrainingSSE";
import type {
  TrainingRequest,
  TrainingState,
  OverlayPayload,
  ModelRegistryEntry,
} from "@shared/trainingTypes";

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTraining(): TrainingState & {
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

  // ── Training state ───────────────────────────────────────────────────────
  const [modelType, setModelType] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState(0);
  const [config, setConfig] = useState<TrainingRequest | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [iterationHistory, setIterationHistory] = useState<Array<{ iteration: number; metrics: Record<string, number> }>>([]);
  const [dataRange, setDataRange] = useState<{ start: string; end: string } | null>(null);
  const [totalBars, setTotalBars] = useState(0);
  const [overlayType, setOverlayType] = useState<string | null>(null);
  const [overlayData, setOverlayData] = useState<OverlayPayload | null>(null);
  const [liveRegimeTimestamps, setLiveRegimeTimestamps] = useState<number[]>([]);
  const [liveRegimeAssignments, setLiveRegimeAssignments] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [completedModelId, setCompletedModelId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<unknown | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  // ── Timeframe from dashboard ─────────────────────────────────────────────
  const timeframeLabel = minutesToLabel(dashboard.timeframeMinutes);

  // ── Config (models registry) ─────────────────────────────────────────────
  const { data: trainingConfig } = useTrainingConfig();
  const availableModels = trainingConfig?.models ?? {};

  // ── Elapsed timer helpers ────────────────────────────────────────────────
  const clearElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const startElapsedTimer = useCallback(() => {
    clearElapsedTimer();
    startTimeRef.current = Date.now();
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSec((Date.now() - startTimeRef.current) / 1000);
    }, 1000);
  }, [clearElapsedTimer]);

  // ── SSE callbacks → state updates ────────────────────────────────────────
  const { connect: connectSSE, disconnect: disconnectSSE } = useTrainingSSE({
    onStarted(d) {
      setDataRange(d.dateRange ?? null);
      setTotalBars(d.totalBars ?? 0);
      setModelType(d.modelType);
      dashboard.setTrainingContext({
        dataStart: d.dateRange?.start ?? "",
        dataEnd: d.dateRange?.end ?? "",
        epoch: 0, totalEpochs: 0,
        loss: 0, valLoss: 0, accuracy: 0, valAccuracy: 0,
        status: "training",
        symbol: d.symbol ?? "",
      });
    },
    onProgress(d) {
      setPhase(d.phase ?? "");
      setProgress(d.pct ?? 0);
      setLogs(prev => [...prev.slice(-500), d.message]);
    },
    onMetric(d) {
      if (d.metrics) {
        setMetrics(prev => ({ ...prev, ...d.metrics }));
        if (d.iteration != null) {
          setIterationHistory(prev => [...prev, { iteration: d.iteration!, metrics: d.metrics! }]);
        }
      }
      if (d.type && d.value != null) {
        setMetrics(prev => ({ ...prev, [d.type!]: d.value! }));
      }
    },
    onOverlay(d) {
      setOverlayType(d.overlayType);
      setOverlayData(d);
      if (d.overlayType === "regime_timestamps" && Array.isArray(d.timestamps)) {
        setLiveRegimeTimestamps(d.timestamps);
      } else if (d.overlayType === "regime_colors" && Array.isArray(d.assignments)) {
        setLiveRegimeAssignments(d.assignments);
      }
    },
    onLog(d) {
      if (d.message) setLogs(prev => [...prev.slice(-500), d.message!]);
    },
    onDone(d) {
      setCompletedModelId(d.modelId ?? null);
      setDiagnostics(d.diagnostics ?? null);
      setElapsedSec(d.elapsedSec ?? 0);
      setIsTraining(false);
      setPhase("complete");
      setProgress(100);
      dashboard.setTrainingContext(null);
      clearElapsedTimer();
      queryClient.invalidateQueries({ queryKey: ["regime", "models"] });
    },
    onError(d) {
      if (d?.message) setError(d.message);
      else setError("Training error");
      setIsTraining(false);
      dashboard.setTrainingContext(null);
      clearElapsedTimer();
    },
  });

  // ── Start Training ───────────────────────────────────────────────────────
  const startTraining = useCallback(async (request: TrainingRequest) => {
    setError(null);
    setLogs([]);
    setMetrics({});
    setIterationHistory([]);
    setOverlayData(null);
    setOverlayType(null);
    setLiveRegimeTimestamps([]);
    setLiveRegimeAssignments([]);
    setCompletedModelId(null);
    setDiagnostics(null);
    setDataRange(null);
    setTotalBars(0);
    setProgress(0);
    setPhase("starting");

    const enriched: TrainingRequest = {
      ...request,
      symbol: request.symbol || dashboard.symbol,
      timeframe: request.timeframe || timeframeLabel,
    };

    try {
      const result = await trainingApi.start(enriched) as { sessionId: string; modelId: string };
      setSessionId(result.sessionId);
      setModelId(result.modelId);
      setModelType(request.modelType);
      setConfig(request);
      setIsTraining(true);
      startElapsedTimer();
      connectSSE(result.modelId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setIsTraining(false);
    }
  }, [connectSSE, dashboard.symbol, timeframeLabel, startElapsedTimer]);

  // ── Stop Training ────────────────────────────────────────────────────────
  const stopTraining = useCallback(() => {
    if (modelId) {
      trainingApi.stop(Number(modelId)).catch(() => {});
    }
    disconnectSSE();
    setIsTraining(false);
    dashboard.setTrainingContext(null);
    clearElapsedTimer();
  }, [modelId, dashboard, disconnectSSE, clearElapsedTimer]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => clearElapsedTimer();
  }, [clearElapsedTimer]);

  return {
    modelType,
    sessionId,
    modelId,
    isTraining,
    phase,
    progress,
    config,
    logs,
    metrics,
    iterationHistory,
    dataRange,
    totalBars,
    overlayType,
    overlayData,
    liveRegimeTimestamps,
    liveRegimeAssignments,
    error,
    completedModelId,
    diagnostics,
    elapsedSec,
    startTraining,
    stopTraining,
    availableModels,
    selectedModelType,
    setSelectedModelType,
    timeframeLabel,
  };
}
