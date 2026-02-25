/**
 * useUniversalTraining — Model-agnostic training hook.
 *
 * Think of it as: the universal remote control for training. No matter which
 * model type you select, you get the same interface: start, stop, progress,
 * metrics, chart overlay data. The model type just changes what metrics appear
 * and what gets painted on the chart.
 *
 * Reads symbol + timeframe from UnifiedDashboardContext. Communicates with
 * the universal training API (POST /api/training/start, GET /api/training/stream/:id).
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import type {
  TrainingRequest,
  UniversalTrainingState,
  OverlayPayload,
  ModelRegistryEntry,
} from "@shared/trainingTypes";

// ─── Timeframe helpers ───────────────────────────────────────────────────────

const MINUTES_TO_LABEL: Record<number, string> = {
  1: "1m", 5: "5m", 15: "15m", 30: "30m",
  60: "1h", 240: "4h", 1440: "1d", 10080: "1w",
};

function minutesToLabel(m: number): string {
  return MINUTES_TO_LABEL[m] ?? `${m}m`;
}

// ─── Config query ────────────────────────────────────────────────────────────

interface TrainingConfigResponse {
  models: Record<string, ModelRegistryEntry>;
  features: Record<string, Record<string, unknown>>;
  timeframes: Record<string, number>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useUniversalTraining(): UniversalTrainingState & {
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
  const eventSourceRef = useRef<EventSource | null>(null);

  // ── Model selection ──────────────────────────────────────────────────────
  const [selectedModelType, setSelectedModelType] = useState("hdp-hmm");

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

  // ── Fetch available models from server ───────────────────────────────────
  const { data: trainingConfig } = useQuery<TrainingConfigResponse>({
    queryKey: ["training", "config"],
    queryFn: async () => {
      const res = await fetch("/api/training/config");
      if (!res.ok) throw new Error("Failed to load training config");
      return res.json();
    },
    staleTime: 300_000, // 5 min
  });

  const availableModels = trainingConfig?.models ?? {};

  // ── SSE Event Handler ────────────────────────────────────────────────────
  const connectSSE = useCallback((streamModelId: string) => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const es = new EventSource(`/api/training/stream/${streamModelId}`);
    eventSourceRef.current = es;

    // training:started
    es.addEventListener("started", (e) => {
      const d = JSON.parse(e.data);
      setDataRange(d.dateRange ?? null);
      setTotalBars(d.totalBars ?? 0);
      setModelType(d.modelType);
      dashboard.setTrainingContext({
        dataStart: d.dateRange?.start ?? "",
        dataEnd: d.dateRange?.end ?? "",
        epoch: 0, totalEpochs: 0,
        loss: 0, valLoss: 0, accuracy: 0, valAccuracy: 0,
        status: "training",
        symbol: d.symbol,
      });
    });

    // training:progress
    es.addEventListener("progress", (e) => {
      const d = JSON.parse(e.data);
      setPhase(d.phase ?? "");
      setProgress(d.pct ?? 0);
      setLogs(prev => [...prev.slice(-500), d.message]);
    });

    // training:metric
    es.addEventListener("metric", (e) => {
      const d = JSON.parse(e.data);
      if (d.metrics) {
        setMetrics(prev => ({ ...prev, ...d.metrics }));
        if (d.iteration != null) {
          setIterationHistory(prev => [...prev, { iteration: d.iteration, metrics: d.metrics }]);
        }
      }
      // Handle named metric types (regimes_discovered, stability, etc.)
      if (d.type && d.value != null) {
        setMetrics(prev => ({ ...prev, [d.type]: d.value }));
      }
    });

    // training:overlay
    es.addEventListener("overlay", (e) => {
      const d = JSON.parse(e.data);
      setOverlayType(d.overlayType);
      setOverlayData(d);

      // Accumulate regime-specific overlay data for chart coloring
      if (d.overlayType === "regime_timestamps" && Array.isArray(d.timestamps)) {
        setLiveRegimeTimestamps(d.timestamps);
      } else if (d.overlayType === "regime_colors" && Array.isArray(d.assignments)) {
        setLiveRegimeAssignments(d.assignments);
      }
    });

    // training:log
    es.addEventListener("log", (e) => {
      const d = JSON.parse(e.data);
      if (d.message) {
        setLogs(prev => [...prev.slice(-500), d.message]);
      }
    });

    // training:done
    es.addEventListener("done", (e) => {
      const d = JSON.parse(e.data);
      setCompletedModelId(d.modelId);
      setDiagnostics(d.diagnostics ?? null);
      setElapsedSec(d.elapsedSec ?? 0);
      setIsTraining(false);
      setPhase("complete");
      setProgress(100);
      dashboard.setTrainingContext(null);
      es.close();
      eventSourceRef.current = null;
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      // Invalidate model queries so saved models refresh
      queryClient.invalidateQueries({ queryKey: ["regime", "models"] });
    });

    // training:error
    es.addEventListener("error", (e) => {
      // SSE connection errors vs training errors
      if (e instanceof MessageEvent) {
        const d = JSON.parse(e.data);
        setError(d.message ?? "Training error");
      }
      setIsTraining(false);
      dashboard.setTrainingContext(null);
      es.close();
      eventSourceRef.current = null;
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    });

    // caught_up (internal — all buffered events replayed)
    es.addEventListener("caught_up", () => {
      // Connection established and caught up
    });

    es.onerror = () => {
      // EventSource auto-reconnects, but if the server closed the stream, clean up
      if (es.readyState === EventSource.CLOSED) {
        eventSourceRef.current = null;
      }
    };
  }, [dashboard, queryClient]);

  // ── Start Training ───────────────────────────────────────────────────────
  const startTraining = useCallback(async (request: TrainingRequest) => {
    // Reset state
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

    // Inject symbol + timeframe from chart context if not provided
    const enriched: TrainingRequest = {
      ...request,
      symbol: request.symbol || dashboard.symbol,
      timeframe: request.timeframe || timeframeLabel,
    };

    try {
      const res = await fetch("/api/training/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enriched),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const result = await res.json();
      setSessionId(result.sessionId);
      setModelId(result.modelId);
      setModelType(request.modelType);
      setConfig(request);
      setIsTraining(true);
      startTimeRef.current = Date.now();

      // Start elapsed timer
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSec((Date.now() - startTimeRef.current) / 1000);
      }, 1000);

      // Connect to SSE stream
      connectSSE(result.modelId);
    } catch (err: any) {
      setError(err.message);
      setIsTraining(false);
    }
  }, [connectSSE, dashboard.symbol, timeframeLabel]);

  // ── Stop Training ────────────────────────────────────────────────────────
  const stopTraining = useCallback(() => {
    if (modelId) {
      fetch(`/api/training/stop/${modelId}`, { method: "POST" }).catch(() => {});
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsTraining(false);
    dashboard.setTrainingContext(null);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
  }, [modelId, dashboard]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

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
