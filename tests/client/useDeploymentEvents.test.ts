// @vitest-environment jsdom
/**
 * W7.f — useDeploymentEvents unit tests.
 *
 * Drives the hook end-to-end against a minimal fake EventSource that exposes
 * the same dispatch shape (addEventListener('deployment.started', ...)) the
 * real browser EventSource does. We assert:
 *
 *   1. open → connected: true
 *   2. prediction events update lastPrediction + predictionsEmitted + predPerMin
 *   3. pnl_update propagates paperPnlTotal + predDriftPsi (incl. null)
 *   4. paused / resumed / stopped / failed flip status correctly
 *   5. failed carries error string
 *   6. on connection error: connected becomes false, reconnect scheduled with
 *      exponential backoff (1s → 2s → 4s)
 *   7. successful reopen resets reconnectAttempt to 0
 *   8. unmount calls .close() on the EventSource (the W7 risk row)
 *   9. predPerMin computes from a 60s rolling window (events older than 60s
 *      are evicted on the next read)
 */

import './setup';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useDeploymentEvents } from '../../src/client/src/deployment/lib/useDeploymentEvents';

// ── Fake EventSource ───────────────────────────────────────────────────────

type Handler = (evt: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  url: string;
  readyState: number = 0; // 0 connecting, 1 open, 2 closed
  closed = false;

  private handlers = new Map<string, Set<Handler>>();
  onopen: ((this: EventSource, ev: Event) => void) | null = null;
  onerror: ((this: EventSource, ev: Event) => void) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: EventListener): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler as unknown as Handler);
  }

  removeEventListener(type: string, handler: EventListener): void {
    this.handlers.get(type)?.delete(handler as unknown as Handler);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  // ── Test helpers ─────────────────────────────────────────────────────────

  fireOpen(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  fireError(): void {
    this.onerror?.(new Event('error'));
  }

  emit(eventName: string, payload: unknown): void {
    const handlers = this.handlers.get(eventName);
    if (!handlers) return;
    const evt = new MessageEvent(eventName, { data: JSON.stringify(payload) });
    for (const h of handlers) h(evt);
  }
}

const FakeESCtor = FakeEventSource as unknown as typeof EventSource;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useDeploymentEvents — connection lifecycle', () => {
  it('opens an EventSource on mount and reports connected after open', () => {
    const { result } = renderHook(() =>
      useDeploymentEvents({ eventSourceCtor: FakeESCtor }),
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0]!;
    expect(es.url).toBe('/api/events/deployments');
    expect(result.current.connected).toBe(false);

    act(() => {
      es.fireOpen();
    });
    expect(result.current.connected).toBe(true);
    expect(result.current.reconnectAttempt).toBe(0);
  });

  it('closes the EventSource on unmount (W7 risk: no leaks)', () => {
    const { unmount } = renderHook(() =>
      useDeploymentEvents({ eventSourceCtor: FakeESCtor }),
    );
    const es = FakeEventSource.instances[0]!;
    expect(es.closed).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });

  it('schedules exponential-backoff reconnects on error: 1s, 2s, 4s', () => {
    renderHook(() => useDeploymentEvents({ eventSourceCtor: FakeESCtor }));
    const first = FakeEventSource.instances[0]!;
    act(() => first.fireOpen());

    // 1st failure → expect a new EventSource ~1000ms later
    act(() => first.fireError());
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeEventSource.instances).toHaveLength(2);

    // 2nd failure (no successful open in between) → ~2000ms
    const second = FakeEventSource.instances[1]!;
    act(() => second.fireError());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(FakeEventSource.instances).toHaveLength(3);

    // 3rd failure → ~4000ms
    const third = FakeEventSource.instances[2]!;
    act(() => third.fireError());
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it('resets the reconnect counter to 0 on a successful reopen', () => {
    const { result } = renderHook(() =>
      useDeploymentEvents({ eventSourceCtor: FakeESCtor }),
    );
    const first = FakeEventSource.instances[0]!;
    act(() => first.fireOpen());

    act(() => first.fireError());
    expect(result.current.reconnectAttempt).toBe(1);
    expect(result.current.connected).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const second = FakeEventSource.instances[1]!;
    act(() => second.fireOpen());

    expect(result.current.connected).toBe(true);
    expect(result.current.reconnectAttempt).toBe(0);
  });

  it('disabled=false tears down the connection without scheduling a reconnect', () => {
    const { result, rerender } = renderHook(
      (enabled: boolean) =>
        useDeploymentEvents({ eventSourceCtor: FakeESCtor, enabled }),
      { initialProps: true },
    );
    const es = FakeEventSource.instances[0]!;
    act(() => es.fireOpen());
    expect(result.current.connected).toBe(true);

    rerender(false);
    expect(es.closed).toBe(true);
    expect(result.current.connected).toBe(false);
    expect(result.current.reconnectAttempt).toBe(0);
  });
});

