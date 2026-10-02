/**
 * TrainingContext — Training state provider.
 *
 * Wraps useTraining() and provides it app-wide via focused contexts:
 * - TrainingControlCtx: session lifecycle, actions (changes ~10x per run)
 * - TrainingLiveCtx: metrics, overlays, logs (changes ~500x per run)
 *   - TrainingMetricsCtx: per-iteration metrics only
 *   - TrainingLogsCtx: log lines only
 *   - TrainingOverlaysCtx: chart overlays + session metadata
 *   - TrainingModelStateCtx: model state snapshots (every 25-50 iterations)
 *
 * Components pick the narrowest hook they need:
 *   useTrainingControl()    → isTraining, progress, start/stop
 *   useTrainingLive()       → all live data (backward compat)
 *   useTrainingMetrics()    → metrics, iterationHistory
 *   useTrainingLogs()       → logs
 *   useTrainingOverlays()   → overlays, regime data, elapsed, diagnostics
 *   useTrainingModelState() → model state snapshots, history
 *   useTrainingContext()    → everything merged (backward compat)
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useTraining } from "@/training/lib/useTraining";
import type { ActiveTrainingSession } from "@/training/lib/useTrainingReattach";
import type {
  TrainingState,
  ModelRegistryEntry,
  TrainingControl,
  TrainingLive,
  TrainingMetricsSlice,
  TrainingLogsSlice,
  TrainingOverlaysSlice,
  TrainingModelStateSlice,
} from "@shared/trainingTypes";
import { TrainingMetricsProvider } from "@/shared/contexts/TrainingMetricsCtx";
import { TrainingLogsProvider } from "@/shared/contexts/TrainingLogsCtx";
import { TrainingOverlaysProvider } from "@/shared/contexts/TrainingOverlaysCtx";
import { TrainingModelStateProvider } from "@/shared/contexts/TrainingModelStateCtx";

// Re-export sub-context hooks for convenience
export { useTrainingMetrics } from "@/shared/contexts/TrainingMetricsCtx";
export { useTrainingLogs } from "@/shared/contexts/TrainingLogsCtx";
export { useTrainingOverlays } from "@/shared/contexts/TrainingOverlaysCtx";
export { useTrainingModelState } from "@/shared/contexts/TrainingModelStateCtx";

// ── Full context type (backward compat) ─────────────────────────────────────
type TrainingContextValue = TrainingState & {
  isPending: boolean;
  otherActiveSessions: ActiveTrainingSession[];
  availableModels: Record<string, ModelRegistryEntry>;
  selectedModelType: string;
  setSelectedModelType: (type: string) => void;
  timeframeLabel: string;
};

// ── Two focused contexts ────────────────────────────────────────────────────
type ControlValue = TrainingControl & {
  availableModels: Record<string, ModelRegistryEntry>;
  timeframeLabel: string;
  /**
   * Live server-side runs this tab is not driving, found by the mount-time
   * reattach probe. Non-empty only when more than one run is in flight.
   */
  otherActiveSessions: ActiveTrainingSession[];
};

const TrainingControlCtx = createContext<ControlValue | null>(null);
const TrainingLiveCtx = createContext<TrainingLive | null>(null);

