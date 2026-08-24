# Event Architecture Design — Sagas, State Machines, Event Sourcing, Caching

**Date:** 2026-03-12
**Status:** Approved
**Scope:** Backend infrastructure + frontend integration

## Overview

Add event-driven architecture to ml_dashboard: saga orchestrators for multi-step pipelines, XState state machines for lifecycle management, SQLite event sourcing for audit/replay/crash recovery, and event-driven caching with SSE push invalidation.

## Guiding Principles

- **Single-user desktop app** — no distributed systems complexity, no message brokers, no eventual consistency
- **In-process event bus** — eventemitter2, not Kafka/NATS/Redis
- **Immediate consistency** — inline projections in same SQLite transaction as event persistence
- **Minimal dependencies** — ~56KB total (xstate + eventemitter2 + lru-cache)
- **Right-sized patterns** — enterprise event sourcing simplified for embedded Electron app

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Transport Layer                                     │
│  REST: queries + mutations (existing 11 routers)     │
│  SSE:  server-push (state changes, progress, cache   │
│        invalidation) — multiple channels              │
│  WS:   PTY terminal only (bidirectional)             │
├─────────────────────────────────────────────────────┤
│  Event Bus (eventemitter2, typed, in-process)         │
│  Subscribers: projections, sagas, cache invalidation, │
│               SSE adapters                            │
├─────────────────────────────────────────────────────┤
│  Saga Orchestrator (XState v5 actors)                │
│  Training | Ingestion | Deployment pipelines         │
│  Each saga = state machine + persisted event log     │
│  Compensation on failure, resume on crash             │
├─────────────────────────────────────────────────────┤
│  Event Store                                         │
│  SQLite: saga/aggregate events (UNIQUE stream_id +   │
│          position, optimistic concurrency)            │
│  QuestDB: domain telemetry (market arrivals,         │
│           inference results, system metrics)          │
├─────────────────────────────────────────────────────┤
│  Projections & Cache                                 │
│  Inline SQLite projections (same txn = immediate)    │
│  In-memory Maps (hot cache, rebuilt on startup)      │
│  lru-cache (expensive QuestDB query results)         │
│  TanStack Query (staleTime: Infinity, SSE invalidation)│
└─────────────────────────────────────────────────────┘
```

## Transport Layer Decision

**Research conclusion:** GraphQL is not worth the migration cost for a single-user localhost app. REST + SSE + WS covers all needs optimally.

| Pattern | Protocol | Rationale |
|---------|----------|-----------|
| Fetch data, run mutations | REST | Existing 11 routers, HTTP caching, simple |
| Training progress, pipeline status | SSE | Auto-reconnect, HTTP/2 multiplexing, lightweight |
| State change notifications | SSE | One-way push, cache invalidation triggers |
| Cache invalidation → frontend | SSE | Server pushes query keys to invalidate |
| PTY terminal | WebSocket | Only genuinely bidirectional use case |

SSE channels (separate endpoints, frontend subscribes to what it needs):
- `/api/events/pipeline` — saga state transitions, step progress
- `/api/events/training` — epoch metrics, loss curves (extends existing `/api/training/stream`)
- `/api/events/system` — cache invalidation, health status, domain events

## Event Store

### SQLite Event Table (Drizzle schema)

```typescript
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  streamId: text('stream_id').notNull(),          // e.g., 'training:abc123'
  streamPosition: integer('stream_position').notNull(),
  type: text('type').notNull(),                    // e.g., 'TrainingStarted'
  version: integer('version').notNull().default(1), // schema version for upcasting
  data: text('data').notNull(),                    // JSON payload
  metadata: text('metadata').notNull(),            // JSON: correlationId, causationId
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  streamPositionUnique: unique().on(table.streamId, table.streamPosition),
  streamIdx: index('idx_events_stream').on(table.streamId, table.streamPosition),
  typeIdx: index('idx_events_type').on(table.type),
  createdIdx: index('idx_events_created').on(table.createdAt),
}));
```

### Core Operations (~200 lines)

```typescript
// Append event with optimistic concurrency
async function appendToStream(
  streamId: string,
  expectedPosition: number,
  events: NewEvent[]
): Promise<void>

