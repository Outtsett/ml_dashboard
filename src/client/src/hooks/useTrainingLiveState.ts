/**
 * useTrainingLiveState — Live training data state.
 *
 * Owns the fast-changing state that updates on every SSE event:
 * metrics, logs, overlays, iteration history, elapsed time.
 *
 * Separated from useTraining (SRP) so that session lifecycle
 * (start/stop/pending) doesn't share a hook with per-iteration updates.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { OverlayPayload, ModelStatePayload } from "@shared/trainingTypes";

export interface TrainingLiveState {
  // Live data
  logs: string[];
  metrics: Record<string, number>;
  iterationHistory: Array<{ iteration: number; metrics: Record<string, number> }>;
  overlayType: string | null;
  overlayData: OverlayPayload | null;
  liveRegimeTimestamps: number[];
  liveRegimeAssignments: number[];
  diagnostics: unknown | null;
  /** Self-describing metric declarations emitted at training start (renderer hints) */
  metricDeclarations: Record<string, unknown> | null;
  elapsedSec: number;

  // Model state snapshots (every 25-50 iterations)
  modelState: ModelStatePayload | null;
  modelStateHistory: Array<{ iteration: number; state: ModelStatePayload }>;

  // Chart alignment
  dataRange: { start: string; end: string } | null;
  totalBars: number;
}

export interface TrainingLiveSetters {
  setLogs: React.Dispatch<React.SetStateAction<string[]>>;
  setMetrics: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setIterationHistory: React.Dispatch<React.SetStateAction<Array<{ iteration: number; metrics: Record<string, number> }>>>;
  setOverlayType: React.Dispatch<React.SetStateAction<string | null>>;
  setOverlayData: React.Dispatch<React.SetStateAction<OverlayPayload | null>>;
  setLiveRegimeTimestamps: React.Dispatch<React.SetStateAction<number[]>>;
  setLiveRegimeAssignments: React.Dispatch<React.SetStateAction<number[]>>;
  setDiagnostics: React.Dispatch<React.SetStateAction<unknown | null>>;
  setMetricDeclarations: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>;
  setElapsedSec: React.Dispatch<React.SetStateAction<number>>;
  setModelState: React.Dispatch<React.SetStateAction<ModelStatePayload | null>>;
  setModelStateHistory: React.Dispatch<React.SetStateAction<Array<{ iteration: number; state: ModelStatePayload }>>>;
  setDataRange: React.Dispatch<React.SetStateAction<{ start: string; end: string } | null>>;
  setTotalBars: React.Dispatch<React.SetStateAction<number>>;
}

export function useTrainingLiveState() {
  const [logs, setLogs] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [iterationHistory, setIterationHistory] = useState<Array<{ iteration: number; metrics: Record<string, number> }>>([]);
  const [overlayType, setOverlayType] = useState<string | null>(null);
  const [overlayData, setOverlayData] = useState<OverlayPayload | null>(null);
  const [liveRegimeTimestamps, setLiveRegimeTimestamps] = useState<number[]>([]);
  const [liveRegimeAssignments, setLiveRegimeAssignments] = useState<number[]>([]);
  const [diagnostics, setDiagnostics] = useState<unknown | null>(null);
  const [metricDeclarations, setMetricDeclarations] = useState<Record<string, unknown> | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [modelState, setModelState] = useState<ModelStatePayload | null>(null);
  const [modelStateHistory, setModelStateHistory] = useState<Array<{ iteration: number; state: ModelStatePayload }>>([]);
  const [dataRange, setDataRange] = useState<{ start: string; end: string } | null>(null);
  const [totalBars, setTotalBars] = useState(0);

  // Elapsed timer management
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const clearElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const startElapsedTimer = useCallback(() => {
    clearElapsedTimer();
    startTimeRef.current = Date.now();
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSec((Date.now() - startTimeRef.current) / 1000);
    }, 1000);
  }, [clearElapsedTimer]);

  /** Reset all live state for a new training run. */
  const resetLiveState = useCallback(() => {
    setLogs([]);
    setMetrics({});
    setIterationHistory([]);
    setOverlayData(null);
    setOverlayType(null);
    setLiveRegimeTimestamps([]);
    setLiveRegimeAssignments([]);
    setDiagnostics(null);
    setMetricDeclarations(null);
    setModelState(null);
    setModelStateHistory([]);
    setDataRange(null);
    setTotalBars(0);
    setElapsedSec(0);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => clearElapsedTimer();
  }, [clearElapsedTimer]);

  const state: TrainingLiveState = {
    logs, metrics, iterationHistory,
    overlayType, overlayData,
    liveRegimeTimestamps, liveRegimeAssignments,
    diagnostics, metricDeclarations, elapsedSec,
    modelState, modelStateHistory,
    dataRange, totalBars,
  };

  const setters: TrainingLiveSetters = {
    setLogs, setMetrics, setIterationHistory,
    setOverlayType, setOverlayData,
    setLiveRegimeTimestamps, setLiveRegimeAssignments,
    setDiagnostics, setMetricDeclarations, setElapsedSec,
    setModelState, setModelStateHistory,
    setDataRange, setTotalBars,
  };

  return {
    state,
    setters,
    resetLiveState,
    startElapsedTimer,
    clearElapsedTimer,
  };
}
