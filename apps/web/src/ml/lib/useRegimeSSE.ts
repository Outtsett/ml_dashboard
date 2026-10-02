/**
 * useRegimeSSE — ReadableStream-based SSE consumer for regime training progress.
 *
 * Think of it as: a live telemetry receiver for the regime training pipeline.
 * Connects to the server's training stream, reads raw bytes, slices them into
 * SSE frames (event: + data:), parses JSON, and fires typed callbacks for each
 * event type. The caller owns state — this hook owns only the stream lifecycle.
 *
 * Unlike useTrainingSSE (which uses native EventSource), the regime training
 * API uses fetch + ReadableStream so it can be aborted via AbortController.
 */

import { useRef, useCallback, useEffect } from "react";
import type { TrainingProgress } from "@/ml/components/regime-analytics/types";

// ─── Event data shapes ──────────────────────────────────────────────────────

export type RegimeSSEProgressData = TrainingProgress;

export interface RegimeSSEGibbsData {
  iteration: number;
  totalIterations: number;
  logLikelihood: number;
  activeStates: number;
  delta: number;
  fitPerBar?: number;
  entropy?: number;
  switchRate?: number;
  selfTransition?: number;
  maxRegimePct?: number;
  avgDwell?: number;
}

export interface RegimeSSEMetricData {
  type: string;
  value: number;
}

export interface RegimeSSEDoneData {
  modelId: string;
  elapsed: string;
  diagnostics?: Record<string, unknown>;
}

export interface RegimeSSEErrorData {
  message: string;
  details?: string;
}

// ─── Callback contract ──────────────────────────────────────────────────────

export interface RegimeSSECallbacks {
  onProgress:         (data: RegimeSSEProgressData) => void;
  onGibbsProgress:    (data: RegimeSSEGibbsData, nBarsTotal: number) => void;
  onMetric:           (data: RegimeSSEMetricData) => void;
  onStatus:           (data: { message?: string; phase?: string }) => void;
  onLog:              (data: { message: string }) => void;
  onRegimeLine:       (data: { text: string }) => void;
  onRegimeTimestamps: (data: { timestamps: number[] }) => void;
  onRegimeSnapshot:   (data: { assignments: number[] }) => void;
  onDone:             (data: RegimeSSEDoneData) => void;
  onError:            (data: RegimeSSEErrorData) => void;
  onWarning:          (data: { message: string }) => void;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useRegimeSSE(callbacks: RegimeSSECallbacks) {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const nBarsRef = useRef(0);

  /**
   * Connect to a regime training SSE stream via fetch + ReadableStream.
   * Returns when the stream ends or the signal is aborted.
   */
  const consumeStream = useCallback(async (modelId: string, signal: AbortSignal) => {
    nBarsRef.current = 0;

    const streamRes = await fetch(`/api/training/stream/${modelId}`, { signal });
    if (!streamRes.ok || !streamRes.body) {
      throw new Error("Failed to connect to training stream");
    }

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventName = line.slice(7).trim();
        } else if (line.startsWith("data: ") && eventName) {
          try {
            const data = JSON.parse(line.slice(6));
            dispatchEvent(cbRef.current, eventName, data, nBarsRef);
          } catch {
            // Skip malformed JSON
          }
          eventName = "";
        }
      }
    }
  }, []);

  // Cleanup nothing on unmount — the AbortController in the caller handles lifecycle
  useEffect(() => {}, []);

  return { consumeStream };
}

// ─── Event dispatcher (pure function) ──────────────────────────────────────

// The stream carries no schema beyond `event:`/`data:` framing — each frame's
// JSON payload is asserted to the shape its own event name promises (the SSE
// protocol contract this hook was written against), the same way the rest of
// the codebase's stdout/SSE parsers trust their event-name-to-shape mapping.
function dispatchEvent(
  cb: RegimeSSECallbacks,
  event: string,
  data: unknown,
  nBarsRef: React.MutableRefObject<number>,
) {
  switch (event) {
    case "progress":
      cb.onProgress(data as RegimeSSEProgressData);
      break;
    case "gibbs_progress":
      cb.onGibbsProgress(data as RegimeSSEGibbsData, nBarsRef.current);
      break;
    case "metric": {
      const metricData = data as RegimeSSEMetricData;
      if (metricData.type === "data_size") {
        nBarsRef.current = metricData.value;
      }
      cb.onMetric(metricData);
      break;
    }
    case "status":
      cb.onStatus(data as { message?: string; phase?: string });
      break;
    case "log":
      cb.onLog(data as { message: string });
      break;
    case "regime_line":
      cb.onRegimeLine(data as { text: string });
      break;
    case "regime_timestamps":
      cb.onRegimeTimestamps(data as { timestamps: number[] });
      break;
    case "regime_snapshot":
      cb.onRegimeSnapshot(data as { assignments: number[] });
      break;
    case "done":
      cb.onDone(data as RegimeSSEDoneData);
      break;
    case "error":
      cb.onError(data as RegimeSSEErrorData);
      break;
    case "warning":
      cb.onWarning(data as { message: string });
      break;
    case "caught_up":
      break; // no-op
  }
}
