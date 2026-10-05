// Deployment event publisher.
//
// Publishes typed `deployment.*` events to the global EventBus (for live SSE
// fan-out at /api/events/deployments) AND persists them to the EventStore so
// that late subscribers can replay history (W9: "what predictions did v_004
// emit during the last hour?").
//
// Stream-id convention: `deployment-<deployment_id>` — one stream per
// deployment makes per-deployment replay trivial via
// `EventStore.readStream('deployment-42')`.
//
// Usage from W7.c lifecycle / W9 mlbridge handlers:
//
//   import { publishDeploymentEvent } from '../deployments/publisher';
//   await publishDeploymentEvent({
//     type: 'deployment.prediction',
//     data: { deployment_id: 42, ts, prediction: 1, confidence: 0.73 },
//     correlationId: requestId,
//   });

import { db as sqliteDb } from '../infrastructure/database/sqlite';
import { EventStore } from '../infrastructure/events/event-store';
import { getEventBus } from '../infrastructure/events/event-bus';
import type {
  DeploymentEvent,
  EventMetadata,
  NewEvent,
} from '@shared/event-types';

// Lazy singleton EventStore (one DB handle reused across publishes).
let storeInstance: EventStore | null = null;
function getStore(): EventStore {
  if (!storeInstance) {
    storeInstance = new EventStore(sqliteDb);
  }
  return storeInstance;
}

// Per-stream position tracking. EventStore enforces optimistic concurrency
// via UNIQUE(stream_id, stream_position); we cache the last-known position
// per deployment to avoid a SELECT MAX() per publish.
const positions = new Map<string, number>();

/** Compute the stream id for a deployment. */
export function deploymentStreamId(deploymentId: number): string {
  return `deployment-${deploymentId}`;
}

/**
 * Reset cached stream-position bookkeeping. Test-only.
 * The DB still holds the canonical position via UNIQUE constraint.
 */
export function resetDeploymentPublisher(): void {
  positions.clear();
  storeInstance = null;
}

interface PublishOptions {
  /** Originating HTTP request id (for correlationId). Defaults to streamId. */
  correlationId?: string;
  /** Event id that caused this one (for causationId). Defaults to correlationId. */
  causationId?: string;
}

/**
 * Publish a typed deployment event:
 *   1. persist to EventStore on stream `deployment-<id>` (for replay)
 *   2. emit to global EventBus (for live SSE fan-out)
 *
 * Both steps share the same envelope so the SSE wire format and the replayed
 * payload are byte-identical.
 *
 * Failures from EventStore (e.g. UNIQUE conflict from a stale position cache)
 * are recovered by re-reading the head position once and retrying.
 */
export async function publishDeploymentEvent(
  payload: Omit<DeploymentEvent, 'metadata'> & { correlationId?: string; causationId?: string },
): Promise<DeploymentEvent> {
  const deploymentId = (payload.data as { deployment_id: number }).deployment_id;
  const streamId = deploymentStreamId(deploymentId);

  const correlationId = payload.correlationId ?? streamId;
  const causationId = payload.causationId ?? correlationId;

  const metadata: EventMetadata = {
    correlationId,
    causationId,
    timestamp: Date.now(),
  };

  const event = {
    type: payload.type,
    data: payload.data,
    metadata,
  } as DeploymentEvent;

  const newEvent: NewEvent = {
    type: event.type,
    data: event.data as Record<string, unknown>,
    metadata,
  };

  const store = getStore();

  // Resolve current position; first publish on a stream lazily reads from DB.
  let position = positions.get(streamId);
  if (position === undefined) {
    position = await store.getStreamPosition(streamId);
    positions.set(streamId, position);
  }

  try {
    await store.appendToStream(streamId, position, [newEvent]);
    positions.set(streamId, position + 1);
  } catch (err) {
    // Stale cache (e.g. parallel publisher in another worker) — re-sync once.
    const fresh = await store.getStreamPosition(streamId);
    positions.set(streamId, fresh);
    await store.appendToStream(streamId, fresh, [newEvent]);
    positions.set(streamId, fresh + 1);
    void err;
  }

  // Live fan-out (cast to DomainEvent — DeploymentEvent is part of the union).
  // SSE adapter only matches by prefix; we publish via a dedicated channel
  // (see eventsDeployments.ts) instead of the generic SSEAdapter.
  getEventBus().emit(event as unknown as Parameters<ReturnType<typeof getEventBus>['emit']>[0]);

  return event;
}

// ── Typed helpers per DeploymentEvent variant (W9.c) ───────────────
// Each helper takes only the variant's data payload + optional correlation
// metadata, and delegates to publishDeploymentEvent(). This gives lifecycle.ts
// (W9.b) compile-time enforcement that every publish matches event-types.ts.

type DataFor<T extends DeploymentEvent['type']> =
  Extract<DeploymentEvent, { type: T }>['data'];

export function publishDeploymentStarted(
  data: DataFor<'deployment.started'>,
  opts?: PublishOptions,
): Promise<DeploymentEvent> {
  return publishDeploymentEvent({ type: 'deployment.started', data, ...opts });
}

export function publishPrediction(
  data: DataFor<'deployment.prediction'>,
  opts?: PublishOptions,
): Promise<DeploymentEvent> {
  return publishDeploymentEvent({ type: 'deployment.prediction', data, ...opts });
}

export function publishPnlUpdate(
  data: DataFor<'deployment.pnl_update'>,
  opts?: PublishOptions,
): Promise<DeploymentEvent> {
  return publishDeploymentEvent({ type: 'deployment.pnl_update', data, ...opts });
}

export function publishDeploymentPaused(
  data: DataFor<'deployment.paused'>,
  opts?: PublishOptions,
): Promise<DeploymentEvent> {
  return publishDeploymentEvent({ type: 'deployment.paused', data, ...opts });
}

export function publishDeploymentResumed(
  data: DataFor<'deployment.resumed'>,
  opts?: PublishOptions,
): Promise<DeploymentEvent> {
  return publishDeploymentEvent({ type: 'deployment.resumed', data, ...opts });
}

export function publishDeploymentStopped(
  data: DataFor<'deployment.stopped'>,
  opts?: PublishOptions,
): Promise<DeploymentEvent> {
  return publishDeploymentEvent({ type: 'deployment.stopped', data, ...opts });
}

export function publishDeploymentFailed(
  data: DataFor<'deployment.failed'>,
  opts?: PublishOptions,
): Promise<DeploymentEvent> {
  return publishDeploymentEvent({ type: 'deployment.failed', data, ...opts });
}
