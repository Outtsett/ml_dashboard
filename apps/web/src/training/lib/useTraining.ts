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
import { useDashboard } from "@/shared/contexts/UnifiedDashboardContext";
import { trainingApi } from "@/infrastructure/api/api_service";
import { minutesToLabel } from "@/market/lib/timeframes";
import { buildSSECallbacks } from "@/training/sse_handlers";
import { useTrainingConfig } from "@/training/lib/useTrainingConfig";
import { useTrainingSSE } from "@/training/lib/useTrainingSSE";
import { useTrainingLiveState } from "@/training/lib/useTrainingLiveState";
import { useTrainingReattach, type ActiveTrainingSession } from "@/training/lib/useTrainingReattach";
import { QUERY_KEYS } from "@/shared/utils/types";
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
  /**
   * Live server-side runs this tab is NOT driving (found by the mount-time
   * status probe). Empty in the common single-run case.
   */
  otherActiveSessions: ActiveTrainingSession[];
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
  const baseSSECallbacks = buildSSECallbacks({
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
  });

  const { connect: connectSSE, disconnect: disconnectSSE, connected: sseConnected, error: sseError } = useTrainingSSE({
    ...baseSSECallbacks,
    // `started` is the only place sessionId reaches the client, and the stream
    // replays it on reconnect. Capturing it here is what lets a reattached run
    // keep the experiment bridge (which keys off sessionId) working after F5.
    onStarted: (d) => {
      if (d?.sessionId) setSessionId(d.sessionId);
      baseSSECallbacks.onStarted(d);
    },
  });

  // ── Reset state when model type changes (multi-model isolation) ─────────
  // When the user switches model type in the dropdown, clear stale data from
  // the previous model so metrics/overlays/diagnostics don't bleed across.
  const prevModelTypeRef = useRef(selectedModelType);
  useEffect(() => {
    if (prevModelTypeRef.current && prevModelTypeRef.current !== selectedModelType) {
      // Defer the reset while a run is live — don't nuke a live session. Leaving
      // `prevModelTypeRef` untouched is what makes the reset eventually happen:
      // `isTraining` is a dependency, so this effect re-fires when the run ends
      // and the stale-vs-selected comparison still holds. Advancing the ref here
      // would swallow the switch permanently, leaving the previous model's
      // metrics/logs/sessionId on screen forever.
      if (isTraining) return;
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
    prevModelTypeRef.current = selectedModelType;
  }, [selectedModelType, isTraining, disconnectSSE, resetLiveState, clearElapsedTimer]);

  // ── Reattach to an in-flight server-side run after a page reload ─────────
  // The server keeps training and keeps buffering events when the EventSource
  // goes away, so the whole job here is to ask once on mount and reconnect.

  // Read inside the async probe callback, so a run started in this tab while
  // the probe was in flight wins over whatever the probe found.
  const modelIdRef = useRef<string | null>(null);
  modelIdRef.current = modelId;
  const currentModelId = useCallback(() => modelIdRef.current, []);

  /**
   * Wall-clock baseline for a reattached run. The shared elapsed timer always
   * counts from the moment it is started, which would report a 20-minute-old
   * run as 0s; this carries the server's own `elapsed` forward instead.
   */
  const [reattachClock, setReattachClock] = useState<{ startedAtMs: number; elapsedSeconds: number } | null>(null);
  const { setElapsedSec } = liveSetters;

  useEffect(() => {
    if (!reattachClock || !isTraining) return;
    const tick = () => setElapsedSec(
      reattachClock.elapsedSeconds + (Date.now() - reattachClock.startedAtMs) / 1000,
    );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [reattachClock, isTraining, setElapsedSec]);

  const onReattach = useCallback((session: ActiveTrainingSession) => {
    resetLiveState();
    clearElapsedTimer();
    setModelId(session.modelId);
    setModelType(session.modelType);
    setIsTraining(true);
    setIsPending(false);
    setError(null);
    setCompletedModelId(null);
    setPhase("reattaching");
    // Only what the status endpoint actually proves. The hyperparameters this
    // run was launched with are not recoverable from it, so they stay unset
    // rather than being invented.
    setConfig({
      modelType: session.modelType,
      symbol: session.symbol,
      timeframe: session.timeframe,
    });
    setReattachClock({ startedAtMs: Date.now(), elapsedSeconds: session.elapsedSeconds });
    // Point the picker at the running model, and advance prevModelTypeRef in
    // lockstep. Without that, the model-type-change effect above sees a switch,
    // defers it because isTraining is true, and then wipes the replayed history
    // the instant the run finishes.
    prevModelTypeRef.current = session.modelType;
    setSelectedModelType(session.modelType);
    // Replays the buffered events (no `from`, so from index 0), then goes live.
    connectSSE(session.modelId);
  }, [connectSSE, resetLiveState, clearElapsedTimer]);

  const { otherActiveSessions } = useTrainingReattach({ currentModelId, onReattach });

  // The server calls res.end() right after `done`/`error`. An EventSource reads
  // that close as a failure and reconnects with backoff — replaying the entire
  // buffer and duplicating metric history on every attempt. Close it ourselves
  // once the run is over.
  const wasTrainingRef = useRef(false);
  useEffect(() => {
    if (isTraining) { wasTrainingRef.current = true; return; }
    if (wasTrainingRef.current) {
      wasTrainingRef.current = false;
      disconnectSSE();
    }
  }, [isTraining, disconnectSSE]);

  // ── Start Training ───────────────────────────────────────────────────────
  const startTraining = useCallback(async (request: TrainingRequest) => {
    // Immediate visual feedback — button changes the instant you press it
    setIsPending(true);
    setError(null);
    setCompletedModelId(null);
    setProgress(0);
    setPhase("starting");
    resetLiveState();
    // A fresh run owns the elapsed clock again — drop the reattach baseline so
    // the two tickers never fight over elapsedSec.
    setReattachClock(null);

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
    setReattachClock(null);
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
    // Other live server-side runs this tab is not driving
    otherActiveSessions,
    // Live state (from sub-hook)
    ...liveState,
    // Actions
    startTraining, stopTraining,
    // Config
    availableModels, selectedModelType, setSelectedModelType,
    timeframeLabel,
  };
}
