import { useState, useRef, useEffect, useCallback, startTransition } from 'react';
import { logError, logWarn } from '../lib/errorLogger';

export interface SSEConnectionOptions {
  url: string;
  enabled?: boolean;
  /** Handler for default 'message' events (parsed JSON). */
  onMessage?: (data: unknown) => void;
  /** Named event listeners — keys are event types, values are handlers receiving parsed JSON. */
  eventMap?: Record<string, (data: unknown) => void>;
  maxReconnectAttempts?: number;
}

export interface SSEConnectionState {
  connected: boolean;
  error: string | null;
  reconnectAttempt: number;
}

export function backoffDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}

export function useSSEConnection(options: SSEConnectionOptions): SSEConnectionState {
  const { url, enabled = true, onMessage, eventMap, maxReconnectAttempts = 10 } = options;
  const [state, setState] = useState<SSEConnectionState>({
    connected: false, error: null, reconnectAttempt: 0,
  });

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const eventMapRef = useRef(eventMap);
  eventMapRef.current = eventMap;

  const connect = useCallback(() => {
    esRef.current?.close();
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      attemptRef.current = 0;
      startTransition(() => setState({ connected: true, error: null, reconnectAttempt: 0 }));
    };

    es.onmessage = (event) => {
      if (!onMessageRef.current) return;
      try {
        const data = JSON.parse(event.data);
        onMessageRef.current(data);
      } catch (err) {
        logError('useSSEConnection', 'Failed to parse SSE message', {
          url, raw: String(event.data).slice(0, 200), error: String(err),
        });
      }
    };

    const currentMap = eventMapRef.current;
    if (currentMap) {
      for (const [eventType, handler] of Object.entries(currentMap)) {
        es.addEventListener(eventType, ((e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            handler(data);
          } catch (err) {
            logError('useSSEConnection', `Failed to parse SSE event '${eventType}'`, {
              url, raw: String(e.data).slice(0, 200), error: String(err),
            });
          }
        }) as EventListener);
      }
    }

    es.onerror = () => {
      es.close();
      esRef.current = null;
      const attempt = attemptRef.current;

      if (attempt >= maxReconnectAttempts) {
        startTransition(() => setState({
          connected: false,
          error: `SSE connection lost after ${maxReconnectAttempts} attempts`,
          reconnectAttempt: attempt,
        }));
        logError('useSSEConnection', 'Max reconnect attempts reached', { url, attempts: attempt });
        return;
      }

      const delay = backoffDelay(attempt);
      attemptRef.current = attempt + 1;
      startTransition(() => setState({
        connected: false,
        error: `Reconnecting in ${Math.round(delay / 1000)}s...`,
        reconnectAttempt: attempt + 1,
      }));
      logWarn('useSSEConnection', `Reconnecting (attempt ${attempt + 1})`, { url, delay });
      reconnectTimerRef.current = setTimeout(connect, delay);
    };
  }, [url, maxReconnectAttempts]);

  useEffect(() => {
    if (!enabled) {
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      startTransition(() => setState({ connected: false, error: null, reconnectAttempt: 0 }));
      return;
    }
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [enabled, connect]);

  return state;
}
