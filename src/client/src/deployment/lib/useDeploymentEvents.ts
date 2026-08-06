/**
 * useDeploymentEvents — W7.f
 *
 * Subscribes to the `/api/events/deployments` SSE channel (built in W7.d on the
 * backend) and aggregates per-deployment live state for <DeploymentLiveMetrics>.
 *
 * Per the W7 risk row in the plan: an EventSource that isn't closed on unmount
 * leaks a long-lived TCP socket every time the user opens a second window or
 * navigates between stages. The hook is engineered so that:
 *
 *   - exactly one EventSource exists per mounted hook instance (kept in a ref,
 *     never in state, so re-renders don't churn the connection)
 *   - the cleanup function in useEffect ALWAYS calls .close() on the
 *     EventSource and clears any in-flight reconnect timer
 *   - exponential backoff (1s → 2s → 4s → 8s → 16s → 30s) on connection error,
 *     reset to 0 on a successful (re)open
 *   - all state writes are wrapped in startTransition so high-frequency
 *     `prediction` events never block input/animation frames
 *
 * Server emits the following named SSE events (see `eventsDeployments.ts` —
 * W7.d). Event names use the canonical `deployment.*` namespace from
 * `src/shared/event-types.ts`. SSE payload is the FULL DomainEvent envelope:
 * `{ type, data, metadata }` — handlers below dig into `evt.data`.
 *
 *   deployment.started     data: { deployment_id, version_id, mode, symbol, timeframe, started_at }
 *   deployment.prediction  data: { deployment_id, ts, prediction, confidence,
 *                                  paper_pnl_delta?, paper_pnl_total? }
 *   deployment.pnl_update  data: { deployment_id, paper_pnl_total,
 *                                  predictions_emitted, last_prediction_at }
 *   deployment.paused      data: { deployment_id, paused_at }
 *   deployment.resumed     data: { deployment_id, resumed_at }
 *   deployment.stopped     data: { deployment_id, stopped_at, reason? }
 *   deployment.failed      data: { deployment_id, failed_at, error }
 *   heartbeat              data: { ts }                ← liveness ping; not aggregated
 *   connected              data: { channel, deployment_id, server_time }  ← initial handshake
 *
 * predPerMin is computed from a per-deployment ring of prediction timestamps,
 * filtered to the last 60 seconds on every read. The ring is bounded at 600
 * entries (10 pred/sec for 60s — far above any realistic 1-bar/1m strategy
 * cadence) so memory cannot grow unboundedly even under server misbehaviour.
 */

import { useEffect, useRef, useState, useCallback, startTransition } from 'react';
import { logError, logWarn } from "@/infrastructure/lib/error_logger";

// ── Public types ────────────────────────────────────────────────────────────

export type DeploymentRunStatus = 'running' | 'paused' | 'stopped' | 'failed';

export interface DeploymentEventState {
  lastPrediction: { ts: string; prediction: number | string; confidence: number } | null;
  paperPnlTotal: number | null;
  predictionsEmitted: number;
  /** Predictions per minute (rolling 60s window). */
  predPerMin: number;
  predDriftPsi: number | null;
  status: DeploymentRunStatus;
  lastError?: string;
  /** Last server-emitted ts (heartbeat or event), as ISO. Surface for "stale" UX. */
  lastEventTs: string | null;
}

export interface DeploymentEventsState {
  byDeployment: Record<number, DeploymentEventState>;
  connected: boolean;
  /** 0 while connected; increments per backoff cycle; resets on successful open. */
  reconnectAttempt: number;
}

// ── Wire types (what the server actually sends) ─────────────────────────────
// The server sends the full DomainEvent envelope `{ type, data, metadata }`.
// We narrow on the `data` shape per event variant. Field names are snake_case
// to match `src/shared/event-types.ts` (DeploymentEvent variants).

