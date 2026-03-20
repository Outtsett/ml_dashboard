import { useState, useRef, useCallback, useEffect, startTransition } from 'react';
import { RingBuffer } from '../lib/ringBuffer';
import { useSSEConnection } from './useSSEConnection';

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

export interface UseTrainingSSEOptions {
  phase: string;
  model: string;
  enabled?: boolean;
  maxEvents?: number;
  batchIntervalMs?: number;
}

export interface UseTrainingSSEResult {
  events: MetricEvent[];
  connected: boolean;
  error: string | null;
  reconnectAttempt: number;
  clear: () => void;
}

const DEFAULT_MAX_EVENTS = 5000;
const DEFAULT_BATCH_INTERVAL = 50;

export function useTrainingSSE(options: UseTrainingSSEOptions): UseTrainingSSEResult {
  const {
    phase, model, enabled = true,
    maxEvents = DEFAULT_MAX_EVENTS,
    batchIntervalMs = DEFAULT_BATCH_INTERVAL,
  } = options;

  const [events, setEvents] = useState<MetricEvent[]>([]);
  const ringRef = useRef(new RingBuffer<MetricEvent>(maxEvents));
  const batchRef = useRef<MetricEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const batch = batchRef.current;
    if (batch.length === 0) return;
    const ring = ringRef.current;
    for (const event of batch) ring.push(event);
    batchRef.current = [];
    const snapshot = ring.toArray();
    startTransition(() => setEvents(snapshot));
  }, []);

  const handleMessage = useCallback((data: unknown) => {
    batchRef.current.push(data as MetricEvent);
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(flush, batchIntervalMs);
    }
  }, [flush, batchIntervalMs]);

  const url = `/api/training/stream/${encodeURIComponent(phase)}/${encodeURIComponent(model)}`;
  const { connected, error, reconnectAttempt } = useSSEConnection({
    url, enabled, onMessage: handleMessage,
  });

  const clear = useCallback(() => {
    ringRef.current.clear();
    batchRef.current = [];
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    setEvents([]);
  }, []);

  useEffect(() => {
    return () => { if (flushTimerRef.current) clearTimeout(flushTimerRef.current); };
  }, []);

  return { events, connected, error, reconnectAttempt, clear };
}
