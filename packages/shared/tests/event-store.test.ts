import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { EventStore } from '../../../apps/api/infrastructure/events/event-store';
import type { NewEvent, EventMetadata } from '../src/event-types';

const CREATE_EVENTS_TABLE = `
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
`;

function makeMetadata(overrides?: Partial<EventMetadata>): EventMetadata {
  return {
    correlationId: overrides?.correlationId ?? 'corr-1',
    causationId: overrides?.causationId ?? 'cause-1',
    timestamp: overrides?.timestamp ?? Date.now(),
  };
}

function makeEvent(type: string, data: Record<string, unknown> = {}): NewEvent {
  return { type, data, metadata: makeMetadata() };
}

describe('EventStore', () => {
  let sqlite: InstanceType<typeof Database>;
  let db: BetterSQLite3Database<Record<string, unknown>>;
  let store: EventStore;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(CREATE_EVENTS_TABLE);
    db = drizzle(sqlite);
    store = new EventStore(db);
  });

  // ── Append events ────────────────────────────────────────

  it('should append a single event to a new stream', async () => {
    const events = [makeEvent('pipeline.started', { pipelineId: 'p1' })];
    const stored = await store.appendToStream('pipeline-p1', -1, events);

    expect(stored).toHaveLength(1);
    expect(stored[0]!.streamId).toBe('pipeline-p1');
    expect(stored[0]!.streamPosition).toBe(0);
    expect(stored[0]!.type).toBe('pipeline.started');
    expect(stored[0]!.data).toEqual({ pipelineId: 'p1' });
    expect(stored[0]!.id).toBeGreaterThan(0);
  });

  it('should append multiple events sequentially', async () => {
    // First append
    await store.appendToStream('stream-1', -1, [
      makeEvent('pipeline.started', { pipelineId: 'p1' }),
    ]);

    // Second append, expected position is now 0
    const stored = await store.appendToStream('stream-1', 0, [
      makeEvent('pipeline.step.started', { step: 'ingest' }),
    ]);

    expect(stored).toHaveLength(1);
    expect(stored[0]!.streamPosition).toBe(1);
  });

  it('should append a batch of events atomically', async () => {
    const events = [
      makeEvent('pipeline.started', { pipelineId: 'p1' }),
      makeEvent('pipeline.step.started', { step: 'validate' }),
      makeEvent('pipeline.step.completed', { step: 'validate', durationMs: 42 }),
    ];

    const stored = await store.appendToStream('batch-stream', -1, events);

    expect(stored).toHaveLength(3);
    expect(stored[0]!.streamPosition).toBe(0);
    expect(stored[1]!.streamPosition).toBe(1);
    expect(stored[2]!.streamPosition).toBe(2);

    // Verify all in DB
    const all = await store.readStream('batch-stream');
    expect(all).toHaveLength(3);
  });

  // ── Optimistic concurrency ───────────────────────────────

  it('should reject concurrent writes with wrong expected position', async () => {
    // Append first event at position 0
    await store.appendToStream('stream-1', -1, [
      makeEvent('pipeline.started', { pipelineId: 'p1' }),
    ]);

    // Try to append at position -1 again (stale expected position)
    await expect(
      store.appendToStream('stream-1', -1, [
        makeEvent('pipeline.started', { pipelineId: 'p2' }),
      ]),
    ).rejects.toThrow();
  });

  // ── Read stream ──────────────────────────────────────────

  it('should read events for a stream ordered by position', async () => {
    await store.appendToStream('read-test', -1, [
      makeEvent('pipeline.started'),
      makeEvent('pipeline.step.started'),
      makeEvent('pipeline.completed'),
    ]);

    const events = await store.readStream('read-test');
    expect(events).toHaveLength(3);
    expect(events[0]!.type).toBe('pipeline.started');
    expect(events[1]!.type).toBe('pipeline.step.started');
    expect(events[2]!.type).toBe('pipeline.completed');
  });

  it('should read stream from a specific position', async () => {
    await store.appendToStream('read-from', -1, [
      makeEvent('a'),
      makeEvent('b'),
      makeEvent('c'),
      makeEvent('d'),
    ]);

    const events = await store.readStream('read-from', 2);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('c');
    expect(events[1]!.type).toBe('d');
  });

  // ── Read by type ─────────────────────────────────────────

  it('should read events by type across all streams', async () => {
    await store.appendToStream('s1', -1, [
      makeEvent('pipeline.started', { pipelineId: 'p1' }),
      makeEvent('pipeline.completed', { pipelineId: 'p1' }),
    ]);
    await store.appendToStream('s2', -1, [
      makeEvent('pipeline.started', { pipelineId: 'p2' }),
    ]);

    const started = await store.readByType('pipeline.started');
    expect(started).toHaveLength(2);
    expect(started[0]!.streamId).toBe('s1');
    expect(started[1]!.streamId).toBe('s2');
  });

  it('should read events by type after a specific id', async () => {
    await store.appendToStream('s1', -1, [
      makeEvent('pipeline.started', { pipelineId: 'p1' }),
    ]);
    await store.appendToStream('s2', -1, [
      makeEvent('pipeline.started', { pipelineId: 'p2' }),
    ]);

    const first = await store.readByType('pipeline.started');
    const afterFirst = await store.readByType('pipeline.started', first[0]!.id);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]!.streamId).toBe('s2');
  });

  // ── Read all ─────────────────────────────────────────────

  it('should read all events', async () => {
    await store.appendToStream('s1', -1, [makeEvent('a')]);
    await store.appendToStream('s2', -1, [makeEvent('b')]);

    const all = await store.readAll();
    expect(all).toHaveLength(2);
  });

  it('should read all events after a specific id', async () => {
    await store.appendToStream('s1', -1, [makeEvent('a')]);
    await store.appendToStream('s2', -1, [makeEvent('b')]);

    const all = await store.readAll();
    const afterFirst = await store.readAll(all[0]!.id);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]!.type).toBe('b');
  });

  // ── Stream position ──────────────────────────────────────

  it('should return -1 for empty stream', async () => {
    const pos = await store.getStreamPosition('nonexistent');
    expect(pos).toBe(-1);
  });

  it('should return current highest position', async () => {
    await store.appendToStream('pos-test', -1, [
      makeEvent('a'),
      makeEvent('b'),
      makeEvent('c'),
    ]);

    const pos = await store.getStreamPosition('pos-test');
    expect(pos).toBe(2);
  });

  // ── Find incomplete streams ──────────────────────────────

  it('should find streams that were started but never completed/failed/compensated', async () => {
    // Complete pipeline
    await store.appendToStream('pipeline-p1', -1, [
      makeEvent('pipeline.started', { pipelineId: 'p1' }),
      makeEvent('pipeline.completed', { pipelineId: 'p1' }),
    ]);

    // Incomplete pipeline (only started)
    await store.appendToStream('pipeline-p2', -1, [
      makeEvent('pipeline.started', { pipelineId: 'p2' }),
      makeEvent('pipeline.step.started', { step: 'ingest' }),
    ]);

    // Failed pipeline
    await store.appendToStream('pipeline-p3', -1, [
      makeEvent('pipeline.started', { pipelineId: 'p3' }),
      makeEvent('pipeline.failed', { error: 'boom' }),
    ]);

    // Another incomplete pipeline
    await store.appendToStream('pipeline-p4', -1, [
      makeEvent('pipeline.started', { pipelineId: 'p4' }),
    ]);

    const incomplete = await store.findIncompleteStreams('pipeline-');
    const streamIds = incomplete.map((e) => e.streamId);
    expect(streamIds).toContain('pipeline-p2');
    expect(streamIds).toContain('pipeline-p4');
    expect(streamIds).not.toContain('pipeline-p1');
    expect(streamIds).not.toContain('pipeline-p3');
    expect(incomplete).toHaveLength(2);
  });

  // ── JSON parsing ─────────────────────────────────────────

  it('should parse data and metadata JSON when reading', async () => {
    const meta = makeMetadata({ correlationId: 'test-corr', causationId: 'test-cause' });
    const events = [{ type: 'test.event', data: { nested: { key: 'value' } }, metadata: meta }];

    await store.appendToStream('json-test', -1, events);
    const stored = await store.readStream('json-test');

    expect(stored[0]!.data).toEqual({ nested: { key: 'value' } });
    expect(stored[0]!.metadata.correlationId).toBe('test-corr');
    expect(stored[0]!.metadata.causationId).toBe('test-cause');
    expect(typeof stored[0]!.metadata.timestamp).toBe('number');
  });
});
