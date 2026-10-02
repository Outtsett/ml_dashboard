# Shared — TypeScript Types and Schemas

Shared type definitions, validation schemas, and state machines used by both the React client and the NestJS server. Imported via `@shared/*` path alias.

## Files

| File | Purpose |
|---|---|
| `schema.ts` | Drizzle ORM table definitions (37 SQLite tables) + Zod validation. Exports typed `Insert*` and select types per table. |
| `mlTaxonomy.ts` | ML categories (4), subcategories (10), metrics, XAI method registry (~1600 lines). Drives the Model Catalog UI. |
| `trainingTypes.ts` | Universal training types: `TrainingRequest`, SSE event shapes, overlay payloads, Surface3D types. |
| `event-types.ts` | SSE event type definitions for typed event bus communication. |
| `hpoTypes.ts` | HPO session and trial type definitions (Optuna integration). |
| `ohlcv.ts` | Shared OHLCV bar type definitions (used by chart, ingestion, and ML pipelines). |
| `validation.ts` | Shared Zod validation schemas for API request/response. |
| `strategyTypes.ts` | Trading strategy type definitions (backtesting). |
| `categoryMetrics.ts` | ML category metric definitions. |
| `delta.ts` | SSE delta encoding/decoding (`computeDelta`, `applyDelta`, `DELTA_MARKER`). Reduces SSE payload size by ~50% for model state events. |

## State Machines

XState v5 machine definitions in `machines/`:

| Machine | States | Purpose |
|---|---|---|
| `ingestion-machine.ts` | idle -> validating -> ingesting -> complete/error | File upload + OHLCV ingestion pipeline |
| `training-machine.ts` | idle -> configuring -> training -> evaluating -> complete | ML training lifecycle |
| `deployment-machine.ts` | idle -> validating -> deploying -> active -> retiring | Model deployment lifecycle |

## Connections

- **Client** imports via `@shared/*` path alias (configured in `tsconfig.json`)
- **Server** imports via relative paths from `src/shared/`
- `schema.ts` is the source of truth for the SQLite database schema
- `event-types.ts` ensures type-safe SSE communication between server and client
- `delta.ts` used by both SSE adapter (server) and SSE hooks (client) for efficient state sync
