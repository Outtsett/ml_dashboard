# Phase 1 — Training Analytics Data Foundation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Lay the persistent data foundation for QuantConnect-grade training analytics — schema evolution, storage layer, model versioning, metric persistence, rich signal contract, evaluation stages 1-2, walk-forward orchestration, visualization registry config, and client hooks.

**Architecture:** Additive schema evolution on SQLite (Drizzle ORM). New storage module owns all training DB access (DIP). Versioned model IDs prevent overwrites. Python signals.py and evaluation.py are shared modules usable by any model. Walk-forward orchestrator dispatches N sequential windows. Visualization registry is config-driven JSON (OCP).

**Tech Stack:** Drizzle ORM (SQLite), QuestDB (time-series), Python (scipy, scikit-learn), TypeScript, React 19, TanStack Query

**Design Doc:** `docs/plans/2026-02-28-training-analytics-design.md`
**High-Level Plan:** `docs/plans/2026-02-28-training-analytics-impl.md`

---

## File Inventory — What Phase 1 Touches

### Files to Create (9 new files)
| File | Purpose |
|------|---------|
| `src/server/storage/trainingStorage.ts` | SQLite CRUD for sessions, metrics, evaluations (DIP) |
| `src/server/training/versioning.ts` | Timestamped model ID generation |
| `src/server/training/walkforward.ts` | Walk-forward window computation |
| `src/ml/shared/signals.py` | Rich signal columns (confidence, entropy, etc.) |
| `src/ml/shared/evaluation.py` | Statistical evaluation stages 1-2 |
| `src/config/visualizations.json` | Category → component visualization registry (OCP) |
| `src/client/src/hooks/useVisualizationRegistry.ts` | Client hook for viz registry |
| `src/client/src/hooks/usePersistedMetrics.ts` | Fetch convergence from SQLite API |
| `src/client/src/hooks/useEvaluationResults.ts` | Fetch evaluation results |

### Files to Modify (9 existing files)
| File | Lines | Changes |
|------|-------|---------|
| `src/shared/schema.ts` | 60-91 | Evolve trainingSessions + add 2 new tables |
| `src/shared/trainingTypes.ts` | 66-80, 84-91 | Add walkForward to TrainingRequest, new SSE event types |
| `src/server/training/orchestrator.ts` | 25, 55-76, 107-146 | Versioned IDs, DB persistence, WF branch |
| `src/server/training/runners/parsers/hdpHmmParser.ts` | 45-51 | Persist metrics to SQLite |
| `src/server/training/runners/pythonRunner.ts` | 135-172 | Finalize session on close |
| `src/server/routes/training.ts` | 22-39, append | New imports + 7 new endpoints |
| `src/server/main.ts` | 108-112 | Orphaned session cleanup |
| `src/ml/hdp_hmm/main.py` | 32-50, 115-133 | Evaluation integration + CLI flags |
| `src/ml/hdp_hmm/io/save.py` | 1-19, 53-88 | Signal columns + evaluation in diagnostics |
| `src/ml/hmm_2state/main.py` | 31-46, 108-121 | Same evaluation + signal integration |

---

## Milestone 1A: Schema Evolution

### Task 1: Evolve trainingSessions table with 20 new columns

**SOLID:** SRP — schema.ts defines data shape only, no business logic. OCP — additive columns, nothing removed.

**Files:**
- Modify: `src/shared/schema.ts:60-75`

**Step 1: Add new columns to trainingSessions**

At `src/shared/schema.ts:60-71`, the current `trainingSessions` table definition has 9 columns (id through updatedAt). We add 20 new columns after `updatedAt` (line 70) while keeping every existing column intact. We also add indexes.

Replace lines 60-75 with:

```typescript
// Training session tracking — persists across server restarts
export const trainingSessions = sqliteTable("training_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // ── Original columns (unchanged) ──
  modelName: text("model_name").notNull(),
  status: text("status").notNull().default("running"), // running, paused, completed, failed, stopped
  currentEpoch: integer("current_epoch").notNull().default(0),
  maxEpochs: integer("max_epochs").notNull(),
  currentLoss: real("current_loss"),
  currentValLoss: real("current_val_loss"),
  learningRate: real("learning_rate").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),

  // ── Phase 1: Training Analytics columns ──
  modelType: text("model_type"),                     // hdp-hmm, 2-state-hmm, etc.
  symbol: text("symbol"),                            // ES, NQ, EURUSD, etc.
  timeframe: text("timeframe"),                      // 1h, 4h, 1d
  versionedModelId: text("versioned_model_id"),      // ES_1h_hdp-hmm_20260227T143022
  hyperparameters: text("hyperparameters"),           // JSON string
  featureCategories: text("feature_categories"),      // JSON string
  trainDateStart: integer("train_date_start"),        // epoch ms
  trainDateEnd: integer("train_date_end"),            // epoch ms
  testDateStart: integer("test_date_start"),          // epoch ms
  testDateEnd: integer("test_date_end"),              // epoch ms
  totalBars: integer("total_bars"),
  totalFeatures: integer("total_features"),
  modelPath: text("model_path"),                      // filesystem path to saved model
  diagnostics: text("diagnostics"),                   // JSON blob — full diagnostics from Python
  qualityScore: real("quality_score"),                // 0-100 composite quality
  evaluationGrade: text("evaluation_grade"),          // A/B/C/D/F composite grade
  walkForwardGroupId: text("walk_forward_group_id"),  // links windows in same WF run
  windowIndex: integer("window_index"),               // WF window number (0-based)
  errorMessage: text("error_message"),
  elapsedSec: real("elapsed_sec"),
  resourcePeakMemoryMb: real("resource_peak_memory_mb"),
  resourceAvgCpuPct: real("resource_avg_cpu_pct"),
}, (table) => ({
  modelTypeIdx: index("ts_model_type_idx").on(table.modelType),
  symbolIdx: index("ts_symbol_idx").on(table.symbol),
  statusIdx: index("ts_status_idx").on(table.status),
  versionedModelIdIdx: index("ts_versioned_model_id_idx").on(table.versionedModelId),
  walkForwardGroupIdx: index("ts_wf_group_idx").on(table.walkForwardGroupId),
}));
```

Keep the existing Zod schema + types at lines 73-75 unchanged:

```typescript
export const insertTrainingSessionSchema = createInsertSchema(trainingSessions).omit({ id: true, startedAt: true, updatedAt: true });
export type InsertTrainingSession = z.infer<typeof insertTrainingSessionSchema>;
export type TrainingSession = typeof trainingSessions.$inferSelect;
```

**Step 2: Push schema to SQLite**

Run: `npx drizzle-kit push`
Expected: Drizzle detects new columns + indexes, applies ALTER TABLE to `data/ml_dashboard.db`

**Step 3: Verify the push**

Run: `npx drizzle-kit push` (second time)
Expected: "No changes detected" — schema is in sync

**Step 4: Commit**

```bash
git add src/shared/schema.ts
git commit -m "feat(schema): evolve trainingSessions with versioning, WF, and evaluation columns"
```

---

### Task 2: Add training_metrics table

**SOLID:** SRP — one table, one concern (per-iteration metrics). ISP — separate from session data so convergence curves can be queried independently without loading full session blob.

**Files:**
- Modify: `src/shared/schema.ts` (insert after `lossHistory` at line 91)

**Step 1: Add table definition**

Insert after line 91 (`export type LossHistory = ...`):

```typescript
// ── Per-iteration training metrics — convergence curves that survive restarts ──
export const trainingMetrics = sqliteTable("training_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  iteration: integer("iteration").notNull(),
  metricName: text("metric_name").notNull(),       // 'log_likelihood', 'n_active_states', 'convergence_delta', etc.
  metricValue: real("metric_value").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  sessionMetricIdx: index("tm_session_metric_idx").on(table.sessionId, table.metricName, table.iteration),
  sessionIdx: index("tm_session_idx").on(table.sessionId),
}));

export const insertTrainingMetricSchema = createInsertSchema(trainingMetrics).omit({ id: true, timestamp: true });
export type InsertTrainingMetric = z.infer<typeof insertTrainingMetricSchema>;
export type TrainingMetric = typeof trainingMetrics.$inferSelect;
```

**Step 2: Push schema**

Run: `npx drizzle-kit push`
Expected: Creates `training_metrics` table with indexes

**Step 3: Commit**

```bash
git add src/shared/schema.ts
git commit -m "feat(schema): add training_metrics table for per-iteration convergence tracking"
```

---

### Task 3: Add evaluation_results table

**SOLID:** SRP — one table for statistical test results. OCP — new evaluation stages add rows, not schema changes. ISP — separate from metrics (different query patterns: metrics are time-series, evaluations are categorical pass/fail).

**Files:**
- Modify: `src/shared/schema.ts` (insert after trainingMetrics)

**Step 1: Add table definition**

Insert after the trainingMetrics type exports:

```typescript
// ── Statistical evaluation results — per-test pass/fail with p-values ──
export const evaluationResults = sqliteTable("evaluation_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  stage: text("stage").notNull(),          // regime_quality, significance, oos_validation, conditioned_performance, benchmark
  testName: text("test_name").notNull(),   // silhouette_score, permutation_test, etc.
  testValue: real("test_value"),
  testPassed: integer("test_passed"),       // 0 or 1
  pValue: real("p_value"),
  details: text("details"),                 // JSON blob for drill-down visualization
  computedAt: integer("computed_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  sessionStageIdx: index("er_session_stage_idx").on(table.sessionId, table.stage, table.testName),
  sessionIdx: index("er_session_idx").on(table.sessionId),
}));

export const insertEvaluationResultSchema = createInsertSchema(evaluationResults).omit({ id: true, computedAt: true });
export type InsertEvaluationResult = z.infer<typeof insertEvaluationResultSchema>;
export type EvaluationResult = typeof evaluationResults.$inferSelect;
```

