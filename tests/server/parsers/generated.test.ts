import { describe, it, expect, beforeEach } from 'vitest';
import {
  GeneratedParser,
  parseGeneratedLine,
  GeneratedEventSchema,
} from '../../../src/server/training/runners/parsers/generated';
import { getParser, generatedParser } from '../../../src/server/training/runners/parsers/index';
import { createSession } from '../../../src/server/training/runners/types';
import type { ResolvedTrainingConfig, TrainingSession, TrainingEvent } from '../../../src/shared/trainingTypes';

function makeSession(modelType = 'generated_test+direction_classifier'): TrainingSession {
  const config: ResolvedTrainingConfig = {
    modelType,
    registry: {
      name: 'test',
      category: 'test',
      subcategory: 'test',
      runner: 'python',
      featurePipeline: 'default',
      outputs: [],
      chartOverlay: 'none',
      outputDir: 'data/models/test',
      defaultHyperparameters: {},
    },
    symbol: 'MNQ',
    timeframe: '1d',
    timeframeSec: 86400,
    hyperparameters: {},
    featurePipeline: 'default',
    outputDir: 'data/models/test',
    modelId: 'MNQ_1d',
  };
  return createSession('test-session-1', config);
}

function lastEvent(session: TrainingSession): TrainingEvent {
  expect(session.events.length).toBeGreaterThan(0);
  return session.events[session.events.length - 1]!;
}

describe('parseGeneratedLine — pure function', () => {
  it('parses a metric_declarations line', () => {
    const line = JSON.stringify({
      type: 'metric_declarations',
      declarations: {
        profit_factor: {
          renderer: 'gauge',
          mission: 'Is this model profitable after costs?',
          context: { breakeven: 1.0, good: 1.5 },
          group: 'trading',
          order: 1,
        },
      },
    });
    const result = parseGeneratedLine(line);
    expect(result.kind).toBe('event');
    if (result.kind !== 'event') return;
    expect(result.event.type).toBe('metric_declarations');
    if (result.event.type !== 'metric_declarations') return;
    expect(result.event.declarations.profit_factor!.renderer).toBe('gauge');
  });

  it('parses an epoch_metric line', () => {
    const line = JSON.stringify({
      type: 'epoch_metric',
      iteration: 4,
      total: 30,
      epoch: 4,
      metrics: { train_loss: 0.213, val_loss: 0.241, val_auc: 0.612 },
    });
    const result = parseGeneratedLine(line);
    expect(result.kind).toBe('event');
    if (result.kind !== 'event') return;
    expect(result.event.type).toBe('epoch_metric');
    if (result.event.type !== 'epoch_metric') return;
    expect(result.event.iteration).toBe(4);
    expect(result.event.metrics?.val_auc).toBe(0.612);
  });

  it('parses a fold_complete line (new event type)', () => {
    const line = JSON.stringify({
      type: 'fold_complete',
      fold_idx: 2,
      metrics: { sharpe_after_costs: 0.41, profit_factor: 1.32, n_trades: 28 },
    });
    const result = parseGeneratedLine(line);
    expect(result.kind).toBe('event');
    if (result.kind !== 'event') return;
    expect(result.event.type).toBe('fold_complete');
    if (result.event.type !== 'fold_complete') return;
    expect(result.event.fold_idx).toBe(2);
    expect(result.event.metrics?.profit_factor).toBe(1.32);
  });

  it('parses a config line with nested config payload', () => {
    const line = JSON.stringify({
      type: 'config',
      scope: 'study',
      trial: null,
      fold: null,
      label: 'study_setup',
      config: {
        model: { name: 'CnnTransformerModel', d_model: 32 },
        optimizer: { name: 'AdamW', lr: 1e-3 },
        hpo: { n_trials: 32, sampler: 'TPE' },
      },
    });
    const result = parseGeneratedLine(line);
    expect(result.kind).toBe('event');
    if (result.kind !== 'event') return;
    expect(result.event.type).toBe('config');
    if (result.event.type !== 'config') return;
    expect(result.event.scope).toBe('study');
    expect(result.event.config.optimizer).toMatchObject({ name: 'AdamW' });
  });

  it('parses a done line with summary diagnostics', () => {
    const line = JSON.stringify({
      type: 'done',
      modelPath: 'data/models/MNQ_1d/checkpoint.pt',
      elapsedSec: 712.4,
      diagnostics: { quality_score: 0.72, num_folds: 4 },
    });
    const result = parseGeneratedLine(line);
    expect(result.kind).toBe('event');
    if (result.kind !== 'event') return;
    expect(result.event.type).toBe('done');
    if (result.event.type !== 'done') return;
    expect(result.event.modelPath).toContain('checkpoint.pt');
    expect(result.event.elapsedSec).toBeCloseTo(712.4);
  });

  it('parses an error line', () => {
    const line = JSON.stringify({
      type: 'error',
      message: 'CUDA out of memory',
      details: 'Tried to allocate 4.2 GiB',
    });
    const result = parseGeneratedLine(line);
    expect(result.kind).toBe('event');
    if (result.kind !== 'event') return;
    expect(result.event.type).toBe('error');
    if (result.event.type !== 'error') return;
    expect(result.event.message).toBe('CUDA out of memory');
  });

  it('returns kind=unknown for an unrecognized event type (no throw)', () => {
    const line = JSON.stringify({
      type: 'experimental_xyz_not_in_union',
      payload: { whatever: 42 },
    });
    expect(() => parseGeneratedLine(line)).not.toThrow();
    const result = parseGeneratedLine(line);
    expect(result.kind).toBe('unknown');
    if (result.kind !== 'unknown') return;
    expect(result.raw.type).toBe('experimental_xyz_not_in_union');
    expect((result.raw as { payload?: { whatever?: number } }).payload?.whatever).toBe(42);
  });

  it('returns kind=log for a non-JSON line', () => {
    const result = parseGeneratedLine('plain stderr-like message');
    expect(result.kind).toBe('log');
    if (result.kind !== 'log') return;
    expect(result.message).toBe('plain stderr-like message');
  });

  it('returns kind=log for malformed JSON', () => {
    const result = parseGeneratedLine('{ not valid json');
    expect(result.kind).toBe('log');
  });

  it('Zod schema validates a valid event directly', () => {
    const validated = GeneratedEventSchema.safeParse({
      type: 'metric',
      name: 'val_loss',
      value: 0.42,
      iteration: 7,
      total: 30,
    });
    expect(validated.success).toBe(true);
  });
});

