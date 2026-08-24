/**
 * TrainingOverlaysCtx — Chart overlays + session metadata.
 *
 * Sub-slice of TrainingLive. Components that render overlays, regime data,
 * or session-level metadata (elapsedSec, totalBars, dataRange, diagnostics)
 * subscribe here instead of the full TrainingLive context.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { TrainingOverlaysSlice } from "@shared/trainingTypes";

const TrainingOverlaysCtx = createContext<TrainingOverlaysSlice | null>(null);

export function TrainingOverlaysProvider({
  value,
  children,
}: {
  value: TrainingOverlaysSlice;
  children: ReactNode;
}) {
  return (
    <TrainingOverlaysCtx.Provider value={value}>
      {children}
    </TrainingOverlaysCtx.Provider>
  );
}

/** Narrow: overlays + session metadata (regime data, elapsed, totalBars, dataRange, diagnostics). */
export function useTrainingOverlays(): TrainingOverlaysSlice {
  const ctx = useContext(TrainingOverlaysCtx);
  if (!ctx)
    throw new Error(
      "useTrainingOverlays must be used within TrainingOverlaysProvider",
    );
  return ctx;
}