**Step 2: Push schema**

Run: `npx drizzle-kit push`
Expected: Creates `evaluation_results` table with indexes

**Step 3: Commit**

```bash
git add src/shared/schema.ts
git commit -m "feat(schema): add evaluation_results table for statistical test tracking"
```

---

## Milestone 1B: Training Storage Layer

### Task 4: Create trainingStorage.ts — SQLite CRUD for all training tables

**SOLID:**
- **DIP** — Routes and orchestrator depend on this module's functions (abstractions), never on `db.select().from(...)` directly.
- **SRP** — This module's only job: read/write training-related SQLite tables. No HTTP, no business logic, no formatting.
- **ISP** — Functions accept narrow parameter objects, not full `TrainingSession` or `ResolvedTrainingConfig`.

**Files:**
- Create: `src/server/storage/trainingStorage.ts`

**Step 1: Create the storage directory if needed**

The `src/server/storage/` directory should already exist (other storage files live there). If not, it will be created with the file.

**Step 2: Write the file**

```typescript
/**
 * Training Storage — SQLite CRUD for training sessions, metrics, and evaluations.
 *
 * DIP: Routes and orchestrator call these functions — never query the DB directly.
 * SRP: Only concern is read/write of training-related tables.
 * ISP: Each function accepts a narrow param object — callers only provide what they need.
 */

import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../database/db";
import {
  trainingSessions,
  trainingMetrics,
  evaluationResults,
  type InsertTrainingMetric,
  type InsertEvaluationResult,
} from "@shared/schema";

// ─── Sessions ────────────────────────────────────────────────────────────────

/** Create a new training session row. Returns the inserted row with id. */
export function createTrainingSession(data: {
  modelName: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  versionedModelId: string;
  maxEpochs: number;
  learningRate: number;
  hyperparameters?: Record<string, unknown>;
  featureCategories?: string[];
  walkForwardGroupId?: string;
  windowIndex?: number;
}) {
  return db.insert(trainingSessions).values({
    modelName: data.modelName,
    modelType: data.modelType,
    symbol: data.symbol,
    timeframe: data.timeframe,
    versionedModelId: data.versionedModelId,
    maxEpochs: data.maxEpochs,
    learningRate: data.learningRate,
    hyperparameters: data.hyperparameters ? JSON.stringify(data.hyperparameters) : null,
    featureCategories: data.featureCategories ? JSON.stringify(data.featureCategories) : null,
    walkForwardGroupId: data.walkForwardGroupId ?? null,
    windowIndex: data.windowIndex ?? null,
    status: "running",
  }).returning().get();
}

/** Update session progress fields (called during training). */
export function updateSessionProgress(id: number, data: {
  currentEpoch?: number;
  currentLoss?: number;
  currentValLoss?: number;
  totalBars?: number;
  totalFeatures?: number;
  trainDateStart?: number;
  trainDateEnd?: number;
  testDateStart?: number;
  testDateEnd?: number;
}) {
  db.update(trainingSessions)
    .set({ ...data, updatedAt: sql`(unixepoch() * 1000)` })
    .where(eq(trainingSessions.id, id))
    .run();
}

/** Finalize session on completion, failure, or stop. */
export function finalizeSession(id: number, data: {
  status: "completed" | "failed" | "stopped";
  diagnostics?: Record<string, unknown>;
  qualityScore?: number;
  evaluationGrade?: string;
  modelPath?: string;
  elapsedSec?: number;
  errorMessage?: string;
  resourcePeakMemoryMb?: number;
  resourceAvgCpuPct?: number;
}) {
  db.update(trainingSessions)
    .set({
      status: data.status,
      diagnostics: data.diagnostics ? JSON.stringify(data.diagnostics) : null,
      qualityScore: data.qualityScore ?? null,
      evaluationGrade: data.evaluationGrade ?? null,
      modelPath: data.modelPath ?? null,
      elapsedSec: data.elapsedSec ?? null,
      errorMessage: data.errorMessage ?? null,
      resourcePeakMemoryMb: data.resourcePeakMemoryMb ?? null,
      resourceAvgCpuPct: data.resourceAvgCpuPct ?? null,
      updatedAt: sql`(unixepoch() * 1000)`,
    })
    .where(eq(trainingSessions.id, id))
    .run();
}

/** Get a single session by id. */
export function getSession(id: number) {
  return db.select().from(trainingSessions).where(eq(trainingSessions.id, id)).get();
}

/** Get a session by versioned model ID. */
export function getSessionByVersionedId(versionedModelId: string) {
  return db.select().from(trainingSessions)
    .where(eq(trainingSessions.versionedModelId, versionedModelId)).get();
}

/** List sessions with optional filters. */
export function listSessions(opts?: {
  symbol?: string;
  modelType?: string;
  status?: string;
  limit?: number;
}) {
  const conditions = [];
  if (opts?.symbol) conditions.push(eq(trainingSessions.symbol, opts.symbol));
  if (opts?.modelType) conditions.push(eq(trainingSessions.modelType, opts.modelType));
  if (opts?.status) conditions.push(eq(trainingSessions.status, opts.status));

  let query = db.select().from(trainingSessions).orderBy(desc(trainingSessions.startedAt));

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  if (opts?.limit) {
    query = query.limit(opts.limit) as typeof query;
  }

  return query.all();
}

/** Get all sessions in a walk-forward group, ordered by window index. */
export function getWalkForwardGroup(groupId: string) {
  return db.select().from(trainingSessions)
    .where(eq(trainingSessions.walkForwardGroupId, groupId))
    .orderBy(trainingSessions.windowIndex)
    .all();
}

/** Mark any "running" sessions as "failed" — call on server startup to clean up orphans. */
export function markOrphanedSessionsFailed(): number {
  const result = db.update(trainingSessions)
    .set({
      status: "failed",
      errorMessage: "Server restarted during training",
      updatedAt: sql`(unixepoch() * 1000)`,
    })
    .where(eq(trainingSessions.status, "running"))
    .run();
  return result.changes;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

/** Insert a single metric row. */
export function insertMetric(data: InsertTrainingMetric) {
  db.insert(trainingMetrics).values(data).run();
}

/** Insert a batch of metric rows (one per metric name per iteration). */
export function insertMetricsBatch(data: InsertTrainingMetric[]) {
  if (data.length === 0) return;
  // SQLite batch insert — Drizzle handles chunking
  db.insert(trainingMetrics).values(data).run();
}

/** Get metrics for a session, optionally filtered by metric name. */
export function getMetrics(sessionId: number, metricName?: string) {
  const conditions = [eq(trainingMetrics.sessionId, sessionId)];
  if (metricName) conditions.push(eq(trainingMetrics.metricName, metricName));

  return db.select().from(trainingMetrics)
    .where(and(...conditions))
    .orderBy(trainingMetrics.iteration)
    .all();
}

/** Get distinct metric names for a session (for convergence chart series selection). */
export function getMetricNames(sessionId: number): string[] {
  const rows = db.selectDistinct({ metricName: trainingMetrics.metricName })
    .from(trainingMetrics)
    .where(eq(trainingMetrics.sessionId, sessionId))
    .all();
  return rows.map(r => r.metricName);
}

// ─── Evaluation Results ──────────────────────────────────────────────────────

/** Insert a single evaluation test result. */
export function insertEvaluation(data: InsertEvaluationResult) {
  db.insert(evaluationResults).values(data).run();
}

/** Insert a batch of evaluation results (e.g., all Stage 1 tests at once). */
export function insertEvaluationsBatch(data: InsertEvaluationResult[]) {
  if (data.length === 0) return;
  db.insert(evaluationResults).values(data).run();
}

/** Get evaluation results for a session, optionally filtered by stage. */
export function getEvaluations(sessionId: number, stage?: string) {
  const conditions = [eq(evaluationResults.sessionId, sessionId)];
  if (stage) conditions.push(eq(evaluationResults.stage, stage));

  return db.select().from(evaluationResults)
    .where(and(...conditions))
    .orderBy(evaluationResults.stage, evaluationResults.testName)
    .all();
}

/** Get per-stage pass/fail summary for a session. */
export function getEvaluationSummary(sessionId: number) {
  return db.select({
    stage: evaluationResults.stage,
    totalTests: sql<number>`count(*)`,
    passedTests: sql<number>`sum(case when ${evaluationResults.testPassed} = 1 then 1 else 0 end)`,
    failedTests: sql<number>`sum(case when ${evaluationResults.testPassed} = 0 then 1 else 0 end)`,
  })
    .from(evaluationResults)
    .where(eq(evaluationResults.sessionId, sessionId))
    .groupBy(evaluationResults.stage)
    .all();
}
```

**Step 3: Commit**

```bash
git add src/server/storage/trainingStorage.ts
git commit -m "feat(storage): add training storage module for sessions, metrics, and evaluations"
```

---

## Milestone 1C: Model Versioning

### Task 5: Create versioning.ts

**SOLID:**
- **SRP** — One module, one job: generate and parse versioned model IDs.
- **OCP** — Future ID format changes only happen here.

**Files:**
- Create: `src/server/training/versioning.ts`

**Step 1: Write the file**

