# Event Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add saga orchestrators, XState state machines, SQLite event sourcing, event-driven caching, and SSE push invalidation to ml_dashboard.

**Architecture:** In-process event bus (eventemitter2) → SQLite event store (append-only, optimistic concurrency) → inline projections → SSE push to frontend. XState v5 state machines define pipeline lifecycles. Saga orchestrator wraps XState actors with step execution, compensation, and crash recovery. lru-cache for expensive QuestDB queries, invalidated by event bus subscriptions.

**Tech Stack:** xstate 5.x, eventemitter2 6.x, lru-cache 11.x, Drizzle ORM, Vitest, Express SSE

**Design doc:** `docs/plans/2026-03-12-event-architecture-design.md`

---

## Phase 1: Foundation

### Task 1: Install Dependencies

**Step 1: Install npm packages**

Run:
```bash
cd E:/source/repos/ml_dashboard && npm install xstate eventemitter2 lru-cache
```
Expected: 3 packages added to `dependencies` in package.json

**Step 2: Verify TypeScript types resolve**

Run:
```bash
cd E:/source/repos/ml_dashboard && npx tsc --noEmit 2>&1 | head -5
```
Expected: No new type errors (xstate and lru-cache ship their own types, eventemitter2 has @types included)

**Step 3: Commit**

```bash
cd E:/source/repos/ml_dashboard && git add package.json package-lock.json && git commit -m "chore: add xstate, eventemitter2, lru-cache for event architecture"
```

---

### Task 2: Shared Event Type Definitions

**Files:**
- Create: `src/shared/event-types.ts`
- Test: `tests/event-types.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/event-types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  DomainEvent, EventMetadata, PipelineEvent, TrainingEvent,
  IngestionEvent, ModelEvent, CacheEvent, SystemEvent,
} from '../src/shared/event-types';

describe('event-types', () => {
  it('should create a valid PipelineStarted event', () => {
    const event: PipelineEvent = {
      type: 'pipeline.started',
      data: {
        pipelineId: 'test-123',
        pipelineType: 'training',
        config: { symbol: 'ES', timeframe: '1m' },
      },
      metadata: {
        correlationId: 'req-001',
        causationId: 'req-001',
        timestamp: Date.now(),
      },
    };
    expect(event.type).toBe('pipeline.started');
    expect(event.data.pipelineType).toBe('training');
  });

  it('should create a valid TrainingEpochCompleted event', () => {
    const event: TrainingEvent = {
      type: 'training.epoch.completed',
      data: {
        sessionId: 'sess-001',
        epoch: 10,
        metrics: { loss: 0.5, valLoss: 0.6 },
      },
      metadata: {
        correlationId: 'req-001',
        causationId: 'evt-009',
        timestamp: Date.now(),
      },
    };
    expect(event.type).toBe('training.epoch.completed');
    expect(event.data.epoch).toBe(10);
  });

  it('should create a valid CacheInvalidate event', () => {
    const event: CacheEvent = {
      type: 'cache.invalidate',
      data: { keys: ['charts:ES', 'indicators:ES'] },
      metadata: {
        correlationId: 'req-001',
        causationId: 'evt-010',
        timestamp: Date.now(),
      },
    };
    expect(event.data.keys).toHaveLength(2);
  });

  it('should enforce discriminated union — type narrows data', () => {
    const event: DomainEvent = {
      type: 'model.registered',
      data: { modelId: 'mdl-001', name: 'hdp-hmm-ES-1m', metrics: { sharpe: 1.5 } },
      metadata: { correlationId: 'r1', causationId: 'r1', timestamp: Date.now() },
    };
    if (event.type === 'model.registered') {
      expect(event.data.modelId).toBe('mdl-001');
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/event-types.test.ts`
Expected: FAIL — cannot find module `../src/shared/event-types`

**Step 3: Write the implementation**

```typescript
// src/shared/event-types.ts

// ── Metadata (every event carries this) ────────────────────
export interface EventMetadata {
  correlationId: string;   // originating request ID
  causationId: string;     // event that directly caused this one
  timestamp: number;       // epoch ms
}

// ── Base event envelope ────────────────────────────────────
export interface BaseEvent<TType extends string, TData> {
  type: TType;
  data: TData;
  metadata: EventMetadata;
}

// ── Pipeline types ─────────────────────────────────────────
export type PipelineType = 'training' | 'ingestion' | 'deployment';

export type PipelineStatus =
  | 'idle' | 'running' | 'completed' | 'failed'
  | 'compensating' | 'compensated' | 'paused';

// ── Pipeline events ────────────────────────────────────────
export type PipelineEvent =
  | BaseEvent<'pipeline.started', {
      pipelineId: string;
      pipelineType: PipelineType;
      config: Record<string, unknown>;
    }>
  | BaseEvent<'pipeline.step.started', {
      pipelineId: string;
      step: string;
      stepIndex: number;
    }>
  | BaseEvent<'pipeline.step.completed', {
      pipelineId: string;
      step: string;
      stepIndex: number;
      result: Record<string, unknown>;
      durationMs: number;
    }>
  | BaseEvent<'pipeline.step.failed', {
      pipelineId: string;
      step: string;
      stepIndex: number;
      error: string;
    }>
  | BaseEvent<'pipeline.completed', {
      pipelineId: string;
      totalDurationMs: number;
    }>
  | BaseEvent<'pipeline.failed', {
      pipelineId: string;
      error: string;
      failedStep: string;
    }>
  | BaseEvent<'pipeline.compensating', {
      pipelineId: string;
      stepsToCompensate: string[];
    }>
  | BaseEvent<'pipeline.compensated', {
      pipelineId: string;
      compensatedSteps: string[];
    }>
  | BaseEvent<'pipeline.paused', {
      pipelineId: string;
      step: string;
    }>
  | BaseEvent<'pipeline.resumed', {
      pipelineId: string;
      step: string;
    }>;

// ── Training events ────────────────────────────────────────
export type TrainingEvent =
  | BaseEvent<'training.epoch.completed', {
      sessionId: string;
      epoch: number;
      metrics: Record<string, number>;
    }>
  | BaseEvent<'training.checkpoint.saved', {
      sessionId: string;
      path: string;
      epoch: number;
    }>
  | BaseEvent<'training.heartbeat', {
      sessionId: string;
      epoch: number;
      progress: number; // 0-1
    }>;

// ── Ingestion events ───────────────────────────────────────
export type IngestionEvent =
  | BaseEvent<'ingestion.file.received', {
      uploadId: string;
      filename: string;
      fileSize: number;
    }>
  | BaseEvent<'ingestion.validated', {
      uploadId: string;
      rowCount: number;
      symbol: string;
    }>
  | BaseEvent<'ingestion.completed', {
      uploadId: string;
      symbol: string;
      timeframe: string;
      rowCount: number;
    }>;

// ── Model events ───────────────────────────────────────────
export type ModelEvent =
  | BaseEvent<'model.registered', {
      modelId: string;
      name: string;
      metrics: Record<string, number>;
    }>
  | BaseEvent<'model.promoted', {
      modelId: string;
      previousModelId: string | null;
      reason: string;
    }>
  | BaseEvent<'model.retired', {
      modelId: string;
      reason: string;
    }>;

// ── Cache events ───────────────────────────────────────────
export type CacheEvent =
  | BaseEvent<'cache.invalidate', {
      keys: string[];
    }>;

// ── System events ──────────────────────────────────────────
export type SystemEvent =
  | BaseEvent<'system.startup', {
      version: string;
      databases: Record<string, string>;
    }>
  | BaseEvent<'system.shutdown', {
      reason: string;
    }>;

// ── Union of all domain events ─────────────────────────────
export type DomainEvent =
  | PipelineEvent
  | TrainingEvent
  | IngestionEvent
  | ModelEvent
  | CacheEvent
  | SystemEvent;

// ── Extract event type strings ─────────────────────────────
export type DomainEventType = DomainEvent['type'];

// ── Extract data for a specific event type ─────────────────
export type EventDataFor<T extends DomainEventType> =
  Extract<DomainEvent, { type: T }>['data'];

// ── Stored event (after persistence) ───────────────────────
export interface StoredEvent {
  id: number;
  streamId: string;
  streamPosition: number;
  type: string;
  version: number;
  data: Record<string, unknown>;
  metadata: EventMetadata;
  createdAt: string;
}

// ── New event (before persistence) ─────────────────────────
export interface NewEvent {
  type: string;
  version?: number;
  data: Record<string, unknown>;
  metadata: EventMetadata;
}
```

**Step 4: Run test to verify it passes**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/event-types.test.ts`
Expected: PASS (4 tests)

**Step 5: Type check**

Run: `cd E:/source/repos/ml_dashboard && npx tsc --noEmit`
Expected: No new errors

**Step 6: Commit**

```bash
cd E:/source/repos/ml_dashboard && git add src/shared/event-types.ts tests/event-types.test.ts && git commit -m "feat: add shared domain event type definitions"
```

---

### Task 3: Event Store Schema

**Files:**
- Modify: `src/shared/schema.ts` (add events table)
- Test: `tests/event-store-schema.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/event-store-schema.test.ts
import { describe, it, expect } from 'vitest';
import { events } from '../src/shared/schema';

describe('events table schema', () => {
  it('should have required columns', () => {
    const columns = Object.keys(events);
    expect(columns).toContain('id');
    expect(columns).toContain('streamId');
    expect(columns).toContain('streamPosition');
    expect(columns).toContain('type');
    expect(columns).toContain('version');
    expect(columns).toContain('data');
    expect(columns).toContain('metadata');
    expect(columns).toContain('createdAt');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/event-store-schema.test.ts`
Expected: FAIL — `events` not exported from schema

**Step 3: Add the events table to schema.ts**

Append to `src/shared/schema.ts` after the `ingestedFiles` table (after line 621):

```typescript
// ============================================================
// EVENT STORE
// ============================================================

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  streamId: text("stream_id").notNull(),
  streamPosition: integer("stream_position").notNull(),
  type: text("type").notNull(),
  version: integer("version").notNull().default(1),
  data: text("data").notNull(),          // JSON payload
  metadata: text("metadata").notNull(),  // JSON: correlationId, causationId, timestamp
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  streamPositionUnique: index("events_stream_position_unique").on(table.streamId, table.streamPosition),
  streamIdx: index("idx_events_stream").on(table.streamId, table.streamPosition),
  typeIdx: index("idx_events_type").on(table.type),
  createdIdx: index("idx_events_created").on(table.createdAt),
}));

export type EventRow = typeof events.$inferSelect;
```

**Important:** The `streamPositionUnique` index enforces uniqueness on `(stream_id, stream_position)` for optimistic concurrency. Drizzle SQLite uses `index()` with a unique compound — we rely on the index name convention; for true uniqueness, we add a UNIQUE check at the query layer since Drizzle SQLite doesn't have a `unique()` on compound columns the same way. The event store's `appendToStream` function handles this via transaction + position check.

**Step 4: Run test to verify it passes**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/event-store-schema.test.ts`
Expected: PASS

**Step 5: Push schema to SQLite**

Run: `cd E:/source/repos/ml_dashboard && npx drizzle-kit push`
Expected: `events` table created in `data/ml_dashboard.db`

**Step 6: Commit**

```bash
cd E:/source/repos/ml_dashboard && git add src/shared/schema.ts tests/event-store-schema.test.ts && git commit -m "feat: add events table to Drizzle schema for event sourcing"
```

---

### Task 4: Event Store Operations

**Files:**
- Create: `src/server/events/event-store.ts`
- Test: `tests/event-store.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/event-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/shared/schema';
import { EventStore } from '../src/server/events/event-store';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  // Create events table in memory
  sqlite.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT NOT NULL,
      stream_position INTEGER NOT NULL,
      type TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      data TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(stream_id, stream_position)
    );
    CREATE INDEX idx_events_stream ON events(stream_id, stream_position);
    CREATE INDEX idx_events_type ON events(type);
    CREATE INDEX idx_events_created ON events(created_at);
  `);
  return { db, sqlite };
}