describe('GeneratedParser — session integration', () => {
  let session: TrainingSession;
  let parser: GeneratedParser;

  beforeEach(() => {
    session = makeSession();
    parser = new GeneratedParser();
  });

  it('emits a session event for fold_complete', () => {
    parser.parseLine(
      session,
      JSON.stringify({
        type: 'fold_complete',
        fold_idx: 0,
        metrics: { profit_factor: 1.98 },
      }),
      { modelsDir: '.', modelId: 'MNQ_1d' },
    );
    const evt = lastEvent(session);
    expect(evt.type).toBe('fold_complete');
    expect(evt.data.fold_idx).toBe(0);
    expect(evt.data.metrics).toMatchObject({ profit_factor: 1.98 });
  });

  it('marks parserHandledDone on done events to prevent double-emit', () => {
    parser.parseLine(
      session,
      JSON.stringify({ type: 'done', modelPath: 'x.pt', elapsedSec: 1.5 }),
      { modelsDir: '.', modelId: 'MNQ_1d' },
    );
    expect(lastEvent(session).type).toBe('done');
    expect(
      (session as TrainingSession & { parserHandledDone?: boolean }).parserHandledDone,
    ).toBe(true);
  });

  it('forwards unknown event types as log with raw payload preserved', () => {
    parser.parseLine(
      session,
      JSON.stringify({ type: 'experimental_xyz', stuff: 1 }),
      { modelsDir: '.', modelId: 'MNQ_1d' },
    );
    const evt = lastEvent(session);
    expect(evt.type).toBe('log');
    expect(evt.data.unknownType).toBe('experimental_xyz');
    expect(typeof evt.data.message).toBe('string');
    expect(evt.data.message as string).toContain('experimental_xyz');
  });

  it('emits log for non-JSON lines', () => {
    parser.parseLine(session, 'WARNING: deprecated kwarg', {
      modelsDir: '.',
      modelId: 'MNQ_1d',
    });
    const evt = lastEvent(session);
    expect(evt.type).toBe('log');
    expect(evt.data.message).toBe('WARNING: deprecated kwarg');
  });

  it('does not throw on empty line and does not emit', () => {
    const before = session.events.length;
    parser.parseLine(session, '', { modelsDir: '.', modelId: 'MNQ_1d' });
    expect(session.events.length).toBe(before);
  });
});

describe('getParser — registry routing', () => {
  it('routes generated_* model types to the GeneratedParser', () => {
    const p = getParser('generated_rf_v1+direction_classifier');
    expect(p).toBe(generatedParser);
  });

  it('falls back to GeneratedParser for unknown model types (base protocol is project-wide)', () => {
    const p = getParser('not_yet_registered_model');
    expect(p).toBe(generatedParser);
  });

  it('still honors exact-match parsers (xgb_classifier)', () => {
    const p = getParser('xgb_classifier');
    expect(p).not.toBe(generatedParser);
  });
});