```typescript
/**
 * Model Versioning — Timestamped model IDs that never overwrite.
 *
 * SRP: Only concern is ID generation/parsing.
 * OCP: If format changes, only this module changes.
 *
 * Format: {SYMBOL}_{TIMEFRAME}_{MODEL-TYPE}_{YYYYMMDDTHHMMSS}
 * Example: ES_1h_hdp-hmm_20260227T143022
 */

/** Generate a versioned model ID with current timestamp. */
export function generateVersionedModelId(
  symbol: string,
  timeframe: string,
  modelType: string,
): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")     // Remove dashes and colons
    .replace(/\.\d{3}Z$/, ""); // Remove .000Z milliseconds
  // Result: "20260227T143022"
  return `${symbol}_${timeframe}_${modelType}_${ts}`;
}

/** Extract the base model ID (without version timestamp).
 *  ES_1h_hdp-hmm_20260227T143022 → ES_1h_hdp-hmm */
export function getBaseModelId(versionedModelId: string): string {
  const parts = versionedModelId.split("_");
  const tsPattern = /^\d{8}T\d{6}$/;
  const tsIdx = parts.findIndex(p => tsPattern.test(p));
  if (tsIdx === -1) return versionedModelId;
  return parts.slice(0, tsIdx).join("_");
}

/** Extract timestamp from versioned model ID. Returns null if not found. */
export function getVersionTimestamp(versionedModelId: string): Date | null {
  const parts = versionedModelId.split("_");
  const tsPattern = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/;
  for (const part of parts) {
    const match = part.match(tsPattern);
    if (match) {
      const [, y, m, d, h, min, s] = match;
      return new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`);
    }
  }
  return null;
}

/** Append walk-forward window index to versioned model ID.
 *  ES_1h_hdp-hmm_20260227T143022 → ES_1h_hdp-hmm_20260227T143022_w0 */
export function appendWindowIndex(versionedModelId: string, windowIndex: number): string {
  return `${versionedModelId}_w${windowIndex}`;
}
```

**Step 2: Commit**

```bash
git add src/server/training/versioning.ts
git commit -m "feat(training): add model versioning module with timestamped IDs"
```

---

### Task 6: Integrate versioning + DB persistence into orchestrator

**SOLID:**
- **DIP** — Orchestrator depends on `versioning.ts` (abstraction) and `trainingStorage.ts` (abstraction), not raw DB calls.
- **OCP** — Adding new metadata to sessions = add to storage call, not restructure orchestrator.
- **SRP** — Orchestrator dispatches; storage persists; versioning generates IDs.

**Files:**
- Modify: `src/server/training/orchestrator.ts`

**Step 1: Add imports** (after existing imports at line 21)

At `orchestrator.ts:7-21`, add after the existing imports:

```typescript
import { generateVersionedModelId, getBaseModelId } from "./versioning";
import * as trainingStorage from "../storage/trainingStorage";
```

**Step 2: Replace modelId generation** (line 61)

Current code at `orchestrator.ts:61`:
```typescript
const modelId = `${sym}_${tf}_${request.modelType}`;
```

Replace with:
```typescript
  const baseModelId = `${sym}_${tf}_${request.modelType}`;
  const modelId = generateVersionedModelId(sym, tf, request.modelType);
```

**Step 3: Replace duplicate-check** (lines 68-75)

Current code checks `activeSessions.get(modelId)`. Since modelId is now unique (timestamped), we need to check if the **base** model is already training:

Replace lines 68-75:
```typescript
  // Check if already training this base model (prevents concurrent duplicate training)
  for (const [existingId, entry] of Array.from(activeSessions.entries())) {
    if (!entry.session.finished && getBaseModelId(existingId) === baseModelId) {
      throw new Error(`Already training ${baseModelId}. Stop it first.`);
    }
  }
```

**Step 4: Persist session to SQLite** (after line 103 where `activeSessions.set()` is called)

After `activeSessions.set(modelId, { session, runner, config: resolved });` (line 103), add:

```typescript
  // Persist session to SQLite for crash recovery (DIP — storage abstraction)
  const dbSession = trainingStorage.createTrainingSession({
    modelName: baseModelId,
    modelType: request.modelType,
    symbol: sym,
    timeframe: tf,
    versionedModelId: modelId,
    maxEpochs: Number(hyperparameters.gibbsIter ?? hyperparameters.emIter ?? 100),
    learningRate: 0, // Not applicable for HMM models
    hyperparameters: hyperparameters as Record<string, unknown>,
    featureCategories: resolved.featureCategories,
  });
  // Attach DB session ID for metric persistence and finalization
  (session as any).dbSessionId = dbSession.id;
```

**Step 5: Commit**

```bash
git add src/server/training/orchestrator.ts
git commit -m "feat(training): integrate versioned model IDs and session persistence into orchestrator"
```

---

## Milestone 1D: Metric Persistence + Session Finalization

### Task 7: Persist metrics from parser, finalize session on close

**SOLID:**
- **DIP** — Parser calls `trainingStorage.insertMetricsBatch()`, not raw DB.
- **SRP** — Parser parses; storage persists. Parser doesn't know about SQLite.
- **OCP** — Adding new metric types requires no code changes (the metric name comes from Python).

**Files:**
- Modify: `src/server/training/runners/parsers/hdpHmmParser.ts:45-51`
- Modify: `src/server/training/runners/pythonRunner.ts:135-172`

**Step 1: Add metric persistence to parser**

At `hdpHmmParser.ts`, add import at top (after line 11):

```typescript
import * as trainingStorage from "../../../storage/trainingStorage";
```

Then modify the `case 'metric'` block (lines 45-51). Currently:

```typescript
      case 'metric':
        emitSessionEvent(session, 'metric', {
          iteration: msg.iteration,
          totalIterations: msg.total,
          metrics: { [msg.name as string]: msg.value },
        });
        break;
```

Replace with:

```typescript
      case 'metric': {
        emitSessionEvent(session, 'metric', {
          iteration: msg.iteration,
          totalIterations: msg.total,
          metrics: { [msg.name as string]: msg.value },
        });

        // Persist metric to SQLite for post-training convergence analysis (DIP)
        const dbSessionId = (session as any).dbSessionId;
        if (dbSessionId != null) {
          trainingStorage.insertMetric({
            sessionId: dbSessionId,
            iteration: Number(msg.iteration ?? 0),
            metricName: String(msg.name),
            metricValue: Number(msg.value),
          });
        }
        break;
      }
```

**Step 2: Add session finalization to pythonRunner**

At `pythonRunner.ts`, add import at top (after line 15):

```typescript
import * as trainingStorage from "../../storage/trainingStorage";
```

Then modify the `child.on("close", ...)` handler. Currently at lines 135-172, the handler emits events and does cleanup. We add finalization calls.

After the `emitSessionEvent(session, "done", {...})` call at line 162-166, add:

```typescript
        // Finalize session in SQLite (DIP — storage abstraction)
        const dbSessionId = (session as any).dbSessionId;
        if (dbSessionId != null) {
          trainingStorage.finalizeSession(dbSessionId, {
            status: "completed",
            diagnostics: diagnostics as Record<string, unknown> ?? undefined,
            qualityScore: (diagnostics as any)?.quality_score as number ?? undefined,
            evaluationGrade: (diagnostics as any)?.evaluation?.grade as string ?? undefined,
            modelPath: `${config.outputDir}/${config.modelId}`,
            elapsedSec: parseFloat(((Date.now() - session.startedAt) / 1000).toFixed(1)),
          });
        }
```

After the `emitSessionEvent(session, "error", {...})` call at lines 144-147 (the error case), add:

```typescript
        // Finalize failed session in SQLite
        const dbSessionId = (session as any).dbSessionId;
        if (dbSessionId != null) {
          trainingStorage.finalizeSession(dbSessionId, {
            status: "failed",
            elapsedSec: parseFloat(((Date.now() - session.startedAt) / 1000).toFixed(1)),
            errorMessage: `Training failed (exit code ${code})`,
          });
        }
```

Also add finalization in the `stop()` method (line 178-187). After `session.finished = true;` at line 183:

```typescript
      const dbSessionId = (session as any).dbSessionId;
      if (dbSessionId != null) {
        trainingStorage.finalizeSession(dbSessionId, {
          status: "stopped",
          elapsedSec: parseFloat(((Date.now() - session.startedAt) / 1000).toFixed(1)),
          errorMessage: "Training stopped by user",
        });
      }
```

**Step 3: Commit**

```bash
git add src/server/training/runners/parsers/hdpHmmParser.ts src/server/training/runners/pythonRunner.ts
git commit -m "feat(training): persist metrics to SQLite and finalize sessions on completion"
```

---

### Task 8: Mark orphaned sessions on server startup

**SOLID:**
- **SRP** — Startup cleanup is a one-liner delegating to storage. `main.ts` does bootstrapping; storage does the query.

**Files:**
- Modify: `src/server/main.ts:108-112`

**Step 1: Add import and cleanup call**

At `main.ts`, after the runner registration block (line 112), add:

```typescript
  // ── Clean up orphaned training sessions (sessions that were "running" when server crashed) ──
  const { markOrphanedSessionsFailed } = await import('./storage/trainingStorage');
  const orphanCount = markOrphanedSessionsFailed();
  if (orphanCount > 0) {
    log(`Marked ${orphanCount} orphaned training session(s) as failed`, 'training');
  }