describe('EventStore', () => {
  let store: EventStore;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    store = new EventStore(testDb.db);
    sqlite = testDb.sqlite;
  });

  const metadata = {
    correlationId: 'req-001',
    causationId: 'req-001',
    timestamp: Date.now(),
  };

  it('should append events to a stream', async () => {
    await store.appendToStream('pipeline:test-1', 0, [
      { type: 'pipeline.started', data: { pipelineId: 'test-1' }, metadata },
    ]);

    const events = await store.readStream('pipeline:test-1');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('pipeline.started');
    expect(events[0].streamPosition).toBe(0);
  });

  it('should append multiple events sequentially', async () => {
    await store.appendToStream('pipeline:test-1', 0, [
      { type: 'pipeline.started', data: { pipelineId: 'test-1' }, metadata },
    ]);
    await store.appendToStream('pipeline:test-1', 1, [
      { type: 'pipeline.step.started', data: { step: 'ingesting' }, metadata },
    ]);

    const events = await store.readStream('pipeline:test-1');
    expect(events).toHaveLength(2);
    expect(events[0].streamPosition).toBe(0);
    expect(events[1].streamPosition).toBe(1);
  });

  it('should reject concurrent writes with wrong expected position', async () => {
    await store.appendToStream('pipeline:test-1', 0, [
      { type: 'pipeline.started', data: { pipelineId: 'test-1' }, metadata },
    ]);

    // Both try to write at position 1 — second should fail
    await store.appendToStream('pipeline:test-1', 1, [
      { type: 'pipeline.step.started', data: { step: 'a' }, metadata },
    ]);

    await expect(
      store.appendToStream('pipeline:test-1', 1, [
        { type: 'pipeline.step.started', data: { step: 'b' }, metadata },
      ])
    ).rejects.toThrow();
  });

  it('should read events by type', async () => {
    await store.appendToStream('pipeline:a', 0, [
      { type: 'pipeline.started', data: { pipelineId: 'a' }, metadata },
    ]);
    await store.appendToStream('pipeline:b', 0, [
      { type: 'pipeline.started', data: { pipelineId: 'b' }, metadata },
    ]);
    await store.appendToStream('pipeline:a', 1, [
      { type: 'pipeline.completed', data: { pipelineId: 'a' }, metadata },
    ]);

    const started = await store.readByType('pipeline.started');
    expect(started).toHaveLength(2);
  });

  it('should read stream from a specific position', async () => {
    await store.appendToStream('pipeline:test-1', 0, [
      { type: 'pipeline.started', data: {}, metadata },
    ]);
    await store.appendToStream('pipeline:test-1', 1, [
      { type: 'pipeline.step.started', data: {}, metadata },
    ]);
    await store.appendToStream('pipeline:test-1', 2, [
      { type: 'pipeline.step.completed', data: {}, metadata },
    ]);

    const events = await store.readStream('pipeline:test-1', 1);
    expect(events).toHaveLength(2);
    expect(events[0].streamPosition).toBe(1);
  });

  it('should return current stream position', async () => {
    expect(await store.getStreamPosition('pipeline:new')).toBe(-1);

    await store.appendToStream('pipeline:new', 0, [
      { type: 'pipeline.started', data: {}, metadata },
    ]);
    expect(await store.getStreamPosition('pipeline:new')).toBe(0);

    await store.appendToStream('pipeline:new', 1, [
      { type: 'pipeline.step.started', data: {}, metadata },
    ]);
    expect(await store.getStreamPosition('pipeline:new')).toBe(1);
  });

  it('should find incomplete streams', async () => {
    // Complete pipeline
    await store.appendToStream('pipeline:done', 0, [
      { type: 'pipeline.started', data: {}, metadata },
    ]);
    await store.appendToStream('pipeline:done', 1, [
      { type: 'pipeline.completed', data: {}, metadata },
    ]);

    // Incomplete pipeline
    await store.appendToStream('pipeline:stuck', 0, [
      { type: 'pipeline.started', data: {}, metadata },
    ]);
    await store.appendToStream('pipeline:stuck', 1, [
      { type: 'pipeline.step.started', data: {}, metadata },
    ]);

    const incomplete = await store.findIncompleteStreams('pipeline:');
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0]).toBe('pipeline:stuck');
  });

  it('should append batch of events atomically', async () => {
    await store.appendToStream('pipeline:batch', 0, [
      { type: 'pipeline.started', data: { a: 1 }, metadata },
      { type: 'pipeline.step.started', data: { b: 2 }, metadata },
      { type: 'pipeline.step.completed', data: { c: 3 }, metadata },
    ]);

    const events = await store.readStream('pipeline:batch');
    expect(events).toHaveLength(3);
    expect(events[0].streamPosition).toBe(0);
    expect(events[1].streamPosition).toBe(1);
    expect(events[2].streamPosition).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/event-store.test.ts`
Expected: FAIL — cannot find module `../src/server/events/event-store`

**Step 3: Implement event store**

```typescript
// src/server/events/event-store.ts
import { eq, and, sql, desc, like, notInArray } from 'drizzle-orm';
import { events } from '@shared/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { NewEvent, StoredEvent, EventMetadata } from '@shared/event-types';

type DrizzleDb = BetterSQLite3Database<Record<string, unknown>>;

export class EventStore {
  constructor(private db: DrizzleDb) {}

  /**
   * Append events to a stream with optimistic concurrency.
   * @param streamId - e.g., 'pipeline:abc123'
   * @param expectedPosition - the position of the first new event (0 for new streams)
   * @param newEvents - events to append
   * @throws if expectedPosition conflicts with existing events (UNIQUE constraint)
   */
  async appendToStream(
    streamId: string,
    expectedPosition: number,
    newEvents: NewEvent[],
  ): Promise<StoredEvent[]> {
    const rows = newEvents.map((evt, i) => ({
      streamId,
      streamPosition: expectedPosition + i,
      type: evt.type,
      version: evt.version ?? 1,
      data: JSON.stringify(evt.data),
      metadata: JSON.stringify(evt.metadata),
    }));

    // Insert in a single batch — SQLite UNIQUE(stream_id, stream_position)
    // will reject if position already taken (optimistic concurrency)
    const inserted = await this.db.insert(events).values(rows).returning();

    return inserted.map(toStoredEvent);
  }

  /**
   * Read all events for a stream, ordered by position.
   * @param fromPosition - optional starting position (inclusive)
   */
  async readStream(streamId: string, fromPosition?: number): Promise<StoredEvent[]> {
    const conditions = [eq(events.streamId, streamId)];
    if (fromPosition !== undefined) {
      conditions.push(sql`${events.streamPosition} >= ${fromPosition}`);
    }

    const rows = await this.db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(events.streamPosition);

    return rows.map(toStoredEvent);
  }

  /**
   * Read all events of a specific type across all streams.
   * @param afterId - optional global event ID to read from (exclusive)
   */
  async readByType(type: string, afterId?: number): Promise<StoredEvent[]> {
    const conditions = [eq(events.type, type)];
    if (afterId !== undefined) {
      conditions.push(sql`${events.id} > ${afterId}`);
    }

    const rows = await this.db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(events.id);

    return rows.map(toStoredEvent);
  }

  /**
   * Read all events across all streams (for full rebuild).
   * @param afterId - optional global event ID to read from (exclusive)
   */
  async readAll(afterId?: number): Promise<StoredEvent[]> {
    const conditions = afterId !== undefined
      ? [sql`${events.id} > ${afterId}`]
      : [];

    const rows = await this.db
      .select()
      .from(events)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(events.id);

    return rows.map(toStoredEvent);
  }

  /**
   * Get the current highest position in a stream (-1 if empty).
   */
  async getStreamPosition(streamId: string): Promise<number> {
    const [row] = await this.db
      .select({ maxPos: sql<number>`MAX(${events.streamPosition})` })
      .from(events)
      .where(eq(events.streamId, streamId));

    return row?.maxPos ?? -1;
  }

  /**
   * Find streams that were started but never completed/failed/compensated.
   * Used for crash recovery on startup.
   * @param prefix - stream ID prefix to filter (e.g., 'pipeline:')
   */
  async findIncompleteStreams(prefix: string): Promise<string[]> {
    const terminalTypes = [
      'pipeline.completed',
      'pipeline.failed',
      'pipeline.compensated',
    ];

    // Streams that have a started event
    const startedStreams = await this.db
      .selectDistinct({ streamId: events.streamId })
      .from(events)
      .where(
        and(
          like(events.streamId, `${prefix}%`),
          eq(events.type, 'pipeline.started'),
        )
      );

    // Streams that have a terminal event
    const completedStreams = await this.db
      .selectDistinct({ streamId: events.streamId })
      .from(events)
      .where(
        and(
          like(events.streamId, `${prefix}%`),
          sql`${events.type} IN ('pipeline.completed', 'pipeline.failed', 'pipeline.compensated')`,
        )
      );

    const completedSet = new Set(completedStreams.map(r => r.streamId));
    return startedStreams
      .map(r => r.streamId)
      .filter(id => !completedSet.has(id));
  }
}

function toStoredEvent(row: typeof events.$inferSelect): StoredEvent {
  return {
    id: row.id,
    streamId: row.streamId,
    streamPosition: row.streamPosition,
    type: row.type,
    version: row.version,
    data: JSON.parse(row.data),
    metadata: JSON.parse(row.metadata),
    createdAt: row.createdAt,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/event-store.test.ts`
Expected: PASS (8 tests)

**Step 5: Type check**

Run: `cd E:/source/repos/ml_dashboard && npx tsc --noEmit`
Expected: No new errors

**Step 6: Commit**

```bash
cd E:/source/repos/ml_dashboard && git add src/server/events/event-store.ts tests/event-store.test.ts && git commit -m "feat: implement SQLite event store with optimistic concurrency"
```

---

### Task 5: Typed Event Bus

**Files:**
- Create: `src/server/events/event-bus.ts`
- Test: `tests/event-bus.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/event-bus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../src/server/events/event-bus';
import type { DomainEvent } from '../src/shared/event-types';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should emit and receive typed events', async () => {
    const handler = vi.fn();
    bus.on('pipeline.started', handler);

    const event: DomainEvent = {
      type: 'pipeline.started',
      data: { pipelineId: 'p1', pipelineType: 'training', config: {} },
      metadata: { correlationId: 'r1', causationId: 'r1', timestamp: Date.now() },
    };
    bus.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('should support wildcard subscriptions', async () => {
    const handler = vi.fn();
    bus.on('pipeline.*', handler);

    bus.emit({
      type: 'pipeline.started',
      data: { pipelineId: 'p1', pipelineType: 'training', config: {} },
      metadata: { correlationId: 'r1', causationId: 'r1', timestamp: Date.now() },
    });
    bus.emit({
      type: 'pipeline.completed',
      data: { pipelineId: 'p1', totalDurationMs: 1000 },
      metadata: { correlationId: 'r1', causationId: 'r1', timestamp: Date.now() },
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should support unsubscribe', () => {
    const handler = vi.fn();
    bus.on('pipeline.started', handler);
    bus.off('pipeline.started', handler);

    bus.emit({
      type: 'pipeline.started',
      data: { pipelineId: 'p1', pipelineType: 'training', config: {} },
      metadata: { correlationId: 'r1', causationId: 'r1', timestamp: Date.now() },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should support onAny for all events', () => {
    const handler = vi.fn();
    bus.onAny(handler);

    bus.emit({
      type: 'pipeline.started',
      data: { pipelineId: 'p1', pipelineType: 'training', config: {} },
      metadata: { correlationId: 'r1', causationId: 'r1', timestamp: Date.now() },
    });
    bus.emit({
      type: 'model.registered',
      data: { modelId: 'm1', name: 'test', metrics: {} },
      metadata: { correlationId: 'r2', causationId: 'r2', timestamp: Date.now() },
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/event-bus.test.ts`
Expected: FAIL — cannot find module

**Step 3: Implement event bus**

```typescript
// src/server/events/event-bus.ts
import { EventEmitter2 } from 'eventemitter2';
import type { DomainEvent, DomainEventType } from '@shared/event-types';

type EventHandler = (event: DomainEvent) => void;

/**
 * Typed in-process event bus wrapping eventemitter2.
 * Supports wildcard subscriptions (e.g., 'pipeline.*').
 */
export class EventBus {
  private emitter: EventEmitter2;

  constructor() {
    this.emitter = new EventEmitter2({
      wildcard: true,
      delimiter: '.',
      maxListeners: 50,
    });
  }

  /** Emit a domain event to all matching subscribers. */
  emit(event: DomainEvent): void {
    this.emitter.emit(event.type, event);
  }

  /** Subscribe to a specific event type or wildcard pattern. */
  on(typeOrPattern: string, handler: EventHandler): void {
    this.emitter.on(typeOrPattern, handler);
  }

  /** Unsubscribe a handler from a specific event type or pattern. */
  off(typeOrPattern: string, handler: EventHandler): void {
    this.emitter.off(typeOrPattern, handler);
  }

  /** Subscribe to a specific event type, fire once then auto-unsubscribe. */
  once(typeOrPattern: string, handler: EventHandler): void {
    this.emitter.once(typeOrPattern, handler);
  }

  /** Subscribe to ALL events regardless of type. */
  onAny(handler: EventHandler): void {
    this.emitter.onAny((_type: string | string[], event: DomainEvent) => {
      handler(event);
    });
  }

  /** Remove all listeners (for testing/shutdown). */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}

// ── Singleton ──────────────────────────────────────────────
let globalBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!globalBus) {
    globalBus = new EventBus();
  }
  return globalBus;
}

/** Reset singleton (for testing only). */
export function resetEventBus(): void {
  if (globalBus) {
    globalBus.removeAllListeners();
    globalBus = null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/event-bus.test.ts`
Expected: PASS (4 tests)

**Step 5: Type check**

Run: `cd E:/source/repos/ml_dashboard && npx tsc --noEmit`

**Step 6: Commit**

```bash
cd E:/source/repos/ml_dashboard && git add src/server/events/event-bus.ts tests/event-bus.test.ts && git commit -m "feat: implement typed event bus with wildcard subscriptions"
```

---

### Task 6: Event Store + Event Bus Integration (barrel export + NestJS module)

**Files:**
- Create: `src/server/events/index.ts`
- Create: `src/server/events/events.module.ts`
- Modify: `src/server/app.module.ts` (add EventsModule)

**Step 1: Create barrel export**

```typescript
// src/server/events/index.ts
export { EventStore } from './event-store';
export { EventBus, getEventBus, resetEventBus } from './event-bus';
```

**Step 2: Create NestJS module**

```typescript
// src/server/events/events.module.ts
import { Module, Global, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventStore } from './event-store';
import { EventBus, getEventBus } from './event-bus';
import { db } from '../database/db';

@Global()
@Module({
  providers: [
    {
      provide: EventStore,
      useFactory: () => new EventStore(db),
    },
    {
      provide: EventBus,
      useFactory: () => getEventBus(),
    },
  ],
  exports: [EventStore, EventBus],
})
export class EventsModule {}
```

**Step 3: Register module in app.module.ts**

Add `EventsModule` to imports in `src/server/app.module.ts`:

```typescript
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    CoreModule,
    DatabaseModule,
    EventsModule,       // ← add
    IndicatorsModule,
    LabelsModule,
    XaiModule,
    TrainingModule,
  ],
})
export class AppModule {}
```

**Step 4: Type check**

Run: `cd E:/source/repos/ml_dashboard && npx tsc --noEmit`

**Step 5: Commit**

```bash
cd E:/source/repos/ml_dashboard && git add src/server/events/index.ts src/server/events/events.module.ts src/server/app.module.ts && git commit -m "feat: add EventsModule with NestJS DI registration"
```

---

## Phase 2: State Machines

### Task 7: Training Pipeline State Machine

**Files:**
- Create: `src/shared/machines/training-machine.ts`
- Test: `tests/training-machine.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/training-machine.test.ts
import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { trainingMachine } from '../src/shared/machines/training-machine';

describe('trainingMachine', () => {
  it('should start in idle state', () => {
    const actor = createActor(trainingMachine);
    actor.start();
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });

  it('should transition idle -> ingesting on START', () => {
    const actor = createActor(trainingMachine);
    actor.start();
    actor.send({ type: 'START', pipelineId: 'p1', config: { symbol: 'ES' } });
    expect(actor.getSnapshot().value).toBe('ingesting');
    actor.stop();
  });

  it('should follow happy path to completed', () => {
    const actor = createActor(trainingMachine);
    actor.start();
    actor.send({ type: 'START', pipelineId: 'p1', config: {} });
    expect(actor.getSnapshot().value).toBe('ingesting');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('computing_features');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('generating_labels');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('training');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('evaluating');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('registering');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('completed');

    actor.stop();
  });

  it('should transition to failed on STEP_FAILED from any running state', () => {
    const actor = createActor(trainingMachine);
    actor.start();
    actor.send({ type: 'START', pipelineId: 'p1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} }); // -> computing_features
    actor.send({ type: 'STEP_FAILED', error: 'out of memory' });
    expect(actor.getSnapshot().value).toBe('failed');
    actor.stop();
  });

  it('should transition failed -> compensating -> compensated', () => {
    const actor = createActor(trainingMachine);
    actor.start();
    actor.send({ type: 'START', pipelineId: 'p1', config: {} });
    actor.send({ type: 'STEP_FAILED', error: 'crash' });
    expect(actor.getSnapshot().value).toBe('failed');

    actor.send({ type: 'COMPENSATE' });
    expect(actor.getSnapshot().value).toBe('compensating');

    actor.send({ type: 'COMPENSATION_DONE' });
    expect(actor.getSnapshot().value).toBe('compensated');
    actor.stop();
  });

  it('should support pause and resume during training', () => {
    const actor = createActor(trainingMachine);
    actor.start();
    actor.send({ type: 'START', pipelineId: 'p1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} }); // -> computing_features
    actor.send({ type: 'STEP_COMPLETED', result: {} }); // -> generating_labels
    actor.send({ type: 'STEP_COMPLETED', result: {} }); // -> training

    actor.send({ type: 'PAUSE' });
    expect(actor.getSnapshot().value).toBe('paused');

    actor.send({ type: 'RESUME' });
    expect(actor.getSnapshot().value).toBe('training');
    actor.stop();
  });

  it('should track completed steps in context', () => {
    const actor = createActor(trainingMachine);
    actor.start();
    actor.send({ type: 'START', pipelineId: 'p1', config: { symbol: 'ES' } });
    actor.send({ type: 'STEP_COMPLETED', result: { rowCount: 1000 } });

    const ctx = actor.getSnapshot().context;
    expect(ctx.pipelineId).toBe('p1');
    expect(ctx.completedSteps).toContain('ingesting');
    expect(ctx.stepResults.ingesting).toEqual({ rowCount: 1000 });
    actor.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/training-machine.test.ts`
Expected: FAIL — cannot find module

**Step 3: Implement training machine**

```typescript
// src/shared/machines/training-machine.ts
import { setup, assign } from 'xstate';

export const TRAINING_STEPS = [
  'ingesting',
  'computing_features',
  'generating_labels',
  'training',
  'evaluating',
  'registering',
] as const;

export type TrainingStep = typeof TRAINING_STEPS[number];

export interface TrainingContext {
  pipelineId: string;
  config: Record<string, unknown>;
  completedSteps: string[];
  stepResults: Record<string, Record<string, unknown>>;
  currentStep: string;
  error: string | null;
  startedAt: number;
  pausedAt: string; // the state to resume to after pause
}

type TrainingEvents =
  | { type: 'START'; pipelineId: string; config: Record<string, unknown> }
  | { type: 'STEP_COMPLETED'; result: Record<string, unknown> }
  | { type: 'STEP_FAILED'; error: string }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'COMPENSATE' }
  | { type: 'COMPENSATION_DONE' };

export const trainingMachine = setup({
  types: {
    context: {} as TrainingContext,
    events: {} as TrainingEvents,
  },
}).createMachine({
  id: 'training-pipeline',
  initial: 'idle',
  context: {
    pipelineId: '',
    config: {},
    completedSteps: [],
    stepResults: {},
    currentStep: '',
    error: null,
    startedAt: 0,
    pausedAt: '',
  },
  states: {
    idle: {
      on: {
        START: {
          target: 'ingesting',
          actions: assign({
            pipelineId: ({ event }) => event.pipelineId,
            config: ({ event }) => event.config,
            completedSteps: () => [],
            stepResults: () => ({}),
            currentStep: () => 'ingesting',
            error: () => null,
            startedAt: () => Date.now(),
          }),
        },
      },
    },
    ingesting: {
      on: {
        STEP_COMPLETED: {
          target: 'computing_features',
          actions: assign({
            completedSteps: ({ context }) => [...context.completedSteps, 'ingesting'],
            stepResults: ({ context, event }) => ({
              ...context.stepResults,
              ingesting: event.result,
            }),
            currentStep: () => 'computing_features',
          }),
        },
        STEP_FAILED: {
          target: 'failed',
          actions: assign({
            error: ({ event }) => event.error,
          }),
        },
      },
    },
    computing_features: {
      on: {
        STEP_COMPLETED: {
          target: 'generating_labels',
          actions: assign({
            completedSteps: ({ context }) => [...context.completedSteps, 'computing_features'],
            stepResults: ({ context, event }) => ({
              ...context.stepResults,
              computing_features: event.result,
            }),
            currentStep: () => 'generating_labels',
          }),
        },
        STEP_FAILED: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error }),
        },
      },
    },
    generating_labels: {
      on: {
        STEP_COMPLETED: {
          target: 'training',
          actions: assign({
            completedSteps: ({ context }) => [...context.completedSteps, 'generating_labels'],
            stepResults: ({ context, event }) => ({
              ...context.stepResults,
              generating_labels: event.result,
            }),
            currentStep: () => 'training',
          }),
        },
        STEP_FAILED: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error }),
        },
      },
    },
    training: {
      on: {
        STEP_COMPLETED: {
          target: 'evaluating',
          actions: assign({
            completedSteps: ({ context }) => [...context.completedSteps, 'training'],
            stepResults: ({ context, event }) => ({
              ...context.stepResults,
              training: event.result,
            }),
            currentStep: () => 'evaluating',
          }),
        },
        STEP_FAILED: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error }),
        },
        PAUSE: {
          target: 'paused',
          actions: assign({ pausedAt: () => 'training' }),
        },
      },
    },
    evaluating: {
      on: {
        STEP_COMPLETED: {
          target: 'registering',
          actions: assign({
            completedSteps: ({ context }) => [...context.completedSteps, 'evaluating'],
            stepResults: ({ context, event }) => ({
              ...context.stepResults,
              evaluating: event.result,
            }),
            currentStep: () => 'registering',
          }),
        },
        STEP_FAILED: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error }),
        },
      },
    },
    registering: {
      on: {
        STEP_COMPLETED: {
          target: 'completed',
          actions: assign({
            completedSteps: ({ context }) => [...context.completedSteps, 'registering'],
            stepResults: ({ context, event }) => ({
              ...context.stepResults,
              registering: event.result,
            }),
            currentStep: () => '',
          }),
        },
        STEP_FAILED: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error }),
        },
      },
    },
    paused: {
      on: {
        RESUME: [
          {
            guard: ({ context }) => context.pausedAt === 'training',
            target: 'training',
          },
          {
            guard: ({ context }) => context.pausedAt === 'ingesting',
            target: 'ingesting',
          },
          {
            guard: ({ context }) => context.pausedAt === 'computing_features',
            target: 'computing_features',
          },
          {
            guard: ({ context }) => context.pausedAt === 'generating_labels',
            target: 'generating_labels',
          },
          {
            guard: ({ context }) => context.pausedAt === 'evaluating',
            target: 'evaluating',
          },
          {
            guard: ({ context }) => context.pausedAt === 'registering',
            target: 'registering',
          },
        ],
        STEP_FAILED: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error }),
        },
      },
    },
    failed: {
      on: {
        COMPENSATE: { target: 'compensating' },
      },
    },
    compensating: {
      on: {
        COMPENSATION_DONE: { target: 'compensated' },
        STEP_FAILED: {
          // Compensation itself failed — still mark compensated to avoid infinite loop
          target: 'compensated',
          actions: assign({
            error: ({ context, event }) =>
              `${context.error}; compensation failed: ${event.error}`,
          }),
        },
      },
    },
    completed: { type: 'final' },
    compensated: { type: 'final' },
  },
});
```

**Step 4: Run test to verify it passes**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/training-machine.test.ts`
Expected: PASS (7 tests)

