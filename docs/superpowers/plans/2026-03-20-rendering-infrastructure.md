# Rendering Infrastructure Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the ML Dashboard rendering infrastructure for high-end performance: React Compiler auto-memoization, non-blocking SSE streaming, Suspense-based queries, comprehensive error handling, and build optimization.

**Architecture:** Four-layer approach — (1) React Compiler eliminates manual memoization, (2) ring-buffer SSE pipeline with startTransition batching, (3) useSuspenseQuery with ErrorBoundary integration, (4) Rolldown builds with dependency pruning.

**Tech Stack:** React 19.2, React Compiler v1.0, TanStack Query v5, Vite 7 + Rolldown, lightweight-charts v5 conflation, react-window v2.2.5, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-03-20-rendering-infrastructure-design.md`

---

## File Map

### New Files
| File | Purpose |
|------|---------|
| `src/client/src/lib/ringBuffer.ts` | Generic ring buffer data structure (SSE events) |
| `src/client/src/lib/errorLogger.ts` | Structured error logging utility |
| `src/client/src/hooks/useSSEConnection.ts` | Shared SSE connection hook with reconnection + named event support |
| `src/client/src/hooks/useWebVitals.ts` | Dev-only Web Vitals monitoring |
| `src/client/src/hooks/useDeferredFilter.ts` | Reusable deferred filter hook wrapping useDeferredValue |
| `src/client/src/contexts/TrainingMetricsCtx.tsx` | Granular metrics sub-context (split from TrainingLive) |
| `src/client/src/contexts/TrainingLogsCtx.tsx` | Granular logs sub-context |
| `src/client/src/contexts/TrainingOverlaysCtx.tsx` | Granular overlays sub-context |
| `src/client/src/components/QueryErrorBoundary.tsx` | TanStack Query + ErrorBoundary integration |
| `tests/ringBuffer.test.ts` | Ring buffer unit tests |
| `tests/errorLogger.test.ts` | Error logger tests |

### Modified Files
| File | Changes |
|------|---------|
| `vite.config.ts` | Add React Compiler babel plugin |
| `package.json` | Add babel-plugin-react-compiler, remove unused deps |
| `src/client/src/hooks/useTrainingSSE.ts` | Rewrite with ring buffer + startTransition batching |
| `src/client/src/hooks/useEventStream.ts` | Add reconnection while preserving named event listeners |
| `src/client/src/contexts/TrainingContext.tsx` | Refactor to compose 3 granular sub-contexts |
| `src/client/src/lib/queryClient.ts` | Adjust staleTime, add error defaults |
| `src/client/src/components/ErrorBoundary.tsx` | Enhance with QueryErrorResetBoundary |
| `src/client/src/App.tsx` | Add global error handler, Activity wrappers, Web Vitals |
| `src/client/src/components/chart/useChartSetup.ts` | Enable lightweight-charts conflation |
| `src/client/src/components/SubchartPanel.tsx` | Enable conflation on subchart createChart call |
| `src/client/src/components/training/hpo/HPODashboard.tsx` | Fix silent catches, add error logging |
| `src/client/src/pages/News.tsx` | Fix silent catches, add EventSource reconnection |
| `CLAUDE.md` | Add rendering infrastructure documentation |

---

## Task 1: React Compiler Installation

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Install React Compiler**

```bash
cd E:\source\repos\ml_dashboard
npm install -D babel-plugin-react-compiler@latest
```

- [ ] **Step 2: Configure Vite**

In `vite.config.ts`, update the `react()` plugin:

```typescript
react({
  babel: {
    plugins: ['babel-plugin-react-compiler'],
  },
}),
```

- [ ] **Step 3: Verify build compiles and dashboard loads**

```bash
npx tsc --noEmit
```

Start dev server, navigate to `http://localhost:5000`, verify chart renders and pages load.

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts package.json package-lock.json
git commit -m "feat: integrate React Compiler v1.0 for automatic memoization"
```

---

## Task 2: Ring Buffer Data Structure

**Files:**
- Create: `src/client/src/lib/ringBuffer.ts`
- Create: `tests/ringBuffer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/ringBuffer.test.ts
import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/client/src/lib/ringBuffer';

