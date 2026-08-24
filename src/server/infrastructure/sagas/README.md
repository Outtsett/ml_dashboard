# Sagas — Workflow Orchestration

Saga orchestrator for multi-step workflows with automatic recovery on failure.

## Files

| File | Purpose |
|---|---|
| `orchestrator.ts` | Saga orchestrator: manages multi-step workflow execution (ingest -> feature compute -> train -> deploy). Tracks step state, handles rollback, emits events. |
| `recovery.ts` | Saga recovery: restores in-progress sagas after server restart. Reads event store to determine last completed step and resumes. |
| `index.ts` | Barrel exports |

## Workflow Pattern

```
1. Client triggers workflow (e.g., "train model")
2. Saga orchestrator creates saga instance
3. Each step executes and emits completion event to event store
4. On failure: saga records failure, attempts compensating actions
5. On restart: recovery module reads event store, resumes from last completed step
```

Sagas integrate with the event bus and event store for reliable state tracking. Pipeline state is exposed via `/api/pipelines` endpoint (CQRS pattern).