// Read all events for an aggregate
async function readStream(streamId: string, fromPosition?: number): Promise<StoredEvent[]>

// Read all events of a type (for projections/replay)
async function readByType(type: string, after?: number): Promise<StoredEvent[]>

// Read all events (for full rebuild)
async function readAll(after?: number): Promise<StoredEvent[]>
```

Optimistic concurrency: `UNIQUE(stream_id, stream_position)`. If two writes race on the same position, exactly one wins, the other gets a constraint violation and retries.

### QuestDB Domain Events Table

```sql
CREATE TABLE domain_events (
  event_type SYMBOL CAPACITY 100 CACHE INDEX,
  source     SYMBOL CAPACITY 50 CACHE INDEX,
  symbol     SYMBOL CAPACITY 100 CACHE INDEX,
  payload    VARCHAR,
  ts         TIMESTAMP
) timestamp(ts) PARTITION BY DAY WAL
DEDUP UPSERT KEYS(ts, event_type, source, symbol);
```

For high-volume telemetry only: market data arrivals, inference results, system metrics. Queried by time range, not by aggregate.

### Event Metadata

Every event carries:

```typescript
type EventMetadata = {
  correlationId: string;  // originating request ID
  causationId: string;    // event that directly caused this one
  timestamp: number;      // epoch ms
  userId?: string;        // future: multi-user support
};
```

### Event Schema Evolution

Strategy: **upcasting on read**. Events store a `version` field. When reading, run upcaster functions that transform old shapes to current shapes. Single-user app = no need for copy-and-transform.

```typescript
const upcasters: Record<string, (data: unknown, fromVersion: number) => unknown> = {
  'TrainingCompleted': (data, v) => {
    if (v < 2) return { ...data, gpuUtilization: null }; // added in v2
    return data;
  },
};
```

## Event Bus

### eventemitter2 with TypeScript types

```typescript
type DomainEvents = {
  // Pipeline events
  'pipeline.started': { pipelineId: string; type: PipelineType; };
  'pipeline.step.started': { pipelineId: string; step: string; };
  'pipeline.step.completed': { pipelineId: string; step: string; result: unknown; };
  'pipeline.step.failed': { pipelineId: string; step: string; error: string; };
  'pipeline.completed': { pipelineId: string; };
  'pipeline.failed': { pipelineId: string; error: string; };

  // Training events
  'training.epoch.completed': { sessionId: string; epoch: number; metrics: TrainingMetrics; };
  'training.checkpoint.saved': { sessionId: string; path: string; };

  // Model events
  'model.registered': { modelId: string; metrics: ModelMetrics; };
  'model.promoted': { modelId: string; reason: string; };
  'model.retired': { modelId: string; };

  // Ingestion events
  'ingestion.file.received': { uploadId: string; filename: string; };
  'ingestion.validated': { uploadId: string; rowCount: number; };
  'ingestion.completed': { uploadId: string; symbol: string; timeframe: string; };

  // Cache events
  'cache.invalidate': { keys: string[]; };
};
```

Wildcard subscriptions: `eventBus.on('pipeline.*', handler)` — SSE adapter subscribes to domain prefixes.

### Event Flow

```
Command (REST mutation)
  → Command Handler (validates, produces events)
    → Event Store (SQLite append, inline projection update — same transaction)
      → EventBus.emit() (after commit)
        → SSE Adapter (pushes to connected frontend clients)
        → Cache Invalidator (clears relevant lru-cache keys)
        → Saga Orchestrator (triggers next step if waiting on this event)
```

## State Machines (XState v5)

### Training Pipeline Machine

```
States:
  idle
  ingesting         → compensate: delete ingested rows
  computing_features → compensate: delete feature rows
  generating_labels  → compensate: delete label rows
  training          → compensate: delete checkpoint files
  evaluating        → compensate: (none, read-only)
  registering       → compensate: unregister model
  completed         → terminal
  failed            → transition to compensating
  compensating      → reverse-order compensation of completed steps
  compensated       → terminal