interface DomainEnvelope<D> {
  type: string;
  data: D;
  metadata?: { correlationId?: string; causationId?: string; timestamp?: number };
}
interface DeploymentStartedData {
  deployment_id: number;
  version_id?: number;
  mode?: string;
  symbol?: string;
  timeframe?: string;
  started_at?: string;
}
interface PredictionData {
  deployment_id: number;
  ts: string;
  prediction: number | string;
  confidence: number;
  paper_pnl_delta?: number;
  paper_pnl_total?: number;
}
interface PnlUpdateData {
  deployment_id: number;
  paper_pnl_total?: number;
  predictions_emitted?: number;
  last_prediction_at?: string;
  /** Optional drift signal — not part of DeploymentEvent today, future-proof. */
  pred_drift_psi?: number | null;
}
interface DeploymentStateChangeData {
  deployment_id: number;
  paused_at?: string;
  resumed_at?: string;
  stopped_at?: string;
  reason?: string;
}
interface DeploymentFailedData {
  deployment_id: number;
  failed_at?: string;
  error?: string;
}
interface HeartbeatData {
  ts: string;
}

const DEPLOYMENTS_SSE_URL = '/api/events/deployments';
const PRED_RING_MAX = 600;
const PRED_WINDOW_MS = 60_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_FACTOR = 2;

// Per-deployment mutable scratch. Lives in a ref so we don't allocate a new
// Map and copy 1000 prediction timestamps every event.
interface DeploymentScratch {
  state: DeploymentEventState;
  /** Monotonic ring of prediction event ms-epoch timestamps. */
  predTimestamps: number[];
}

function emptyState(): DeploymentEventState {
  return {
    lastPrediction: null,
    paperPnlTotal: null,
    predictionsEmitted: 0,
    predPerMin: 0,
    predDriftPsi: null,
    status: 'running',
    lastEventTs: null,
  };
}

function computePredPerMin(timestamps: number[], nowMs: number): number {
  // Drop anything older than the window in-place to amortize the cost.
  const cutoff = nowMs - PRED_WINDOW_MS;
  // timestamps is monotonic-non-decreasing, so a single splice from the head
  // is O(k) where k = number expired since last call.
  let firstFresh = 0;
  while (firstFresh < timestamps.length && timestamps[firstFresh]! < cutoff) {
    firstFresh++;
  }
  if (firstFresh > 0) timestamps.splice(0, firstFresh);
  return timestamps.length;
}

/**
 * Test seam — allows the unit test to inject a fake EventSource constructor
 * without monkey-patching the global. Production callers pass nothing.
 */
export interface UseDeploymentEventsOptions {
  /** Override the EventSource ctor (test seam). */
  eventSourceCtor?: typeof EventSource;
  /** Override the URL (test seam / future multi-tenant). */
  url?: string;
  /** When false, the hook tears down any existing connection and stays disconnected. */
  enabled?: boolean;
}