**Step 5: Type check**

Run: `cd E:/source/repos/ml_dashboard && npx tsc --noEmit`

**Step 6: Commit**

```bash
cd E:/source/repos/ml_dashboard && git add src/shared/machines/training-machine.ts tests/training-machine.test.ts && git commit -m "feat: add XState v5 training pipeline state machine"
```

---

### Task 8: Ingestion Pipeline State Machine

**Files:**
- Create: `src/shared/machines/ingestion-machine.ts`
- Test: `tests/ingestion-machine.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/ingestion-machine.test.ts
import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { ingestionMachine } from '../src/shared/machines/ingestion-machine';

describe('ingestionMachine', () => {
  it('should start in idle state', () => {
    const actor = createActor(ingestionMachine);
    actor.start();
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });

  it('should follow happy path to completed', () => {
    const actor = createActor(ingestionMachine);
    actor.start();
    actor.send({ type: 'START', pipelineId: 'i1', config: { filename: 'data.csv' } });
    expect(actor.getSnapshot().value).toBe('uploading');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('validating');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('deduplicating');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('ingesting_duckdb');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('syncing_questdb');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('computing_indicators');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('completed');
    actor.stop();
  });

  it('should transition to failed and compensate', () => {
    const actor = createActor(ingestionMachine);
    actor.start();
    actor.send({ type: 'START', pipelineId: 'i1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} }); // -> validating
    actor.send({ type: 'STEP_COMPLETED', result: {} }); // -> deduplicating
    actor.send({ type: 'STEP_FAILED', error: 'disk full' });
    expect(actor.getSnapshot().value).toBe('failed');

    actor.send({ type: 'COMPENSATE' });
    expect(actor.getSnapshot().value).toBe('compensating');

    actor.send({ type: 'COMPENSATION_DONE' });
    expect(actor.getSnapshot().value).toBe('compensated');
    actor.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/ingestion-machine.test.ts`