Guards:
  canStartTraining: no other training active
  meetsMinBenchmarks: OOS Sharpe > 1.0, accuracy > 53%

Actions:
  Each state entry → emit event to event store
  Each state entry → update inline projection
  Each state entry → emit to event bus → SSE push
```

### Ingestion Pipeline Machine

```
States:
  idle
  uploading         → compensate: delete temp file
  validating        → compensate: (none, read-only)
  deduplicating     → compensate: (none, read-only)
  ingesting_duckdb  → compensate: delete rows by batch_id
  syncing_questdb   → compensate: delete synced rows
  computing_indicators → compensate: delete indicator rows
  completed         → terminal
  failed → compensating → compensated
```

### Model Deployment Machine

```
States:
  idle
  validating_benchmarks → compensate: (none, read-only)
  promoting             → compensate: revert to previous active model
  monitoring            → compensate: stop monitoring
  active                → terminal (until superseded)
  failed → compensating → compensated
```

### Shared Frontend/Backend

XState v5 machine definitions are pure config — same `.ts` file imported by both:
- **Backend**: Creates actors, persists transitions as events, runs step logic
- **Frontend**: Creates read-only actors from SSE state updates, drives UI (progress indicators, step highlighting, error display)

## Saga Orchestrator

### Core Pattern

Each saga is an XState actor whose transitions are persisted as events. The orchestrator:

1. Creates an XState actor for the pipeline type
2. On each state transition: appends event to SQLite, updates projection, emits to bus
3. In each state: executes the step's `execute()` function
4. On step failure: transitions to `failed`, then `compensating`, runs reverse-order `compensate()` for each completed step
5. On process crash: replays events from SQLite → rebuilds XState actor → resumes from last completed step

### Step Interface

```typescript
interface SagaStep<TContext> {
  name: string;
  execute: (ctx: TContext) => Promise<StepResult>;
  compensate?: (ctx: TContext) => Promise<void>;
  timeout?: number;       // ms, default varies per step
  retries?: number;       // default 0
  heartbeatInterval?: number; // ms, for long-running steps like training
}
```

### Compensation Table

| Pipeline | Step | Compensation |
|----------|------|-------------|
| Training | ingesting | Delete rows by batch_id |
| Training | computing_features | Delete feature rows by session_id |
| Training | generating_labels | Delete label rows by generation_id |
| Training | training | Delete model checkpoint files |
| Training | registering | Unregister model from registry |
| Ingestion | ingesting_duckdb | Delete rows by batch_id |
| Ingestion | syncing_questdb | Delete synced rows by batch_id |
| Ingestion | computing_indicators | Delete indicator rows by batch_id |
| Deployment | promoting | Revert active model pointer |

### Crash Recovery

On server startup:
1. Query: `SELECT DISTINCT stream_id FROM events WHERE stream_id LIKE 'pipeline:%' AND stream_id NOT IN (SELECT stream_id FROM events WHERE type IN ('PipelineCompleted', 'PipelineFailed', 'PipelineCompensated'))`
2. For each incomplete pipeline: replay events → rebuild XState actor → resume

### Long-Running Step Handling

Training (HDP-HMM) can run for hours:
- Python process emits progress events via JSON stdout protocol (existing pattern)
- Saga orchestrator monitors heartbeat: no event in 5 minutes = step timeout
- Training script supports checkpoint resume: saga passes `--resume-from` flag on restart
- Step timeout: training = 4 hours, feature computation = 30 minutes, evaluation = 10 minutes

## Caching Strategy

### Three-Layer Cache

| Layer | What | Invalidation | Location |
|-------|------|-------------|----------|
| In-memory projections | Active pipelines, model registry, training status | Updated inline with events (same SQLite txn) | Server: `Map<string, T>` |
| lru-cache | Expensive QuestDB queries (OHLCV aggregations, indicator scans, chart data) | Event bus subscription: `ingestion.completed` → clear symbol keys | Server: `lru-cache` instance |
| TanStack Query | All API responses | `staleTime: Infinity`, server SSE pushes invalidation keys | Frontend: `queryClient` |

### Cache Invalidation Flow

```
Event emitted (e.g., 'ingestion.completed' for ES)
  → CacheInvalidator listens on event bus
    → Clears lru-cache keys matching 'charts:ES:*', 'indicators:ES:*'
    → Emits SSE event: { type: 'cache.invalidate', keys: ['charts', 'indicators'] }
      → Frontend SSE handler calls queryClient.invalidateQueries({ queryKey: ['charts'] })