```

**Step 2: Commit**

```bash
git add src/server/main.ts
git commit -m "feat(training): mark orphaned sessions as failed on server startup"
```

---

## Milestone 1E: API Route Extensions

### Task 9: Add 7 new endpoints to training routes

**SOLID:**
- **SRP** — Route handlers: parse params, call storage, return JSON. No business logic.
- **DIP** — Routes depend on `trainingStorage` module, not raw DB calls.
- **ISP** — Each endpoint serves a specific concern; clients fetch only what they need.

**Files:**
- Modify: `src/server/routes/training.ts`

**Step 1: Add import**

At `training.ts:22-39`, add after the existing imports:

```typescript
import * as trainingStorage from "../storage/trainingStorage";
```

**Step 2: Add new endpoints**

Append before `export default router;` (line 287):

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// Persisted Sessions + Metrics + Evaluation (Phase 1 Analytics)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Persisted Sessions ──────────────────────────────────────────────────────

router.get("/training/sessions", (_req: Request, res: Response) => {
  try {
    const { symbol, modelType, status, limit } = _req.query;
    const sessions = trainingStorage.listSessions({
      symbol: symbol as string | undefined,
      modelType: modelType as string | undefined,
      status: status as string | undefined,
      limit: limit ? Number(limit) : 50,
    });
    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/training/sessions/:id", (req: Request, res: Response) => {
  try {
    const session = trainingStorage.getSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Per-Iteration Metrics ───────────────────────────────────────────────────

router.get("/training/sessions/:id/metrics", (req: Request, res: Response) => {
  try {
    const { metricName } = req.query;
    const metrics = trainingStorage.getMetrics(
      Number(req.params.id),
      metricName as string | undefined,
    );
    res.json({ metrics });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/training/sessions/:id/metrics/names", (req: Request, res: Response) => {
  try {
    const names = trainingStorage.getMetricNames(Number(req.params.id));
    res.json({ names });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Evaluation Results ──────────────────────────────────────────────────────

router.get("/training/sessions/:id/evaluation", (req: Request, res: Response) => {
  try {
    const { stage } = req.query;
    const results = trainingStorage.getEvaluations(
      Number(req.params.id),
      stage as string | undefined,
    );
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/training/sessions/:id/evaluation/summary", (req: Request, res: Response) => {
  try {
    const summary = trainingStorage.getEvaluationSummary(Number(req.params.id));
    res.json({ summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Walk-Forward Group ──────────────────────────────────────────────────────

router.get("/training/walk-forward/:groupId", (req: Request, res: Response) => {
  try {
    const windows = trainingStorage.getWalkForwardGroup(req.params.groupId);
    if (windows.length === 0) {
      return res.status(404).json({ error: "Walk-forward group not found" });
    }
    res.json({
      groupId: req.params.groupId,
      windows,
      totalWindows: windows.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 3: Commit**

```bash
git add src/server/routes/training.ts
git commit -m "feat(api): add session, metrics, evaluation, and walk-forward endpoints"
```

---

## Milestone 1F: Rich Signal Contract (Python)

### Task 10: Create signals.py — compute 6 signal columns

**SOLID:**
- **SRP** — One module, one job: compute signal metadata from model outputs. Does NOT write to QuestDB.
- **OCP** — New signal columns = add a function here, call it from save.py. No changes to existing callers.
- **DIP** — save.py depends on the `compute_signal_columns()` function signature, not on the implementation details.

**Files:**
- Create: `src/ml/shared/signals.py`

**Step 1: Write the file**

```python
"""
Signal Contract — Compute rich regime metadata from model outputs.

SRP: Computes signal columns only. Does NOT write to QuestDB.
OCP: Add new columns by adding functions here — save.py calls compute_signal_columns().

Adds 6 columns to model_regimes:
  confidence      — max(posterior[t]), probability of chosen regime (0-1)
  entropy         — normalized Shannon entropy of posterior (0-1), high = uncertain
  magnitude       — mean log return in current regime (expected return)
  volatility      — stdev of log returns in current regime (expected vol)
  duration_bars   — average consecutive run length of current regime
  transition_prob — 1 - P(stay in same regime) from transition matrix
"""

import numpy as np
from typing import Optional


def compute_signal_columns(
    assignments: np.ndarray,           # (T,) int regime assignments
    posteriors: Optional[np.ndarray],  # (T, K) posterior probabilities per bar (or None)
    close: np.ndarray,                 # (T,) close prices
    transition_matrix: Optional[np.ndarray],  # (K, K) row-stochastic transition probs (or None)
) -> dict:
    """
    Compute 6 signal columns from model outputs.

    Returns dict of {column_name: np.ndarray of shape (T,)}.
    All arrays are the same length as `assignments`.
    """
    T = len(assignments)
    if T == 0:
        return {k: np.array([]) for k in
                ["confidence", "entropy", "magnitude", "volatility", "duration_bars", "transition_prob"]}

    K = int(assignments.max()) + 1

    # ── Confidence: max posterior probability per bar ──
    if posteriors is not None and posteriors.ndim == 2 and posteriors.shape[1] > 1:
        confidence = posteriors.max(axis=1)
    else:
        confidence = np.ones(T)  # No posteriors → confidence = 1.0

    # ── Entropy: normalized Shannon entropy of posterior distribution ──
    if posteriors is not None and posteriors.ndim == 2 and posteriors.shape[1] > 1:
        p = np.clip(posteriors, 1e-10, 1.0)
        entropy = -np.sum(p * np.log(p), axis=1)
        max_entropy = np.log(K) if K > 1 else 1.0
        entropy = entropy / max_entropy  # Normalize to [0, 1]
    else:
        entropy = np.zeros(T)

    # ── Magnitude: per-regime mean log return ──
    log_returns = np.diff(np.log(np.maximum(close, 1e-10)))
    log_returns = np.concatenate([[0.0], log_returns])  # Pad to length T

    regime_mean = {}
    for k in range(K):
        mask = assignments == k
        if mask.sum() > 1:
            regime_mean[k] = float(np.mean(log_returns[mask]))
        else:
            regime_mean[k] = 0.0
    magnitude = np.array([regime_mean.get(int(a), 0.0) for a in assignments])

    # ── Volatility: per-regime return stdev ──
    regime_vol = {}
    for k in range(K):
        mask = assignments == k
        if mask.sum() > 2:
            regime_vol[k] = float(np.std(log_returns[mask]))
        else:
            regime_vol[k] = 0.0
    volatility = np.array([regime_vol.get(int(a), 0.0) for a in assignments])

    # ── Duration: average consecutive run length per regime ──
    regime_durations = _compute_regime_durations(assignments, K)
    duration_bars = np.array([regime_durations.get(int(a), 1) for a in assignments])

    # ── Transition probability: P(switch regime at this bar) ──
    if transition_matrix is not None:
        transition_prob = np.array([
            1.0 - float(transition_matrix[int(a)][int(a)])
            if int(a) < len(transition_matrix) else 0.0
            for a in assignments
        ])
    else:
        transition_prob = np.zeros(T)

    return {
        "confidence": confidence.astype(np.float64),
        "entropy": entropy.astype(np.float64),
        "magnitude": magnitude.astype(np.float64),
        "volatility": volatility.astype(np.float64),
        "duration_bars": duration_bars.astype(np.int32),
        "transition_prob": transition_prob.astype(np.float64),
    }


def _compute_regime_durations(assignments: np.ndarray, K: int) -> dict:
    """Compute average consecutive run length per regime."""
    durations = {k: [] for k in range(K)}
    if len(assignments) == 0:
        return {k: 1 for k in range(K)}

    current = int(assignments[0])
    run_len = 1

    for i in range(1, len(assignments)):
        if int(assignments[i]) == current:
            run_len += 1
        else:
            durations[current].append(run_len)
            current = int(assignments[i])
            run_len = 1
    durations[current].append(run_len)  # Last run

    return {k: int(np.mean(v)) if v else 1 for k, v in durations.items()}
```

**Step 2: Commit**

```bash
git add src/ml/shared/signals.py
git commit -m "feat(python): add signals.py for rich regime signal contract (confidence, entropy, etc.)"
```

---

### Task 11: Integrate signals into save.py

**SOLID:**
- **OCP** — save.py's CSV writing loop just adds more columns from the signal dict. The existing CSV columns are untouched.
- **DIP** — save.py depends on `compute_signal_columns()` function signature (abstraction), not internals.

**Files:**
- Modify: `src/ml/hdp_hmm/io/save.py:1-19` (imports), `53-88` (CSV writing)

**Step 1: Add import at top** (after line 19)

After the existing imports, add:

```python
from shared.signals import compute_signal_columns
```

**Step 2: Compute signal columns before CSV writing**

At `save.py:62-63`, after `relabeled, colors, labels, n_regimes = relabel_states(...)`, add:

```python
    # Compute rich signal columns for model_regimes (OCP — new columns, existing untouched)
    posteriors = getattr(model, 'posteriors_', None)  # (T, K) if available from Gibbs/EM
    trans_matrix_full = model.transition_matrix if hasattr(model, 'transition_matrix') else None
    signal_cols = compute_signal_columns(
        assignments=np.array(relabeled),
        posteriors=posteriors,
        close=np.array(close_vals, dtype=np.float64),
        transition_matrix=trans_matrix_full[:n_regimes, :n_regimes] if trans_matrix_full is not None else None,
    )
```

**Step 3: Modify the CSV header and rows** (lines 76-82)

Change the CSV header at line 77 from:
```python
    csv_buf.write("model_id,symbol,ts,close,regime,regime_label,split\n")
```
to:
```python
    csv_buf.write("model_id,symbol,ts,close,regime,regime_label,split,confidence,entropy,magnitude,volatility,duration_bars,transition_prob\n")