describe('RingBuffer', () => {
  it('pushes and retrieves items in order', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1); buf.push(2); buf.push(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
    expect(buf.length).toBe(3);
  });

  it('overwrites oldest when full', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1); buf.push(2); buf.push(3); buf.push(4);
    expect(buf.toArray()).toEqual([2, 3, 4]);
  });

  it('clears all items and resets', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1); buf.push(2); buf.clear();
    expect(buf.toArray()).toEqual([]);
    expect(buf.length).toBe(0);
    buf.push(10);
    expect(buf.toArray()).toEqual([10]);
  });

  it('handles many wraps correctly', () => {
    const buf = new RingBuffer<number>(3);
    for (let i = 0; i < 100; i++) buf.push(i);
    expect(buf.toArray()).toEqual([97, 98, 99]);
  });

  it('returns independent snapshots', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1); buf.push(2);
    const snap1 = buf.toArray();
    buf.push(3);
    expect(snap1).toEqual([1, 2]);
    expect(buf.toArray()).toEqual([1, 2, 3]);
  });

  it('rejects zero capacity', () => {
    expect(() => new RingBuffer(0)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
npx vitest run tests/ringBuffer.test.ts
```

- [ ] **Step 3: Implement RingBuffer**

```typescript
// src/client/src/lib/ringBuffer.ts

/** Fixed-capacity circular buffer. O(1) push, O(n) snapshot. */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private count = 0;
  private cap: number;

  constructor(capacity: number) {
    if (capacity < 1) throw new RangeError('RingBuffer capacity must be >= 1');
    this.cap = capacity;
    this.buf = new Array(capacity);
  }

  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  get length(): number { return this.count; }

  toArray(): T[] {
    if (this.count === 0) return [];
    const result = new Array<T>(this.count);
    const start = (this.head - this.count + this.cap) % this.cap;
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(start + i) % this.cap] as T;
    }
    return result;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.buf = new Array(this.cap);
  }
}
```

- [ ] **Step 4: Run tests — expect all PASS**

```bash
npx vitest run tests/ringBuffer.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/client/src/lib/ringBuffer.ts tests/ringBuffer.test.ts
git commit -m "feat: add RingBuffer data structure for SSE event accumulation"
```

---

## Task 3: Structured Error Logger

**Files:**
- Create: `src/client/src/lib/errorLogger.ts`
- Create: `tests/errorLogger.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/errorLogger.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logError, logWarn, setErrorHandler } from '../src/client/src/lib/errorLogger';

