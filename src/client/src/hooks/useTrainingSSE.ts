import { useEffect, useRef, useState, useCallback } from "react";

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

interface UseTrainingSSEOptions {
  phase: string;
  model: string;
  enabled?: boolean;
  maxEvents?: number;
}

interface UseTrainingSSEResult {
  events: MetricEvent[];
  connected: boolean;
  error: string | null;
  clear: () => void;
}

export function useTrainingSSE({
  phase,
  model,
  enabled = true,
  maxEvents = 5000,
}: UseTrainingSSEOptions): UseTrainingSSEResult {
  const [events, setEvents] = useState<MetricEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const clear = useCallback(() => setEvents([]), []);

  useEffect(() => {
    if (!enabled || !phase || !model) {
      return;
    }

    const url = `/api/training/stream/${phase}/${model}`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.addEventListener("connected", () => {
      setConnected(true);
      setError(null);
    });

    source.addEventListener("metric", (e: MessageEvent) => {
      try {
        const data: MetricEvent = JSON.parse(e.data);
        setEvents((prev) => {
          const next = [...prev, data];
          return next.length > maxEvents ? next.slice(-maxEvents) : next;
        });
      } catch {
        // Ignore malformed events
      }
    });

    source.onerror = () => {
      setConnected(false);
      setError("SSE connection lost");
    };

    return () => {
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [phase, model, enabled, maxEvents]);

  return { events, connected, error, clear };
}
