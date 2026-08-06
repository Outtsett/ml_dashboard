import type { EventStore } from '../events/event-store';
import type { StoredEvent } from '@shared/event-types';
import { log } from '../lib/log';

/** Pipeline-level terminal event types (NOT step-level). */
const PIPELINE_TERMINAL_TYPES = new Set([
  'pipeline.completed',
  'pipeline.failed',
  'pipeline.compensated',
]);

export interface IncompletePipeline {
  pipelineId: string;
  streamId: string;
  pipelineType: string;
  config: Record<string, unknown>;
  completedSteps: string[];
  lastPosition: number;
  events: StoredEvent[];
}

/**
 * Scan the event store for pipeline streams that were started but never
 * reached a terminal state (completed / failed / compensated).
 *
 * Uses findIncompleteStreams as a fast first-pass, then supplements with
 * a precise check: `pipeline.step.completed` matches the EventStore's
 * `%.completed` LIKE filter, so streams with completed steps but no
 * pipeline-level terminal event can be missed. We re-check those by
 * reading all `pipeline.started` events and verifying terminal status.
 */
export async function findIncompletePipelines(
  eventStore: EventStore,
): Promise<IncompletePipeline[]> {
  // Find every stream that has a pipeline.started event
  const startedEvents = await eventStore.readByType('pipeline.started');
  if (startedEvents.length === 0) return [];

  const results: IncompletePipeline[] = [];

  for (const startedEvt of startedEvents) {
    const streamId = startedEvt.streamId;
    const streamEvents = await eventStore.readStream(streamId);

    // Check for a real pipeline-level terminal event
    const hasTerminal = streamEvents.some((e) => PIPELINE_TERMINAL_TYPES.has(e.type));
    if (hasTerminal) continue;

    const pipelineId = (startedEvt.data.pipelineId as string) ?? '';
    const pipelineType = (startedEvt.data.pipelineType as string) ?? '';
    const config = (startedEvt.data.config as Record<string, unknown>) ?? {};

    // Collect completed step names
    const completedSteps = streamEvents
      .filter((e) => e.type === 'pipeline.step.completed')
      .map((e) => e.data.step as string);

    // Last position in the stream
    const lastPosition = streamEvents[streamEvents.length - 1]!.streamPosition;

    results.push({
      pipelineId,
      streamId,
      pipelineType,
      config,
      completedSteps,
      lastPosition,
      events: streamEvents,
    });
  }

  return results;
}

/**
 * On server startup, find any pipelines that were in-progress when the
 * process crashed and mark them as failed so they don't hang indefinitely.
 */
export async function recoverPipelinesOnStartup(
  eventStore: EventStore,
): Promise<void> {
  const incomplete = await findIncompletePipelines(eventStore);

  if (incomplete.length === 0) {
    log('No incomplete pipelines found', 'recovery');
    return;
  }

  log(`Found ${incomplete.length} incomplete pipeline(s) — marking as failed`, 'recovery');

  for (const pipeline of incomplete) {
    log(
      `  pipeline:${pipeline.pipelineId} (${pipeline.pipelineType}) — ` +
        `completed steps: [${pipeline.completedSteps.join(', ')}]`,
      'recovery',
    );

    // Determine the last step that was in progress (if any)
    const lastStepStarted = [...pipeline.events]
      .reverse()
      .find((e) => e.type === 'pipeline.step.started');

    const failedStep = lastStepStarted
      ? (lastStepStarted.data.step as string)
      : 'unknown';

    await eventStore.appendToStream(pipeline.streamId, pipeline.lastPosition, [
      {
        type: 'pipeline.failed',
        data: {
          pipelineId: pipeline.pipelineId,
          error: 'Process crashed — recovered on startup',
          failedStep,
        },
        metadata: {
          correlationId: pipeline.pipelineId,
          causationId: `recovery:${pipeline.pipelineId}`,
          timestamp: Date.now(),
        },
      },
    ]);
  }

  log(`Marked ${incomplete.length} pipeline(s) as failed`, 'recovery');
}