describe('errorLogger', () => {
  beforeEach(() => { vi.restoreAllMocks(); setErrorHandler(undefined); });

  it('logs errors with component context', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('SSE', 'parse failed', { raw: 'x' });
    expect(spy).toHaveBeenCalledWith('[SSE] parse failed', { raw: 'x' });
  });

  it('logs warnings with component context', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWarn('SSE', 'reconnecting', { attempt: 2 });
    expect(spy).toHaveBeenCalledWith('[SSE] reconnecting', { attempt: 2 });
  });

  it('calls custom error handler when set', () => {
    const handler = vi.fn();
    setErrorHandler(handler);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('test', 'boom', { x: 1 });
    expect(handler).toHaveBeenCalledWith('test', 'boom', { x: 1 });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**
- [ ] **Step 3: Implement**

```typescript
// src/client/src/lib/errorLogger.ts
type ErrorHandler = (component: string, message: string, context?: Record<string, unknown>) => void;
let customHandler: ErrorHandler | undefined;

export function setErrorHandler(handler: ErrorHandler | undefined): void { customHandler = handler; }

export function logError(component: string, message: string, context?: Record<string, unknown>): void {
  console.error(`[${component}] ${message}`, context ?? '');
  customHandler?.(component, message, context);
}

export function logWarn(component: string, message: string, context?: Record<string, unknown>): void {
  console.warn(`[${component}] ${message}`, context ?? '');
}
```

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add src/client/src/lib/errorLogger.ts tests/errorLogger.test.ts
git commit -m "feat: add structured error logger with component context"
```

---

## Task 4: SSE Connection Hook with Reconnection

**Files:**
- Create: `src/client/src/hooks/useSSEConnection.ts`

This hook supports BOTH `onmessage` (generic) AND named event listeners via an `eventMap` option. This is critical because `useEventStream` uses named SSE events (`cache.invalidate`, `pipeline.started`, etc.) while `useTrainingSSE` uses the default message event.

- [ ] **Step 1: Implement useSSEConnection**

```typescript
// src/client/src/hooks/useSSEConnection.ts
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
  // Stable refs for callbacks to avoid re-subscribing EventSource
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

    // Default message handler
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

    // Named event listeners (for useEventStream compatibility)
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
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/client/src/hooks/useSSEConnection.ts
git commit -m "feat: add useSSEConnection with exponential backoff and named event support"
```

---

## Task 5: Rewrite useTrainingSSE with Ring Buffer + Batching

**Files:**
- Modify: `src/client/src/hooks/useTrainingSSE.ts`

**Note:** Preserve the existing `MetricEvent` interface exactly (ts: string, step/epoch/fold are non-optional numbers) to avoid breaking downstream consumers.

- [ ] **Step 1: Read current useTrainingSSE.ts to confirm interface**
- [ ] **Step 2: Rewrite with ring buffer and microbatch**

```typescript
// src/client/src/hooks/useTrainingSSE.ts
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
```

- [ ] **Step 3: Verify build + check all consumers of useTrainingSSE still compile**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/client/src/hooks/useTrainingSSE.ts
git commit -m "feat: rewrite useTrainingSSE with ring buffer batching and startTransition"
```

---

## Task 6: Rewrite useEventStream with Reconnection (Preserve Named Events)

**Files:**
- Modify: `src/client/src/hooks/useEventStream.ts`

**Critical:** Must preserve named event listeners (`connected`, `cache.invalidate`, pipeline events) via the `eventMap` option in useSSEConnection.

- [ ] **Step 1: Read current useEventStream.ts to capture all named events**
- [ ] **Step 2: Rewrite using useSSEConnection with eventMap**

```typescript
// src/client/src/hooks/useEventStream.ts
import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSSEConnection } from './useSSEConnection';
import { logError, logWarn } from '../lib/errorLogger';

type SSEChannel = 'pipeline' | 'training' | 'system';

interface EventStreamOptions {
  channel: SSEChannel;
  onEvent?: (type: string, data: unknown) => void;
  enabled?: boolean;
}

const PIPELINE_EVENTS = [
  'pipeline.started', 'pipeline.step.started', 'pipeline.step.completed',
  'pipeline.step.failed', 'pipeline.completed', 'pipeline.failed',
  'pipeline.compensating', 'pipeline.compensated',
] as const;

export function useEventStream(options: EventStreamOptions) {
  const { channel, onEvent, enabled = true } = options;
  const queryClient = useQueryClient();

  const eventMap = useMemo(() => {
    const map: Record<string, (data: unknown) => void> = {};

    // 'connected' event
    map['connected'] = () => {
      logWarn('useEventStream', 'SSE connected', { channel });
    };

    // Cache invalidation
    map['cache.invalidate'] = (data: unknown) => {
      const msg = data as { queryKey?: string[] };
      if (msg.queryKey) {
        try {
          queryClient.invalidateQueries({ queryKey: msg.queryKey });
        } catch (err) {
          logError('useEventStream', 'Cache invalidation failed', {
            queryKey: msg.queryKey, error: String(err),
          });
        }
      }
    };

    // Pipeline events
    for (const eventType of PIPELINE_EVENTS) {
      map[eventType] = (data: unknown) => {
        onEvent?.(eventType, data);
      };
    }

    return map;
  }, [queryClient, onEvent, channel]);

  const url = `/api/events/${channel}`;
  const { connected, error, reconnectAttempt } = useSSEConnection({
    url, enabled, eventMap,
  });

  return { connected, error, reconnectAttempt };
}
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/client/src/hooks/useEventStream.ts
git commit -m "feat: rewrite useEventStream with reconnection, preserving named event listeners"
```

---

## Task 7: QueryErrorBoundary Component

**Files:**
- Create: `src/client/src/components/QueryErrorBoundary.tsx`

- [ ] **Step 1: Implement**

```typescript
// src/client/src/components/QueryErrorBoundary.tsx
import React, { type ReactNode } from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

class InnerBoundary extends React.Component<
  Props & { onReset: () => void }, State
> {
  state: State = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error): State { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[QueryErrorBoundary]', error.message, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="text-red-400 font-mono text-sm">
            {this.state.error?.message ?? 'Something went wrong'}
          </div>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); this.props.onReset(); }}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-sm font-mono transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function QueryErrorBoundary({ children, fallback }: Props) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => <InnerBoundary onReset={reset} fallback={fallback}>{children}</InnerBoundary>}
    </QueryErrorResetBoundary>
  );
}
```

- [ ] **Step 2: Verify build, commit**

```bash
npx tsc --noEmit
git add src/client/src/components/QueryErrorBoundary.tsx
git commit -m "feat: add QueryErrorBoundary with TanStack Query retry integration"
```

---

## Task 8: Global Error Handler, Web Vitals, Activity Wrappers

**Files:**
- Create: `src/client/src/hooks/useWebVitals.ts`
- Create: `src/client/src/hooks/useDeferredFilter.ts`
- Modify: `src/client/src/App.tsx`

- [ ] **Step 1: Create useWebVitals**

```typescript
// src/client/src/hooks/useWebVitals.ts
import { useEffect } from 'react';

export function useWebVitals(): void {
  useEffect(() => {
    if (import.meta.env.PROD) return;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const name = entry.entryType === 'largest-contentful-paint' ? 'LCP'
          : entry.entryType === 'first-input' ? 'FID'
          : entry.entryType === 'layout-shift' ? 'CLS' : entry.name;
        console.log(`%c[WebVital] ${name}: ${entry.startTime.toFixed(1)}ms`, 'color: #4ade80; font-weight: bold;');
      }
    });
    try {
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      observer.observe({ type: 'first-input', buffered: true });
      observer.observe({ type: 'layout-shift', buffered: true });
    } catch { /* entry type not supported */ }
    return () => observer.disconnect();
  }, []);
}
```

- [ ] **Step 2: Create useDeferredFilter**

```typescript
// src/client/src/hooks/useDeferredFilter.ts
import { useState, useDeferredValue } from 'react';

export function useDeferredFilter(initialValue = '') {
  const [query, setQuery] = useState(initialValue);
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;
  return { query, setQuery, deferredQuery, isStale } as const;
}
```

- [ ] **Step 3: Add global error handler + Web Vitals to App.tsx**

Read App.tsx, then add at top of `App` function body:

```typescript
import { useWebVitals } from './hooks/useWebVitals';

// Inside App component:
useEffect(() => {
  const handler = (event: PromiseRejectionEvent) => {
    console.error('[Unhandled Rejection]', event.reason);
  };
  window.addEventListener('unhandledrejection', handler);
  return () => window.removeEventListener('unhandledrejection', handler);
}, []);

useWebVitals();
```

- [ ] **Step 4: Wrap routes with Activity (React 19.2)**

Import `Activity` from `react` and wrap lazy-loaded route content:

```typescript
import { Activity } from 'react';
```

For each route that benefits from state preservation (MarketData, Training, Databases), wrap the component:

```tsx
<Route path="/">
  <Suspense fallback={<ChartSkeleton />}>
    <Activity mode="visible">
      <MarketData />
    </Activity>
  </Suspense>
</Route>
```

**Note:** If `Activity` is not available in React 19.2.0 (it may still be experimental), skip this step and leave a TODO. Verify first:
```bash
node -e "const React = require('react'); console.log('Activity' in React)"
```

- [ ] **Step 5: Verify build, commit**

```bash
npx tsc --noEmit
git add src/client/src/hooks/useWebVitals.ts src/client/src/hooks/useDeferredFilter.ts src/client/src/App.tsx
git commit -m "feat: add global error handler, Web Vitals, useDeferredFilter, and Activity wrappers"
```

---

## Task 9: Enable lightweight-charts Conflation

**Files:**
- Modify: `src/client/src/components/chart/useChartSetup.ts`
- Modify: `src/client/src/components/SubchartPanel.tsx`

- [ ] **Step 1: Read useChartSetup.ts to find createChart options**
- [ ] **Step 2: Add conflation to both createChart calls**

In `useChartSetup.ts` (line ~58) and `SubchartPanel.tsx` (line ~88), add to the `timeScale` options:

```typescript
timeScale: {
  // ... existing options ...
  enableConflation: true,
  conflationThresholdFactor: 1.0,
},
```

- [ ] **Step 3: Verify chart renders with 10k+ bars**
- [ ] **Step 4: Commit**

```bash
git add src/client/src/components/chart/useChartSetup.ts src/client/src/components/SubchartPanel.tsx
git commit -m "feat: enable lightweight-charts data conflation for large datasets"
```

---

## Task 10: Split TrainingLive Context into 3 Sub-Contexts

**Files:**
- Create: `src/client/src/contexts/TrainingMetricsCtx.tsx`
- Create: `src/client/src/contexts/TrainingLogsCtx.tsx`
- Create: `src/client/src/contexts/TrainingOverlaysCtx.tsx`
- Modify: `src/client/src/contexts/TrainingContext.tsx`

- [ ] **Step 1: Read TrainingContext.tsx to understand current TrainingLiveCtx shape**
- [ ] **Step 2: Create 3 granular sub-contexts**

Each sub-context follows the same pattern: dedicated Provider, dedicated hook, only the data that subscribers need.

```typescript
// src/client/src/contexts/TrainingMetricsCtx.tsx
import { createContext, useContext, type ReactNode } from 'react';

interface TrainingMetricsValue {
  metrics: Record<string, number>;
  iterationHistory: Array<Record<string, number>>;
  currentIteration: number;
}

const TrainingMetricsCtx = createContext<TrainingMetricsValue | null>(null);

export function TrainingMetricsProvider({ value, children }: { value: TrainingMetricsValue; children: ReactNode }) {
  return <TrainingMetricsCtx.Provider value={value}>{children}</TrainingMetricsCtx.Provider>;
}

export function useTrainingMetrics(): TrainingMetricsValue {
  const ctx = useContext(TrainingMetricsCtx);
  if (!ctx) throw new Error('useTrainingMetrics must be used within TrainingMetricsProvider');
  return ctx;
}
```

Follow the same pattern for `TrainingLogsCtx.tsx` (logs array) and `TrainingOverlaysCtx.tsx` (overlay/regime data).

- [ ] **Step 3: Refactor TrainingContext.tsx to compose the 3 sub-providers**

Wrap the existing `TrainingLiveCtx.Provider` children with the 3 new providers, passing slices of the live data to each.

- [ ] **Step 4: Update consumers that use `useTrainingLive()` to use the specific sub-hook instead**

Search for all imports of `useTrainingLive` and migrate to the specific hook they actually need.

- [ ] **Step 5: Verify build, commit**

```bash
npx tsc --noEmit
git add src/client/src/contexts/
git commit -m "feat: split TrainingLive into metrics/logs/overlays sub-contexts"
```

---

## Task 11: Fix Silent Catch Blocks + Error Logging

**Files:**
- Modify: `src/client/src/components/training/hpo/HPODashboard.tsx`
- Modify: `src/client/src/pages/News.tsx`

- [ ] **Step 1: Read HPODashboard.tsx, find all silent catches**
- [ ] **Step 2: Add `logError()` to each, with component name and context**

```typescript
import { logError } from '../../lib/errorLogger';

// Replace each silent catch:
catch (err) {
  logError('HPODashboard', 'Failed to parse SSE event', { error: String(err) });
}
```

- [ ] **Step 3: Read News.tsx, fix silent catches and add EventSource onerror**
- [ ] **Step 4: Verify build, commit**

```bash
npx tsc --noEmit
git add src/client/src/components/training/hpo/HPODashboard.tsx src/client/src/pages/News.tsx
git commit -m "fix: replace silent catch blocks with structured error logging"
```

---

## Task 12: Adjust Query staleTime + Add Mutation Error Handling

**Files:**
- Modify: `src/client/src/lib/queryClient.ts`

- [ ] **Step 1: Update global defaults**

Change `staleTime: Infinity` to `staleTime: 5 * 60 * 1000` (5 minutes).

Individual queries that genuinely need Infinity (chart OHLCV, training config) should set it per-query.

- [ ] **Step 2: Search for mutation hooks missing onError**

Find all `useMutation` calls in the codebase and add `onError` handlers that show a toast.

- [ ] **Step 3: Verify build, commit**

```bash
npx tsc --noEmit
git add src/client/src/lib/queryClient.ts
git commit -m "fix: adjust staleTime from Infinity to 5min, add mutation error handlers"
```

---

## Task 13: Prune Unused Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove unused deps**

```bash
cd E:\source\repos\ml_dashboard
npm uninstall framer-motion tw-animate-css parquetjs technicalindicators embla-carousel-react passport passport-local express-session memorystore
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit && npm run build
```

Re-install any that cause import errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: prune 9 unused dependencies"
```

---

## Task 14: Rolldown Build Optimization (Experimental Branch)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Create experiment branch**

```bash
git checkout -b experiment/rolldown
```

- [ ] **Step 2: Swap Vite for Rolldown-Vite**

```bash
npm install vite@npm:rolldown-vite@latest
```

- [ ] **Step 3: Test build, compare times**

```bash
time npm run build
```

- [ ] **Step 4: Merge if successful, delete branch if not**

---

## Task 15: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Rendering Infrastructure section**

Add after the Token Budget section in CLAUDE.md:

```markdown
## Rendering Infrastructure

### React Compiler
- `babel-plugin-react-compiler` enabled in `vite.config.ts`
- Auto-memoizes all components, hooks, and intermediate values
- Do NOT add manual `React.memo`, `useMemo`, or `useCallback` — the compiler handles it
- If a component needs to opt out: add `'use no memo'` directive

### SSE Streaming
- `useSSEConnection` — shared hook with exponential backoff reconnection (1s/2s/4s/8s, max 30s)
- `useTrainingSSE` — ring buffer (5000 slots) + 50ms microbatch + `startTransition` flush
- `useEventStream` — pipeline/training/system channels with auto-reconnection via named events
- All SSE errors logged via `logError()` from `lib/errorLogger.ts`

### Query Layer
- Global `staleTime: 5min` — individual queries override as needed
- `useSuspenseQuery` preferred over `useQuery` when data is required for render
- `QueryErrorBoundary` wraps route groups for retry on query failure
- All mutations must have `onError` handlers (toast notification)

### Error Handling
- Global `unhandledrejection` listener in App.tsx
- `logError(component, message, context)` for structured logging
- No silent catch blocks — every catch must log or handle
- No `any` types at API boundaries — use Zod validation

### Performance
- lightweight-charts: `enableConflation: true` for 10k+ bar datasets
- Web Vitals monitoring in dev mode (LCP, FID, CLS)
- react-window for lists exceeding 100 items
- `useDeferredFilter` hook for search/filter inputs
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add rendering infrastructure section to CLAUDE.md"
```
