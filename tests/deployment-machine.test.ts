import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import {
  deploymentMachine,
  DEPLOYMENT_STEPS,
  type DeploymentContext,
  type DeploymentStep,
} from '@shared/machines/deployment-machine';

// ── Helpers ──────────────────────────────────────────────────
function startActor() {
  const actor = createActor(deploymentMachine);
  actor.start();
  return actor;
}

function getContext(actor: ReturnType<typeof createActor<typeof deploymentMachine>>): DeploymentContext {
  return actor.getSnapshot().context;
}

function getState(actor: ReturnType<typeof createActor<typeof deploymentMachine>>): string {
  return actor.getSnapshot().value as string;
}

describe('Deployment Pipeline State Machine', () => {
  // ── Initial state ─────────────────────────────────────────
  it('should start in idle', () => {
    const actor = startActor();
    expect(getState(actor)).toBe('idle');
    actor.stop();
  });

  // ── idle -> validating_benchmarks on START ────────────────
  it('should transition from idle to validating_benchmarks on START', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'deploy-1', config: { modelId: 'xgb-v3' } });

    expect(getState(actor)).toBe('validating_benchmarks');
    const ctx = getContext(actor);
    expect(ctx.pipelineId).toBe('deploy-1');
    expect(ctx.config).toEqual({ modelId: 'xgb-v3' });
    expect(ctx.currentStep).toBe('validating_benchmarks');
    expect(ctx.startedAt).toBeGreaterThan(0);
    actor.stop();
  });

  // ── Happy path: all steps to active ────────────────────────
  it('should traverse all steps to active on STEP_COMPLETED', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'deploy-1', config: {} });

    // Steps after idle: validating_benchmarks -> promoting -> monitoring -> active
    const runningSteps = DEPLOYMENT_STEPS.slice(1, -1); // exclude idle and active
    for (let i = 0; i < runningSteps.length; i++) {
      const step = runningSteps[i]!;
      expect(getState(actor)).toBe(step);
      expect(getContext(actor).currentStep).toBe(step);
      actor.send({ type: 'STEP_COMPLETED', result: { [`${step}_output`]: true } });
    }

    expect(getState(actor)).toBe('active');
    const ctx = getContext(actor);
    expect(ctx.completedSteps).toEqual(runningSteps);
    expect(ctx.error).toBeNull();
    actor.stop();
  });

  // ── Context tracks stepResults ────────────────────────────
  it('should accumulate stepResults for each completed step', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'deploy-1', config: {} });

    actor.send({ type: 'STEP_COMPLETED', result: { benchmarksPassed: true } });
    expect(getContext(actor).stepResults['validating_benchmarks']).toEqual({ benchmarksPassed: true });

    actor.send({ type: 'STEP_COMPLETED', result: { promoted: 'canary' } });
    expect(getContext(actor).stepResults['promoting']).toEqual({ promoted: 'canary' });

    expect(Object.keys(getContext(actor).stepResults)).toEqual(['validating_benchmarks', 'promoting']);
    actor.stop();
  });

  // ── STEP_FAILED from any running state -> failed ──────────
  it('should transition to failed on STEP_FAILED from validating_benchmarks', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'deploy-1', config: {} });
    expect(getState(actor)).toBe('validating_benchmarks');

    actor.send({ type: 'STEP_FAILED', error: 'benchmark regression detected' });
    expect(getState(actor)).toBe('failed');
    expect(getContext(actor).error).toBe('benchmark regression detected');
    actor.stop();
  });

  it('should transition to failed on STEP_FAILED from promoting', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'deploy-1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(getState(actor)).toBe('promoting');

    actor.send({ type: 'STEP_FAILED', error: 'promotion rejected' });
    expect(getState(actor)).toBe('failed');
    expect(getContext(actor).error).toBe('promotion rejected');
    actor.stop();
  });

  it('should transition to failed on STEP_FAILED from monitoring', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'deploy-1', config: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    actor.send({ type: 'STEP_COMPLETED', result: {} });
    expect(getState(actor)).toBe('monitoring');

    actor.send({ type: 'STEP_FAILED', error: 'health check failed' });
    expect(getState(actor)).toBe('failed');
    expect(getContext(actor).error).toBe('health check failed');
    actor.stop();
  });

  // ── Compensation: failed -> compensating -> compensated ───
  it('should transition failed -> compensating -> compensated', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'deploy-1', config: {} });
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

  // ── active is a final state ────────────────────────────────
  it('should have active as a final state', () => {
    const actor = startActor();
    actor.send({ type: 'START', pipelineId: 'deploy-1', config: {} });

    const runningSteps = DEPLOYMENT_STEPS.slice(1, -1);
    runningSteps.forEach(() => {
      actor.send({ type: 'STEP_COMPLETED', result: {} });
    });

    expect(getState(actor)).toBe('active');
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });

  // ── DEPLOYMENT_STEPS const is correct ─────────────────────
  it('should export DEPLOYMENT_STEPS with correct order', () => {
    expect(DEPLOYMENT_STEPS).toEqual([
      'idle',
      'validating_benchmarks',
      'promoting',
      'monitoring',
      'active',
    ]);
  });

  // ── DeploymentStep type checks ────────────────────────────
  it('should have DeploymentStep type matching DEPLOYMENT_STEPS elements', () => {
    const step: DeploymentStep = 'validating_benchmarks';
    expect(DEPLOYMENT_STEPS).toContain(step);
  });
});