describe('useDeploymentEvents — event aggregation', () => {
  it('aggregates prediction events per deployment id', () => {
    const { result } = renderHook(() =>
      useDeploymentEvents({ eventSourceCtor: FakeESCtor }),
    );
    const es = FakeEventSource.instances[0]!;
    act(() => es.fireOpen());

    act(() => {
      es.emit('deployment.started', {
        deployment_id: 4,
        version_id: 1,
        mode: 'paper',
        symbol: 'MNQ',
        timeframe: '1m',
        started_at: '2026-05-10T11:59:59.000Z',
      });
      es.emit('deployment.prediction', {
        deployment_id: 4,
        ts: '2026-05-10T12:00:00.000Z',
        prediction: 1,
        confidence: 0.62,
      });
      es.emit('deployment.prediction', {
        deployment_id: 4,
        ts: '2026-05-10T12:00:01.000Z',
        prediction: -1,
        confidence: 0.71,
      });
    });

    const dep = result.current.byDeployment[4]!;
    expect(dep).toBeDefined();
    expect(dep.predictionsEmitted).toBe(2);
    expect(dep.lastPrediction).toEqual({
      ts: '2026-05-10T12:00:01.000Z',
      prediction: -1,
      confidence: 0.71,
    });
    expect(dep.status).toBe('running');
  });

  it('updates paperPnlTotal and predDriftPsi from pnl_update', () => {
    const { result } = renderHook(() =>
      useDeploymentEvents({ eventSourceCtor: FakeESCtor }),
    );
    const es = FakeEventSource.instances[0]!;
    act(() => es.fireOpen());

    act(() => {
      es.emit('deployment.pnl_update', {
        deployment_id: 7,
        paper_pnl_total: 432.5,
        predictions_emitted: 3,
        last_prediction_at: '2026-05-10T12:00:01.000Z',
        pred_drift_psi: 0.12,
      });
    });
    expect(result.current.byDeployment[7]!.paperPnlTotal).toBe(432.5);
    expect(result.current.byDeployment[7]!.predDriftPsi).toBeCloseTo(0.12, 6);

    act(() => {
      es.emit('deployment.pnl_update', {
        deployment_id: 7,
        paper_pnl_total: 480.1,
        predictions_emitted: 4,
        last_prediction_at: '2026-05-10T12:00:02.000Z',
        pred_drift_psi: null,
      });
    });
    expect(result.current.byDeployment[7]!.paperPnlTotal).toBe(480.1);
    expect(result.current.byDeployment[7]!.predDriftPsi).toBeNull();
  });

  it('flips status on paused/resumed/stopped/failed', () => {
    const { result } = renderHook(() =>
      useDeploymentEvents({ eventSourceCtor: FakeESCtor }),
    );
    const es = FakeEventSource.instances[0]!;
    act(() => es.fireOpen());
    act(() =>
      es.emit('deployment.started', {
        deployment_id: 9,
        version_id: 1,
        mode: 'paper',
        symbol: 'MNQ',
        timeframe: '1m',
        started_at: '2026-05-10T12:00:00.000Z',
      }),
    );
    expect(result.current.byDeployment[9]!.status).toBe('running');

    act(() =>
      es.emit('deployment.paused', { deployment_id: 9, paused_at: '2026-05-10T12:01:00.000Z' }),
    );
    expect(result.current.byDeployment[9]!.status).toBe('paused');

    act(() =>
      es.emit('deployment.resumed', { deployment_id: 9, resumed_at: '2026-05-10T12:02:00.000Z' }),
    );
    expect(result.current.byDeployment[9]!.status).toBe('running');

    act(() =>
      es.emit('deployment.stopped', { deployment_id: 9, stopped_at: '2026-05-10T12:03:00.000Z' }),
    );
    expect(result.current.byDeployment[9]!.status).toBe('stopped');

    act(() =>
      es.emit('deployment.failed', {
        deployment_id: 9,
        failed_at: '2026-05-10T12:04:00.000Z',
        error: 'questdb unreachable',
      }),
    );
    expect(result.current.byDeployment[9]!.status).toBe('failed');
    expect(result.current.byDeployment[9]!.lastError).toBe('questdb unreachable');
  });

  it('predPerMin reflects the rolling 60s window', () => {
    // System time used to age out old prediction timestamps.
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));

    const { result } = renderHook(() =>
      useDeploymentEvents({ eventSourceCtor: FakeESCtor }),
    );
    const es = FakeEventSource.instances[0]!;
    act(() => es.fireOpen());

    act(() => {
      // 3 predictions in the last 30 seconds: all should count.
      es.emit('deployment.prediction', {
        deployment_id: 1, ts: '2026-05-10T11:59:30.000Z', prediction: 1, confidence: 0.5,
      });
      es.emit('deployment.prediction', {
        deployment_id: 1, ts: '2026-05-10T11:59:45.000Z', prediction: 1, confidence: 0.5,
      });
      es.emit('deployment.prediction', {
        deployment_id: 1, ts: '2026-05-10T12:00:00.000Z', prediction: 1, confidence: 0.5,
      });
    });
    expect(result.current.byDeployment[1]!.predPerMin).toBe(3);
    expect(result.current.byDeployment[1]!.predictionsEmitted).toBe(3);

    // Advance system clock 90s — all 3 are now outside the 60s window.
    // A heartbeat triggers a snapshot republish that drops them.
    act(() => {
      vi.setSystemTime(new Date('2026-05-10T12:01:30.000Z'));
      es.emit('heartbeat', { ts: '2026-05-10T12:01:30.000Z' });
    });
    expect(result.current.byDeployment[1]!.predPerMin).toBe(0);
    // predictionsEmitted is cumulative — must NOT decrement.
    expect(result.current.byDeployment[1]!.predictionsEmitted).toBe(3);
  });
});
