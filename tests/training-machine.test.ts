import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import {
  trainingMachine,
  TRAINING_STEPS,
  type TrainingContext,
  type TrainingStep,
} from '@shared/machines/training-machine';

// ── Helpers ──────────────────────────────────────────────────
function startActor() {
  const actor = createActor(trainingMachine);
  actor.start();
  return actor;
}

function getContext(actor: ReturnType<typeof createActor<typeof trainingMachine>>): TrainingContext {
  return actor.getSnapshot().context;
}

function getState(actor: ReturnType<typeof createActor<typeof trainingMachine>>): string {
  return actor.getSnapshot().value as string;
}

describe('Training Pipeline State Machine', () => {
  // ── Initial state ─────────────────────────────────────────
  it('should start in idle', () => {
    const actor = startActor();
    expect(getState(actor)).toBe('idle');
    actor.stop();
  });

  // ── idle -> ingesting on START ────────────────────────────
  it('should transition from idle to ingesting on START', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'p-1', config: { symbol: 'EURUSD' } });

    expect(getState(actor)).toBe('ingesting');
    const ctx = getContext(actor);
    expect(ctx.pipelineId).toBe('p-1');
    expect(ctx.config).toEqual({ symbol: 'EURUSD' });
    expect(ctx.currentStep).toBe('ingesting');
    expect(ctx.startedAt).toBeGreaterThan(0);
    actor.stop();
  });

  // ── Happy path: all 6 steps to completed ──────────────────
  it('should traverse all steps to completed on STEP_COMPLETED', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'p-1', config: {} });

    // Steps after idle: ingesting -> computing_features -> generating_labels -> training -> evaluating -> registering -> completed
    const runningSteps = TRAINING_STEPS.slice(1, -1); // exclude idle and completed
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
    actor.send({ type: 'START', pipelineId: 'p-1', config: {} });

    actor.send({ type: 'STEP_COMPLETED', result: { rows: 5000 } });
    expect(getContext(actor).stepResults['ingesting']).toEqual({ rows: 5000 });

    actor.send({ type: 'STEP_COMPLETED', result: { features: 42 } });
    expect(getContext(actor).stepResults['computing_features']).toEqual({ features: 42 });

    // Both results exist
    expect(Object.keys(getContext(actor).stepResults)).toEqual(['ingesting', 'computing_features']);
    actor.stop();
  });

  // ── STEP_FAILED from any running state -> failed ──────────
  it('should transition to failed on STEP_FAILED from ingesting', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'p-1', config: {} });
    expect(getState(actor)).toBe('ingesting');

    actor.send({ type: 'STEP_FAILED', error: 'connection timeout' });
    expect(getState(actor)).toBe('failed');
    expect(getContext(actor).error).toBe('connection timeout');
    actor.stop();
  });

  it('should transition to failed on STEP_FAILED from computing_features', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'p-1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(getState(actor)).toBe('computing_features');

    actor.send({ type: 'STEP_FAILED', error: 'OOM' });
    expect(getState(actor)).toBe('failed');
    expect(getContext(actor).error).toBe('OOM');
    actor.stop();
  });

  it('should transition to failed on STEP_FAILED from training', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'p-1', config: {} });
    // ingesting -> computing_features -> generating_labels -> training
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(getState(actor)).toBe('training');

    actor.send({ type: 'STEP_FAILED', error: 'GPU crash' });
    expect(getState(actor)).toBe('failed');
    expect(getContext(actor).error).toBe('GPU crash');
    actor.stop();
  });

  it('should transition to failed on STEP_FAILED from evaluating', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'p-1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(getState(actor)).toBe('evaluating');

    actor.send({ type: 'STEP_FAILED', error: 'metrics below threshold' });
    expect(getState(actor)).toBe('failed');
    actor.stop();
  });

  it('should transition to failed on STEP_FAILED from registering', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'p-1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(getState(actor)).toBe('registering');

    actor.send({ type: 'STEP_FAILED', error: 'registry unreachable' });
    expect(getState(actor)).toBe('failed');
    actor.stop();
  });

  // ── Compensation: failed -> compensating -> compensated ───
  it('should transition failed -> compensating -> compensated', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'p-1', config: {} });
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

  // ── Pause and resume during training ──────────────────────
  it('should pause and resume during training', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'p-1', config: {} });
    // ingesting -> computing_features -> generating_labels -> training
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(getState(actor)).toBe('training');

    actor.send({ type: 'PAUSE' });
    expect(getState(actor)).toBe('paused');
    expect(getContext(actor).pausedAt).toBe('training');

    actor.send({ type: 'RESUME' });
    expect(getState(actor)).toBe('training');

    // Should be able to complete from here
    actor.send({ type: 'STEP_COMPLETED', result: { model: 'xgboost' } });
    expect(getState(actor)).toBe('evaluating');
    actor.stop();
  });

  // ── completed is a final state ────────────────────────────
  it('should have completed as a final state', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'p-1', config: {} });

    const runningSteps = TRAINING_STEPS.slice(1, -1);
    runningSteps.forEach(() => {
      actor.send({ type: 'STEP_COMPLETED', result: {} });
    });

    expect(getState(actor)).toBe('completed');
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });

  // ── TRAINING_STEPS const is correct ───────────────────────
  it('should export TRAINING_STEPS with correct order', () => {
    expect(TRAINING_STEPS).toEqual([
      'idle',
      'ingesting',
      'computing_features',
      'generating_labels',
      'training',
      'evaluating',
      'registering',
      'completed',
    ]);
  });

  // ── TrainingStep type checks ──────────────────────────────
  it('should have TrainingStep type matching TRAINING_STEPS elements', () => {
    // This is a compile-time check - if it compiles, the type is correct
    const step: TrainingStep = 'ingesting';
    expect(TRAINING_STEPS).toContain(step);
  });
});