**Step 3: Implement ingestion machine**

Follow same pattern as training machine. States: `idle -> uploading -> validating -> deduplicating -> ingesting_duckdb -> syncing_questdb -> computing_indicators -> completed`. Same `failed -> compensating -> compensated` error path. Same context shape with `completedSteps`, `stepResults`, `currentStep`.

```typescript
// src/shared/machines/ingestion-machine.ts
import { setup, assign } from 'xstate';

export const INGESTION_STEPS = [
  'uploading',
  'validating',
  'deduplicating',
  'ingesting_duckdb',
  'syncing_questdb',
  'computing_indicators',
] as const;

export type IngestionStep = typeof INGESTION_STEPS[number];

export interface IngestionContext {
  pipelineId: string;
  config: Record<string, unknown>;
  completedSteps: string[];
  stepResults: Record<string, Record<string, unknown>>;
  currentStep: string;
  error: string | null;
  startedAt: number;
}

type IngestionEvents =
  | { type: 'START'; pipelineId: string; config: Record<string, unknown> }
  | { type: 'STEP_COMPLETED'; result: Record<string, unknown> }
  | { type: 'STEP_FAILED'; error: string }
  | { type: 'COMPENSATE' }
  | { type: 'COMPENSATION_DONE' };

const stepTransition = (currentStepName: IngestionStep, nextState: string) => ({
  STEP_COMPLETED: {
    target: nextState,
    actions: assign({
      completedSteps: ({ context }: { context: IngestionContext }) =>
        [...context.completedSteps, currentStepName],
      stepResults: ({ context, event }: { context: IngestionContext; event: { result: Record<string, unknown> } }) =>
        ({ ...context.stepResults, [currentStepName]: event.result }),
      currentStep: () => nextState === 'completed' ? '' : nextState,
    }),
  },
  STEP_FAILED: {
    target: 'failed' as const,
    actions: assign({ error: ({ event }: { event: { error: string } }) => event.error }),
  },
});

export const ingestionMachine = setup({
  types: {
    context: {} as IngestionContext,
    events: {} as IngestionEvents,
  },
}).createMachine({
  id: 'ingestion-pipeline',
  initial: 'idle',
  context: {
    pipelineId: '',
    config: {},
    completedSteps: [],
    stepResults: {},
    currentStep: '',
    error: null,
    startedAt: 0,
  },
  states: {
    idle: {
      on: {
        START: {
          target: 'uploading',
          actions: assign({
            pipelineId: ({ event }) => event.pipelineId,
            config: ({ event }) => event.config,
            completedSteps: () => [],
            stepResults: () => ({}),
            currentStep: () => 'uploading',
            error: () => null,
            startedAt: () => Date.now(),
          }),
        },
      },
    },
    uploading: { on: stepTransition('uploading', 'validating') },
    validating: { on: stepTransition('validating', 'deduplicating') },
    deduplicating: { on: stepTransition('deduplicating', 'ingesting_duckdb') },
    ingesting_duckdb: { on: stepTransition('ingesting_duckdb', 'syncing_questdb') },
    syncing_questdb: { on: stepTransition('syncing_questdb', 'computing_indicators') },
    computing_indicators: { on: stepTransition('computing_indicators', 'completed') },
    failed: {
      on: { COMPENSATE: { target: 'compensating' } },
    },
    compensating: {
      on: {
        COMPENSATION_DONE: { target: 'compensated' },
        STEP_FAILED: {
          target: 'compensated',
          actions: assign({
            error: ({ context, event }) =>
              `${context.error}; compensation failed: ${event.error}`,
          }),
        },
      },
    },
    completed: { type: 'final' },
    compensated: { type: 'final' },
  },
});
```

**Step 4: Run test to verify it passes**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/ingestion-machine.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
cd E:/source/repos/ml_dashboard && git add src/shared/machines/ingestion-machine.ts tests/ingestion-machine.test.ts && git commit -m "feat: add XState v5 ingestion pipeline state machine"
```

---

### Task 9: Deployment Pipeline State Machine

**Files:**
- Create: `src/shared/machines/deployment-machine.ts`
- Test: `tests/deployment-machine.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/deployment-machine.test.ts
import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { deploymentMachine } from '../src/shared/machines/deployment-machine';

describe('deploymentMachine', () => {
  it('should start in idle state', () => {
    const actor = createActor(deploymentMachine);
    actor.start();
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });

  it('should follow happy path to active', () => {
    const actor = createActor(deploymentMachine);
    actor.start();
    actor.send({ type: 'START', pipelineId: 'd1', config: { modelId: 'mdl-001' } });
    expect(actor.getSnapshot().value).toBe('validating_benchmarks');

    actor.send({ type: 'STEP_COMPLETED', result: { sharpe: 1.5, accuracy: 0.57 } });
    expect(actor.getSnapshot().value).toBe('promoting');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('monitoring');

    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(actor.getSnapshot().value).toBe('active');
    actor.stop();
  });

  it('should handle validation failure', () => {
    const actor = createActor(deploymentMachine);
    actor.start();
    actor.send({ type: 'START', pipelineId: 'd1', config: {} });
    actor.send({ type: 'STEP_FAILED', error: 'Sharpe < 1.0' });
    expect(actor.getSnapshot().value).toBe('failed');
    actor.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/deployment-machine.test.ts`

**Step 3: Implement deployment machine**

```typescript
// src/shared/machines/deployment-machine.ts
import { setup, assign } from 'xstate';

export const DEPLOYMENT_STEPS = [
  'validating_benchmarks',
  'promoting',
  'monitoring',
] as const;

export type DeploymentStep = typeof DEPLOYMENT_STEPS[number];

export interface DeploymentContext {
  pipelineId: string;
  config: Record<string, unknown>;
  completedSteps: string[];
  stepResults: Record<string, Record<string, unknown>>;
  currentStep: string;
  error: string | null;
  startedAt: number;
}

type DeploymentEvents =
  | { type: 'START'; pipelineId: string; config: Record<string, unknown> }
  | { type: 'STEP_COMPLETED'; result: Record<string, unknown> }
  | { type: 'STEP_FAILED'; error: string }
  | { type: 'COMPENSATE' }
  | { type: 'COMPENSATION_DONE' };

export const deploymentMachine = setup({
  types: {
    context: {} as DeploymentContext,
    events: {} as DeploymentEvents,
  },
}).createMachine({
  id: 'deployment-pipeline',
  initial: 'idle',
  context: {
    pipelineId: '',
    config: {},
    completedSteps: [],
    stepResults: {},
    currentStep: '',
    error: null,
    startedAt: 0,
  },
  states: {
    idle: {
      on: {
        START: {
          target: 'validating_benchmarks',
          actions: assign({
            pipelineId: ({ event }) => event.pipelineId,
            config: ({ event }) => event.config,
            completedSteps: () => [],
            stepResults: () => ({}),
            currentStep: () => 'validating_benchmarks',
            error: () => null,
            startedAt: () => Date.now(),
          }),
        },
      },
    },
    validating_benchmarks: {
      on: {
        STEP_COMPLETED: {
          target: 'promoting',
          actions: assign({
            completedSteps: ({ context }) => [...context.completedSteps, 'validating_benchmarks'],
            stepResults: ({ context, event }) => ({ ...context.stepResults, validating_benchmarks: event.result }),
            currentStep: () => 'promoting',
          }),
        },
        STEP_FAILED: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error }),
        },
      },
    },
    promoting: {
      on: {
        STEP_COMPLETED: {
          target: 'monitoring',
          actions: assign({
            completedSteps: ({ context }) => [...context.completedSteps, 'promoting'],
            stepResults: ({ context, event }) => ({ ...context.stepResults, promoting: event.result }),
            currentStep: () => 'monitoring',
          }),
        },
        STEP_FAILED: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error }),
        },
      },
    },
    monitoring: {
      on: {
        STEP_COMPLETED: {
          target: 'active',
          actions: assign({
            completedSteps: ({ context }) => [...context.completedSteps, 'monitoring'],
            stepResults: ({ context, event }) => ({ ...context.stepResults, monitoring: event.result }),
            currentStep: () => '',
          }),
        },
        STEP_FAILED: {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error }),
        },
      },
    },
    failed: {
      on: { COMPENSATE: { target: 'compensating' } },
    },
    compensating: {
      on: {
        COMPENSATION_DONE: { target: 'compensated' },
        STEP_FAILED: {
          target: 'compensated',
          actions: assign({
            error: ({ context, event }) => `${context.error}; compensation failed: ${event.error}`,
          }),
        },
      },
    },
    active: { type: 'final' },
    compensated: { type: 'final' },
  },
});
```

**Step 4: Run tests, type check, commit**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/deployment-machine.test.ts`
Expected: PASS (3 tests)

