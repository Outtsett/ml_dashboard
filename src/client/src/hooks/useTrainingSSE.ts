/**
 * useTrainingSSE — Manages SSE (Server-Sent Events) streaming for training progress.
 *
 * Think of it as: the live ticker feed for a training run. Connects to the
 * server's event stream and fires typed callbacks as each training event
 * (started, progress, metric, overlay, log, done, error) arrives.
 *
 * Owns only the EventSource lifecycle — state management lives in the caller.
 */

import { useRef, useCallback, useEffect } from "react";
import type { OverlayPayload } from "@shared/trainingTypes";

// ─── Event data shapes ──────────────────────────────────────────────────────

export interface SSEStartedData {
  dateRange?: { start: string; end: string };
  totalBars?: number;
  modelType: string;
  symbol?: string;
}

export interface SSEProgressData {
  phase?: string;
  pct?: number;
  message: string;
}

export interface SSEMetricData {
  metrics?: Record<string, number>;
  iteration?: number;
  type?: string;
  value?: number;
}

export interface SSEOverlayData extends OverlayPayload {
  overlayType: string;
  timestamps?: number[];
  assignments?: number[];
}

export interface SSELogData {
  message?: string;
}

export interface SSEDoneData {
  modelId?: string;
  diagnostics?: unknown;
  elapsedSec?: number;
}

export interface SSEErrorData {
  message?: string;
}

// ─── Callback contract ──────────────────────────────────────────────────────

export interface TrainingSSECallbacks {
  onStarted:  (data: SSEStartedData) => void;
  onProgress: (data: SSEProgressData) => void;
  onMetric:   (data: SSEMetricData) => void;
  onOverlay:  (data: SSEOverlayData) => void;
  onLog:      (data: SSELogData) => void;
  onDone:     (data: SSEDoneData) => void;
  onError:    (data: SSEErrorData | null) => void;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useTrainingSSE(callbacks: TrainingSSECallbacks) {
  const eventSourceRef = useRef<EventSource | null>(null);
  // Keep a stable ref to callbacks so the connect function doesn't recreate
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const connect = useCallback((modelId: string) => {
    disconnect();

    const es = new EventSource(`/api/training/stream/${modelId}`);
    eventSourceRef.current = es;

    es.addEventListener("started", (e) => {
      cbRef.current.onStarted(JSON.parse(e.data));
    });

    es.addEventListener("progress", (e) => {
      cbRef.current.onProgress(JSON.parse(e.data));
    });

    es.addEventListener("metric", (e) => {
      cbRef.current.onMetric(JSON.parse(e.data));
    });

    es.addEventListener("overlay", (e) => {
      cbRef.current.onOverlay(JSON.parse(e.data));
    });

    es.addEventListener("log", (e) => {
      cbRef.current.onLog(JSON.parse(e.data));
    });

    es.addEventListener("done", (e) => {
      cbRef.current.onDone(JSON.parse(e.data));
      es.close();
      eventSourceRef.current = null;
    });

    es.addEventListener("error", (e) => {
      if (e instanceof MessageEvent) {
        // Server sent a training error event — training failed, close stream
        cbRef.current.onError(JSON.parse(e.data));
        es.close();
        eventSourceRef.current = null;
      }
      // Native connection errors: let EventSource auto-reconnect (don't close)
    });

    // caught_up — all buffered events replayed (no-op)
    es.addEventListener("caught_up", () => {});

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        eventSourceRef.current = null;
      }
    };
  }, [disconnect]);

  // Cleanup on unmount
  useEffect(() => disconnect, [disconnect]);

  return { connect, disconnect };
}
