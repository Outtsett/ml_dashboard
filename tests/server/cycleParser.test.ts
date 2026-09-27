/**
 * Model Cycle wire events (`cycle_*`) through the generated-runner parser.
 *
 * `src/ml/shared/protocol.py::emit_cycle_*` is the real emitter; the fixture
 * at `tests/fixtures/cycle-events.jsonl` was produced by actually running it
 * (see the file header notes in that directory / the 2026-09-25 build), not
 * hand-typed, so this test is checking the real wire shape.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseGeneratedLine,
  GeneratedParser,
  resetDriftWarnings,
} from '../../src/server/training/runners/parsers/generated';
import { getParser, generatedParser } from '../../src/server/training/runners/parsers/index';
import { createSession } from '../../src/server/training/runners/types';
import { CYCLE_EVENT_TYPES } from '../../src/shared/cycle/schema';
import type { ResolvedTrainingConfig, TrainingSession, TrainingEvent } from '../../src/shared/trainingTypes';

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'cycle-events.jsonl');

function makeSession(modelType = 'xgboost+walk_forward_cycle'): TrainingSession {
  const config: ResolvedTrainingConfig = {
    modelType,
    registry: {
      name: 'test',
      category: 'test',
      subcategory: 'test',
      runner: 'python',
      featurePipeline: 'default-35',
      outputs: [],
      chartOverlay: 'prediction_markers',
      outputDir: 'data/models',
      defaultHyperparameters: {},
    },
    symbol: 'MNQ',
    timeframe: '5m',
    timeframeSec: 300,
    hyperparameters: {},
    featurePipeline: 'default-35',
    outputDir: 'data/models',
    modelId: 'MNQ_5m_xgboost_walk_forward_cycle',
  };
  return createSession('cycle-test-session', config);
}

function lastEvent(session: TrainingSession): TrainingEvent {
  expect(session.events.length).toBeGreaterThan(0);
  return session.events[session.events.length - 1]!;
}

describe('cycle_* events — parseGeneratedLine', () => {
  it('accepts every line in the real fixture, keeping seq and run_id', () => {
    const lines = fs.readFileSync(FIXTURE_PATH, 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);

    let previousSeq = -1;
    for (const line of lines) {
      const raw = JSON.parse(line) as { type: string; seq: number; run_id: string };
      const result = parseGeneratedLine(line);
      expect(result.kind, `line type=${raw.type} should parse as a cycle_event`).toBe('cycle_event');
      if (result.kind !== 'cycle_event') continue;

      expect(CYCLE_EVENT_TYPES).toContain(result.eventType);
      expect(result.eventType).toBe(raw.type);
      // seq and run_id — the envelope fields the wire contract requires every
      // consumer keep — survive validation.
      expect(result.event.seq).toBe(raw.seq);
      expect(result.event.run_id).toBe(raw.run_id);
      expect(result.event.seq as number).toBeGreaterThan(previousSeq);
      previousSeq = result.event.seq as number;

      // Cycle events use `nested_copy=False` — no `data` duplicate on the wire,
      // and the parsed output must not fabricate one either.
      expect('data' in result.event).toBe(false);
    }
  });

  it('every fixture event type is one of the declared cycle_* types, and every type is exercised', () => {
    const lines = fs.readFileSync(FIXTURE_PATH, 'utf8').trim().split('\n');
    const seen = new Set(lines.map((l) => (JSON.parse(l) as { type: string }).type));
    for (const type of seen) {
      expect(CYCLE_EVENT_TYPES).toContain(type);
    }
    // The fixture is meant to exercise every event, not a subset.
    expect(seen.size).toBe(CYCLE_EVENT_TYPES.length);
  });

  it('cycle_plan payload fields survive with the right shape', () => {
    const lines = fs.readFileSync(FIXTURE_PATH, 'utf8').trim().split('\n');
    const planLine = lines.find((l) => (JSON.parse(l) as { type: string }).type === 'cycle_plan')!;
    const result = parseGeneratedLine(planLine);
    expect(result.kind).toBe('cycle_event');
    if (result.kind !== 'cycle_event') return;
    expect(result.event.symbol).toBe('MNQ');
    expect(result.event.modelFamily).toBe('xgboost');
    expect(Array.isArray(result.event.folds)).toBe(true);
    expect((result.event.folds as unknown[]).length).toBe(1);
  });

  it('rejects an invalid cycle_bars line (mismatched column lengths) as cycle_invalid, not a crash', () => {
    const line = JSON.stringify({
      type: 'cycle_bars',
      seq: 1,
      run_id: 'run_x',
      role: 'context',
      foldIndex: 0,
      timestamps: [1, 2, 3],
      open: [1, 2], // one short — must fail cycleBarsSchema's superRefine
      high: [1, 2, 3],
      low: [1, 2, 3],
      close: [1, 2, 3],
      volume: [1, 2, 3],
    });
    expect(() => parseGeneratedLine(line)).not.toThrow();
    const result = parseGeneratedLine(line);
    expect(result.kind).toBe('cycle_invalid');
    if (result.kind !== 'cycle_invalid') return;
    expect(result.eventType).toBe('cycle_bars');
    expect(result.firstIssue.length).toBeLessThanOrEqual(300);
    expect(result.firstIssue.toLowerCase()).toContain('open');
  });

  it('an unknown cycle_* name (not in the registry) falls through to the generic union, not cycle handling', () => {
    // "cycle_frobnicate" starts with "cycle_" but is not one of the seven
    // declared types — isCycleEventType must reject it so it takes the
    // ordinary unknown-event path instead of throwing on an undefined schema.
    const line = JSON.stringify({ type: 'cycle_frobnicate', seq: 0 });
    const result = parseGeneratedLine(line);
    expect(result.kind).toBe('unknown');
  });
});

describe('cycle_* events — GeneratedParser session integration', () => {
  beforeEach(() => resetDriftWarnings());

  it('emits a session event per cycle_* line, type and payload preserved', () => {
    const session = makeSession();
    const parser = new GeneratedParser();
    const lines = fs.readFileSync(FIXTURE_PATH, 'utf8').trim().split('\n');
    for (const line of lines) {
      parser.parseLine(session, line, { modelsDir: '.', modelId: session.modelId });
    }
    expect(session.events.length).toBe(lines.length);
    expect(session.events.map((e) => e.type)).toEqual(
      lines.map((l) => (JSON.parse(l) as { type: string }).type),
    );
    // seq rides along on every emitted event's data, matching the wire line.
    lines.forEach((line, i) => {
      const raw = JSON.parse(line) as { seq: number };
      expect(session.events[i]!.data.seq).toBe(raw.seq);
    });
  });

  it('a cycle_bars failure becomes a short warn log, never the raw ~thousands-of-bars payload', () => {
    const session = makeSession();
    const parser = new GeneratedParser();
    const hugeTimestamps = Array.from({ length: 500 }, (_, i) => i);
    const line = JSON.stringify({
      type: 'cycle_bars',
      seq: 0,
      role: 'context',
      foldIndex: 0,
      timestamps: hugeTimestamps,
      open: hugeTimestamps, // fine
      high: hugeTimestamps,
      low: hugeTimestamps,
      close: hugeTimestamps,
      volume: hugeTimestamps.slice(0, 499), // one short -> invalid
    });
    parser.parseLine(session, line, { modelsDir: '.', modelId: session.modelId });
    const evt = lastEvent(session);
    expect(evt.type).toBe('log');
    expect(evt.data.level).toBe('warn');
    // The whole raw payload (500 timestamps x 5 columns) is NOT in the message.
    expect((evt.data.message as string).length).toBeLessThan(500);
    expect(evt.data.message as string).toContain('cycle_bars');
  });
});

describe('getParser — cycle runner keys route to the generated parser', () => {
  it('does not fall into the xgb_classifier parser for a cycle runner key', () => {
    const p = getParser('xgboost+walk_forward_cycle');
    expect(p).toBe(generatedParser);
  });

  it('routes every family to the generated parser', () => {
    for (const family of [
      'logistic_regression',
      'random_forest',
      'lightgbm',
      'multilayer_perceptron',
      'lstm',
      'temporal_convolution_network',
      'transformer_encoder',
    ]) {
      expect(getParser(`${family}+walk_forward_cycle`)).toBe(generatedParser);
    }
  });
});
