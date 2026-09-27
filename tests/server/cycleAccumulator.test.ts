/**
 * `src/server/training/cycle.ts` — the per-run accumulator that folds
 * `"training.event"` domain events into a `CycleSnapshot`, independently of
 * `trainingStorage`'s SQLite recorder.
 *
 * Drives `handleTrainingEvent` directly (synchronously, no `EventBus`
 * round-trip) — the accumulator's own event-bus wiring
 * (`ensureCycleAccumulator`) is a one-line `getEventBus().on(...)` and is not
 * what these tests are about.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { DomainEvent } from '../../src/shared/event-types';
import {
  handleTrainingEvent,
  getCycleSnapshot,
  listCycleRuns,
  resetCycleAccumulatorForTests,
} from '../../src/server/training/cycle';

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'cycle-events.jsonl');
const MODEL_ID = 'MNQ_5m_xgboost_walk_forward_cycle';
const MODEL_TYPE = 'xgboost+walk_forward_cycle';

let clock = 1_000_000;

function feed(type: string, data: Record<string, unknown>, modelId = MODEL_ID): void {
  const event: DomainEvent = {
    type: 'training.event',
    data: { sessionId: `${modelId}-session`, modelId, type, data, ts: clock++ },
    metadata: { correlationId: modelId, causationId: `training-${type}`, timestamp: clock },
  };
  handleTrainingEvent(event);
}

function loadFixtureEvents(): Array<{ type: string; data: Record<string, unknown> }> {
  return fs
    .readFileSync(FIXTURE_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const raw = JSON.parse(line) as Record<string, unknown> & { type: string };
      const { type, ...rest } = raw;
      return { type, data: rest };
    });
}

beforeEach(() => {
  resetCycleAccumulatorForTests();
  clock = 1_000_000;
});

describe('cycle accumulator — tracking', () => {
  it('is not tracked before any qualifying event arrives', () => {
    expect(getCycleSnapshot(MODEL_ID)).toBeNull();
    expect(listCycleRuns()).toEqual([]);
  });

  it('starts tracking on a "started" event whose modelType ends with +walk_forward_cycle', () => {
    feed('started', { modelType: MODEL_TYPE, symbol: 'MNQ', timeframe: '5m', modelId: MODEL_ID });
    const snapshot = getCycleSnapshot(MODEL_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.status).toBe('running');
    expect(snapshot!.modelType).toBe(MODEL_TYPE);
  });

  it('does NOT start tracking a "started" event for a non-cycle model', () => {
    feed('started', { modelType: 'xgboost+direction_classifier', symbol: 'MNQ', timeframe: '5m' }, 'other-model');
    expect(getCycleSnapshot('other-model')).toBeNull();
  });

  it('falls back to tracking on the first cycle_* event if "started" was missed', () => {
    feed('cycle_plan', { seq: 0, symbol: 'MNQ', timeframe: '5m', modelFamily: 'xgboost' });
    expect(getCycleSnapshot(MODEL_ID)).not.toBeNull();
  });
});

describe('cycle accumulator — folding the real fixture into a snapshot', () => {
  it('builds plan/bars/cursor/epochs/trials/trades/scoreboards from every fixture event', () => {
    feed('started', { modelType: MODEL_TYPE, symbol: 'MNQ', timeframe: '5m', modelId: MODEL_ID });
    for (const { type, data } of loadFixtureEvents()) feed(type, data);

    const snapshot = getCycleSnapshot(MODEL_ID)!;
    expect(snapshot.plan).not.toBeNull();
    expect(snapshot.plan!.symbol).toBe('MNQ');
    expect(snapshot.bars.timestamps.length).toBe(5); // 3 context + 2 processed bars in the fixture
    expect(snapshot.cursor).not.toBeNull();
    expect(snapshot.epochs.length).toBe(1);
    expect(snapshot.trials.length).toBe(1);
    expect(snapshot.trades.length).toBe(1);
    expect(snapshot.trades[0]!.tradeNumber).toBe(41);
    expect(snapshot.scoreboards.running).not.toBeNull();
    expect(snapshot.scoreboards.folds.length).toBe(1);
    expect(snapshot.scoreboards.final).not.toBeNull();
    expect(snapshot.lastSequence).toBe(10); // the fixture's highest seq (cycle_parameters)
  });

  it('listCycleRuns reflects the tracked run, symbol/timeframe/family from the plan', () => {
    feed('started', { modelType: MODEL_TYPE, symbol: 'MNQ', timeframe: '5m', modelId: MODEL_ID });
    for (const { type, data } of loadFixtureEvents()) feed(type, data);

    const runs = listCycleRuns();
    expect(runs.length).toBe(1);
    expect(runs[0]!.modelId).toBe(MODEL_ID);
    expect(runs[0]!.symbol).toBe('MNQ');
    expect(runs[0]!.timeframe).toBe('5m');
    expect(runs[0]!.modelFamily).toBe('xgboost');
    expect(runs[0]!.tradeCount).toBe(1);
    expect(runs[0]!.barCount).toBe(5);
  });
});

describe('cycle accumulator — status transitions', () => {
  it('done -> complete', () => {
    feed('started', { modelType: MODEL_TYPE, symbol: 'MNQ', timeframe: '5m', modelId: MODEL_ID });
    feed('done', { modelId: MODEL_ID, diagnostics: { stopped: false } });
    expect(getCycleSnapshot(MODEL_ID)!.status).toBe('complete');
  });

  it('done with diagnostics.stopped=true -> stopped', () => {
    feed('started', { modelType: MODEL_TYPE, symbol: 'MNQ', timeframe: '5m', modelId: MODEL_ID });
    feed('done', { modelId: MODEL_ID, diagnostics: { stopped: true } });
    expect(getCycleSnapshot(MODEL_ID)!.status).toBe('stopped');
  });

  it('error "Training stopped by user" -> stopped, no error message', () => {
    feed('started', { modelType: MODEL_TYPE, symbol: 'MNQ', timeframe: '5m', modelId: MODEL_ID });
    feed('error', { message: 'Training stopped by user' });
    const snapshot = getCycleSnapshot(MODEL_ID)!;
    expect(snapshot.status).toBe('stopped');
    expect(snapshot.error).toBeNull();
  });

  it('any other error -> failed, message preserved', () => {
    feed('started', { modelType: MODEL_TYPE, symbol: 'MNQ', timeframe: '5m', modelId: MODEL_ID });
    feed('error', { message: 'CUDA out of memory' });
    const snapshot = getCycleSnapshot(MODEL_ID)!;
    expect(snapshot.status).toBe('failed');
    expect(snapshot.error).toBe('CUDA out of memory');
  });

  it('log lines accumulate, most recent kept in order', () => {
    feed('started', { modelType: MODEL_TYPE, symbol: 'MNQ', timeframe: '5m', modelId: MODEL_ID });
    feed('log', { message: 'first', level: 'info' });
    feed('log', { message: 'second', level: 'warn' });
    const snapshot = getCycleSnapshot(MODEL_ID)!;
    expect(snapshot.logs.map((l) => l.message)).toEqual(['first', 'second']);
    expect(snapshot.logs[1]!.level).toBe('warn');
  });
});

describe('cycle accumulator — duplicate seq is ignored', () => {
  it('the same seq applied twice only takes effect once', () => {
    feed('started', { modelType: MODEL_TYPE, symbol: 'MNQ', timeframe: '5m', modelId: MODEL_ID });
    feed('cycle_trade', {
      seq: 5,
      tradeNumber: 1,
      foldIndex: 0,
      side: 'long',
      status: 'open',
      contracts: 1,
      entryTimestamp: 1000,
      entryPrice: 100,
      exitTimestamp: null,
      exitPrice: null,
      barsHeld: 0,
      probabilityUpAtEntry: 0.6,
      grossProfitUsd: null,
      costUsd: null,
      netProfitUsd: null,
      exitReason: null,
    });
    expect(getCycleSnapshot(MODEL_ID)!.trades.length).toBe(1);
    expect(getCycleSnapshot(MODEL_ID)!.lastSequence).toBe(5);

    // Same seq, a DIFFERENT trade number — if this were applied, trades
    // would grow to 2. It must be dropped because seq <= lastSequence.
    feed('cycle_trade', {
      seq: 5,
      tradeNumber: 2,
      foldIndex: 0,
      side: 'short',
      status: 'open',
      contracts: 1,
      entryTimestamp: 2000,
      entryPrice: 100,
      exitTimestamp: null,
      exitPrice: null,
      barsHeld: 0,
      probabilityUpAtEntry: 0.4,
      grossProfitUsd: null,
      costUsd: null,
      netProfitUsd: null,
      exitReason: null,
    });
    expect(getCycleSnapshot(MODEL_ID)!.trades.length).toBe(1);
    expect(getCycleSnapshot(MODEL_ID)!.lastSequence).toBe(5);

    // A higher seq is applied normally.
    feed('cycle_trade', {
      seq: 6,
      tradeNumber: 2,
      foldIndex: 0,
      side: 'short',
      status: 'open',
      contracts: 1,
      entryTimestamp: 2000,
      entryPrice: 100,
      exitTimestamp: null,
      exitPrice: null,
      barsHeld: 0,
      probabilityUpAtEntry: 0.4,
      grossProfitUsd: null,
      costUsd: null,
      netProfitUsd: null,
      exitReason: null,
    });
    expect(getCycleSnapshot(MODEL_ID)!.trades.length).toBe(2);
    expect(getCycleSnapshot(MODEL_ID)!.lastSequence).toBe(6);
  });
});

describe('cycle accumulator — 5-run retention', () => {
  it('keeps only the 5 most recently STARTED runs, evicting the oldest', () => {
    for (let i = 0; i < 7; i++) {
      feed('started', { modelType: MODEL_TYPE, symbol: 'MNQ', timeframe: '5m' }, `model-${i}`);
    }
    const runs = listCycleRuns();
    expect(runs.length).toBe(5);
    const ids = new Set(runs.map((r) => r.modelId));
    // The two oldest (model-0, model-1) were evicted.
    expect(ids.has('model-0')).toBe(false);
    expect(ids.has('model-1')).toBe(false);
    expect(ids.has('model-6')).toBe(true);
  });
});
