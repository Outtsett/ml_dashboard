/**
 * TrainingContext — Universal training state provider.
 *
 * Wraps useUniversalTraining() and provides it app-wide.
 * Works alongside the existing RegimeTrainingContext during migration —
 * consumers can use either context.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useUniversalTraining } from "@/hooks/useUniversalTraining";
import type { UniversalTrainingState, ModelRegistryEntry } from "@shared/trainingTypes";

type TrainingContextValue = UniversalTrainingState & {
  availableModels: Record<string, ModelRegistryEntry>;
  selectedModelType: string;
  setSelectedModelType: (type: string) => void;
  timeframeLabel: string;
};

const TrainingCtx = createContext<TrainingContextValue | null>(null);

export function TrainingProvider({ children }: { children: ReactNode }) {
  const state = useUniversalTraining();
  return (
    <TrainingCtx.Provider value={state}>
      {children}
    </TrainingCtx.Provider>
  );
}

export function useTrainingContext(): TrainingContextValue {
  const ctx = useContext(TrainingCtx);
  if (!ctx) throw new Error("useTrainingContext must be used within TrainingProvider");
  return ctx;
}