```bash
cd E:/source/repos/ml_dashboard && git add src/shared/machines/deployment-machine.ts tests/deployment-machine.test.ts && git commit -m "feat: add XState v5 deployment pipeline state machine"
```

---

### Task 10: Machines barrel export

**Files:**
- Create: `src/shared/machines/index.ts`

```typescript
// src/shared/machines/index.ts
export { trainingMachine, TRAINING_STEPS, type TrainingStep, type TrainingContext } from './training-machine';
export { ingestionMachine, INGESTION_STEPS, type IngestionStep, type IngestionContext } from './ingestion-machine';
export { deploymentMachine, DEPLOYMENT_STEPS, type DeploymentStep, type DeploymentContext } from './deployment-machine';
```

```bash
cd E:/source/repos/ml_dashboard && git add src/shared/machines/index.ts && git commit -m "feat: barrel export for pipeline state machines"
```

---

## Phase 3: Saga Orchestrator

### Task 11: Saga Orchestrator Core

**Files:**
- Create: `src/server/sagas/orchestrator.ts`
- Test: `tests/saga-orchestrator.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/saga-orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/shared/schema';
import { EventStore } from '../src/server/events/event-store';
import { EventBus } from '../src/server/events/event-bus';
import { SagaOrchestrator, type SagaStep } from '../src/server/sagas/orchestrator';
import { trainingMachine } from '../src/shared/machines/training-machine';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  sqlite.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT NOT NULL,
      stream_position INTEGER NOT NULL,
      type TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      data TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(stream_id, stream_position)
    );
  `);
  return db;
}

describe('SagaOrchestrator', () => {
  let eventStore: EventStore;
  let eventBus: EventBus;

  beforeEach(() => {
    eventStore = new EventStore(createTestDb());
    eventBus = new EventBus();
  });

  it('should execute all steps in order for happy path', async () => {
    const executionOrder: string[] = [];
    const steps: SagaStep[] = [
      { name: 'ingesting', execute: async () => { executionOrder.push('ingest'); return { rows: 100 }; } },
      { name: 'computing_features', execute: async () => { executionOrder.push('features'); return { count: 29 }; } },
      { name: 'generating_labels', execute: async () => { executionOrder.push('labels'); return { count: 1000 }; } },
      { name: 'training', execute: async () => { executionOrder.push('train'); return { loss: 0.3 }; } },
      { name: 'evaluating', execute: async () => { executionOrder.push('eval'); return { sharpe: 1.5 }; } },
      { name: 'registering', execute: async () => { executionOrder.push('register'); return { modelId: 'm1' }; } },
    ];

    const saga = new SagaOrchestrator(eventStore, eventBus, trainingMachine, steps);
    await saga.execute('test-pipeline-1', { symbol: 'ES', timeframe: '1m' });

    expect(executionOrder).toEqual(['ingest', 'features', 'labels', 'train', 'eval', 'register']);

    // Verify events were persisted
    const events = await eventStore.readStream('pipeline:test-pipeline-1');
    expect(events.length).toBeGreaterThanOrEqual(13); // started + 6*(step.started + step.completed) + completed
    expect(events[0].type).toBe('pipeline.started');
    expect(events[events.length - 1].type).toBe('pipeline.completed');
  });

  it('should run compensation on step failure', async () => {
    const compensated: string[] = [];
    const steps: SagaStep[] = [
      {
        name: 'ingesting',
        execute: async () => ({ rows: 100 }),
        compensate: async () => { compensated.push('ingesting'); },
      },
      {
        name: 'computing_features',
        execute: async () => { throw new Error('out of memory'); },
        compensate: async () => { compensated.push('computing_features'); },
      },
      {
        name: 'generating_labels',
        execute: async () => ({}),
        compensate: async () => { compensated.push('generating_labels'); },
      },
      { name: 'training', execute: async () => ({}) },
      { name: 'evaluating', execute: async () => ({}) },
      { name: 'registering', execute: async () => ({}) },
    ];

    const saga = new SagaOrchestrator(eventStore, eventBus, trainingMachine, steps);
    await expect(saga.execute('fail-pipe', {})).rejects.toThrow('out of memory');

    // Only completed steps should be compensated, in reverse order
    expect(compensated).toEqual(['ingesting']);
  });

  it('should emit events to the event bus', async () => {
    const receivedEvents: string[] = [];
    eventBus.on('pipeline.*', (event) => { receivedEvents.push(event.type); });

    const steps: SagaStep[] = [
      { name: 'ingesting', execute: async () => ({}) },
      { name: 'computing_features', execute: async () => ({}) },
      { name: 'generating_labels', execute: async () => ({}) },
      { name: 'training', execute: async () => ({}) },
      { name: 'evaluating', execute: async () => ({}) },
      { name: 'registering', execute: async () => ({}) },
    ];

    const saga = new SagaOrchestrator(eventStore, eventBus, trainingMachine, steps);
    await saga.execute('bus-pipe', {});

    expect(receivedEvents).toContain('pipeline.started');
    expect(receivedEvents).toContain('pipeline.completed');
    expect(receivedEvents.filter(e => e === 'pipeline.step.started')).toHaveLength(6);
    expect(receivedEvents.filter(e => e === 'pipeline.step.completed')).toHaveLength(6);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/saga-orchestrator.test.ts`

**Step 3: Implement saga orchestrator**

```typescript
// src/server/sagas/orchestrator.ts
import { createActor, type AnyStateMachine, type AnyActorRef } from 'xstate';
import { EventStore } from '../events/event-store';
import { EventBus } from '../events/event-bus';
import type { DomainEvent, EventMetadata, NewEvent } from '@shared/event-types';
import crypto from 'crypto';

export interface SagaStep {
  name: string;
  execute: (context: Record<string, unknown>) => Promise<Record<string, unknown>>;
  compensate?: (context: Record<string, unknown>) => Promise<void>;
  timeout?: number;
}

export class SagaOrchestrator {
  private actor: AnyActorRef | null = null;

  constructor(
    private eventStore: EventStore,
    private eventBus: EventBus,
    private machine: AnyStateMachine,
    private steps: SagaStep[],
  ) {}

  /**
   * Execute the full pipeline saga.
   * Persists every state transition as an event, runs compensation on failure.
   */
  async execute(
    pipelineId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const streamId = `pipeline:${pipelineId}`;
    const correlationId = crypto.randomUUID();
    let position = 0;
    let lastEventId = correlationId;

    const meta = (): EventMetadata => ({
      correlationId,
      causationId: lastEventId,
      timestamp: Date.now(),
    });

    const persistAndEmit = async (event: NewEvent): Promise<void> => {
      const stored = await this.eventStore.appendToStream(streamId, position, [event]);
      position++;
      lastEventId = stored[0].id.toString();
      this.eventBus.emit({
        type: event.type,
        data: event.data,
        metadata: event.metadata,
      } as DomainEvent);
    };

    // Start the XState actor
    this.actor = createActor(this.machine);
    this.actor.start();
    this.actor.send({ type: 'START', pipelineId, config });

    // Persist pipeline.started
    await persistAndEmit({
      type: 'pipeline.started',
      data: { pipelineId, pipelineType: 'training', config },
      metadata: meta(),
    });

    const completedSteps: SagaStep[] = [];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];

      // Persist step.started
      await persistAndEmit({
        type: 'pipeline.step.started',
        data: { pipelineId, step: step.name, stepIndex: i },
        metadata: meta(),
      });

      try {
        const startMs = Date.now();
        const result = await (step.timeout
          ? withTimeout(step.execute(config), step.timeout)
          : step.execute(config));
        const durationMs = Date.now() - startMs;

        // Advance state machine
        this.actor.send({ type: 'STEP_COMPLETED', result });

        // Persist step.completed
        await persistAndEmit({
          type: 'pipeline.step.completed',
          data: { pipelineId, step: step.name, stepIndex: i, result, durationMs },
          metadata: meta(),
        });

        completedSteps.push(step);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        // Advance state machine to failed
        this.actor.send({ type: 'STEP_FAILED', error: errorMsg });

        // Persist step.failed
        await persistAndEmit({
          type: 'pipeline.step.failed',
          data: { pipelineId, step: step.name, stepIndex: i, error: errorMsg },
          metadata: meta(),
        });

        // Persist pipeline.failed
        await persistAndEmit({
          type: 'pipeline.failed',
          data: { pipelineId, error: errorMsg, failedStep: step.name },
          metadata: meta(),
        });

        // Run compensation
        await this.compensate(completedSteps, config, pipelineId, streamId, position, meta);

        this.actor.stop();
        this.actor = null;
        throw err;
      }
    }

    // Persist pipeline.completed
    const totalDurationMs = Date.now() - (this.actor.getSnapshot().context as any).startedAt;
    await persistAndEmit({
      type: 'pipeline.completed',
      data: { pipelineId, totalDurationMs },
      metadata: meta(),
    });

    this.actor.stop();
    this.actor = null;
  }

  private async compensate(
    completedSteps: SagaStep[],
    config: Record<string, unknown>,
    pipelineId: string,
    streamId: string,
    startPosition: number,
    meta: () => EventMetadata,
  ): Promise<void> {
    if (this.actor) {
      this.actor.send({ type: 'COMPENSATE' });
    }

    let position = startPosition;
    const stepsToCompensate = completedSteps.filter(s => s.compensate).map(s => s.name);

    const persistCompEvent = async (event: NewEvent) => {
      await this.eventStore.appendToStream(streamId, position, [event]);
      position++;
      this.eventBus.emit({
        type: event.type,
        data: event.data,
        metadata: event.metadata,
      } as DomainEvent);
    };

    await persistCompEvent({
      type: 'pipeline.compensating',
      data: { pipelineId, stepsToCompensate },
      metadata: meta(),
    });

    const compensatedSteps: string[] = [];

    // Reverse order compensation
    for (const step of [...completedSteps].reverse()) {
      if (step.compensate) {
        try {
          await step.compensate(config);
          compensatedSteps.push(step.name);
        } catch (compErr) {
          // Log but continue compensating other steps
          console.error(`[saga] compensation failed for step ${step.name}:`, compErr);
        }
      }
    }

    await persistCompEvent({
      type: 'pipeline.compensated',
      data: { pipelineId, compensatedSteps },
      metadata: meta(),
    });

    if (this.actor) {
      this.actor.send({ type: 'COMPENSATION_DONE' });
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Step timed out after ${ms}ms`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/saga-orchestrator.test.ts`
Expected: PASS (3 tests)

**Step 5: Type check + commit**

```bash
cd E:/source/repos/ml_dashboard && npx tsc --noEmit && git add src/server/sagas/orchestrator.ts tests/saga-orchestrator.test.ts && git commit -m "feat: implement saga orchestrator with event persistence and compensation"
```

---

## Phase 4: SSE + Cache

### Task 12: SSE Event Adapter

**Files:**
- Create: `src/server/events/sse-adapter.ts`
- Test: `tests/sse-adapter.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/sse-adapter.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../src/server/events/event-bus';
import { SSEAdapter } from '../src/server/events/sse-adapter';

// Mock Express Response
function createMockResponse() {
  const chunks: string[] = [];
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((data: string) => { chunks.push(data); return true; }),
    end: vi.fn(),
    on: vi.fn(),
    headersSent: false,
    chunks,
  };
}

describe('SSEAdapter', () => {
  let bus: EventBus;
  let adapter: SSEAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new SSEAdapter(bus);
  });

  afterEach(() => {
    adapter.shutdown();
    bus.removeAllListeners();
  });

  it('should send SSE-formatted event to connected clients', () => {
    const res = createMockResponse();
    adapter.addClient('pipeline', res as any);

    bus.emit({
      type: 'pipeline.started',
      data: { pipelineId: 'p1', pipelineType: 'training', config: {} },
      metadata: { correlationId: 'r1', causationId: 'r1', timestamp: Date.now() },
    });

    expect(res.chunks.length).toBeGreaterThanOrEqual(2); // connected + event
    const eventChunk = res.chunks.find(c => c.includes('pipeline.started'));
    expect(eventChunk).toBeDefined();
  });

  it('should only send events matching the channel', () => {
    const pipelineRes = createMockResponse();
    const trainingRes = createMockResponse();
    adapter.addClient('pipeline', pipelineRes as any);
    adapter.addClient('training', trainingRes as any);

    bus.emit({
      type: 'pipeline.started',
      data: { pipelineId: 'p1', pipelineType: 'training', config: {} },
      metadata: { correlationId: 'r1', causationId: 'r1', timestamp: Date.now() },
    });

    const pipelineHasEvent = pipelineRes.chunks.some(c => c.includes('pipeline.started'));
    const trainingHasEvent = trainingRes.chunks.some(c => c.includes('pipeline.started'));
    expect(pipelineHasEvent).toBe(true);
    expect(trainingHasEvent).toBe(false);
  });

  it('should remove disconnected clients', () => {
    const res = createMockResponse();
    let closeHandler: (() => void) | undefined;
    res.on = vi.fn((event: string, handler: () => void) => {
      if (event === 'close') closeHandler = handler;
    });

    adapter.addClient('pipeline', res as any);
    expect(adapter.clientCount('pipeline')).toBe(1);

    // Simulate client disconnect
    closeHandler!();
    expect(adapter.clientCount('pipeline')).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/sse-adapter.test.ts`

**Step 3: Implement SSE adapter**

```typescript
// src/server/events/sse-adapter.ts
import type { Response } from 'express';
import type { EventBus } from './event-bus';
import type { DomainEvent } from '@shared/event-types';

type SSEChannel = 'pipeline' | 'training' | 'system';

const CHANNEL_PATTERNS: Record<SSEChannel, string[]> = {
  pipeline: ['pipeline.*'],
  training: ['training.*'],
  system: ['cache.*', 'system.*', 'model.*', 'ingestion.*'],
};

interface SSEClient {
  id: string;
  res: Response;
  channel: SSEChannel;
}

export class SSEAdapter {
  private clients: Map<string, SSEClient> = new Map();
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private clientIdCounter = 0;

  constructor(private eventBus: EventBus) {
    // Subscribe to all events and fan out to matching clients
    this.eventBus.onAny((event: DomainEvent) => {
      this.broadcast(event);
    });

    // Keepalive every 15 seconds
    this.keepaliveInterval = setInterval(() => {
      for (const client of this.clients.values()) {
        client.res.write(`:keepalive ${Date.now()}\n\n`);
      }
    }, 15_000);
  }

  /** Register a new SSE client connection. */
  addClient(channel: SSEChannel, res: Response): string {
    const id = `sse-${++this.clientIdCounter}`;

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send connected event
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId: id, channel, ts: new Date().toISOString() })}\n\n`);

    const client: SSEClient = { id, res, channel };
    this.clients.set(id, client);

    // Remove on disconnect
    res.on('close', () => {
      this.clients.delete(id);
    });

    return id;
  }

  /** Get count of connected clients for a channel. */
  clientCount(channel: SSEChannel): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.channel === channel) count++;
    }
    return count;
  }

  /** Broadcast an event to all clients on matching channels. */
  private broadcast(event: DomainEvent): void {
    const eventPrefix = event.type.split('.')[0];

    for (const client of this.clients.values()) {
      const patterns = CHANNEL_PATTERNS[client.channel];
      const matches = patterns.some(p => {
        const prefix = p.split('.')[0];
        return prefix === eventPrefix;
      });

      if (matches) {
        const sseData = JSON.stringify({
          type: event.type,
          data: event.data,
          metadata: event.metadata,
        });
        client.res.write(`event: ${event.type}\ndata: ${sseData}\n\n`);
      }
    }
  }

  /** Clean up (for shutdown). */
  shutdown(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
    for (const client of this.clients.values()) {
      client.res.end();
    }
    this.clients.clear();
  }
}
```

**Step 4: Run tests, type check, commit**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/sse-adapter.test.ts`

