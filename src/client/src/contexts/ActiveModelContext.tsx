import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { TrainingBarContext } from './dashboardTypes';

// ── Context interface ──────────────────────────────────────────────────────

export interface ActiveModelContextType {
  activeModelId: number | null;
  activeModelName: string | null;
  setActiveModel: (id: number | null, name?: string) => void;
  trainingContext: TrainingBarContext | null;
  setTrainingContext: (ctx: TrainingBarContext | null) => void;
  isTraining: boolean;
}

// ── Provider ───────────────────────────────────────────────────────────────

const ActiveModelContext = createContext<ActiveModelContextType | null>(null);

export function ActiveModelProvider({ children }: { children: React.ReactNode }) {
  const [activeModelId, setActiveModelId] = useState<number | null>(null);
  const [activeModelName, setActiveModelName] = useState<string | null>(null);
  const [trainingContext, setTrainingContext] = useState<TrainingBarContext | null>(null);

  const isTraining = trainingContext?.status === 'training';

  const setActiveModel = useCallback((id: number | null, name?: string) => {
    setActiveModelId(id);
    setActiveModelName(name || null);
  }, []);

  const value = useMemo(() => ({
    activeModelId, activeModelName, setActiveModel,
    trainingContext, setTrainingContext, isTraining,
  }), [activeModelId, activeModelName, setActiveModel, trainingContext, isTraining]);

  return <ActiveModelContext.Provider value={value}>{children}</ActiveModelContext.Provider>;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useActiveModelContext(): ActiveModelContextType {
  const ctx = useContext(ActiveModelContext);
  if (!ctx) throw new Error('useActiveModelContext must be used within ActiveModelProvider');
  return ctx;
}
