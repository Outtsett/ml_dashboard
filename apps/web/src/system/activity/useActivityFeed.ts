/**
 * useActivityFeed — one subscription per SSE channel, one merged feed.
 *
 * The three channels (`pipeline`, `training`, `system`) are routed by disjoint
 * type prefixes server-side, so an event is delivered to exactly one of them and
 * the merge below cannot double-count.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSSEConnection } from '@/infrastructure/lib/useSSEConnection';
import { ACTIVITY_EVENT_TYPES, toEntry, toMetrics } from './normalize';
import type { ActivityEntry, ActivityMetric } from './types';

/** Rows retained in memory. Older rows are dropped from the front. */
const MAX_ENTRIES = 2000;
/** Coalescing window — a busy run emits far faster than a useful frame rate. */
const FLUSH_MS = 120;

type Channel = 'pipeline' | 'training' | 'system';
const CHANNELS: Channel[] = ['pipeline', 'training', 'system'];

export interface ActivityFeed {
  entries: ActivityEntry[];
  metrics: ActivityMetric[];
  connected: boolean;
  /** Count of entries per level, over everything currently retained. */
  counts: Record<string, number>;
  clear: () => void;
}

export function useActivityFeed(enabled: boolean): ActivityFeed {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [metricMap, setMetricMap] = useState<Record<string, ActivityMetric>>({});

  // Events land in a staging buffer and flush on a timer. Without this a
  // training run at a few hundred events/sec drives a setState per event and
  // the rail becomes the most expensive thing on the page.
  const pending = useRef<ActivityEntry[]>([]);
  const pendingMetrics = useRef<Record<string, ActivityMetric>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    flushTimer.current = null;
    const batch = pending.current;
    const metricBatch = pendingMetrics.current;
    pending.current = [];
    pendingMetrics.current = {};

    if (batch.length > 0) {
      setEntries((prev) => {
        const next = prev.concat(batch);
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
      });
    }
    if (Object.keys(metricBatch).length > 0) {
      setMetricMap((prev) => ({ ...prev, ...metricBatch }));
    }
  }, []);

  const ingest = useCallback((type: string, raw: unknown) => {
    const entry = toEntry(type, raw);
    if (entry) pending.current.push(entry);
    for (const m of toMetrics(type, raw)) {
      pendingMetrics.current[m.key] = m;
    }
    if (flushTimer.current === null) {
      flushTimer.current = setTimeout(flush, FLUSH_MS);
    }
  }, [flush]);

  // One handler map, shared by all three connections. Each channel only ever
  // receives the subset of types its prefix matches, so registering the full
  // list on each is harmless and keeps the routing table in one place.
  const eventMap = useMemo(() => {
    const map: Record<string, (data: unknown) => void> = {};
    for (const type of ACTIVITY_EVENT_TYPES) {
      map[type] = (data: unknown) => ingest(type, data);
    }
    return map;
  }, [ingest]);

  // Hooks cannot be called in a loop, so the three channels are explicit.
  const pipeline = useSSEConnection({ url: `/api/events/${CHANNELS[0]}`, enabled, eventMap });
  const training = useSSEConnection({ url: `/api/events/${CHANNELS[1]}`, enabled, eventMap });
  const system   = useSSEConnection({ url: `/api/events/${CHANNELS[2]}`, enabled, eventMap });

  const clear = useCallback(() => {
    pending.current = [];
    setEntries([]);
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { error: 0, warn: 0, success: 0, info: 0 };
    for (const e of entries) c[e.level] = (c[e.level] ?? 0) + 1;
    return c;
  }, [entries]);

  const metrics = useMemo(
    () => Object.values(metricMap).sort((a, b) => a.key.localeCompare(b.key)),
    [metricMap],
  );

  return {
    entries,
    metrics,
    // Any live channel counts as connected — the rail is useful even if one
    // subsystem's stream is down, and showing "offline" then would be a lie.
    connected: pipeline.connected || training.connected || system.connected,
    counts,
    clear,
  };
}