```bash
cd E:/source/repos/ml_dashboard && git add src/server/events/sse-adapter.ts tests/sse-adapter.test.ts && git commit -m "feat: SSE adapter broadcasts event bus events to connected clients"
```

---

### Task 13: Server-Side Cache with Event-Driven Invalidation

**Files:**
- Create: `src/server/cache/query-cache.ts`
- Test: `tests/query-cache.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/query-cache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryCache } from '../src/server/cache/query-cache';
import { EventBus } from '../src/server/events/event-bus';

describe('QueryCache', () => {
  let cache: QueryCache;
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
    cache = new QueryCache(bus, { max: 100, ttl: 60_000 });
  });

  it('should cache and retrieve values', () => {
    cache.set('charts:ES:1m', [1, 2, 3]);
    expect(cache.get('charts:ES:1m')).toEqual([1, 2, 3]);
  });

  it('should return undefined for missing keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should invalidate keys matching a prefix on ingestion.completed', () => {
    cache.set('charts:ES:1m', [1]);
    cache.set('charts:ES:5m', [2]);
    cache.set('charts:NQ:1m', [3]);
    cache.set('indicators:ES:1m', [4]);

    // Emit ingestion completed for ES
    bus.emit({
      type: 'ingestion.completed',
      data: { uploadId: 'u1', symbol: 'ES', timeframe: '1m', rowCount: 100 },
      metadata: { correlationId: 'r1', causationId: 'r1', timestamp: Date.now() },
    });

    // ES keys should be invalidated
    expect(cache.get('charts:ES:1m')).toBeUndefined();
    expect(cache.get('charts:ES:5m')).toBeUndefined();
    expect(cache.get('indicators:ES:1m')).toBeUndefined();

    // NQ keys should survive
    expect(cache.get('charts:NQ:1m')).toEqual([3]);
  });

  it('should emit cache.invalidate event to bus', () => {
    const handler = vi.fn();
    bus.on('cache.invalidate', handler);

    cache.set('charts:ES:1m', [1]);

    bus.emit({
      type: 'ingestion.completed',
      data: { uploadId: 'u1', symbol: 'ES', timeframe: '1m', rowCount: 100 },
      metadata: { correlationId: 'r1', causationId: 'r1', timestamp: Date.now() },
    });

    expect(handler).toHaveBeenCalledOnce();
    const cacheEvent = handler.mock.calls[0][0];
    expect(cacheEvent.data.keys.length).toBeGreaterThan(0);
  });

  it('should report stats', () => {
    cache.set('a', 1);
    cache.get('a'); // hit
    cache.get('b'); // miss

    const stats = cache.getStats();
    expect(stats.size).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/query-cache.test.ts`

**Step 3: Implement query cache**

```typescript
// src/server/cache/query-cache.ts
import { LRUCache } from 'lru-cache';
import type { EventBus } from '../events/event-bus';
import type { DomainEvent } from '@shared/event-types';

interface QueryCacheOptions {
  max: number;
  ttl: number; // ms
}

export class QueryCache {
  private cache: LRUCache<string, unknown>;

  constructor(
    private eventBus: EventBus,
    options: QueryCacheOptions = { max: 500, ttl: 5 * 60_000 },
  ) {
    this.cache = new LRUCache({
      max: options.max,
      ttl: options.ttl,
    });

    // Auto-invalidate on domain events
    this.eventBus.on('ingestion.*', (event: DomainEvent) => {
      if (event.type === 'ingestion.completed') {
        const symbol = (event.data as any).symbol;
        if (symbol) this.invalidateBySymbol(symbol);
      }
    });

    this.eventBus.on('model.*', (_event: DomainEvent) => {
      this.invalidateByPrefix('models:');
    });

    this.eventBus.on('training.*', (_event: DomainEvent) => {
      this.invalidateByPrefix('training:');
    });
  }

  get<T>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.cache.set(key, value);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  /** Invalidate all keys containing the given symbol. */
  private invalidateBySymbol(symbol: string): void {
    const invalidated: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.includes(`:${symbol}:`)) {
        this.cache.delete(key);
        invalidated.push(key);
      }
    }
    if (invalidated.length > 0) {
      this.emitCacheInvalidation(invalidated);
    }
  }

  /** Invalidate all keys starting with a prefix. */
  private invalidateByPrefix(prefix: string): void {
    const invalidated: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        invalidated.push(key);
      }
    }
    if (invalidated.length > 0) {
      this.emitCacheInvalidation(invalidated);
    }
  }

  /** Emit cache.invalidate event so SSE adapter pushes to frontend. */
  private emitCacheInvalidation(keys: string[]): void {
    // Extract unique query key prefixes (e.g., 'charts', 'indicators')
    const queryKeys = [...new Set(keys.map(k => k.split(':')[0]))];
    this.eventBus.emit({
      type: 'cache.invalidate',
      data: { keys: queryKeys },
      metadata: {
        correlationId: 'cache-system',
        causationId: 'cache-system',
        timestamp: Date.now(),
      },
    });
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.cache.max,
    };
  }

  clear(): void {
    this.cache.clear();
  }
}
```

**Step 4: Run tests, type check, commit**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/query-cache.test.ts`

```bash
cd E:/source/repos/ml_dashboard && git add src/server/cache/query-cache.ts tests/query-cache.test.ts && git commit -m "feat: LRU query cache with event-driven invalidation"
```

---

## Phase 5: SSE Routes + Pipeline API

### Task 14: SSE Event Stream Routes

**Files:**
- Create: `src/server/routes/events.ts`
- Modify: `src/server/core/routes.ts` (mount new router)

**Step 1: Create the event stream router**

```typescript
// src/server/routes/events.ts
import { Router, Request, Response } from 'express';
import { getEventBus } from '../events/event-bus';
import { SSEAdapter } from '../events/sse-adapter';

const router = Router();

// Singleton SSE adapter — created on first request
let sseAdapter: SSEAdapter | null = null;

function getSSEAdapter(): SSEAdapter {
  if (!sseAdapter) {
    sseAdapter = new SSEAdapter(getEventBus());
  }
  return sseAdapter;
}

type SSEChannel = 'pipeline' | 'training' | 'system';
const VALID_CHANNELS = new Set<SSEChannel>(['pipeline', 'training', 'system']);

// GET /api/events/:channel — SSE endpoint
router.get('/events/:channel', (req: Request, res: Response) => {
  const channel = req.params.channel as SSEChannel;

  if (!VALID_CHANNELS.has(channel)) {
    return res.status(400).json({ error: `Invalid channel. Must be one of: ${[...VALID_CHANNELS].join(', ')}` });
  }

  getSSEAdapter().addClient(channel, res);

  // Don't end the response — SSE keeps it open
  req.on('close', () => {
    // Client cleanup handled inside SSEAdapter.addClient
  });
});

// GET /api/events/stats — connected client counts
router.get('/events/stats', (_req: Request, res: Response) => {
  const adapter = getSSEAdapter();
  res.json({
    pipeline: adapter.clientCount('pipeline'),
    training: adapter.clientCount('training'),
    system: adapter.clientCount('system'),
  });
});

export default router;

