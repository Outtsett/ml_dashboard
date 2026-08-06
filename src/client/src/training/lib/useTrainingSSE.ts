import { useState, useRef, useCallback, useMemo } from 'react';
import { useSSEConnection } from "@/infrastructure/lib/useSSEConnection";
import { useTrainingMetrics } from "@/shared/contexts/TrainingMetricsCtx";
import type {
  StartedPayload,
  ProgressPayload,
  OverlayPayload,
  DonePayload,
  ErrorPayload,
} from "@shared/trainingTypes";

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

/**
 * `training:metric` events arrive in two shapes depending on origin:
 * the primary per-iteration payload (`metrics` + `iteration`) and the
 * `hpo_trial_done`/`fold_done` bridges plus a legacy single-value shape
 * (`type`/`value`). All fields are optional since callers narrow at use.
 */
export interface MetricEventPayload {
  metrics?: Record<string, number>;
  iteration?: number;
  totalIterations?: number;
  type?: string;
  value?: number;
}

/** Full model-state snapshot OR a delta envelope keyed by DELTA_MARKER. */
export type ModelStateEventPayload = Record<string, unknown>;

export interface MetricDeclarationsPayload {
  declarations?: Record<string, unknown>;
}

export interface LogEventPayload {
  message?: string;
  level?: string;
}

/** `hpo_trial_start` bridge payload — only the field actually read. */
export interface HpoTrialStartEventPayload {
  trialNumber?: number;
}

/** `fold_start` bridge payload — only the fields actually read. */
export interface FoldStartEventPayload {
  foldIndex?: number;
  totalFolds?: number;
}

// ── Callback-based API (used by useTraining.ts) ───────────────
export interface TrainingSSECallbacks {
  onStarted(data: StartedPayload): void;
  onProgress(data: ProgressPayload): void;
  onMetric(data: MetricEventPayload): void;
  onOverlay(data: OverlayPayload): void;
  onLog(data: LogEventPayload): void;
  onModelState(data: ModelStateEventPayload): void;
  onMetricDeclarations(data: MetricDeclarationsPayload): void;
  onDone(data: DonePayload): void;
  onError(data: ErrorPayload): void;
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
    started:     (d) => cbRef.current.onStarted(d as StartedPayload),
    progress:    (d) => cbRef.current.onProgress(d as ProgressPayload),
    metric:      (d) => cbRef.current.onMetric(d as MetricEventPayload),
    overlay:     (d) => cbRef.current.onOverlay(d as OverlayPayload),
    log:         (d) => cbRef.current.onLog(d as LogEventPayload),
    model_state:          (d) => cbRef.current.onModelState(d as ModelStateEventPayload),
    metric_declarations:  (d) => cbRef.current.onMetricDeclarations(d as MetricDeclarationsPayload),
    hpo_trial_start:      (d) => cbRef.current.onLog({ message: `HPO trial ${(d as HpoTrialStartEventPayload)?.trialNumber} started`, level: 'info' }),
    hpo_trial_done:       (d) => cbRef.current.onMetric(d as MetricEventPayload),
    fold_start:           (d) => cbRef.current.onLog({ message: `Fold ${(d as FoldStartEventPayload)?.foldIndex}/${(d as FoldStartEventPayload)?.totalFolds} started`, level: 'info' }),
    fold_done:            (d) => cbRef.current.onMetric(d as MetricEventPayload),
    done:                 (d) => cbRef.current.onDone(d as DonePayload),
    error:       (d) => cbRef.current.onError(d as ErrorPayload),
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
