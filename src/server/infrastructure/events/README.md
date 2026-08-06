# Events — Event Bus + SSE Streaming

Custom event-driven architecture providing typed pub/sub, persistent event storage, and Server-Sent Events broadcasting.

## Files

| File | Purpose |
|---|---|
| `event-bus.ts` | Typed pub/sub event bus (EventEmitter2). Channels: `pipeline`, `training`, `system`. All events carry typed payloads. |
| `event-store.ts` | Persistent event storage with replay capability. Audit trail for all state transitions. |
| `sse-adapter.ts` | SSE connection management. Per-channel subscriptions, client tracking, delta encoding for large payloads. |
| `events.module.ts` | NestJS DI module: provides EventBus, EventStore, SSEAdapter as injectable services. |
| `index.ts` | Barrel exports |

## SSE Channels

| Channel | Events | Consumer |
|---|---|---|
| `training` | `metric`, `progress`, `done`, `error`, `model_state`, `overlay`, `metric_declarations` | Training page, live metrics |
| `system` | `gpu`, `cpu`, `memory`, `disk` | Hardware page, GPU monitor |
| `pipeline` | `ingestion.*`, `training.*`, `deployment.*` | Pipeline state machine UI |

## Delta Encoding

Model state events use delta encoding (via `src/shared/delta.ts`). First event is a full snapshot, subsequent events send only changed fields if the delta is less than 50% of the full payload size. A full snapshot is forced every 10 events for client recovery.
