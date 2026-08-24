import { describe, it, expect } from 'vitest';
import type {
  DomainEvent, PipelineEvent, TrainingEvent,
  CacheEvent,
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
