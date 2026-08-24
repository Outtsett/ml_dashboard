import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import {
  ingestionMachine,
  INGESTION_STEPS,
  type IngestionContext,
  type IngestionStep,
} from '@shared/machines/ingestion-machine';

// ── Helpers ──────────────────────────────────────────────────
function startActor() {
  const actor = createActor(ingestionMachine);
  actor.start();
  return actor;
}

function getContext(actor: ReturnType<typeof createActor<typeof ingestionMachine>>): IngestionContext {
  return actor.getSnapshot().context;
}

function getState(actor: ReturnType<typeof createActor<typeof ingestionMachine>>): string {
  return actor.getSnapshot().value as string;
}

describe('Ingestion Pipeline State Machine', () => {
  // ── Initial state ─────────────────────────────────────────
  it('should start in idle', () => {
    const actor = startActor();
    expect(getState(actor)).toBe('idle');
    actor.stop();
  });

  // ── idle -> uploading on START ────────────────────────────
  it('should transition from idle to uploading on START', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'ing-1', config: { symbol: 'EURUSD', timeframe: '1h' } });

    expect(getState(actor)).toBe('uploading');
    const ctx = getContext(actor);
    expect(ctx.pipelineId).toBe('ing-1');
    expect(ctx.config).toEqual({ symbol: 'EURUSD', timeframe: '1h' });
    expect(ctx.currentStep).toBe('uploading');
    expect(ctx.startedAt).toBeGreaterThan(0);
    actor.stop();
  });

  // ── Happy path: all 6 steps to completed ──────────────────
  it('should traverse all steps to completed on STEP_COMPLETED', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'ing-1', config: {} });

    // Steps after idle: uploading -> validating -> deduplicating -> ingesting_duckdb -> syncing_questdb -> computing_indicators -> completed
    const runningSteps = INGESTION_STEPS.slice(1, -1); // exclude idle and completed
    for (let i = 0; i < runningSteps.length; i++) {
      const step = runningSteps[i]!;
      expect(getState(actor)).toBe(step);
      expect(getContext(actor).currentStep).toBe(step);
      actor.send({ type: 'STEP_COMPLETED', result: { [`${step}_output`]: true } });
    }

    expect(getState(actor)).toBe('completed');
    const ctx = getContext(actor);
    expect(ctx.completedSteps).toEqual(runningSteps);
    expect(ctx.error).toBeNull();
    actor.stop();
  });

  // ── Context tracks stepResults ────────────────────────────
  it('should accumulate stepResults for each completed step', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'ing-1', config: {} });

    actor.send({ type: 'STEP_COMPLETED', result: { bytes: 1024000 } });
    expect(getContext(actor).stepResults['uploading']).toEqual({ bytes: 1024000 });

    actor.send({ type: 'STEP_COMPLETED', result: { rowCount: 50000, valid: true } });
    expect(getContext(actor).stepResults['validating']).toEqual({ rowCount: 50000, valid: true });

    // Both results exist
    expect(Object.keys(getContext(actor).stepResults)).toEqual(['uploading', 'validating']);
    actor.stop();
  });

  // ── STEP_FAILED from any running state -> failed ──────────
  it('should transition to failed on STEP_FAILED from uploading', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'ing-1', config: {} });
    expect(getState(actor)).toBe('uploading');

    actor.send({ type: 'STEP_FAILED', error: 'file too large' });
    expect(getState(actor)).toBe('failed');
    expect(getContext(actor).error).toBe('file too large');
    actor.stop();
  });

  it('should transition to failed on STEP_FAILED from validating', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'ing-1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(getState(actor)).toBe('validating');

    actor.send({ type: 'STEP_FAILED', error: 'invalid CSV format' });
    expect(getState(actor)).toBe('failed');
    expect(getContext(actor).error).toBe('invalid CSV format');
    actor.stop();
  });

  it('should transition to failed on STEP_FAILED from deduplicating', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'ing-1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(getState(actor)).toBe('deduplicating');

    actor.send({ type: 'STEP_FAILED', error: 'dedup hash collision' });
    expect(getState(actor)).toBe('failed');
    expect(getContext(actor).error).toBe('dedup hash collision');
    actor.stop();
  });

  it('should transition to failed on STEP_FAILED from ingesting_duckdb', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'ing-1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(getState(actor)).toBe('ingesting_duckdb');

    actor.send({ type: 'STEP_FAILED', error: 'DuckDB write failed' });
    expect(getState(actor)).toBe('failed');
    expect(getContext(actor).error).toBe('DuckDB write failed');
    actor.stop();
  });

  it('should transition to failed on STEP_FAILED from syncing_questdb', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'ing-1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(getState(actor)).toBe('syncing_questdb');

    actor.send({ type: 'STEP_FAILED', error: 'QuestDB connection refused' });
    expect(getState(actor)).toBe('failed');
    expect(getContext(actor).error).toBe('QuestDB connection refused');
    actor.stop();
  });

  it('should transition to failed on STEP_FAILED from computing_indicators', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'ing-1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(getState(actor)).toBe('computing_indicators');

    actor.send({ type: 'STEP_FAILED', error: 'indicator computation OOM' });
    expect(getState(actor)).toBe('failed');
    expect(getContext(actor).error).toBe('indicator computation OOM');
    actor.stop();
  });

  // ── Compensation: failed -> compensating -> compensated ───
  it('should transition failed -> compensating -> compensated', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'ing-1', config: {} });
    actor.send({ type: 'STEP_FAILED', error: 'boom' });
    expect(getState(actor)).toBe('failed');

    actor.send({ type: 'COMPENSATE' });
    expect(getState(actor)).toBe('compensating');

    actor.send({ type: 'COMPENSATION_DONE' });
    expect(getState(actor)).toBe('compensated');

    // compensated is a final state - verify the actor status
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });

  // ── completed is a final state ────────────────────────────
  it('should have completed as a final state', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'ing-1', config: {} });

    const runningSteps = INGESTION_STEPS.slice(1, -1);
    runningSteps.forEach(() => {
      actor.send({ type: 'STEP_COMPLETED', result: {} });
    });

    expect(getState(actor)).toBe('completed');
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });

  // ── INGESTION_STEPS const is correct ───────────────────────
  it('should export INGESTION_STEPS with correct order', () => {
    expect(INGESTION_STEPS).toEqual([
      'idle',
      'uploading',
      'validating',
      'deduplicating',
      'ingesting_duckdb',
      'syncing_questdb',
      'computing_indicators',
      'completed',
    ]);
  });

  // ── IngestionStep type checks ──────────────────────────────
  it('should have IngestionStep type matching INGESTION_STEPS elements', () => {
    // This is a compile-time check - if it compiles, the type is correct
    const step: IngestionStep = 'uploading';
    expect(INGESTION_STEPS).toContain(step);
  });
});
