/**
 * TrainingContext — Training state provider.
 *
 * Wraps useTraining() and provides it app-wide via two focused contexts:
 * - TrainingControlCtx: session lifecycle, actions (changes ~10x per run)
 * - TrainingLiveCtx: metrics, overlays, logs (changes ~500x per run)
 *
 * Components that only need isTraining/progress use useTrainingControl().
 * Components that need live metrics/overlays use useTrainingLive().
 * useTrainingContext() merges both for backward compat.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useTraining } from "@/hooks/useTraining";
import type { TrainingState, ModelRegistryEntry, TrainingControl, TrainingLive } from "@shared/trainingTypes";

// ── Full context type (backward compat) ─────────────────────────────────────
type TrainingContextValue = TrainingState & {
  availableModels: Record<string, ModelRegistryEntry>;
  selectedModelType: string;
  setSelectedModelType: (type: string) => void;
  timeframeLabel: string;
};

// ── Two focused contexts ────────────────────────────────────────────────────
type ControlValue = TrainingControl & {
  availableModels: Record<string, ModelRegistryEntry>;
  timeframeLabel: string;
};

const TrainingControlCtx = createContext<ControlValue | null>(null);
const TrainingLiveCtx = createContext<TrainingLive | null>(null);

export function TrainingProvider({ children }: { children: ReactNode }) {
  const state = useTraining();

  // Control plane — only changes on user action or phase transition
  const control = useMemo<ControlValue>(() => ({
    isTraining: state.isTraining,
    phase: state.phase,
    progress: state.progress,
    error: state.error,
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
  }), [
    state.isTraining, state.phase, state.progress, state.error,
    state.startTraining, state.stopTraining,
    state.selectedModelType, state.setSelectedModelType,
    state.availableModels, state.completedModelId, state.config,
    state.timeframeLabel, state.modelType, state.sessionId, state.modelId,
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
  }), [
    state.metrics, state.iterationHistory, state.logs,
    state.liveRegimeTimestamps, state.liveRegimeAssignments,
    state.overlayData, state.overlayType,
    state.elapsedSec, state.totalBars, state.dataRange, state.diagnostics,
  ]);

  return (
    <TrainingControlCtx.Provider value={control}>
      <TrainingLiveCtx.Provider value={live}>
        {children}
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
