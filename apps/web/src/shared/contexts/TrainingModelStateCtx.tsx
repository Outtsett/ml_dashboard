/**
 * TrainingModelStateCtx — Full model state snapshots.
 *
 * Sub-slice of TrainingLive. Components that render model state visualizations
 * (emission heatmaps, transition matrices, regime profiles, feature attribution)
 * subscribe here instead of the full TrainingLive context, avoiding re-renders
 * when metrics, logs, or overlays change. Updates every 25-50 iterations.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { TrainingModelStateSlice } from "@shared/trainingTypes";

const TrainingModelStateCtx = createContext<TrainingModelStateSlice | null>(null);

export function TrainingModelStateProvider({
  value,
  children,
}: {
  value: TrainingModelStateSlice;
  children: ReactNode;
}) {
  return (
    <TrainingModelStateCtx.Provider value={value}>
      {children}
    </TrainingModelStateCtx.Provider>
  );
}

/** Narrow: model state snapshots only (modelState, modelStateHistory). */
export function useTrainingModelState(): TrainingModelStateSlice {
  const ctx = useContext(TrainingModelStateCtx);
  if (!ctx)
    throw new Error(
      "useTrainingModelState must be used within TrainingModelStateProvider",
    );
  return ctx;
}
