import { createActor, type AnyStateMachine } from 'xstate';
import { EventStore } from '../events/event-store';
import { EventBus } from '../events/event-bus';
import type { NewEvent, DomainEvent, EventMetadata } from '@shared/event-types';

// ── SagaStep interface ──────────────────────────────────────
export interface SagaStep {
  name: string;
  execute: (context: Record<string, unknown>) => Promise<Record<string, unknown>>;
  compensate?: (context: Record<string, unknown>) => Promise<void>;
  timeout?: number;
}

// ── Timeout helper ──────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Step "${label}" timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ── Default timeout: 5 minutes ──────────────────────────────
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// ── SagaOrchestrator ────────────────────────────────────────
export class SagaOrchestrator {
  constructor(
    private eventStore: EventStore,
    private eventBus: EventBus,
    private machine: AnyStateMachine,
    private steps: SagaStep[],
  ) {}

  /**
   * Execute a saga pipeline: run each step sequentially, persist events,
   * and run compensation on failure.
   */
  async execute(pipelineId: string, config: Record<string, unknown>): Promise<void> {
    // Track stream position for optimistic concurrency
    let position = -1;

    // Create and start the state machine actor
    const actor = createActor(this.machine);
    actor.start();
    actor.send({ type: 'START', pipelineId, config });

    // Helper: build metadata for an event
    const makeMeta = (): EventMetadata => ({
      correlationId: pipelineId,
      causationId: pipelineId,
      timestamp: Date.now(),
    });

    // Helper: persist a single event and emit it to the bus
    const persistAndEmit = async (event: NewEvent): Promise<void> => {
      await this.eventStore.appendToStream(pipelineId, position, [event]);
      position += 1;
      this.eventBus.emit({ ...event } as DomainEvent);
    };

    // ── 1. Persist pipeline.started ─────────────────────────
    await persistAndEmit({
      type: 'pipeline.started',
      data: { pipelineId, pipelineType: 'training', config },
      metadata: makeMeta(),
    });

    // ── 2. Execute each step ────────────────────────────────
    const completedSteps: string[] = [];
    const sagaContext: Record<string, unknown> = { ...config };
    const startTime = Date.now();

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i]!;
      const timeout = step.timeout ?? DEFAULT_TIMEOUT_MS;

      // Persist step.started
      await persistAndEmit({
        type: 'pipeline.step.started',
        data: { pipelineId, step: step.name, stepIndex: i },
        metadata: makeMeta(),
      });

      try {
        // Execute the step with timeout
        const stepStart = Date.now();
        const result = await withTimeout(step.execute(sagaContext), timeout, step.name);
        const durationMs = Date.now() - stepStart;

        // Merge step result into saga context
        Object.assign(sagaContext, result);

        // Persist step.completed
        await persistAndEmit({
          type: 'pipeline.step.completed',
          data: { pipelineId, step: step.name, stepIndex: i, result, durationMs },
          metadata: makeMeta(),
        });

        // Track completed step and advance state machine
        completedSteps.push(step.name);
        actor.send({ type: 'STEP_COMPLETED', result });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        // ── 3. On failure: persist failure events ───────────
        await persistAndEmit({
          type: 'pipeline.step.failed',
          data: { pipelineId, step: step.name, stepIndex: i, error: errorMsg },
          metadata: makeMeta(),
        });

        actor.send({ type: 'STEP_FAILED', error: errorMsg });

        await persistAndEmit({
          type: 'pipeline.failed',
          data: { pipelineId, error: errorMsg, failedStep: step.name },
          metadata: makeMeta(),
        });

        // ── Run compensation ────────────────────────────────
        await this.compensate(actor, pipelineId, position, completedSteps, sagaContext, makeMeta, persistAndEmit);

        actor.stop();
        return;
      }
    }

    // ── 4. All steps succeeded ──────────────────────────────
    const totalDurationMs = Date.now() - startTime;
    await persistAndEmit({
      type: 'pipeline.completed',
      data: { pipelineId, totalDurationMs },
      metadata: makeMeta(),
    });

    actor.stop();
  }

  /**
   * Run compensation for completed steps in reverse order.
   */
  private async compensate(
    actor: ReturnType<typeof createActor>,
    pipelineId: string,
    _position: number,
    completedSteps: string[],
    sagaContext: Record<string, unknown>,
    makeMeta: () => EventMetadata,
    persistAndEmit: (event: NewEvent) => Promise<void>,
  ): Promise<void> {
    // Send COMPENSATE to state machine
    actor.send({ type: 'COMPENSATE' });

    // Persist pipeline.compensating
    const stepsToCompensate = [...completedSteps].reverse();
    await persistAndEmit({
      type: 'pipeline.compensating',
      data: { pipelineId, stepsToCompensate },
      metadata: makeMeta(),
    });

    // Run compensation for each completed step in reverse order
    for (const stepName of stepsToCompensate) {
      const step = this.steps.find((s) => s.name === stepName);
      if (step?.compensate) {
        try {
          await step.compensate(sagaContext);
        } catch {
          // Compensation errors are swallowed -- best-effort
        }
      }
    }

    // Persist pipeline.compensated
    await persistAndEmit({
      type: 'pipeline.compensated',
      data: { pipelineId, compensatedSteps: stepsToCompensate },
      metadata: makeMeta(),
    });

    // Send COMPENSATION_DONE to state machine
    actor.send({ type: 'COMPENSATION_DONE' });
  }
}
