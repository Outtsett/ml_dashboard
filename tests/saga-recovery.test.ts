import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { EventStore } from '../src/server/events/event-store';
import type { NewEvent, EventMetadata } from '../src/shared/event-types';
import { findIncompletePipelines, recoverPipelinesOnStartup } from '../src/server/sagas/recovery';

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

describe('Saga Recovery', () => {
  let sqlite: InstanceType<typeof Database>;
  let db: BetterSQLite3Database<Record<string, unknown>>;
  let store: EventStore;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(CREATE_EVENTS_TABLE);
    db = drizzle(sqlite);
    store = new EventStore(db);
  });

  describe('findIncompletePipelines', () => {
    it('should detect incomplete pipelines (one complete, one stuck mid-step)', async () => {
      // Complete pipeline — started, steps completed, pipeline completed
      await store.appendToStream('pipeline:p1', -1, [
        makeEvent('pipeline.started', {
          pipelineId: 'p1',
          pipelineType: 'training',
          config: { epochs: 10 },
        }),
        makeEvent('pipeline.step.started', { pipelineId: 'p1', step: 'validate', stepIndex: 0 }),
        makeEvent('pipeline.step.completed', {
          pipelineId: 'p1',
          step: 'validate',
          stepIndex: 0,
          result: {},
          durationMs: 100,
        }),
        makeEvent('pipeline.completed', { pipelineId: 'p1', totalDurationMs: 500 }),
      ]);

      // Incomplete pipeline — started, one step done, stuck mid-second-step
      await store.appendToStream('pipeline:p2', -1, [
        makeEvent('pipeline.started', {
          pipelineId: 'p2',
          pipelineType: 'ingestion',
          config: { symbol: 'EURUSD' },
        }),
        makeEvent('pipeline.step.started', { pipelineId: 'p2', step: 'validate', stepIndex: 0 }),
        makeEvent('pipeline.step.completed', {
          pipelineId: 'p2',
          step: 'validate',
          stepIndex: 0,
          result: {},
          durationMs: 50,
        }),
        makeEvent('pipeline.step.started', { pipelineId: 'p2', step: 'ingest', stepIndex: 1 }),
      ]);

      const incomplete = await findIncompletePipelines(store);

      expect(incomplete).toHaveLength(1);
      expect(incomplete[0]!.pipelineId).toBe('p2');
      expect(incomplete[0]!.streamId).toBe('pipeline:p2');
      expect(incomplete[0]!.pipelineType).toBe('ingestion');
      expect(incomplete[0]!.config).toEqual({ symbol: 'EURUSD' });
      expect(incomplete[0]!.completedSteps).toEqual(['validate']);
      expect(incomplete[0]!.lastPosition).toBe(3);
      expect(incomplete[0]!.events).toHaveLength(4);
    });

    it('should return empty array when all pipelines completed', async () => {
      // One completed pipeline
      await store.appendToStream('pipeline:p1', -1, [
        makeEvent('pipeline.started', {
          pipelineId: 'p1',
          pipelineType: 'training',
          config: { epochs: 5 },
        }),
        makeEvent('pipeline.completed', { pipelineId: 'p1', totalDurationMs: 200 }),
      ]);

      // One failed pipeline (terminal state — not incomplete)
      await store.appendToStream('pipeline:p2', -1, [
        makeEvent('pipeline.started', {
          pipelineId: 'p2',
          pipelineType: 'deployment',
          config: {},
        }),
        makeEvent('pipeline.failed', { pipelineId: 'p2', error: 'boom', failedStep: 'deploy' }),
      ]);

      const incomplete = await findIncompletePipelines(store);
      expect(incomplete).toHaveLength(0);
    });
  });

  describe('recoverPipelinesOnStartup', () => {
    it('should mark incomplete pipelines as failed', async () => {

      // Incomplete pipeline
      await store.appendToStream('pipeline:p1', -1, [
        makeEvent('pipeline.started', {
          pipelineId: 'p1',
          pipelineType: 'training',
          config: { epochs: 10 },
        }),
        makeEvent('pipeline.step.started', { pipelineId: 'p1', step: 'train', stepIndex: 0 }),
      ]);

      await recoverPipelinesOnStartup(store);

      // Verify the stream now has a pipeline.failed event
      const events = await store.readStream('pipeline:p1');
      const failedEvent = events.find((e) => e.type === 'pipeline.failed');
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.data.pipelineId).toBe('p1');
      expect(failedEvent!.data.error).toContain('crash');
    });

    it('should not touch completed pipelines', async () => {

      // Complete pipeline
      await store.appendToStream('pipeline:p1', -1, [
        makeEvent('pipeline.started', {
          pipelineId: 'p1',
          pipelineType: 'training',
          config: {},
        }),
        makeEvent('pipeline.completed', { pipelineId: 'p1', totalDurationMs: 100 }),
      ]);

      await recoverPipelinesOnStartup(store);

      // Stream should still have exactly 2 events
      const events = await store.readStream('pipeline:p1');
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.type)).toEqual(['pipeline.started', 'pipeline.completed']);
    });
  });
});