/** For graceful shutdown. */
export function shutdownSSE(): void {
  if (sseAdapter) {
    sseAdapter.shutdown();
    sseAdapter = null;
  }
}
```

**Step 2: Mount in routes.ts**

Add to `src/server/core/routes.ts`:

```typescript
import eventsRouter from "../routes/events";
```

Add after the existing router mounts (after `trainingArtifactsRouter`):

```typescript
app.use("/api", eventsRouter);
```

**Step 3: Type check + commit**

```bash
cd E:/source/repos/ml_dashboard && npx tsc --noEmit && git add src/server/routes/events.ts src/server/core/routes.ts && git commit -m "feat: add /api/events/:channel SSE endpoints"
```

---

### Task 15: Pipeline REST Routes

**Files:**
- Create: `src/server/routes/pipelines.ts`
- Modify: `src/server/core/routes.ts` (mount)

**Step 1: Create pipeline routes**

```typescript
// src/server/routes/pipelines.ts
import { Router, Request, Response } from 'express';
import { EventStore } from '../events/event-store';
import { db } from '../database/db';

const router = Router();
const eventStore = new EventStore(db);

// GET /api/pipelines — list all pipelines (from event store)
router.get('/pipelines', async (_req: Request, res: Response) => {
  try {
    const startedEvents = await eventStore.readByType('pipeline.started');
    const completedEvents = await eventStore.readByType('pipeline.completed');
    const failedEvents = await eventStore.readByType('pipeline.failed');

    const completedIds = new Set(completedEvents.map(e => (e.data as any).pipelineId));
    const failedIds = new Set(failedEvents.map(e => (e.data as any).pipelineId));

    const pipelines = startedEvents.map(evt => {
      const pipelineId = (evt.data as any).pipelineId;
      let status = 'running';
      if (completedIds.has(pipelineId)) status = 'completed';
      if (failedIds.has(pipelineId)) status = 'failed';

      return {
        pipelineId,
        pipelineType: (evt.data as any).pipelineType,
        config: (evt.data as any).config,
        status,
        startedAt: evt.metadata.timestamp,
      };
    });

    res.json(pipelines.reverse()); // newest first
  } catch (err: unknown) {
    console.error('[pipelines] list error:', err);
    res.status(500).json({ error: 'Failed to list pipelines' });
  }
});

// GET /api/pipelines/:id/events — event log for a pipeline
router.get('/pipelines/:id/events', async (req: Request, res: Response) => {
  try {
    const pipelineId = req.params.id;
    const events = await eventStore.readStream(`pipeline:${pipelineId}`);
    res.json(events);
  } catch (err: unknown) {
    console.error('[pipelines] events error:', err);
    res.status(500).json({ error: 'Failed to fetch pipeline events' });
  }
});

// GET /api/pipelines/:id/state — current state machine snapshot
router.get('/pipelines/:id/state', async (req: Request, res: Response) => {
  try {
    const pipelineId = req.params.id;
    const events = await eventStore.readStream(`pipeline:${pipelineId}`);

    if (events.length === 0) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }

    // Derive current state from events
    const startedEvent = events.find(e => e.type === 'pipeline.started');
    const completedSteps = events
      .filter(e => e.type === 'pipeline.step.completed')
      .map(e => (e.data as any).step);
    const failedStep = events.find(e => e.type === 'pipeline.step.failed');
    const isCompleted = events.some(e => e.type === 'pipeline.completed');
    const isFailed = events.some(e => e.type === 'pipeline.failed');
    const isCompensated = events.some(e => e.type === 'pipeline.compensated');

    let currentState = 'running';
    if (isCompleted) currentState = 'completed';
    else if (isCompensated) currentState = 'compensated';
    else if (isFailed) currentState = 'failed';

    const lastStep = events
      .filter(e => e.type === 'pipeline.step.started')
      .pop();

    res.json({
      pipelineId,
      pipelineType: (startedEvent?.data as any)?.pipelineType,
      currentState,
      currentStep: lastStep ? (lastStep.data as any).step : null,
      completedSteps,
      failedStep: failedStep ? (failedStep.data as any).step : null,
      error: failedStep ? (failedStep.data as any).error : null,
      eventCount: events.length,
      startedAt: startedEvent?.metadata.timestamp,
    });
  } catch (err: unknown) {
    console.error('[pipelines] state error:', err);
    res.status(500).json({ error: 'Failed to fetch pipeline state' });
  }
});

export default router;
```

**Step 2: Mount in routes.ts**

Add to `src/server/core/routes.ts`:

```typescript
import pipelinesRouter from "../routes/pipelines";
```

Add alongside other mounts:

```typescript
app.use("/api", pipelinesRouter);
```

**Step 3: Type check + commit**

```bash
cd E:/source/repos/ml_dashboard && npx tsc --noEmit && git add src/server/routes/pipelines.ts src/server/core/routes.ts && git commit -m "feat: add pipeline REST routes (list, events, state)"
```

---

## Phase 6: Frontend Integration

### Task 16: useEventStream Hook

**Files:**
- Create: `src/client/src/hooks/useEventStream.ts`

```typescript
// src/client/src/hooks/useEventStream.ts
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type SSEChannel = 'pipeline' | 'training' | 'system';

interface EventStreamOptions {
  channel: SSEChannel;
  onEvent?: (event: { type: string; data: unknown; metadata: unknown }) => void;
  enabled?: boolean;
}

/**
 * Subscribe to server-sent events on a specific channel.
 * Automatically invalidates TanStack Query cache when cache.invalidate events arrive.
 */
export function useEventStream({ channel, onEvent, enabled = true }: EventStreamOptions) {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource(`/api/events/${channel}`);
    eventSourceRef.current = source;

    source.addEventListener('connected', (e) => {
      console.log(`[SSE:${channel}] connected`, JSON.parse(e.data));
    });

    // Listen for all named events by using onmessage as fallback
    // and specific event listeners for known types
    source.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        onEvent?.(parsed);
      } catch { /* ignore parse errors */ }
    };

    // Cache invalidation handler (system channel)
    source.addEventListener('cache.invalidate', (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const keys: string[] = parsed.data?.keys ?? [];
        for (const key of keys) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
      } catch { /* ignore */ }
    });

    // Pipeline events
    const pipelineEvents = [
      'pipeline.started', 'pipeline.step.started', 'pipeline.step.completed',
      'pipeline.step.failed', 'pipeline.completed', 'pipeline.failed',
      'pipeline.compensating', 'pipeline.compensated',
    ];
    for (const eventType of pipelineEvents) {
      source.addEventListener(eventType, (e) => {
        try {
          const parsed = JSON.parse(e.data);
          onEvent?.(parsed);

          // Auto-invalidate pipeline queries on any pipeline event
          queryClient.invalidateQueries({ queryKey: ['pipelines'] });
        } catch { /* ignore */ }
      });
    }

    source.onerror = () => {
      console.warn(`[SSE:${channel}] connection error, will auto-reconnect`);
    };

    return () => {
      source.close();
      eventSourceRef.current = null;
    };
  }, [channel, enabled, queryClient, onEvent]);
}
```

**Commit:**

```bash
cd E:/source/repos/ml_dashboard && git add src/client/src/hooks/useEventStream.ts && git commit -m "feat: add useEventStream hook for SSE subscriptions + cache invalidation"
```

---

### Task 17: usePipelineState Hook

**Files:**
- Create: `src/client/src/hooks/usePipelineState.ts`

```typescript
// src/client/src/hooks/usePipelineState.ts
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/queryClient';

interface PipelineState {
  pipelineId: string;
  pipelineType: string;
  currentState: string;
  currentStep: string | null;
  completedSteps: string[];
  failedStep: string | null;
  error: string | null;
  eventCount: number;
  startedAt: number;
}

interface PipelineSummary {
  pipelineId: string;
  pipelineType: string;
  config: Record<string, unknown>;
  status: string;
  startedAt: number;
}

/** Fetch the current state of a specific pipeline. */
export function usePipelineState(pipelineId: string | null) {
  return useQuery<PipelineState>({
    queryKey: ['pipelines', pipelineId, 'state'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/pipelines/${pipelineId}/state`);
      return res.json();
    },
    enabled: !!pipelineId,
    refetchInterval: false, // rely on SSE invalidation
  });
}

/** Fetch all pipelines. */
export function usePipelines() {
  return useQuery<PipelineSummary[]>({
    queryKey: ['pipelines'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/pipelines');
      return res.json();
    },
  });
}

/** Fetch the event log for a pipeline. */
export function usePipelineEvents(pipelineId: string | null) {
  return useQuery({
    queryKey: ['pipelines', pipelineId, 'events'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/pipelines/${pipelineId}/events`);
      return res.json();
    },
    enabled: !!pipelineId,
  });
}
```

**Commit:**

```bash
cd E:/source/repos/ml_dashboard && git add src/client/src/hooks/usePipelineState.ts && git commit -m "feat: add usePipelineState, usePipelines, usePipelineEvents hooks"
```

---

### Task 18: Update QueryClient Configuration

**Files:**
- Modify: `src/client/src/lib/queryClient.ts`

Change the `staleTime` from 60000 to `Infinity` and disable `refetchOnWindowFocus` so invalidation is fully event-driven:

Find this block:
```typescript
staleTime: 60000,
```

Replace with:
```typescript
staleTime: Infinity,
```

Find:
```typescript
refetchOnReconnect: true,
```

Add below it:
```typescript
refetchOnWindowFocus: false,
```

**Commit:**

```bash
cd E:/source/repos/ml_dashboard && git add src/client/src/lib/queryClient.ts && git commit -m "feat: switch TanStack Query to event-driven invalidation (staleTime: Infinity)"
```

---

## Phase 7: Crash Recovery + Startup Integration

### Task 19: Crash Recovery on Startup

**Files:**
- Create: `src/server/sagas/recovery.ts`
- Test: `tests/saga-recovery.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/saga-recovery.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/shared/schema';
import { EventStore } from '../src/server/events/event-store';
import { findIncompletePipelines, type IncompletePipeline } from '../src/server/sagas/recovery';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  sqlite.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT NOT NULL,
      stream_position INTEGER NOT NULL,
      type TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      data TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(stream_id, stream_position)
    );
  `);
  return db;
}

describe('saga crash recovery', () => {
  let eventStore: EventStore;

  const meta = {
    correlationId: 'r1',
    causationId: 'r1',
    timestamp: Date.now(),
  };

  beforeEach(() => {
    eventStore = new EventStore(createTestDb());
  });

  it('should detect incomplete pipelines', async () => {
    // Completed pipeline — should not be recovered
    await eventStore.appendToStream('pipeline:done', 0, [
      { type: 'pipeline.started', data: { pipelineId: 'done', pipelineType: 'training' }, metadata: meta },
    ]);
    await eventStore.appendToStream('pipeline:done', 1, [
      { type: 'pipeline.completed', data: { pipelineId: 'done' }, metadata: meta },
    ]);

    // Incomplete pipeline — should be recovered
    await eventStore.appendToStream('pipeline:stuck', 0, [
      { type: 'pipeline.started', data: { pipelineId: 'stuck', pipelineType: 'ingestion' }, metadata: meta },
    ]);
    await eventStore.appendToStream('pipeline:stuck', 1, [
      { type: 'pipeline.step.started', data: { step: 'uploading', stepIndex: 0 }, metadata: meta },
    ]);
    await eventStore.appendToStream('pipeline:stuck', 2, [
      { type: 'pipeline.step.completed', data: { step: 'uploading', stepIndex: 0 }, metadata: meta },
    ]);

    const incomplete = await findIncompletePipelines(eventStore);
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0].pipelineId).toBe('stuck');
    expect(incomplete[0].pipelineType).toBe('ingestion');
    expect(incomplete[0].completedSteps).toEqual(['uploading']);
    expect(incomplete[0].lastPosition).toBe(2);
  });

  it('should return empty array when all pipelines completed', async () => {
    await eventStore.appendToStream('pipeline:a', 0, [
      { type: 'pipeline.started', data: { pipelineId: 'a', pipelineType: 'training' }, metadata: meta },
    ]);
    await eventStore.appendToStream('pipeline:a', 1, [
      { type: 'pipeline.completed', data: { pipelineId: 'a' }, metadata: meta },
    ]);

    const incomplete = await findIncompletePipelines(eventStore);
    expect(incomplete).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/saga-recovery.test.ts`

