/**
 * RegimeTrainingContext — App-level provider for HDP-HMM training state.
 *
 * Think of it as: a radio channel that broadcasts training status to every page.
 * The training SSE connection persists across route changes, so you can start
 * training on MarketData, navigate to Training Center to watch metrics,
 * and the logs keep accumulating the whole time.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useRegimeTraining } from "@/components/training/useRegimeTraining";
import type { TrainingState } from "@/components/training/types";

const RegimeTrainingContext = createContext<TrainingState | null>(null);

export function RegimeTrainingProvider({ children }: { children: ReactNode }) {
  const state = useRegimeTraining();
  return (
    <RegimeTrainingContext.Provider value={state}>
      {children}
    </RegimeTrainingContext.Provider>
  );
}

export function useRegimeTrainingContext(): TrainingState {
  const ctx = useContext(RegimeTrainingContext);
  if (!ctx) throw new Error("useRegimeTrainingContext must be used within RegimeTrainingProvider");
  return ctx;
}
