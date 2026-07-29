/**
 * Envelope tests for the generated-runner parser.
 *
 * The Node half of the schema-v1 envelope contract. Two properties are
 * load-bearing:
 *
 * 1. **Legacy lines still parse.** Every envelope field is optional, so a
 *    pre-envelope runner (or a headless `scripts/train_*.py`) validates
 *    exactly as before.
 * 2. **Enveloped lines parse with identity typed**, and any identity field the
 *    runner did not emit is synthesized from the spawn record — never guessed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  GeneratedParser,
  GeneratedEventSchema,
  parseGeneratedLine,
  withSynthesizedEnvelope,
} from '../../../src/server/training/runners/parsers/generated';
import { createSession } from '../../../src/server/training/runners/types';
import {
  registerRunContext,
  resetRunContexts,
  type RunContext,
} from '../../../src/server/training/provenance';
import type { ResolvedTrainingConfig, TrainingSession, TrainingEvent } from '../../../src/shared/trainingTypes';

const MODEL_ID = 'MNQ_1d_xgboost+direction_classifier_20260728T120000';

const CTX: RunContext = {
  experimentId: 'exp_01K3QZ6ABCDEFGHJKMNPQRSTV',
  runId: 'run_01K3QZ7ABCDEFGHJKMNPQRSTV',
  catalogId: 'xgboost',
  runnerKey: 'xgboost+direction_classifier',
  legacyModelId: MODEL_ID,
  configHash: '9f3c1a2e5b70d4c8',
  manifestHash: '7ad04ef1c9b3220a',
  manifestPath: 'data/runs/exp_01K3QZ6ABCDEFGHJKMNPQRSTV/run_01K3QZ7ABCDEFGHJKMNPQRSTV/manifest.json',
  artifactDir: `data/models/${MODEL_ID}`,
  trialIdx: null,
  foldIdx: null,
};

/** A metric line exactly as `protocol.py::_envelope` emits it — flat payload
 *  AND nested `data`, which is the documented v1 transition form. */
function envelopedMetricLine(): string {
  return JSON.stringify({
    type: 'metric',
    name: 'val_auc',
    value: 0.6134,
    iteration: 42,
    total: 200,
    v: 1,
    kind: 'training',
    ts: '2026-07-28T18:03:11.284Z',
    mono_ns: 91284113000,
    seq: 1043,
    run_id: CTX.runId,
    experiment_id: CTX.experimentId,
    catalog_id: CTX.catalogId,
    trial_idx: 17,
    fold_idx: 2,
    config_hash: CTX.configHash,
    manifest_hash: CTX.manifestHash,
    data: { name: 'val_auc', value: 0.6134, iteration: 42, total: 200 },
  });
}

function makeSession(): TrainingSession {
  const config: ResolvedTrainingConfig = {
    modelType: 'xgboost+direction_classifier',
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
    modelId: MODEL_ID,
  };
  return createSession('test-session-envelope', config);
}

function lastEvent(session: TrainingSession): TrainingEvent {
  expect(session.events.length).toBeGreaterThan(0);
  return session.events[session.events.length - 1]!;
}

beforeEach(() => resetRunContexts());
afterEach(() => resetRunContexts());