```

### TanStack Query Changes

```typescript
// Current: staleTime 60s, refetch on window focus
// New: staleTime Infinity, invalidation driven by server events
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,       // never auto-refetch
      refetchOnWindowFocus: false, // server tells us when data changes
    },
  },
});
```

Frontend SSE hook:
```typescript
function useEventStream() {
  useEffect(() => {
    const source = new EventSource('/api/events/system');
    source.addEventListener('cache.invalidate', (e) => {
      const { keys } = JSON.parse(e.data);
      keys.forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));
    });
    return () => source.close();
  }, []);
}
```

## Audit Capabilities

Event sourcing enables:

1. **Full audit trail**: Every pipeline run, every step, every state transition — timestamped, with correlation IDs linking cause to effect
2. **Time-travel debugging**: Replay events up to any point → reconstruct exact system state at that moment
3. **Projection rebuild**: Change how you display data → replay all events through new projection logic
4. **Crash forensics**: After a crash, the event log shows exactly where the pipeline was and what happened
5. **Pipeline comparison**: Compare event streams of two training runs side-by-side

## New Dependencies

| Library | Version | Size (gzip) | Downloads/week | Purpose |
|---------|---------|-------------|----------------|---------|
| `xstate` | 5.x | ~14KB | 1.5M+ | State machines (frontend + backend) |
| `eventemitter2` | 6.x | ~22KB | 10M+ | Typed wildcard event bus |
| `lru-cache` | 11.x | ~20KB | 300M+ | Server-side query cache |
| **Total** | | **~56KB** | | Zero external services |

## What Stays Unchanged

- All 11 REST routers (no GraphQL migration)
- QuestDB for time-series (OHLCV, trades, indicators, materialized views)
- SQLite + Drizzle for existing 22 CRUD tables
- WebSocket for PTY terminal
- Python ML scripts (JSON stdout protocol)
- File-based model checkpoints
- Frontend component structure

## File Structure (new files)

```
src/server/
  events/
    event-store.ts          # SQLite append/read, optimistic concurrency (~200 lines)
    event-bus.ts            # eventemitter2 wrapper, typed events (~50 lines)
    event-types.ts          # All domain event type definitions
    projections.ts          # Inline projection handlers
    sse-adapter.ts          # Event bus → SSE push for connected clients
  sagas/
    orchestrator.ts         # Saga runner: XState actor + event persistence
    steps/
      training-steps.ts     # execute/compensate for each training step
      ingestion-steps.ts    # execute/compensate for each ingestion step
      deployment-steps.ts   # execute/compensate for each deployment step
    machines/
      training-machine.ts   # XState v5 machine definition
      ingestion-machine.ts  # XState v5 machine definition
      deployment-machine.ts # XState v5 machine definition
  cache/
    query-cache.ts          # lru-cache wrapper + event-driven invalidation
    cache-invalidator.ts    # Event bus listener → cache clear + SSE push

src/client/src/
  hooks/
    useEventStream.ts       # SSE subscription + TanStack Query invalidation
    usePipelineState.ts     # XState read-only actor from SSE state updates
  components/
    pipeline/
      PipelineStatus.tsx    # Visual state machine (step indicators, progress)
      PipelineHistory.tsx   # Event log viewer (audit trail)

src/shared/
  schema.ts                 # Add events table definition (Drizzle)
  event-types.ts            # Shared event type definitions (frontend + backend)
  machines/                 # Shared XState machine definitions
    training-machine.ts
    ingestion-machine.ts
    deployment-machine.ts
```
