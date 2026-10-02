/**
 * TrainingLogsCtx — Append-only training log lines.
 *
 * Sub-slice of TrainingLive. Components that only render logs subscribe here
 * instead of the full TrainingLive context, avoiding re-renders when metrics
 * or overlays change.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { TrainingLogsSlice } from "@shared/trainingTypes";

const TrainingLogsCtx = createContext<TrainingLogsSlice | null>(null);

export function TrainingLogsProvider({
  value,
  children,
}: {
  value: TrainingLogsSlice;
  children: ReactNode;
}) {
  return (
    <TrainingLogsCtx.Provider value={value}>
      {children}
    </TrainingLogsCtx.Provider>
  );
}

/** Narrow: log lines only. */
export function useTrainingLogs(): TrainingLogsSlice {
  const ctx = useContext(TrainingLogsCtx);
  if (!ctx)
    throw new Error(
      "useTrainingLogs must be used within TrainingLogsProvider",
    );
  return ctx;
}