export function useDeploymentEvents(
  options: UseDeploymentEventsOptions = {},
): DeploymentEventsState {
  const {
    eventSourceCtor,
    url = DEPLOYMENTS_SSE_URL,
    enabled = true,
  } = options;

  const [snapshot, setSnapshot] = useState<DeploymentEventsState>({
    byDeployment: {},
    connected: false,
    reconnectAttempt: 0,
  });

  // Per-deployment mutable scratch — never put into React state.
  const scratchRef = useRef<Map<number, DeploymentScratch>>(new Map());
  // The single EventSource for this hook instance. Never in state.
  const esRef = useRef<EventSource | null>(null);
  // In-flight reconnect timer; cleared on cleanup.
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Backoff attempt count (mirrors snapshot.reconnectAttempt but available
  // synchronously inside the onerror handler before setState flushes).
  const attemptRef = useRef(0);
  // Mount guard — we don't call setState after unmount.
  const mountedRef = useRef(true);

  // Recompute the public snapshot from scratch + connection state.
  // Called after any event mutates a deployment, after open/error, and
  // periodically (250ms) so predPerMin decays even when no events arrive.
  const publishSnapshot = useCallback(
    (overrides?: Partial<Pick<DeploymentEventsState, 'connected' | 'reconnectAttempt'>>) => {
      if (!mountedRef.current) return;
      const now = Date.now();
      const byDeployment: Record<number, DeploymentEventState> = {};
      for (const [id, scratch] of scratchRef.current) {
        scratch.state = {
          ...scratch.state,
          predPerMin: computePredPerMin(scratch.predTimestamps, now),
        };
        byDeployment[id] = scratch.state;
      }
      startTransition(() => {
        setSnapshot((prev) => ({
          byDeployment,
          connected: overrides?.connected ?? prev.connected,
          reconnectAttempt: overrides?.reconnectAttempt ?? prev.reconnectAttempt,
        }));
      });
    },
    [],
  );

  // ── Event handlers ────────────────────────────────────────────────────────

  const ensureScratch = useCallback((id: number): DeploymentScratch => {
    let s = scratchRef.current.get(id);
    if (!s) {
      s = { state: emptyState(), predTimestamps: [] };
      scratchRef.current.set(id, s);
    }
    return s;
  }, []);

  const handleStarted = useCallback((data: DeploymentStartedData) => {
    const s = ensureScratch(data.deployment_id);
    s.state = {
      ...s.state,
      status: 'running',
      lastError: undefined,
      lastEventTs: data.started_at ?? new Date().toISOString(),
    };
    publishSnapshot();
  }, [ensureScratch, publishSnapshot]);

  const handlePrediction = useCallback((data: PredictionData) => {
    const s = ensureScratch(data.deployment_id);
    const tsMs = Date.parse(data.ts);
    if (Number.isFinite(tsMs)) {
      s.predTimestamps.push(tsMs);
      // Bound the ring even under server misbehaviour.
      if (s.predTimestamps.length > PRED_RING_MAX) {
        s.predTimestamps.splice(0, s.predTimestamps.length - PRED_RING_MAX);
      }
    }
    s.state = {
      ...s.state,
      lastPrediction: {
        ts: data.ts,
        prediction: data.prediction,
        confidence: data.confidence,
      },
      // Per-prediction PnL is piggybacked on the prediction event so the UI
      // updates the running total without waiting for the throttled pnl_update.
      paperPnlTotal:
        typeof data.paper_pnl_total === 'number'
          ? data.paper_pnl_total
          : s.state.paperPnlTotal,
      predictionsEmitted: s.state.predictionsEmitted + 1,
      lastEventTs: data.ts,
    };
    publishSnapshot();
  }, [ensureScratch, publishSnapshot]);

  const handlePnlUpdate = useCallback((data: PnlUpdateData) => {
    const s = ensureScratch(data.deployment_id);
    s.state = {
      ...s.state,
      paperPnlTotal:
        typeof data.paper_pnl_total === 'number' ? data.paper_pnl_total : s.state.paperPnlTotal,
      predictionsEmitted:
        typeof data.predictions_emitted === 'number'
          ? data.predictions_emitted
          : s.state.predictionsEmitted,
      predDriftPsi:
        data.pred_drift_psi === null
          ? null
          : typeof data.pred_drift_psi === 'number'
            ? data.pred_drift_psi
            : s.state.predDriftPsi,
      lastEventTs: data.last_prediction_at ?? new Date().toISOString(),
    };
    publishSnapshot();
  }, [ensureScratch, publishSnapshot]);

  const handleStatusChange = useCallback(
    (status: DeploymentRunStatus) => (data: DeploymentStateChangeData) => {
      const s = ensureScratch(data.deployment_id);
      const tsField =
        data.paused_at ?? data.resumed_at ?? data.stopped_at ?? new Date().toISOString();
      s.state = {
        ...s.state,
        status,
        lastEventTs: tsField,
      };
      publishSnapshot();
    },
    [ensureScratch, publishSnapshot],
  );

  const handleFailed = useCallback((data: DeploymentFailedData) => {
    const s = ensureScratch(data.deployment_id);
    s.state = {
      ...s.state,
      status: 'failed',
      lastError: data.error,
      lastEventTs: data.failed_at ?? new Date().toISOString(),
    };
    publishSnapshot();
  }, [ensureScratch, publishSnapshot]);

  const handleHeartbeat = useCallback((_data: HeartbeatData) => {
    // Only used to drive the rolling-window decay of predPerMin so the UI
    // doesn't show "30 pred/min" forever after the upstream goes silent.
    void _data;
    publishSnapshot();
  }, [publishSnapshot]);

  // ── Connect / disconnect lifecycle ────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      // Disabled mode: tear down + show disconnected.
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      attemptRef.current = 0;
      startTransition(() => {
        setSnapshot((prev) => ({ ...prev, connected: false, reconnectAttempt: 0 }));
      });
      return () => {
        mountedRef.current = false;
      };
    }

    const Ctor = eventSourceCtor ?? (typeof EventSource !== 'undefined' ? EventSource : undefined);
    if (!Ctor) {
      // SSR / non-browser env: render disconnected and bail.
      logWarn('useDeploymentEvents', 'EventSource not available; staying disconnected', { url });
      return () => {
        mountedRef.current = false;
      };
    }

    const connect = () => {
      // Defensive: close any stale connection before opening a new one.
      esRef.current?.close();

      let es: EventSource;
      try {
        es = new Ctor(url);
      } catch (err) {
        logError('useDeploymentEvents', 'EventSource constructor threw', {
          url, error: String(err),
        });
        return;
      }
      esRef.current = es;

      es.onopen = () => {
        attemptRef.current = 0;
        publishSnapshot({ connected: true, reconnectAttempt: 0 });
      };

      // Server wire format: `event: <type>\ndata: {type, data, metadata}\n\n`.
      // We unwrap `.data` before forwarding to handlers. Heartbeat is the one
      // exception — server emits `event: heartbeat\ndata: {ts}` directly.
      const wireEnveloped = <D,>(eventName: string, handler: (d: D) => void) => {
        es.addEventListener(eventName, ((evt: MessageEvent) => {
          try {
            const parsed = JSON.parse(evt.data) as DomainEnvelope<D> | D;
            // Distinguish envelope vs raw: envelope has `type` AND `data`.
            const inner =
              parsed && typeof parsed === 'object' && 'data' in (parsed as object)
                ? (parsed as DomainEnvelope<D>).data
                : (parsed as D);
            handler(inner);
          } catch (err) {
            logError('useDeploymentEvents', `Parse failure for '${eventName}'`, {
              raw: String(evt.data).slice(0, 200), error: String(err),
            });
          }
        }) as EventListener);
      };

      wireEnveloped<DeploymentStartedData>('deployment.started', handleStarted);
      wireEnveloped<PredictionData>('deployment.prediction', handlePrediction);
      wireEnveloped<PnlUpdateData>('deployment.pnl_update', handlePnlUpdate);
      wireEnveloped<DeploymentStateChangeData>('deployment.paused', handleStatusChange('paused'));
      wireEnveloped<DeploymentStateChangeData>('deployment.resumed', handleStatusChange('running'));
      wireEnveloped<DeploymentStateChangeData>('deployment.stopped', handleStatusChange('stopped'));
      wireEnveloped<DeploymentFailedData>('deployment.failed', handleFailed);
      // Heartbeat is raw (no envelope) — server emits `data: {ts}` directly.
      wireEnveloped<HeartbeatData>('heartbeat', handleHeartbeat);

      es.onerror = () => {
        // EventSource auto-reconnects on its own, but it doesn't apply
        // exponential backoff — and on hard 5xx loops it can spin so we
        // close + manually reschedule. Closing is also required on unmount
        // (cleanup function below) per the W7 risk row.
        es.close();
        if (esRef.current === es) esRef.current = null;

        const attempt = attemptRef.current;
        const delay = Math.min(BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, attempt), BACKOFF_MAX_MS);
        attemptRef.current = attempt + 1;

        publishSnapshot({ connected: false, reconnectAttempt: attempt + 1 });
        logWarn('useDeploymentEvents', `SSE error; reconnect in ${delay}ms`, {
          attempt: attempt + 1, url,
        });

        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, delay);
      };
    };

    connect();

    return () => {
      mountedRef.current = false;
      // Cleanup on unmount — non-negotiable per the W7 risk row.
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    };
  }, [
    enabled,
    eventSourceCtor,
    url,
    handleStarted,
    handlePrediction,
    handlePnlUpdate,
    handleStatusChange,
    handleFailed,
    handleHeartbeat,
    publishSnapshot,
  ]);

  return snapshot;
}
