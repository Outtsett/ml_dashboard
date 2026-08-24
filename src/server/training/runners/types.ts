import type { ResolvedTrainingConfig, TrainingEvent, TrainingSession } from "@shared/trainingTypes";
import type { DomainEvent } from "@shared/event-types";
import { getEventBus } from "../../infrastructure/events";

export interface ITrainerRunner {
  start(config: ResolvedTrainingConfig, existingSession?: TrainingSession): Promise<TrainingSession>;
  stop(sessionId: string): void;
  isActive(sessionId: string): boolean;
  getSession(sessionId: string): TrainingSession | undefined;
}

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

const MAX_EVENT_BUFFER = 1000;

export function emitSessionEvent(
  session: TrainingSession,
  type: TrainingEvent["type"],
  data: Record<string, unknown>,
) {
  const evt: TrainingEvent = { type, data, ts: Date.now() };
  session.events.push(evt);
  
  if (session.events.length > MAX_EVENT_BUFFER) {
    session.events = [session.events[0]!, ...session.events.slice(-(MAX_EVENT_BUFFER - 1))];
  }
  
  for (const listener of Array.from(session.listeners)) {
    try { listener(evt); } catch { session.listeners.delete(listener); }
  }

  const bus = getEventBus();
  bus.emit({
    type: "training.event" as const,
    data: {
      sessionId: session.sessionId,
      modelId: session.modelId,
      type: evt.type,
      data: evt.data,
      ts: evt.ts,
    },
    metadata: {
      correlationId: session.sessionId,
      causationId: `training-${type}`,
      timestamp: evt.ts,
    },
  } satisfies DomainEvent);
}