**Step 3: Implement recovery**

```typescript
// src/server/sagas/recovery.ts
import { EventStore } from '../events/event-store';
import type { StoredEvent } from '@shared/event-types';
import { log } from '../lib/log';

export interface IncompletePipeline {
  pipelineId: string;
  streamId: string;
  pipelineType: string;
  config: Record<string, unknown>;
  completedSteps: string[];
  lastPosition: number;
  events: StoredEvent[];
}

/**
 * Find all pipelines that were started but never reached a terminal state.
 * Called on server startup for crash recovery.
 */
export async function findIncompletePipelines(
  eventStore: EventStore,
): Promise<IncompletePipeline[]> {
  const incompleteStreamIds = await eventStore.findIncompleteStreams('pipeline:');

  const results: IncompletePipeline[] = [];

  for (const streamId of incompleteStreamIds) {
    const events = await eventStore.readStream(streamId);
    if (events.length === 0) continue;

    const startedEvent = events.find(e => e.type === 'pipeline.started');
    if (!startedEvent) continue;

    const completedSteps = events
      .filter(e => e.type === 'pipeline.step.completed')
      .map(e => (e.data as any).step);

    const lastPosition = events[events.length - 1].streamPosition;

    results.push({
      pipelineId: (startedEvent.data as any).pipelineId,
      streamId,
      pipelineType: (startedEvent.data as any).pipelineType,
      config: (startedEvent.data as any).config ?? {},
      completedSteps,
      lastPosition,
      events,
    });
  }

  return results;
}

/**
 * Log incomplete pipelines on startup. Actual resume logic
 * will be added when pipeline step implementations exist.
 */
export async function recoverPipelinesOnStartup(
  eventStore: EventStore,
): Promise<void> {
  const incomplete = await findIncompletePipelines(eventStore);

  if (incomplete.length === 0) {
    log('No incomplete pipelines found', 'recovery');
    return;
  }

  for (const pipeline of incomplete) {
    log(
      `Incomplete pipeline: ${pipeline.pipelineId} (${pipeline.pipelineType}) ` +
      `— completed steps: [${pipeline.completedSteps.join(', ')}], ` +
      `last position: ${pipeline.lastPosition}`,
      'recovery',
    );

    // Mark as failed in event store so they don't stay "running" forever
    const nextPosition = pipeline.lastPosition + 1;
    await eventStore.appendToStream(pipeline.streamId, nextPosition, [{
      type: 'pipeline.failed',
      data: {
        pipelineId: pipeline.pipelineId,
        error: 'Process crashed — pipeline interrupted',
        failedStep: pipeline.completedSteps[pipeline.completedSteps.length - 1] ?? 'unknown',
      },
      metadata: {
        correlationId: 'recovery',
        causationId: 'recovery',
        timestamp: Date.now(),
      },
    }]);
  }

  log(`Marked ${incomplete.length} incomplete pipeline(s) as failed`, 'recovery');
}
```

**Step 4: Run test to verify it passes**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/saga-recovery.test.ts`
Expected: PASS (2 tests)

**Step 5: Integrate into startup sequence**

Modify `src/server/main.ts` — add recovery after NestJS initialization (after `log('NestJS initialized (databases ready)', 'nest');`):

```typescript
import { recoverPipelinesOnStartup } from './sagas/recovery';
import { EventStore } from './events/event-store';
```

Add after the NestJS initialization block (after `log('NestJS initialized (databases ready)', 'nest');`):

```typescript
// ── Recover incomplete pipelines from previous crashes ──
try {
  const eventStoreForRecovery = new EventStore(db);
  await recoverPipelinesOnStartup(eventStoreForRecovery);
} catch (err) {
  console.error('[recovery] Failed to recover pipelines:', err);
}
```

Also add the db import at the top of main.ts:

```typescript
import { db } from './database/db';
```

**Step 6: Type check + commit**

```bash
cd E:/source/repos/ml_dashboard && npx tsc --noEmit && git add src/server/sagas/recovery.ts tests/saga-recovery.test.ts src/server/main.ts && git commit -m "feat: crash recovery marks incomplete pipelines as failed on startup"
```

---

### Task 20: Sagas barrel export

**Files:**
- Create: `src/server/sagas/index.ts`

```typescript
// src/server/sagas/index.ts
export { SagaOrchestrator, type SagaStep } from './orchestrator';
export { findIncompletePipelines, recoverPipelinesOnStartup, type IncompletePipeline } from './recovery';
```

```bash
cd E:/source/repos/ml_dashboard && git add src/server/sagas/index.ts && git commit -m "feat: barrel export for sagas module"
```

---

### Task 21: Full Integration Test

**Files:**
- Test: `tests/integration/event-architecture.test.ts`

**Step 1: Write an end-to-end integration test**

```typescript
// tests/integration/event-architecture.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/shared/schema';
import { EventStore } from '../../src/server/events/event-store';
import { EventBus } from '../../src/server/events/event-bus';
import { SagaOrchestrator, type SagaStep } from '../../src/server/sagas/orchestrator';
import { QueryCache } from '../../src/server/cache/query-cache';
import { trainingMachine } from '../../src/shared/machines/training-machine';
import { findIncompletePipelines } from '../../src/server/sagas/recovery';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  sqlite.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT NOT NULL,
      stream_position INTEGER NOT NULL,
      type TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      data TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(stream_id, stream_position)
    );
  `);
  return db;
}

describe('Event Architecture Integration', () => {
  let eventStore: EventStore;
  let eventBus: EventBus;
  let cache: QueryCache;

  beforeEach(() => {
    eventStore = new EventStore(createTestDb());
    eventBus = new EventBus();
    cache = new QueryCache(eventBus);
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  it('should run complete training pipeline saga with event persistence', async () => {
    const steps: SagaStep[] = [
      { name: 'ingesting', execute: async () => ({ rows: 500 }) },
      { name: 'computing_features', execute: async () => ({ features: 29 }) },
      { name: 'generating_labels', execute: async () => ({ labels: 1000 }) },
      { name: 'training', execute: async () => ({ loss: 0.3, epochs: 100 }) },
      { name: 'evaluating', execute: async () => ({ sharpe: 1.5, accuracy: 0.57 }) },
      { name: 'registering', execute: async () => ({ modelId: 'hdp-hmm-ES-1m-v1' }) },
    ];

    const saga = new SagaOrchestrator(eventStore, eventBus, trainingMachine, steps);
    await saga.execute('integration-test', { symbol: 'ES', timeframe: '1m' });

    // Verify events
    const events = await eventStore.readStream('pipeline:integration-test');
    const types = events.map(e => e.type);
    expect(types[0]).toBe('pipeline.started');
    expect(types[types.length - 1]).toBe('pipeline.completed');
    expect(types.filter(t => t === 'pipeline.step.completed')).toHaveLength(6);

    // No incomplete pipelines
    const incomplete = await findIncompletePipelines(eventStore);
    expect(incomplete).toHaveLength(0);
  });

  it('should compensate and invalidate cache on failure', async () => {
    const compensated: string[] = [];
    const cacheEvents: string[][] = [];

    eventBus.on('cache.invalidate', (event) => {
      cacheEvents.push((event.data as any).keys);
    });

    // Pre-populate cache
    cache.set('models:hdp-hmm', { status: 'active' });

    const steps: SagaStep[] = [
      {
        name: 'ingesting',
        execute: async () => ({ rows: 500 }),
        compensate: async () => { compensated.push('ingesting'); },
      },
      {
        name: 'computing_features',
        execute: async () => ({ features: 29 }),
        compensate: async () => { compensated.push('computing_features'); },
      },
      {
        name: 'generating_labels',
        execute: async () => { throw new Error('label generation failed'); },
      },
      { name: 'training', execute: async () => ({}) },
      { name: 'evaluating', execute: async () => ({}) },
      { name: 'registering', execute: async () => ({}) },
    ];

    const saga = new SagaOrchestrator(eventStore, eventBus, trainingMachine, steps);
    await expect(saga.execute('fail-test', {})).rejects.toThrow('label generation failed');

    // Compensation ran in reverse
    expect(compensated).toEqual(['computing_features', 'ingesting']);

    // Events recorded the failure
    const events = await eventStore.readStream('pipeline:fail-test');
    const types = events.map(e => e.type);
    expect(types).toContain('pipeline.step.failed');
    expect(types).toContain('pipeline.failed');
    expect(types).toContain('pipeline.compensating');
    expect(types).toContain('pipeline.compensated');
  });
});
```

**Step 2: Run the integration test**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run tests/integration/event-architecture.test.ts`
Expected: PASS (2 tests)

**Step 3: Run all tests**

Run: `cd E:/source/repos/ml_dashboard && npx vitest run`
Expected: All tests pass

**Step 4: Final type check**

Run: `cd E:/source/repos/ml_dashboard && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
cd E:/source/repos/ml_dashboard && git add tests/integration/event-architecture.test.ts && git commit -m "test: add end-to-end integration test for event architecture"
```

---

### Task 22: Run Full Build

**Step 1: Build**

Run: `cd E:/source/repos/ml_dashboard && npm run build`
Expected: Build succeeds

**Step 2: Fix any build errors**

Address any issues found during build.

**Step 3: Final commit**

```bash
cd E:/source/repos/ml_dashboard && git add -A && git commit -m "chore: fix any build issues from event architecture"
```

---

## Summary of New Files

```
src/shared/
  event-types.ts                    # Domain event type definitions
  machines/
    index.ts                        # Barrel export
    training-machine.ts             # XState training pipeline
    ingestion-machine.ts            # XState ingestion pipeline
    deployment-machine.ts           # XState deployment pipeline

src/server/
  events/
    index.ts                        # Barrel export
    event-store.ts                  # SQLite event store (~150 lines)
    event-bus.ts                    # eventemitter2 wrapper (~60 lines)
    events.module.ts                # NestJS module
    sse-adapter.ts                  # Event bus → SSE push (~100 lines)
  sagas/
    index.ts                        # Barrel export
    orchestrator.ts                 # Saga runner (~180 lines)
    recovery.ts                     # Crash recovery (~80 lines)
  cache/
    query-cache.ts                  # lru-cache + invalidation (~90 lines)
  routes/
    events.ts                       # SSE channel endpoints
    pipelines.ts                    # Pipeline REST API

src/client/src/
  hooks/
    useEventStream.ts               # SSE subscription hook
    usePipelineState.ts             # Pipeline data hooks

tests/
  event-types.test.ts
  event-store-schema.test.ts
  event-store.test.ts
  event-bus.test.ts
  training-machine.test.ts
  ingestion-machine.test.ts
  deployment-machine.test.ts
  saga-orchestrator.test.ts
  sse-adapter.test.ts
  query-cache.test.ts
  saga-recovery.test.ts
  integration/
    event-architecture.test.ts
```

## Modified Files

```
src/shared/schema.ts                # + events table
src/server/main.ts                  # + crash recovery on startup
src/server/app.module.ts            # + EventsModule
src/server/core/routes.ts           # + events + pipelines routers
src/client/src/lib/queryClient.ts   # staleTime: Infinity
package.json                        # + xstate, eventemitter2, lru-cache
```
