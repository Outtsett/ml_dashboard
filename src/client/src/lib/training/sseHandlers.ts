/**
 * SSE Event Handlers — Pure state-update functions for training SSE events.
 *
 * Extracted from useTraining.ts (SRP): the hook owns lifecycle + connection,
 * these functions own the state mapping from SSE payloads to React state setters.
 */

import type { TrainingSSECallbacks } from "@/hooks/useTrainingSSE";

export interface TrainingStateSetters {
  setDataRange: (v: { start: string; end: string } | null) => void;
  setTotalBars: (v: number) => void;
  setModelType: (v: string | null) => void;
  setPhase: (v: string) => void;
  setProgress: (v: number) => void;
  setLogs: (updater: (prev: string[]) => string[]) => void;
  setMetrics: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
  setIterationHistory: (updater: (prev: Array<{ iteration: number; metrics: Record<string, number> }>) => Array<{ iteration: number; metrics: Record<string, number> }>) => void;
  setOverlayType: (v: string | null) => void;
  setOverlayData: (v: any) => void;
  setLiveRegimeTimestamps: (v: number[]) => void;
  setLiveRegimeAssignments: (v: number[]) => void;
  setCompletedModelId: (v: string | null) => void;
  setDiagnostics: (v: unknown) => void;
  setElapsedSec: (v: number) => void;
  setError: (v: string | null) => void;
  setIsTraining: (v: boolean) => void;
  clearElapsedTimer: () => void;
  setTrainingContext: (v: any) => void;
  invalidateModels: () => void;
}

export function buildSSECallbacks(s: TrainingStateSetters): TrainingSSECallbacks {
  return {
    onStarted(d) {
      s.setDataRange(d.dateRange ?? null);
      s.setTotalBars(d.totalBars ?? 0);
      s.setModelType(d.modelType);
      s.setTrainingContext({
        dataStart: d.dateRange?.start ?? "",
        dataEnd: d.dateRange?.end ?? "",
        epoch: 0, totalEpochs: 0,
        loss: 0, valLoss: 0, accuracy: 0, valAccuracy: 0,
        status: "training",
        symbol: d.symbol ?? "",
      });
    },
    onProgress(d) {
      s.setPhase(d.phase ?? "");
      s.setProgress(d.pct ?? 0);
      s.setLogs(prev => [...prev.slice(-500), d.message]);
    },
    onMetric(d) {
      if (d.metrics) {
        s.setMetrics(prev => ({ ...prev, ...d.metrics }));
        if (d.iteration != null) {
          s.setIterationHistory(prev => [...prev, { iteration: d.iteration!, metrics: d.metrics! }]);
        }
      }
      if (d.type && d.value != null) {
        s.setMetrics(prev => ({ ...prev, [d.type!]: d.value! }));
      }
    },
    onOverlay(d) {
      s.setOverlayType(d.overlayType);
      s.setOverlayData(d);
      if (d.overlayType === "regime_zones" && Array.isArray(d.timestamps) && Array.isArray(d.assignments)) {
        s.setLiveRegimeTimestamps(d.timestamps.map((t: unknown) => typeof t === 'string' ? Number(t) : t as number));
        s.setLiveRegimeAssignments(d.assignments);
      }
    },
    onLog(d) {
      if (d.message) s.setLogs(prev => [...prev.slice(-500), d.message!]);
    },
    onDone(d) {
      s.setCompletedModelId(d.modelId ?? null);
      s.setDiagnostics(d.diagnostics ?? null);
      s.setElapsedSec(d.elapsedSec ?? 0);
      s.setIsTraining(false);
      s.setPhase("complete");
      s.setProgress(100);
      s.setTrainingContext(null);
      s.clearElapsedTimer();
      s.invalidateModels();
    },
    onError(d) {
      if (d?.message) s.setError(d.message);
      else s.setError("Training error");
      s.setIsTraining(false);
      s.setTrainingContext(null);
      s.clearElapsedTimer();
    },
  };
}
