import type { DomainEvent } from '@shared/event-types';
import EventEmitter2Pkg from 'eventemitter2';

// eventemitter2 exports { EventEmitter2 } as default in CJS — handle both shapes
const EventEmitter2 = (EventEmitter2Pkg as any).EventEmitter2 ?? EventEmitter2Pkg;

// ── Handler type ─────────────────────────────────────────────
export type EventHandler = (event: DomainEvent) => void;

// ── Emitter config ───────────────────────────────────────────
const EMITTER_CONFIG = {
  wildcard: true,
  delimiter: '.',
  maxListeners: 50,
} as const;

// ── EventBus ─────────────────────────────────────────────────
export class EventBus {
  private emitter: InstanceType<typeof EventEmitter2>;

  constructor() {
    this.emitter = new EventEmitter2(EMITTER_CONFIG);
  }

  /** Emit a domain event to all matching subscribers. */
  emit(event: DomainEvent): void {
    this.emitter.emit(event.type, event);
  }

  /** Subscribe to events matching a type or wildcard pattern. */
  on(typeOrPattern: string, handler: EventHandler): void {
    this.emitter.on(typeOrPattern, handler);
  }

  /** Unsubscribe a handler from a type or wildcard pattern. */
  off(typeOrPattern: string, handler: EventHandler): void {
    this.emitter.off(typeOrPattern, handler);
  }

  /** Subscribe to the next matching event only (auto-unsubscribes). */
  once(typeOrPattern: string, handler: EventHandler): void {
    this.emitter.once(typeOrPattern, handler);
  }

  /** Subscribe to ALL events regardless of type. */
  onAny(handler: EventHandler): void {
    this.emitter.onAny((_type: string | string[], event: DomainEvent) => {
      handler(event);
    });
  }

  /** Remove all listeners (specific + onAny). Replaces the emitter for a clean slate. */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
    this.emitter = new EventEmitter2(EMITTER_CONFIG);
  }
}

// ── Singleton ────────────────────────────────────────────────
let instance: EventBus | null = null;

/** Get or create the global EventBus singleton. */
export function getEventBus(): EventBus {
  if (!instance) {
    instance = new EventBus();
  }
  return instance;
}

/** Reset the global EventBus singleton (for testing). */
export function resetEventBus(): void {
  if (instance) {
    instance.removeAllListeners();
  }
  instance = null;
}
