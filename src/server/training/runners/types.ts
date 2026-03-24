/**
 * Runner Interface — The contract every trainer must implement.
 *
 * Think of it as: a universal adapter plug. Whether the model runs in
 * Python (child process) or TensorFlow.js (in-process), it exposes
 * the same start/stop/events interface to the orchestrator.
 */

import type { ResolvedTrainingConfig, TrainingEvent, TrainingSession } from "@shared/trainingTypes";
import { getEventBus } from "../../events";

/** Maximum number of events buffered per session to prevent unbounded memory growth. */
const MAX_EVENT_BUFFER = 1000;

export interface ITrainerRunner {
  /** Start training, return a session handle. If existingSession provided, reuse it. */
  start(config: ResolvedTrainingConfig, existingSession?: TrainingSession): Promise<TrainingSession>;

  /** Stop an active training session */
  stop(sessionId: string): void;

  /** Check if a specific session is active */
  isActive(sessionId: string): boolean;

  /** Get an active session by ID */
  getSession(sessionId: string): TrainingSession | undefined;
}

/** Helper to create a fresh session object */
export function createSession(
  sessionId: string,
  config: ResolvedTrainingConfig,
): TrainingSession {
  return {
    sessionId,
    modelType: config.modelType,
    modelId: config.modelId,
    symbol: config.symbol,
    timeframe: config.timeframe,
    startedAt: Date.now(),
    events: [],
    listeners: new Set(),
    finished: false,
    exitCode: null,
  };
}

/** Emit an event to a session's listeners + buffer */
/** Emit an event to a session's listeners + buffer + Global Event Bus */
export function emitSessionEvent(
  session: TrainingSession,
  type: TrainingEvent["type"],
  data: Record<string, unknown>,
) {
  const evt: TrainingEvent = { type, data, ts: Date.now() };
  session.events.push(evt);

  // Cap event buffer: keep first event (start marker) + most recent events
  if (session.events.length > MAX_EVENT_BUFFER) {
    session.events = [session.events[0], ...session.events.slice(-(MAX_EVENT_BUFFER - 1))];
  }
  
  // 1. Notify local session listeners (legacy/specific)
  for (const listener of Array.from(session.listeners)) {
    try { listener(evt); } catch { /* dead listener */ }
  }

  // 2. Broadcast to Global Event Bus (High-performance SSE backbone)
  const bus = getEventBus();
  bus.emit({
    type: "training.event",
    data: {
      sessionId: session.sessionId,
      modelId: session.modelId,
      ...evt
    }
  });
}
