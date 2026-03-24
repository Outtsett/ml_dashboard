/**
 * TrainingMetricsCtx — Per-iteration metric data.
 *
 * Sub-slice of TrainingLive. Components that only need metrics/iterationHistory
 * subscribe here instead of the full TrainingLive context, avoiding re-renders
 * when logs or overlays change.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { TrainingMetricsSlice } from "@shared/trainingTypes";

const TrainingMetricsCtx = createContext<TrainingMetricsSlice | null>(null);

export function TrainingMetricsProvider({
  value,
  children,
}: {
  value: TrainingMetricsSlice;
  children: ReactNode;
}) {
  return (
    <TrainingMetricsCtx.Provider value={value}>
      {children}
    </TrainingMetricsCtx.Provider>
  );
}

/** Narrow: per-iteration metrics only (metrics, iterationHistory). */
export function useTrainingMetrics(): TrainingMetricsSlice {
  const ctx = useContext(TrainingMetricsCtx);
  if (!ctx)
    throw new Error(
      "useTrainingMetrics must be used within TrainingMetricsProvider",
    );
  return ctx;
}