describe('GeneratedEventSchema — envelope intersection', () => {
  it('validates a fully enveloped metric line', () => {
    const result = GeneratedEventSchema.safeParse(JSON.parse(envelopedMetricLine()));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe('metric');
    expect(result.data.run_id).toBe(CTX.runId);
    expect(result.data.experiment_id).toBe(CTX.experimentId);
    expect(result.data.seq).toBe(1043);
    expect(result.data.v).toBe(1);
    expect(result.data.kind).toBe('training');
  });

  it('still validates a legacy line with no envelope at all', () => {
    const result = GeneratedEventSchema.safeParse({
      type: 'metric',
      name: 'val_loss',
      value: 0.42,
      iteration: 7,
      total: 30,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.run_id).toBeUndefined();
    expect(result.data.seq).toBeUndefined();
  });

  it('accepts null identity — a headless run legitimately has none', () => {
    const result = GeneratedEventSchema.safeParse({
      type: 'log',
      level: 'info',
      message: 'headless',
      v: 1,
      kind: 'training',
      seq: 0,
      run_id: null,
      experiment_id: null,
      catalog_id: null,
      trial_idx: null,
      fold_idx: null,
      config_hash: null,
      manifest_hash: null,
      data: { level: 'info', message: 'headless' },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.run_id).toBeNull();
  });

  it('validates every enveloped event type, including array-carrying overlay', () => {
    const envelope = {
      v: 1,
      kind: 'training',
      ts: '2026-07-28T18:03:11.284Z',
      mono_ns: 1,
      seq: 0,
      run_id: CTX.runId,
      experiment_id: CTX.experimentId,
      catalog_id: CTX.catalogId,
      trial_idx: null,
      fold_idx: 1,
      config_hash: CTX.configHash,
      manifest_hash: CTX.manifestHash,
    };
    const payloads: Array<Record<string, unknown>> = [
      { type: 'progress', iteration: 1, total: 10, phase: 'fit' },
      { type: 'metric', name: 'loss', value: 0.5, iteration: 1, total: 10 },
      { type: 'fold_complete', fold_idx: 1, metrics: { auc: 0.5 } },
      {
        type: 'overlay',
        overlayType: 'regime_zones',
        timestamps: [1_700_000_000, 1_700_000_060],
        assignments: [0, 1],
        payload: { colors: ['#0072B2', '#E69F00'], labels: ['calm', 'stressed'] },
      },
      { type: 'log', level: 'info', message: 'msg' },
      { type: 'done', modelPath: 'p', diagnostics: { quality_score: 0.5 } },
      { type: 'model_state', iteration: 1, total: 10, snapshot: { k: 3 } },
      { type: 'sampler_diagnostics', iteration: 1, total: 10, diagnostics: { ess: 120 } },
      { type: 'metric_declarations', declarations: { loss: { renderer: 'number' } } },
      { type: 'error', message: 'boom', details: 'traceback' },
      { type: 'epoch_metric', iteration: 1, total: 10, metrics: { loss: 0.1 } },
      { type: 'config', config: { model: { name: 'X' } } },
    ];

    for (const payload of payloads) {
      const line = { ...envelope, ...payload, data: { ...payload } };
      const result = GeneratedEventSchema.safeParse(line);
      expect(result.success, `${String(payload.type)} failed to validate`).toBe(true);
      if (!result.success) continue;
      expect(result.data.type).toBe(payload.type);
      expect(result.data.run_id).toBe(CTX.runId);
    }
  });

  it('preserves the flat payload that XgbClassifierParser depends on', () => {
    const result = parseGeneratedLine(envelopedMetricLine());
    expect(result.kind).toBe('event');
    if (result.kind !== 'event') return;
    if (result.event.type !== 'metric') return;
    expect(result.event.name).toBe('val_auc');
    expect(result.event.value).toBeCloseTo(0.6134);
    expect(result.event.iteration).toBe(42);
    expect(result.event.total).toBe(200);
  });

  it('preserves the nested data mirror', () => {
    const result = parseGeneratedLine(envelopedMetricLine());
    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event.data).toEqual({ name: 'val_auc', value: 0.6134, iteration: 42, total: 200 });
  });

  it('does not reclassify an enveloped line as unknown', () => {
    expect(parseGeneratedLine(envelopedMetricLine()).kind).toBe('event');
  });
});

describe('withSynthesizedEnvelope', () => {
  it('fills identity from the spawn record when the runner emitted none', () => {
    registerRunContext(MODEL_ID, CTX);
    const payload = withSynthesizedEnvelope({ name: 'loss', value: 1 }, MODEL_ID);
    expect(payload).toMatchObject({
      run_id: CTX.runId,
      experiment_id: CTX.experimentId,
      catalog_id: CTX.catalogId,
      config_hash: CTX.configHash,
      manifest_hash: CTX.manifestHash,
    });
  });

  it('never overwrites an identity the runner did emit', () => {
    registerRunContext(MODEL_ID, CTX);
    const payload = withSynthesizedEnvelope({ run_id: 'run_FROM_PYTHON' }, MODEL_ID);
    expect(payload.run_id).toBe('run_FROM_PYTHON');
    // ...while still filling the fields that were absent.
    expect(payload.experiment_id).toBe(CTX.experimentId);
  });

  it('replaces an explicit null — a headless emitter reports null, not a value', () => {
    registerRunContext(MODEL_ID, CTX);
    const payload = withSynthesizedEnvelope({ run_id: null }, MODEL_ID);
    expect(payload.run_id).toBe(CTX.runId);
  });

  it('does not fabricate trial_idx / fold_idx — only the process knows those', () => {
    registerRunContext(MODEL_ID, CTX);
    const payload = withSynthesizedEnvelope({ name: 'loss' }, MODEL_ID);
    expect('trial_idx' in payload).toBe(false);
    expect('fold_idx' in payload).toBe(false);
  });

  it('is a no-op when no spawn record exists', () => {
    const payload = withSynthesizedEnvelope({ name: 'loss' }, MODEL_ID);
    expect(payload).toEqual({ name: 'loss' });
  });
});

describe('GeneratedParser — envelope on session events', () => {
  let session: TrainingSession;
  let parser: GeneratedParser;

  beforeEach(() => {
    session = makeSession();
    parser = new GeneratedParser();
  });

  it('forwards the envelope fields on the emitted session event', () => {
    parser.parseLine(session, envelopedMetricLine(), { modelsDir: '.', modelId: MODEL_ID });
    const evt = lastEvent(session);
    expect(evt.type).toBe('metric');
    expect(evt.data.run_id).toBe(CTX.runId);
    expect(evt.data.trial_idx).toBe(17);
    expect(evt.data.fold_idx).toBe(2);
    expect(evt.data.seq).toBe(1043);
    // Flat payload intact.
    expect(evt.data.name).toBe('val_auc');
    expect(evt.data.value).toBeCloseTo(0.6134);
  });

  it('synthesizes identity for a legacy runner that emits no envelope', () => {
    registerRunContext(MODEL_ID, CTX);
    parser.parseLine(
      session,
      JSON.stringify({ type: 'metric', name: 'val_loss', value: 0.42, iteration: 7, total: 30 }),
      { modelsDir: '.', modelId: MODEL_ID },
    );
    const evt = lastEvent(session);
    expect(evt.data.run_id).toBe(CTX.runId);
    expect(evt.data.experiment_id).toBe(CTX.experimentId);
    expect(evt.data.config_hash).toBe(CTX.configHash);
    expect(evt.data.name).toBe('val_loss');
  });

  it('emits a legacy line unchanged when there is no spawn record at all', () => {
    parser.parseLine(
      session,
      JSON.stringify({ type: 'metric', name: 'val_loss', value: 0.42, iteration: 7, total: 30 }),
      { modelsDir: '.', modelId: MODEL_ID },
    );
    const evt = lastEvent(session);
    expect(evt.data.run_id).toBeUndefined();
    expect(evt.data.name).toBe('val_loss');
  });

  it('marks parserHandledError on an error envelope so the runner reports failed, not crashed', () => {
    parser.parseLine(
      session,
      JSON.stringify({ type: 'error', message: 'CUDA out of memory', v: 1, kind: 'training', seq: 3 }),
      { modelsDir: '.', modelId: MODEL_ID },
    );
    expect(lastEvent(session).type).toBe('error');
    expect(
      (session as TrainingSession & { parserHandledError?: boolean }).parserHandledError,
    ).toBe(true);
  });

  it('leaves parserHandledError unset on a normal run', () => {
    parser.parseLine(session, envelopedMetricLine(), { modelsDir: '.', modelId: MODEL_ID });
    expect(
      (session as TrainingSession & { parserHandledError?: boolean }).parserHandledError,
    ).toBeUndefined();
  });

  it('still marks parserHandledDone on an enveloped done event', () => {
    parser.parseLine(
      session,
      JSON.stringify({ type: 'done', modelPath: 'x.pt', elapsedSec: 1.5, v: 1, kind: 'training', seq: 9 }),
      { modelsDir: '.', modelId: MODEL_ID },
    );
    expect(lastEvent(session).type).toBe('done');
    expect(
      (session as TrainingSession & { parserHandledDone?: boolean }).parserHandledDone,
    ).toBe(true);
  });
});