```

Change the CSV row writing at lines 78-82 from:
```python
    for i in range(T):
        ts_str = _fmt_ts(ts_vals[i])
        rl = str(regime_label_list[i]).replace(",", " ")
        csv_buf.write(f"{model_id},{args.symbol},{ts_str},{float(close_vals[i])},{int(relabeled[i])},{rl},{splits[i]}\n")
```
to:
```python
    for i in range(T):
        ts_str = _fmt_ts(ts_vals[i])
        rl = str(regime_label_list[i]).replace(",", " ")
        conf = float(signal_cols["confidence"][i])
        ent = float(signal_cols["entropy"][i])
        mag = float(signal_cols["magnitude"][i])
        vol = float(signal_cols["volatility"][i])
        dur = int(signal_cols["duration_bars"][i])
        tp = float(signal_cols["transition_prob"][i])
        csv_buf.write(f"{model_id},{args.symbol},{ts_str},{float(close_vals[i])},{int(relabeled[i])},{rl},{splits[i]},{conf},{ent},{mag},{vol},{dur},{tp}\n")
```

QuestDB `/imp` auto-discovers new columns — no DDL change needed.

**Step 4: Commit**

```bash
git add src/ml/hdp_hmm/io/save.py
git commit -m "feat(python): emit rich signal columns in model_regimes CSV (confidence, entropy, etc.)"
```

---

## Milestone 1G: Python Evaluation Stages 1-2

### Task 12: Create evaluation.py

**SOLID:**
- **SRP** — evaluation.py runs statistical tests. It does NOT write to databases or emit SSE events.
- **OCP** — New evaluation tests: add a function, add to the stage1/stage2 results dict. Caller code unchanged.
- **DIP** — main.py depends on `run_stage1_regime_quality()` and `run_stage2_significance()` signatures.

**Files:**
- Create: `src/ml/shared/evaluation.py`

**Step 1: Write the file**

```python
"""
Evaluation Pipeline — Statistical validation of regime models.

SRP: Runs statistical tests and returns results as dicts. Does NOT write to DB.
OCP: New tests = new functions in this module, added to stage results dict.

Stage 1: Regime Quality Assessment (always runs, ~1 second)
Stage 2: Statistical Significance (opt-in, ~60-120 seconds with 1000 permutations)
"""

import numpy as np
from typing import Optional

from shared.protocol import emit_log, emit_metric


