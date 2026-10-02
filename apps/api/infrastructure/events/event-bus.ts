import type { DomainEvent } from '@shared/event-types';
import EventEmitter2Pkg from 'eventemitter2';

// eventemitter2 exports { EventEmitter2 } as default in CJS — handle both shapes.
// The .d.ts claims EventEmitter2Pkg IS the class, but the CJS runtime build
// sometimes attaches the real class under a `.EventEmitter2` property instead —
// this type describes both possible runtime shapes without widening to `any`.
type EventEmitter2Module = typeof EventEmitter2Pkg & { EventEmitter2?: typeof EventEmitter2Pkg };
const EventEmitter2 = (EventEmitter2Pkg as EventEmitter2Module).EventEmitter2 ?? EventEmitter2Pkg;

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
