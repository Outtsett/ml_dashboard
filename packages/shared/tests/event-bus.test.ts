import { describe, it, expect, beforeEach } from 'vitest';
import type { DomainEvent, PipelineEvent, TrainingEvent, ModelEvent } from '../src/event-types';
import { EventBus, getEventBus, resetEventBus } from '../../../apps/api/infrastructure/events/event-bus';

// ── Helpers ──────────────────────────────────────────────────
function makeEvent<T extends DomainEvent>(
  overrides: Omit<T, 'metadata'> & Partial<Pick<T, 'metadata'>>,
): T {
  return {
    ...overrides,
    metadata: overrides.metadata ?? {
      correlationId: 'cor-1',
      causationId: 'cau-1',
      timestamp: Date.now(),
    },
  } as T;
}

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    resetEventBus();
    bus = getEventBus();
  });

  // ── Basic emit / receive ─────────────────────────────────
  it('should emit and receive a typed event', () => {
    const received: DomainEvent[] = [];
    const handler = (e: DomainEvent) => received.push(e);

    bus.on('pipeline.started', handler);

    const event = makeEvent<PipelineEvent>({
      type: 'pipeline.started',
      data: { pipelineId: 'p-1', pipelineType: 'training', config: {} },
    });
    bus.emit(event);

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('pipeline.started');
    if (received[0]!.type === 'pipeline.started') {
      expect(received[0]!.data.pipelineId).toBe('p-1');
    }
  });

  // ── Wildcard subscriptions ───────────────────────────────
  it('should support wildcard subscriptions (pipeline.*)', () => {
    const received: DomainEvent[] = [];
    bus.on('pipeline.*', (e: DomainEvent) => received.push(e));

    bus.emit(makeEvent<PipelineEvent>({
      type: 'pipeline.started',
      data: { pipelineId: 'p-1', pipelineType: 'training', config: {} },
    }));
    bus.emit(makeEvent<PipelineEvent>({
      type: 'pipeline.completed',
      data: { pipelineId: 'p-1', totalDurationMs: 5000 },
    }));

    // Should NOT match deeper wildcards without **
    bus.emit(makeEvent<PipelineEvent>({
      type: 'pipeline.step.started',
      data: { pipelineId: 'p-1', step: 'preprocess', stepIndex: 0 },
    }));

    // pipeline.* matches single-level: started, completed but NOT step.started
    expect(received).toHaveLength(2);
    expect(received[0]!.type).toBe('pipeline.started');
    expect(received[1]!.type).toBe('pipeline.completed');
  });

  it('should support deep wildcard subscriptions (pipeline.**)', () => {
    const received: DomainEvent[] = [];
    bus.on('pipeline.**', (e: DomainEvent) => received.push(e));

    bus.emit(makeEvent<PipelineEvent>({
      type: 'pipeline.started',
      data: { pipelineId: 'p-1', pipelineType: 'training', config: {} },
    }));
    bus.emit(makeEvent<PipelineEvent>({
      type: 'pipeline.step.started',
      data: { pipelineId: 'p-1', step: 'preprocess', stepIndex: 0 },
    }));
    bus.emit(makeEvent<TrainingEvent>({
      type: 'training.epoch.completed',
      data: { sessionId: 's-1', epoch: 1, metrics: { loss: 0.5 } },
    }));

    // pipeline.** matches pipeline.started AND pipeline.step.started
    // but NOT training.epoch.completed
    expect(received).toHaveLength(2);
  });

  // ── Unsubscribe ──────────────────────────────────────────
  it('should unsubscribe with off()', () => {
    const received: DomainEvent[] = [];
    const handler = (e: DomainEvent) => received.push(e);

    bus.on('model.registered', handler);

    bus.emit(makeEvent<ModelEvent>({
      type: 'model.registered',
      data: { modelId: 'm-1', name: 'test-model', metrics: { sharpe: 1.2 } },
    }));
    expect(received).toHaveLength(1);

    bus.off('model.registered', handler);

    bus.emit(makeEvent<ModelEvent>({
      type: 'model.registered',
      data: { modelId: 'm-2', name: 'test-model-2', metrics: { sharpe: 1.5 } },
    }));
    expect(received).toHaveLength(1); // still 1, handler was removed
  });

  // ── once ─────────────────────────────────────────────────
  it('should fire handler only once with once()', () => {
    const received: DomainEvent[] = [];
    bus.once('pipeline.started', (e: DomainEvent) => received.push(e));

    const event = makeEvent<PipelineEvent>({
      type: 'pipeline.started',
      data: { pipelineId: 'p-1', pipelineType: 'training', config: {} },
    });
    bus.emit(event);
    bus.emit(event);

    expect(received).toHaveLength(1);
  });

  // ── onAny ────────────────────────────────────────────────
  it('should receive ALL events with onAny()', () => {
    const received: DomainEvent[] = [];
    bus.onAny((e: DomainEvent) => received.push(e));

    bus.emit(makeEvent<PipelineEvent>({
      type: 'pipeline.started',
      data: { pipelineId: 'p-1', pipelineType: 'training', config: {} },
    }));
    bus.emit(makeEvent<TrainingEvent>({
      type: 'training.epoch.completed',
      data: { sessionId: 's-1', epoch: 1, metrics: { loss: 0.5 } },
    }));
    bus.emit(makeEvent<ModelEvent>({
      type: 'model.registered',
      data: { modelId: 'm-1', name: 'test', metrics: {} },
    }));

    expect(received).toHaveLength(3);
    expect(received[0]!.type).toBe('pipeline.started');
    expect(received[1]!.type).toBe('training.epoch.completed');
    expect(received[2]!.type).toBe('model.registered');
  });

  // ── removeAllListeners ───────────────────────────────────
  it('should remove all listeners with removeAllListeners()', () => {
    const received: DomainEvent[] = [];
    bus.on('pipeline.started', (e: DomainEvent) => received.push(e));
    bus.on('model.registered', (e: DomainEvent) => received.push(e));
    bus.onAny((e: DomainEvent) => received.push(e));

    bus.removeAllListeners();

    bus.emit(makeEvent<PipelineEvent>({
      type: 'pipeline.started',
      data: { pipelineId: 'p-1', pipelineType: 'training', config: {} },
    }));
    bus.emit(makeEvent<ModelEvent>({
      type: 'model.registered',
      data: { modelId: 'm-1', name: 'test', metrics: {} },
    }));

    expect(received).toHaveLength(0);
  });

  // ── Singleton ────────────────────────────────────────────
  it('should return the same instance from getEventBus()', () => {
    const bus1 = getEventBus();
    const bus2 = getEventBus();
    expect(bus1).toBe(bus2);
  });

  it('should return a new instance after resetEventBus()', () => {
    const bus1 = getEventBus();
    resetEventBus();
    const bus2 = getEventBus();
    expect(bus1).not.toBe(bus2);
  });
});