def run_stage1_regime_quality(
    features: np.ndarray,        # (T, D) feature matrix
    assignments: np.ndarray,     # (T,) regime assignments
    close: np.ndarray,           # (T,) close prices
    iteration: int = 0,
) -> dict:
    """
    Stage 1: Regime Quality Assessment.

    Tests: silhouette, calinski-harabasz, davies-bouldin,
           return separation, volatility separation, min duration.

    Returns dict of {test_name: {value, passed, p_value, details}}.
    """
    # Lazy imports — these are heavy and only needed during evaluation
    from scipy import stats
    from sklearn.metrics import silhouette_score, calinski_harabasz_score, davies_bouldin_score

    emit_log("Running Stage 1: Regime Quality Assessment")
    results = {}
    K = int(assignments.max()) + 1
    log_returns = np.diff(np.log(np.maximum(close, 1e-10)))
    log_returns = np.concatenate([[0.0], log_returns])

    # ── Silhouette Score ──
    try:
        if K > 1 and K < len(assignments):
            sil = float(silhouette_score(
                features, assignments,
                sample_size=min(5000, len(features)),
            ))
        else:
            sil = 0.0
        passed = sil > 0.2
        results["silhouette_score"] = {
            "value": round(sil, 4), "passed": passed, "p_value": None,
        }
        emit_metric("eval_silhouette", sil, iteration)
    except Exception as e:
        results["silhouette_score"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Calinski-Harabasz Index ──
    try:
        if K > 1:
            ch = float(calinski_harabasz_score(features, assignments))
        else:
            ch = 0.0
        results["calinski_harabasz"] = {
            "value": round(ch, 2), "passed": ch > 10, "p_value": None,
        }
        emit_metric("eval_calinski_harabasz", ch, iteration)
    except Exception as e:
        results["calinski_harabasz"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Davies-Bouldin Index ──
    try:
        if K > 1:
            db_idx = float(davies_bouldin_score(features, assignments))
        else:
            db_idx = 999.0
        passed = db_idx < 1.5
        results["davies_bouldin"] = {
            "value": round(db_idx, 4), "passed": passed, "p_value": None,
        }
        emit_metric("eval_davies_bouldin", db_idx, iteration)
    except Exception as e:
        results["davies_bouldin"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Regime Return Separation (Welch's t-test on pairwise log returns) ──
    try:
        regime_rets = {k: log_returns[assignments == k]
                       for k in range(K) if (assignments == k).sum() > 2}
        pairs_tested = 0
        pairs_significant = 0
        min_p = 1.0

        keys = sorted(regime_rets.keys())
        for i, k1 in enumerate(keys):
            for k2 in keys[i + 1:]:
                _, p_val = stats.ttest_ind(
                    regime_rets[k1], regime_rets[k2], equal_var=False,
                )
                pairs_tested += 1
                if p_val < 0.05:
                    pairs_significant += 1
                min_p = min(min_p, float(p_val))

        passed = pairs_significant >= 2 if pairs_tested >= 3 else pairs_significant >= 1
        results["return_separation"] = {
            "value": pairs_significant, "passed": passed,
            "p_value": round(min_p, 6),
            "details": {"pairs_tested": pairs_tested, "pairs_significant": pairs_significant},
        }
        emit_metric("eval_return_separation_pairs", pairs_significant, iteration)
    except Exception as e:
        results["return_separation"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Regime Volatility Separation (Levene's test) ──
    try:
        groups = [log_returns[assignments == k]
                  for k in range(K) if (assignments == k).sum() > 2]
        if len(groups) >= 2:
            stat, p_val = stats.levene(*groups)
            passed = float(p_val) < 0.05
        else:
            stat, p_val, passed = 0.0, 1.0, False
        results["volatility_separation"] = {
            "value": round(float(stat), 4), "passed": passed,
            "p_value": round(float(p_val), 6),
        }
        emit_metric("eval_volatility_levene_p", float(p_val), iteration)
    except Exception as e:
        results["volatility_separation"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Minimum Regime Duration ──
    try:
        durations = _regime_run_lengths(assignments)
        median_dur = float(np.median(durations)) if durations else 0
        passed = median_dur > 5
        results["min_duration"] = {
            "value": round(median_dur, 1), "passed": passed, "p_value": None,
            "details": {
                "median": round(median_dur, 1),
                "mean": round(float(np.mean(durations)), 1) if durations else 0,
                "count": len(durations),
            },
        }
        emit_metric("eval_median_duration", median_dur, iteration)
    except Exception as e:
        results["min_duration"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    return results


def run_stage2_significance(
    features: np.ndarray,
    assignments: np.ndarray,
    close: np.ndarray,
    n_permutations: int = 1000,
    n_bootstrap: int = 100,
    iteration: int = 0,
) -> dict:
    """
    Stage 2: Statistical Significance.

    Expensive — opt-in via --run-significance-tests CLI flag.
    Takes ~60-120s with n_permutations=1000.
    """
    from sklearn.metrics import silhouette_score

    emit_log(f"Running Stage 2: Significance Tests (n_perm={n_permutations}, n_boot={n_bootstrap})")
    results = {}
    K = int(assignments.max()) + 1

    # ── Permutation Test ──
    try:
        emit_log("Permutation test: shuffling regime labels to build null distribution...")
        random_scores = []
        sample_n = min(2000, len(features))
        for i in range(n_permutations):
            shuffled = np.random.permutation(assignments)
            if K > 1 and K < len(shuffled):
                score = float(silhouette_score(features, shuffled, sample_size=sample_n))
            else:
                score = 0.0
            random_scores.append(score)
            if (i + 1) % 100 == 0:
                emit_metric("eval_permutation_progress", (i + 1) / n_permutations * 100, iteration)

        real_score = float(silhouette_score(
            features, assignments, sample_size=min(5000, len(features)),
        )) if K > 1 else 0.0
        p_value = float(np.mean(np.array(random_scores) >= real_score))
        passed = p_value < 0.05

        results["permutation_test"] = {
            "value": round(real_score, 4), "passed": passed,
            "p_value": round(p_value, 4),
            "details": {
                "n_permutations": n_permutations,
                "real_score": round(real_score, 4),
                "random_mean": round(float(np.mean(random_scores)), 4),
                "random_std": round(float(np.std(random_scores)), 4),
            },
        }
        emit_metric("eval_permutation_p", p_value, iteration)
    except Exception as e:
        results["permutation_test"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    # ── Bootstrap Confidence Interval ──
    try:
        emit_log("Bootstrap CI: resampling to measure assignment stability...")
        boot_scores = []
        T = len(assignments)
        for i in range(n_bootstrap):
            idx = np.random.choice(T, size=T, replace=True)
            if K > 1 and K < len(idx):
                score = float(silhouette_score(
                    features[idx], assignments[idx],
                    sample_size=min(2000, len(idx)),
                ))
            else:
                score = 0.0
            boot_scores.append(score)

        ci_low = float(np.percentile(boot_scores, 2.5))
        ci_high = float(np.percentile(boot_scores, 97.5))
        ci_mean = float(np.mean(boot_scores))

        results["bootstrap_ci"] = {
            "value": round(ci_mean, 4),
            "passed": ci_low > 0.0,  # 95% CI above 0 means stable
            "p_value": None,
            "details": {
                "ci_low": round(ci_low, 4),
                "ci_high": round(ci_high, 4),
                "ci_mean": round(ci_mean, 4),
                "n_bootstrap": n_bootstrap,
            },
        }
        emit_metric("eval_bootstrap_ci_low", ci_low, iteration)
        emit_metric("eval_bootstrap_ci_high", ci_high, iteration)
    except Exception as e:
        results["bootstrap_ci"] = {
            "value": None, "passed": False, "p_value": None, "details": str(e),
        }

    return results


def compute_evaluation_grade(stage1: dict, stage2: Optional[dict] = None) -> str:
    """
    Compute composite evaluation grade A-F.

    A: All Stage 1 pass + Stage 2 permutation p < 0.01
    B: All Stage 1 pass + Stage 2 permutation p < 0.05
    C: Most Stage 1 pass (>=60%)
    D: Some Stage 1 pass (>0%)
    F: No tests pass or cluster quality below random
    """
    s1_tests = [v.get("passed", False) for v in stage1.values()]
    s1_total = len(s1_tests)
    if s1_total == 0:
        return "F"

    s1_pass_rate = sum(s1_tests) / s1_total

    perm_p = None
    if stage2 and "permutation_test" in stage2:
        perm_p = stage2["permutation_test"].get("p_value")

    if s1_pass_rate == 1.0 and perm_p is not None and perm_p < 0.01:
        return "A"
    elif s1_pass_rate == 1.0 and perm_p is not None and perm_p < 0.05:
        return "B"
    elif s1_pass_rate >= 0.6:
        return "C"
    elif s1_pass_rate > 0:
        return "D"
    else:
        return "F"


def _regime_run_lengths(assignments: np.ndarray) -> list:
    """Compute list of consecutive run lengths across all regimes."""
    if len(assignments) == 0:
        return []
    runs = []
    current = int(assignments[0])
    length = 1
    for i in range(1, len(assignments)):
        if int(assignments[i]) == current:
            length += 1
        else:
            runs.append(length)
            current = int(assignments[i])
            length = 1
    runs.append(length)
    return runs
```

**Step 2: Commit**

```bash
git add src/ml/shared/evaluation.py
git commit -m "feat(python): add evaluation.py with Stage 1-2 statistical validation"
```

---

### Task 13: Integrate evaluation into hdp_hmm/main.py

**SOLID:**
- **OCP** — Evaluation is a new step appended to the pipeline. Existing load → features → train → save flow unchanged.

**Files:**
- Modify: `src/ml/hdp_hmm/main.py:32-50` (argparse), `115-133` (post-training)

**Step 1: Add CLI flags** (in `parse_args()`, after line 49)

Add before `return parser.parse_args()`:

```python
    parser.add_argument("--run-significance-tests", action="store_true", default=False,
                        help="Run expensive significance tests (permutation, bootstrap)")
    parser.add_argument("--n-permutations", type=int, default=1000,
                        help="Number of permutations for significance test")
    parser.add_argument("--n-bootstrap", type=int, default=100,
                        help="Number of bootstrap resamples")
```

**Step 2: Add evaluation import** (after line 29)

```python
from shared.evaluation import run_stage1_regime_quality, run_stage2_significance, compute_evaluation_grade
```

**Step 3: Add evaluation calls** (after model.fit at line 114, before save step at line 119)

Insert between the training block and the save block:

```python
        # 4b. Evaluate — statistical validation of regime quality
        emit_log("Running evaluation Stage 1: Regime Quality Assessment")
        stage1_results = run_stage1_regime_quality(
            features=X_valid,
            assignments=model.state_sequence,
            close=np.array(close_valid, dtype=np.float64),
            iteration=args.gibbs_iter,
        )

        stage2_results = {}
        if args.run_significance_tests:
            emit_log("Running evaluation Stage 2: Significance Tests")
            stage2_results = run_stage2_significance(
                features=X_valid,
                assignments=model.state_sequence,
                close=np.array(close_valid, dtype=np.float64),
                n_permutations=args.n_permutations,
                n_bootstrap=args.n_bootstrap,
                iteration=args.gibbs_iter,
            )

        eval_grade = compute_evaluation_grade(stage1_results, stage2_results or None)
        emit_log(f"Evaluation grade: {eval_grade}")
        emit_metric("evaluation_grade_ord", ord(eval_grade) - ord("A"), args.gibbs_iter)
```

**Step 4: Pass evaluation to save_model**

Modify the `save_model` call (lines 121-126) to include evaluation data. The simplest approach: save_model already writes `diagnostics.json`, so we pass evaluation info via a new keyword arg. But to minimize save.py changes, we can just include it in the diagnostics dict *after* save_model returns:

After `model_path, diagnostics = save_model(...)` (line 121-126), add:

```python
        # Inject evaluation results into diagnostics
        diagnostics["evaluation"] = {
            "stage1": stage1_results,
            "stage2": stage2_results,
            "grade": eval_grade,
        }
        # Re-write diagnostics.json with evaluation data
        import json
        diag_path = os.path.join(model_path, "diagnostics.json")
        with open(diag_path, "w") as f:
            json.dump(diagnostics, f, indent=2)
```

**Step 5: Commit**

```bash
git add src/ml/hdp_hmm/main.py
git commit -m "feat(python): integrate evaluation stages 1-2 into HDP-HMM pipeline"
```

---

### Task 14: Integrate evaluation into hmm_2state/main.py

**SOLID:** Same OCP pattern as Task 13 — append evaluation step to existing pipeline.

**Files:**
- Modify: `src/ml/hmm_2state/main.py:31-46` (argparse), `108-121` (post-training)

**Step 1: Add CLI flags** (same as HDP-HMM)

Add to parse_args() before `return parser.parse_args()`:

```python
    parser.add_argument("--run-significance-tests", action="store_true", default=False,
                        help="Run expensive significance tests")
    parser.add_argument("--n-permutations", type=int, default=1000)
    parser.add_argument("--n-bootstrap", type=int, default=100)
```

**Step 2: Add import** (after line 27)

```python
from shared.evaluation import run_stage1_regime_quality, run_stage2_significance, compute_evaluation_grade
```

**Step 3: Add evaluation calls** (same pattern as HDP-HMM, after model.fit and before save)

Insert after model training (line 106), before save (line 108):

```python
        # 4b. Evaluate
        emit_log("Running evaluation Stage 1: Regime Quality Assessment")
        stage1_results = run_stage1_regime_quality(
            features=X_valid,
            assignments=model.state_sequence,
            close=np.array(close_valid, dtype=np.float64),
            iteration=args.em_iter * args.n_restarts,
        )

        stage2_results = {}
        if args.run_significance_tests:
            emit_log("Running evaluation Stage 2: Significance Tests")
            stage2_results = run_stage2_significance(
                features=X_valid,
                assignments=model.state_sequence,
                close=np.array(close_valid, dtype=np.float64),
                n_permutations=args.n_permutations,
                n_bootstrap=args.n_bootstrap,
                iteration=args.em_iter * args.n_restarts,
            )

        eval_grade = compute_evaluation_grade(stage1_results, stage2_results or None)
        emit_log(f"Evaluation grade: {eval_grade}")
```

**Step 4: Inject evaluation into diagnostics** (same pattern as HDP-HMM)

After `model_path, diagnostics = save_model(...)`:

```python
        diagnostics["evaluation"] = {
            "stage1": stage1_results,
            "stage2": stage2_results,
            "grade": eval_grade,
        }
        import json
        diag_path = os.path.join(model_path, "diagnostics.json")
        with open(diag_path, "w") as f:
            json.dump(diagnostics, f, indent=2)
```

**Step 5: Commit**

```bash
git add src/ml/hmm_2state/main.py
git commit -m "feat(python): integrate evaluation stages 1-2 into 2-State HMM pipeline"
```

---

## Milestone 1H: Walk-Forward Validation

### Task 15: Create walkforward.ts — window computation

**SOLID:**
- **SRP** — Pure functions: compute windows from dates, generate group ID. No side effects.
- **OCP** — Future walk-forward strategies (anchored, expanding) add functions here without modifying orchestrator.

**Files:**
- Create: `src/server/training/walkforward.ts`

**Step 1: Write the file**

```typescript
/**
 * Walk-Forward Validation — Rolling train/test window computation.
 *
 * SRP: Pure functions only — computes windows from dates. No I/O.
 * OCP: New walk-forward strategies add functions here, orchestrator dispatches.
 */

import crypto from "crypto";

export interface WalkForwardConfig {
  trainMonths: number;
  testMonths: number;
  stepMonths?: number; // Default: testMonths (non-overlapping test windows)
}

export interface WalkForwardWindow {
  index: number;
  trainStart: string;  // ISO date YYYY-MM-DD
  trainEnd: string;
  testStart: string;
  testEnd: string;
}

/** Compute walk-forward windows from a date range. */
export function computeWindows(
  dateStart: string,
  dateEnd: string,
  config: WalkForwardConfig,
): WalkForwardWindow[] {
  const start = new Date(dateStart);
  const end = new Date(dateEnd);
  const step = config.stepMonths ?? config.testMonths;

  const windows: WalkForwardWindow[] = [];
  let windowStart = new Date(start);
  let index = 0;

  while (index < 50) { // Safety cap
    const trainEnd = addMonths(windowStart, config.trainMonths);
    const testStart = new Date(trainEnd);
    const testEnd = addMonths(testStart, config.testMonths);

    // Stop if test window extends beyond data range
    if (testEnd > end) break;

    windows.push({
      index,
      trainStart: toDateStr(windowStart),
      trainEnd: toDateStr(trainEnd),
      testStart: toDateStr(testStart),
      testEnd: toDateStr(testEnd),
    });

    windowStart = addMonths(windowStart, step);
    index++;
  }

  return windows;
}

/** Generate a unique walk-forward group ID. */
export function generateGroupId(): string {
  return `wf_${crypto.randomUUID().split("-")[0]}`;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function toDateStr(date: Date): string {
  return date.toISOString().split("T")[0];
}
```

**Step 2: Commit**

```bash
git add src/server/training/walkforward.ts
git commit -m "feat(training): add walk-forward window computation module"
```

---

### Task 16: Integrate walk-forward into orchestrator + types

**SOLID:**
- **OCP** — Walk-forward is a new branch in `launchTrainingPipeline()`. Single-run path untouched.
- **LSP** — Walk-forward windows reuse the same `runner.start()` interface. Runner doesn't know it's a WF window.

**Files:**
- Modify: `src/shared/trainingTypes.ts:66-80` (TrainingRequest), `84-91` (TrainingEventType)
- Modify: `src/server/training/orchestrator.ts:107-146` (pipeline launch)

**Step 1: Extend TrainingRequest** (`trainingTypes.ts`)

After `indicatorGroups?: string;` (line 79), add:

```typescript
  walkForward?: {
    trainMonths: number;
    testMonths: number;
    stepMonths?: number;
  };
```

**Step 2: Extend TrainingEventType** (`trainingTypes.ts:84-91`)

Replace the TrainingEventType union with:

```typescript
export type TrainingEventType =
  | 'started'
  | 'progress'
  | 'metric'
  | 'overlay'
  | 'log'
  | 'done'
  | 'error'
  | 'walk-forward-window-start'
  | 'walk-forward-window-done'
  | 'walk-forward-summary';
```

**Step 3: Add walk-forward dispatch to orchestrator**

At `orchestrator.ts`, add import (near existing imports):

```typescript
import { computeWindows, generateGroupId } from "./walkforward";
import { appendWindowIndex } from "./versioning";
```

Modify `launchTrainingPipeline()` (lines 120-146). After the `emitSessionEvent(session, "started", {...})` block (line 141), replace the direct `runner.start()` call with a branch:

Replace lines 143-146:
```typescript
  // Start runner, passing existing session so it reuses our listeners/events
  console.log(`[training] Starting ${request.modelType} for ${modelId} via ${registry.runner} runner`);
  await runner.start(resolved, session);
```

With:
```typescript
  if (request.walkForward && resolved.dateRange) {
    // Walk-forward mode: N sequential windows
    await launchWalkForwardPipeline(session, runner, resolved, request);
  } else {
    // Single-run mode (original path)
    console.log(`[training] Starting ${request.modelType} for ${modelId} via ${registry.runner} runner`);
    await runner.start(resolved, session);
  }
```

Then add the walk-forward function at the end of the file (before the exports):

```typescript
/** Walk-forward pipeline: spawn N sequential training windows. */
async function launchWalkForwardPipeline(
  session: TrainingSession,
  runner: ITrainerRunner,
  resolved: ResolvedTrainingConfig,
  request: TrainingRequest,
) {
  const { start: dateStart, end: dateEnd } = resolved.dateRange!;
  const windows = computeWindows(dateStart, dateEnd, request.walkForward!);
  const groupId = generateGroupId();

  emitSessionEvent(session, "log", {
    message: `Walk-forward: ${windows.length} windows (${request.walkForward!.trainMonths}m train / ${request.walkForward!.testMonths}m test)`,
    level: "info",
  });

  for (const window of windows) {
    if (session.finished) break; // User stopped training

    const windowModelId = appendWindowIndex(resolved.modelId, window.index);

    emitSessionEvent(session, "walk-forward-window-start", {
      window: window.index,
      totalWindows: windows.length,
      trainRange: { start: window.trainStart, end: window.trainEnd },
      testRange: { start: window.testStart, end: window.testEnd },
    });

    // Persist walk-forward window session to SQLite
    const dbWfSession = trainingStorage.createTrainingSession({
      modelName: resolved.modelId,
      modelType: request.modelType,
      symbol: resolved.symbol,
      timeframe: resolved.timeframe,
      versionedModelId: windowModelId,
      maxEpochs: Number(resolved.hyperparameters.gibbsIter ?? resolved.hyperparameters.emIter ?? 100),
      learningRate: 0,
      hyperparameters: resolved.hyperparameters as Record<string, unknown>,
      featureCategories: resolved.featureCategories,
      walkForwardGroupId: groupId,
      windowIndex: window.index,
    });

    // Per-window config with window-specific date range
    const windowConfig: ResolvedTrainingConfig = {
      ...resolved,
      modelId: windowModelId,
      dateRange: { start: window.trainStart, end: window.testEnd },
    };

    console.log(`[training] WF window ${window.index}/${windows.length}: ${window.trainStart}→${window.testEnd}`);
    await runner.start(windowConfig, session);

    emitSessionEvent(session, "walk-forward-window-done", {
      window: window.index,
      totalWindows: windows.length,
    });
  }

  // Emit walk-forward summary
  emitSessionEvent(session, "walk-forward-summary", {
    groupId,
    totalWindows: windows.length,
    windows: windows.map(w => ({
      index: w.index,
      trainRange: { start: w.trainStart, end: w.trainEnd },
      testRange: { start: w.testStart, end: w.testEnd },
    })),
  });
}
```

**Step 4: Add walkForward to Zod validation in training routes**

At `src/server/routes/training.ts`, in the `trainingRequestSchema` (around line 47-67), add after the `indicatorGroups` field:

```typescript
  walkForward: z.object({
    trainMonths: z.number().int().min(1).max(120),
    testMonths: z.number().int().min(1).max(60),
    stepMonths: z.number().int().min(1).max(120).optional(),
  }).optional(),
```

**Step 5: Commit**

```bash
git add src/shared/trainingTypes.ts src/server/training/orchestrator.ts src/server/routes/training.ts
git commit -m "feat(training): walk-forward validation with N-window sequential orchestration"
```

---

## Milestone 1I: Visualization Registry Config

### Task 17: Create visualizations.json

**SOLID:**
- **OCP** — Adding visualizations for a new model category = add a group entry in JSON. No code changes.

**Files:**
- Create: `src/config/visualizations.json`

**Step 1: Write the file**

Use the exact JSON from the design doc section 1.8. See the design doc for the full content. Here's the complete file:

```json
{
  "version": 1,
  "universal": [
    "convergence-panel",
    "feature-correlation-matrix",
    "train-test-split-timeline",
    "walk-forward-windows",
    "confidence-calibration",
    "data-quality-panel",
    "resource-usage"
  ],
  "groups": {
    "clustering": {
      "subcategories": ["clustering", "self-organizing", "probabilistic-mixture"],
      "components": [
        "regime-timeline",
        "transition-sankey",
        "cluster-scatter",
        "posterior-heatmap",
        "cluster-profile-cards",
        "silhouette-plot",
        "elbow-bic-curve"
      ],
      "conditional": {
        "hierarchical": ["dendrogram"],
        "som": ["som-grid"]
      }
    },
    "dimensionality-reduction": {
      "subcategories": ["dimensionality-reduction"],
      "components": [
        "scatter-2d-3d",
        "explained-variance-bar",
        "component-loadings-heatmap",
        "reconstruction-error-plot",
        "biplot"
      ],
      "conditional": {
        "manifold": ["manifold-surface"],
        "umap": ["neighborhood-graph"],
        "tsne": ["neighborhood-graph"]
      }
    },
    "anomaly-detection": {
      "subcategories": ["anomaly-detection"],
      "components": [
        "anomaly-timeline",
        "score-distribution",
        "decision-boundary",
        "feature-contribution-breakdown",
        "anomaly-cluster-view"
      ]
    },
    "classification": {
      "subcategories": ["classification", "meta-learner"],
      "components": [
        "confusion-matrix-heatmap",
        "roc-curve",
        "precision-recall-curve",
        "feature-importance-bar",
        "shap-beeswarm",
        "shap-waterfall",
        "calibration-plot",
        "prediction-timeline",
        "profit-curve",
        "learning-curve"
      ]
    },
    "regression": {
      "subcategories": ["regression", "linear", "regression-techniques"],
      "components": [
        "residual-plot",
        "prediction-vs-actual",
        "residual-distribution",
        "coefficient-bar",
        "prediction-interval",
        "rolling-error",
        "quantile-fan"
      ],
      "conditional": {
        "lasso-regression": ["regularization-path"],
        "ridge-regression": ["regularization-path"],
        "elasticnet-regression": ["regularization-path"]
      }
    },
    "sequence": {
      "subcategories": ["sequence", "time-series", "recurrent-and-sequential", "attention-based"],
      "components": [
        "forecast-ribbon",
        "attention-heatmap",
        "hidden-state-timeline",
        "layer-activation-map",
        "gradcam-overlay",
        "multi-horizon-error",
        "sequence-embedding"
      ]
    },
    "ensemble-boosting": {
      "subcategories": ["ensemble", "boosting"],
      "components": [
        "boosting-loss-curve",
        "tree-count-vs-error",
        "feature-importance-3way",
        "shap-dependence-plot",
        "shap-interaction",
        "individual-tree-viz",
        "ensemble-diversity",
        "stacking-weights"
      ]
    },
    "deep-learning": {
      "subcategories": ["deep-learning", "convolutional-networks", "feedforward-and-mlps", "generative-and-latent-models"],
      "components": [
        "loss-surface-3d",
        "training-curves",
        "gradient-flow",
        "activation-distribution",
        "weight-distribution",
        "embedding-space",
        "reconstruction-grid",
        "latent-space-walk"
      ]
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/config/visualizations.json
git commit -m "feat(config): add visualizations.json registry mapping categories to components"
```

---

### Task 18: Add visualization API endpoint

**SOLID:**
- **SRP** — Route reads config file, returns JSON. No business logic.
- **OCP** — New categories/components = edit JSON, not code.

**Files:**
- Modify: `src/server/routes/training.ts` (append new endpoints)

**Step 1: Add visualization endpoints**

Append before `export default router;`:

```typescript
// ─── Visualization Registry (Phase 1: config-driven component resolution) ────

router.get("/training/visualizations", (_req: Request, res: Response) => {
  try {
    const configPath = path.join(process.cwd(), "src", "config", "visualizations.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/training/visualizations/:category", (req: Request, res: Response) => {
  try {
    const configPath = path.join(process.cwd(), "src", "config", "visualizations.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { category } = req.params;

    const universal: string[] = config.universal || [];
    let groupComponents: string[] = [];
    let conditional: Record<string, string[]> = {};

    for (const [, groupDef] of Object.entries(config.groups)) {
      const def = groupDef as any;
      if (def.subcategories?.includes(category)) {
        groupComponents = def.components || [];
        conditional = def.conditional || {};
        break;
      }
    }

    res.json({ universal, components: groupComponents, conditional });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

Also add `fs` import at the top of `training.ts` if not already present:

```typescript
import fs from "fs";
```

**Step 2: Commit**

```bash
git add src/server/routes/training.ts
git commit -m "feat(api): add visualization registry endpoints for config-driven component resolution"
```

---

## Milestone 1J: Client Hooks

### Task 19: Create useVisualizationRegistry hook

**SOLID:**
- **SRP** — One hook, one job: fetch and resolve visualization components for a model category.
- **DIP** — Components depend on this hook (abstraction), not on raw fetch calls.

**Files:**
- Create: `src/client/src/hooks/useVisualizationRegistry.ts`

**Step 1: Write the hook**

```typescript
/**
 * useVisualizationRegistry — Resolve visualization components for a model category.
 *
 * SRP: Fetches config, resolves component list. No rendering.
 * DIP: Components depend on this hook, not raw API calls.
 */

import { useQuery } from "@tanstack/react-query";

interface VisualizationConfig {
  universal: string[];
  components: string[];
  conditional: Record<string, string[]>;
}

export function useVisualizationRegistry(subcategory: string | null) {
  return useQuery<VisualizationConfig>({
    queryKey: ["visualizations", subcategory],
    queryFn: async () => {
      if (!subcategory) return { universal: [], components: [], conditional: {} };
      const res = await fetch(`/api/training/visualizations/${subcategory}`);
      if (!res.ok) throw new Error("Failed to load visualization config");
      return res.json();
    },
    enabled: !!subcategory,
    staleTime: Infinity, // Config doesn't change during a session
  });
}

/** Resolve all component IDs for a model (universal + group + conditional). */
export function resolveComponents(
  config: VisualizationConfig | undefined,
  modelType?: string,
): string[] {
  if (!config) return [];

  const components = [...config.universal, ...config.components];

  // Add conditional components if modelType matches a trigger
  if (modelType && config.conditional) {
    for (const [trigger, extras] of Object.entries(config.conditional)) {
      if (modelType.includes(trigger)) {
        components.push(...extras);
      }
    }
  }

  return components;
}
```

**Step 2: Commit**

```bash
git add src/client/src/hooks/useVisualizationRegistry.ts
git commit -m "feat(hooks): add useVisualizationRegistry for config-driven component resolution"
```

---

### Task 20: Create usePersistedMetrics hook

**SOLID:**
- **SRP** — Fetches persisted training metrics from SQLite via API. Separate from `useTrainingMetrics` which handles live SSE state.
- **ISP** — Callers get only the data shape they need (metric rows + names).

**Files:**
- Create: `src/client/src/hooks/usePersistedMetrics.ts`

**Step 1: Write the hook**

```typescript
/**
 * usePersistedMetrics — Fetch per-iteration convergence data from SQLite.
 *
 * SRP: API data fetching only. Separate from live SSE metrics (useTrainingMetrics).
 * ISP: Returns metric rows + names — nothing more.
 */

import { useQuery } from "@tanstack/react-query";

interface TrainingMetricRow {
  id: number;
  sessionId: number;
  iteration: number;
  metricName: string;
  metricValue: number;
  timestamp: number;
}

export function usePersistedMetrics(sessionId: number | null, metricName?: string) {
  return useQuery<{ metrics: TrainingMetricRow[] }>({
    queryKey: ["persistedMetrics", sessionId, metricName],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (metricName) params.set("metricName", metricName);
      const res = await fetch(`/api/training/sessions/${sessionId}/metrics?${params}`);
      if (!res.ok) throw new Error("Failed to fetch training metrics");
      return res.json();
    },
    enabled: sessionId != null,
  });
}

export function usePersistedMetricNames(sessionId: number | null) {
  return useQuery<{ names: string[] }>({
    queryKey: ["persistedMetricNames", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/training/sessions/${sessionId}/metrics/names`);
      if (!res.ok) throw new Error("Failed to fetch metric names");
      return res.json();
    },
    enabled: sessionId != null,
  });
}
```

**Step 2: Commit**

```bash
git add src/client/src/hooks/usePersistedMetrics.ts
git commit -m "feat(hooks): add usePersistedMetrics for SQLite convergence data"
```

---

### Task 21: Create useEvaluationResults hook

**SOLID:**
- **SRP** — Fetches evaluation test results from SQLite via API.
- **ISP** — Two granularities: detailed results and stage-level summary.

**Files:**
- Create: `src/client/src/hooks/useEvaluationResults.ts`

**Step 1: Write the hook**

```typescript
/**
 * useEvaluationResults — Fetch evaluation test results from SQLite.
 *
 * SRP: API data fetching only. No rendering or business logic.
 * ISP: Separate queries for results vs summary — components use what they need.
 */

import { useQuery } from "@tanstack/react-query";

interface EvaluationResultRow {
  id: number;
  sessionId: number;
  stage: string;
  testName: string;
  testValue: number | null;
  testPassed: number | null;
  pValue: number | null;
  details: string | null;
  computedAt: number;
}

interface EvaluationStageSummary {
  stage: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
}

export function useEvaluationResults(sessionId: number | null, stage?: string) {
  return useQuery<{ results: EvaluationResultRow[] }>({
    queryKey: ["evaluationResults", sessionId, stage],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (stage) params.set("stage", stage);
      const res = await fetch(`/api/training/sessions/${sessionId}/evaluation?${params}`);
      if (!res.ok) throw new Error("Failed to fetch evaluation results");
      return res.json();
    },
    enabled: sessionId != null,
  });
}

export function useEvaluationSummary(sessionId: number | null) {
  return useQuery<{ summary: EvaluationStageSummary[] }>({
    queryKey: ["evaluationSummary", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/training/sessions/${sessionId}/evaluation/summary`);
      if (!res.ok) throw new Error("Failed to fetch evaluation summary");
      return res.json();
    },
    enabled: sessionId != null,
  });
}
```

**Step 2: Commit**

```bash
git add src/client/src/hooks/useEvaluationResults.ts
git commit -m "feat(hooks): add useEvaluationResults for statistical validation data"
```

---

## Phase 1 Verification Checkpoint

### Task 22: Verify TypeScript compiles

**Step 1: Run type check**

Run: `npm run check`
Expected: Compiles with only pre-existing errors (see MEMORY.md). NO new errors from Phase 1 changes.

If new errors:
- Fix import paths (ensure `@shared/schema` exports new tables)
- Fix any Drizzle type mismatches
- Ensure `sql` import is present in schema.ts

### Task 23: Verify schema push

**Step 1: Push schema**

Run: `npx drizzle-kit push`
Expected: "No changes detected" (all 3 schema tasks already pushed)

### Task 24: Verify dev server starts

**Step 1: Start dev server**

Run: `npm run dev`
Expected:
- "NestJS initialized (databases ready)"
- "Training runners registered: python"
- Orphaned session cleanup message (if any sessions were running)
- Server listening on port 5000

**Step 2: Test new endpoints**

Run: `curl http://localhost:5000/api/training/sessions`
Expected: `{"sessions":[]}`

Run: `curl http://localhost:5000/api/training/visualizations/clustering`
Expected: `{"universal":[...],"components":[...],"conditional":{...}}`

### Task 25: Final commit

```bash
git add -A
git commit -m "milestone: Phase 1 complete — training analytics data foundation"
```

---

## Summary of SOLID Annotations

| Principle | Where Applied |
|-----------|--------------|
| **SRP** | schema.ts (data shape only), trainingStorage.ts (DB CRUD only), versioning.ts (ID generation only), signals.py (signal computation only), evaluation.py (statistical tests only), walkforward.ts (window math only), routes (HTTP only) |
| **OCP** | visualizations.json (new categories = JSON entry), evaluation.py (new tests = new functions), signals.py (new columns = new functions), schema additive columns, walk-forward as branch not rewrite |
| **LSP** | Walk-forward windows use same `runner.start()` as single runs — runner doesn't know it's a WF window. Both HMM models use identical evaluation interface. |
| **ISP** | trainingStorage functions accept narrow params not full objects. Separate hooks for metrics vs evaluation vs viz registry. Per-stage evaluation queries. |
| **DIP** | Routes → trainingStorage (not raw DB). Orchestrator → versioning module. Parser → trainingStorage for metrics. Python main.py → evaluation.py function signatures. Client hooks → API endpoints (not raw fetch in components). |