export function TrainingProvider({ children }: { children: ReactNode }) {
  const state = useTraining();

  // Control plane — only changes on user action or phase transition
  const control = useMemo<ControlValue>(() => ({
    isTraining: state.isTraining,
    isPending: state.isPending,
    phase: state.phase,
    progress: state.progress,
    error: state.error,
    sseError: state.sseError,
    startTraining: state.startTraining,
    stopTraining: state.stopTraining,
    selectedModelType: state.selectedModelType,
    setSelectedModelType: state.setSelectedModelType,
    availableModels: state.availableModels,
    completedModelId: state.completedModelId,
    config: state.config,
    timeframeLabel: state.timeframeLabel,
    modelType: state.modelType,
    sessionId: state.sessionId,
    modelId: state.modelId,
    otherActiveSessions: state.otherActiveSessions,
  }), [
    state.isTraining, state.isPending, state.phase, state.progress, state.error,
    state.sseError, state.startTraining, state.stopTraining,
    state.selectedModelType, state.setSelectedModelType,
    state.availableModels, state.completedModelId, state.config,
    state.timeframeLabel, state.modelType, state.sessionId, state.modelId,
    state.otherActiveSessions,
  ]);

  // Live data plane — changes per iteration/tick
  const live = useMemo<TrainingLive>(() => ({
    metrics: state.metrics,
    iterationHistory: state.iterationHistory,
    logs: state.logs,
    liveRegimeTimestamps: state.liveRegimeTimestamps,
    liveRegimeAssignments: state.liveRegimeAssignments,
    overlayData: state.overlayData,
    overlayType: state.overlayType,
    elapsedSec: state.elapsedSec,
    totalBars: state.totalBars,
    dataRange: state.dataRange,
    diagnostics: state.diagnostics,
    metricDeclarations: state.metricDeclarations,
    modelState: state.modelState,
    modelStateHistory: state.modelStateHistory,
  }), [
    state.metrics, state.iterationHistory, state.logs,
    state.liveRegimeTimestamps, state.liveRegimeAssignments,
    state.overlayData, state.overlayType,
    state.elapsedSec, state.totalBars, state.dataRange, state.diagnostics,
    state.metricDeclarations, state.modelState, state.modelStateHistory,
  ]);

  // ── Sub-slices: memoized independently so each context only triggers
  //    re-renders when its specific fields change ─────────────────────────

  const metricsSlice = useMemo<TrainingMetricsSlice>(() => ({
    metrics: state.metrics,
    iterationHistory: state.iterationHistory,
  }), [state.metrics, state.iterationHistory]);

  const logsSlice = useMemo<TrainingLogsSlice>(() => ({
    logs: state.logs,
  }), [state.logs]);

  const overlaysSlice = useMemo<TrainingOverlaysSlice>(() => ({
    liveRegimeTimestamps: state.liveRegimeTimestamps,
    liveRegimeAssignments: state.liveRegimeAssignments,
    overlayData: state.overlayData,
    overlayType: state.overlayType,
    elapsedSec: state.elapsedSec,
    totalBars: state.totalBars,
    dataRange: state.dataRange,
    diagnostics: state.diagnostics,
    metricDeclarations: state.metricDeclarations,
  }), [
    state.liveRegimeTimestamps, state.liveRegimeAssignments,
    state.overlayData, state.overlayType,
    state.elapsedSec, state.totalBars, state.dataRange, state.diagnostics,
    state.metricDeclarations,
  ]);

  const modelStateSlice = useMemo<TrainingModelStateSlice>(() => ({
    modelState: state.modelState,
    modelStateHistory: state.modelStateHistory,
  }), [state.modelState, state.modelStateHistory]);

  return (
    <TrainingControlCtx.Provider value={control}>
      <TrainingLiveCtx.Provider value={live}>
        <TrainingMetricsProvider value={metricsSlice}>
          <TrainingLogsProvider value={logsSlice}>
            <TrainingOverlaysProvider value={overlaysSlice}>
              <TrainingModelStateProvider value={modelStateSlice}>
                {children}
              </TrainingModelStateProvider>
            </TrainingOverlaysProvider>
          </TrainingLogsProvider>
        </TrainingMetricsProvider>
      </TrainingLiveCtx.Provider>
    </TrainingControlCtx.Provider>
  );
}

/** Narrow: control plane only (isTraining, progress, start/stop). */
export function useTrainingControl(): ControlValue {
  const ctx = useContext(TrainingControlCtx);
  if (!ctx) throw new Error("useTrainingControl must be used within TrainingProvider");
  return ctx;
}

/** Narrow: live data only (metrics, overlays, logs). */
export function useTrainingLive(): TrainingLive {
  const ctx = useContext(TrainingLiveCtx);
  if (!ctx) throw new Error("useTrainingLive must be used within TrainingProvider");
  return ctx;
}

/** Full state (backward compat) — merges both contexts. */
export function useTrainingContext(): TrainingContextValue {
  const control = useTrainingControl();
  const live = useTrainingLive();
  return useMemo(() => ({ ...control, ...live }), [control, live]);
}
