import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { EventStore } from '../src/server/events/event-store';
import { EventBus } from '../src/server/events/event-bus';
import { trainingMachine } from '../src/shared/machines/training-machine';
import { SagaOrchestrator } from '../src/server/sagas/orchestrator';
import type { SagaStep } from '../src/server/sagas/orchestrator';
import type { DomainEvent } from '../src/shared/event-types';

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

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite);
  sqlite.exec(CREATE_EVENTS_TABLE);
  return db;
}

function makeSteps(count: number, failAt?: number): SagaStep[] {
  const names = ['ingesting', 'computing_features', 'generating_labels', 'training', 'evaluating', 'registering'];
  return names.slice(0, count).map((name, i) => ({
    name,
    execute: failAt === i
      ? vi.fn(async () => { throw new Error(`Step ${name} failed`); })
      : vi.fn(async (ctx: Record<string, unknown>) => ({ [`${name}_result`]: true })),
    compensate: vi.fn(async () => {}),
  }));
}

describe('SagaOrchestrator', () => {
  let db: BetterSQLite3Database<Record<string, unknown>>;
  let eventStore: EventStore;
  let eventBus: EventBus;

  beforeEach(() => {
    db = createTestDb();
    eventStore = new EventStore(db);
    eventBus = new EventBus();
  });

  // ── Happy path ───────────────────────────────────────────

  it('should execute all steps in order and persist events', async () => {
    const steps = makeSteps(6);
    const orchestrator = new SagaOrchestrator(eventStore, eventBus, trainingMachine, steps);

    await orchestrator.execute('pipeline-1', { symbol: 'EURUSD' });

    const events = await eventStore.readStream('pipeline-1');
    const types = events.map((e) => e.type);

    // pipeline.started + (step.started + step.completed) * 6 + pipeline.completed = 14
    expect(events).toHaveLength(14);

    // First event: pipeline.started
    expect(types[0]).toBe('pipeline.started');

    // Each step pair: step.started, step.completed
    for (let i = 0; i < 6; i++) {
      expect(types[1 + i * 2]).toBe('pipeline.step.started');
      expect(types[2 + i * 2]).toBe('pipeline.step.completed');
    }

    // Last event: pipeline.completed
    expect(types[13]).toBe('pipeline.completed');

    // Verify stream positions are sequential starting from 0
    events.forEach((e, i) => {
      expect(e.streamPosition).toBe(i);
    });

    // Verify each step's execute was called exactly once
    for (const step of steps) {
      expect(step.execute).toHaveBeenCalledOnce();
    }
  });

  // ── Compensation on failure ──────────────────────────────

  it('should run compensation on step failure in reverse order', async () => {
    // Fail at step index 3 (training), so steps 0-2 completed
    const steps = makeSteps(6, 3);
    const orchestrator = new SagaOrchestrator(eventStore, eventBus, trainingMachine, steps);

    await orchestrator.execute('pipeline-fail', { symbol: 'EURUSD' });

    const events = await eventStore.readStream('pipeline-fail');
    const types = events.map((e) => e.type);

    // pipeline.started = 1
    // 3 completed steps: (step.started + step.completed) * 3 = 6
    // failed step: step.started + step.failed = 2
    // pipeline.failed = 1
    // pipeline.compensating = 1
    // pipeline.compensated = 1
    // Total = 12
    expect(events).toHaveLength(12);

    expect(types[0]).toBe('pipeline.started');

    // 3 successful step pairs
    for (let i = 0; i < 3; i++) {
      expect(types[1 + i * 2]).toBe('pipeline.step.started');
      expect(types[2 + i * 2]).toBe('pipeline.step.completed');
    }

    // Failed step
    expect(types[7]).toBe('pipeline.step.started');
    expect(types[8]).toBe('pipeline.step.failed');

    // Pipeline failure + compensation
    expect(types[9]).toBe('pipeline.failed');
    expect(types[10]).toBe('pipeline.compensating');
    expect(types[11]).toBe('pipeline.compensated');

    // Only steps 0-2 should have been compensated (the ones that completed)
    // Steps should be compensated in reverse order
    const compensateCalls: string[] = [];
    for (const step of steps) {
      if ((step.compensate as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
        compensateCalls.push(step.name);
      }
    }
    expect(compensateCalls).toEqual(['ingesting', 'computing_features', 'generating_labels']);

    // Verify reverse order by checking call order
    const callOrder: string[] = [];
    for (const step of steps) {
      const mock = step.compensate as ReturnType<typeof vi.fn>;
      if (mock.mock.calls.length > 0) {
        callOrder.push(step.name);
      }
    }
    // The compensate mocks were called, but we need to verify reverse order
    // We'll check the mock invocation order
    const compensateOrder = steps
      .filter((s) => (s.compensate as ReturnType<typeof vi.fn>).mock.calls.length > 0)
      .sort((a, b) => {
        const aOrder = (a.compensate as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
        const bOrder = (b.compensate as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
        return aOrder - bOrder;
      })
      .map((s) => s.name);

    expect(compensateOrder).toEqual(['generating_labels', 'computing_features', 'ingesting']);

    // Step 3's execute was called but compensate should NOT be called (it failed, not completed)
    expect(steps[3]!.execute).toHaveBeenCalledOnce();
    expect(steps[3]!.compensate).not.toHaveBeenCalled();

    // Steps 4, 5 should not have been executed at all
    expect(steps[4]!.execute).not.toHaveBeenCalled();
    expect(steps[5]!.execute).not.toHaveBeenCalled();
  });

  // ── EventBus receives events ─────────────────────────────

  it('should emit events to event bus', async () => {
    const steps = makeSteps(6);
    const orchestrator = new SagaOrchestrator(eventStore, eventBus, trainingMachine, steps);

    const receivedEvents: DomainEvent[] = [];
    eventBus.on('pipeline.**', (event: DomainEvent) => {
      receivedEvents.push(event);
    });

    await orchestrator.execute('pipeline-bus', { symbol: 'EURUSD' });

    // All 14 events should have been emitted to the bus
    const pipelineEvents = receivedEvents.filter((e) => e.type.startsWith('pipeline.'));
    expect(pipelineEvents.length).toBe(14);

    // Check specific event types are present
    const types = pipelineEvents.map((e) => e.type);
    expect(types).toContain('pipeline.started');
    expect(types).toContain('pipeline.step.started');
    expect(types).toContain('pipeline.step.completed');
    expect(types).toContain('pipeline.completed');
  });
});
