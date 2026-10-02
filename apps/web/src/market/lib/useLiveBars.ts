/**
 * Subscribe to the forming-bar stream.
 *
 * Frames for the same bar coalesce into one in-progress candle rather than
 * appending, so the chart mutates the current bar in place and commits it when
 * `isClosed` arrives — the animated-candle behaviour, rather than a hard
 * refresh per interval.
 *
 * `origin` is surfaced, not hidden. The stream is live while live_source is
 * running and LiveBridge is writing to `qt_bars_1m`, and a replay of
 * stored history when it is not. Those are indistinguishable once rendered, so
 * any UI built on this must be able to say which it is showing.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSSEConnection } from '@/infrastructure/lib/useSSEConnection';

export interface LiveBar {
  symbol: string;
  timeframe: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  progress: number;
  isClosed: boolean;
  origin: 'replay' | 'live';
}

export interface UseLiveBarsResult {
  /** The bar currently forming, or the last one seen. */
  current: LiveBar | null;
  /** Closed bars, oldest first, capped at `maxClosed`. */
  closed: LiveBar[];
  /** Where the data came from — null until the first frame. */
  origin: 'replay' | 'live' | null;
  connected: boolean;
  error: string | null;
  reset: () => void;
}

const DEFAULT_MAX_CLOSED = 500;

export function useLiveBars(maxClosed = DEFAULT_MAX_CLOSED): UseLiveBarsResult {
  const [current, setCurrent] = useState<LiveBar | null>(null);
  const [closed, setClosed] = useState<LiveBar[]>([]);

  // Guards against a duplicate close frame committing the same bar twice, which
  // a reconnect-and-replay of the last event would otherwise cause.
  const lastClosedTs = useRef<number | null>(null);

  const handleBar = useCallback(
    (raw: unknown) => {
      const envelope = raw as { data?: LiveBar };
      const bar = envelope.data ?? (raw as LiveBar);
      if (!bar || !Number.isFinite(bar.timestamp)) return;

      setCurrent((prev) => {
        // Frames for the same bar merge; extremes only ever widen, matching
        // how a real bar's range behaves within its interval.
        if (prev && prev.timestamp === bar.timestamp) {
          return {
            ...bar,
            open: prev.open,
            high: Math.max(prev.high, bar.high),
            low: Math.min(prev.low, bar.low),
            volume: Math.max(prev.volume, bar.volume),
          };
        }
        return bar;
      });

      if (bar.isClosed && lastClosedTs.current !== bar.timestamp) {
        lastClosedTs.current = bar.timestamp;
        setClosed((prev) => {
          const next = [...prev, bar];
          return next.length > maxClosed ? next.slice(-maxClosed) : next;
        });
      }
    },
    [maxClosed],
  );

  const eventMap = useMemo(() => ({ 'market.bar': handleBar }), [handleBar]);

  // The pipeline channel, not system: the SSE adapter routes the `market.`
  // prefix to `pipeline` (sse-adapter.ts CHANNEL_PATTERNS). Subscribing to
  // `/api/events/system` here would connect successfully and then receive
  // nothing forever, which is indistinguishable from a closed market.
  const { connected, error } = useSSEConnection({
    url: '/api/events/pipeline',
    enabled: true,
    eventMap,
  });

  const reset = useCallback(() => {
    setCurrent(null);
    setClosed([]);
    lastClosedTs.current = null;
  }, []);

  return {
    current,
    closed,
    origin: current?.origin ?? null,
    connected,
    error,
    reset,
  };
}
