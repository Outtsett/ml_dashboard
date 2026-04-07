import { useState, useRef, useCallback, useMemo } from 'react';
import { useSSEConnection } from './useSSEConnection';
import { useTrainingMetrics } from '../contexts/TrainingMetricsCtx';

// ── Metric event type (used by Phase panels) ──────────────────
export interface MetricEvent {
  ts: string;
  phase: string;
  model: string;
  metric: string;
  value: number;
  step: number;
  epoch: number;
  fold: number;
}

// ── Callback-based API (used by useTraining.ts) ───────────────
export interface TrainingSSECallbacks {
  onStarted(data: any): void;
  onProgress(data: any): void;
  onMetric(data: any): void;
  onOverlay(data: any): void;
  onLog(data: any): void;
  onModelState(data: any): void;
  onMetricDeclarations(data: any): void;
  onDone(data: any): void;
  onError(data: any): void;
}

export interface UseTrainingSSEResult {
  connect: (modelId: string) => void;
  disconnect: () => void;
  connected: boolean;
  error: string | null;
}

/**
 * Hook that connects to the training SSE stream and dispatches named events
 * (started, progress, metric, overlay, log, done, error) to callbacks.
 *
 * Usage:
 *   const { connect, disconnect } = useTrainingSSE(callbacks);
 *   connect(modelId);   // starts SSE at /api/training/stream/:modelId
 *   disconnect();       // closes the connection
 */
export function useTrainingSSE(callbacks: TrainingSSECallbacks): UseTrainingSSEResult {
  const [modelId, setModelId] = useState<string | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  const eventMap = useMemo<Record<string, (data: unknown) => void>>(() => ({
    started:     (d) => cbRef.current.onStarted(d),
    progress:    (d) => cbRef.current.onProgress(d),
    metric:      (d) => cbRef.current.onMetric(d),
    overlay:     (d) => cbRef.current.onOverlay(d),
    log:         (d) => cbRef.current.onLog(d),
    model_state:          (d) => cbRef.current.onModelState(d),
    metric_declarations:  (d) => cbRef.current.onMetricDeclarations(d),
    hpo_trial_start:      (d) => cbRef.current.onLog({ message: `HPO trial ${(d as any)?.trialNumber} started`, level: 'info' }),
    hpo_trial_done:       (d) => cbRef.current.onMetric(d),
    fold_start:           (d) => cbRef.current.onLog({ message: `Fold ${(d as any)?.foldIndex}/${(d as any)?.totalFolds} started`, level: 'info' }),
    fold_done:            (d) => cbRef.current.onMetric(d),
    done:                 (d) => cbRef.current.onDone(d),
    error:       (d) => cbRef.current.onError(d),
  }), []);

  const url = modelId
    ? `/api/training/stream/${encodeURIComponent(modelId)}`
    : '';

  const { connected, error } = useSSEConnection({
    url,
    enabled: !!modelId,
    eventMap,
  });

  const connect = useCallback((id: string) => setModelId(id), []);
  const disconnect = useCallback(() => setModelId(null), []);

  return { connect, disconnect, connected, error };
}

// ── Event-buffer API (used by Phase panels for metric charts) ─
export interface UseMetricStreamOptions {
  phase: string;
  model: string;
  enabled?: boolean;
  maxEvents?: number;
  batchIntervalMs?: number;
}

export interface UseMetricStreamResult {
  events: MetricEvent[];
  connected: boolean;
  error: string | null;
  clear: () => void;
}

/**
 * Derives MetricEvent[] from the main training SSE stream via context.
 *
 * Phase panels call this to get per-epoch metric data without opening
 * a separate SSE connection. The iterationHistory from TrainingMetricsCtx
 * (populated by the main SSE stream) is transformed into the MetricEvent
 * shape that phase-panel charts expect.
 */
export function useMetricStream(options: UseMetricStreamOptions): UseMetricStreamResult {
  const { phase, model, enabled = true } = options;

  const { iterationHistory } = useTrainingMetrics();

  const events = useMemo<MetricEvent[]>(() => {
    if (!enabled) return [];
    const result: MetricEvent[] = [];
    for (const entry of iterationHistory) {
      for (const [metric, value] of Object.entries(entry.metrics)) {
        result.push({
          ts: '',
          phase,
          model,
          metric,
          value,
          step: entry.iteration,
          epoch: entry.iteration,
          fold: 0,
        });
      }
    }
    return result;
  }, [iterationHistory, phase, model, enabled]);

  const connected = iterationHistory.length > 0 || enabled;
  const clear = useCallback(() => {}, []);

  return { events, connected, error: null, clear };
}
