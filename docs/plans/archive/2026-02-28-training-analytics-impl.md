# Deep Visual Training Analytics — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the training pipeline into a QuantConnect-grade visual research platform with session persistence, model versioning, rich signal contracts, walk-forward validation, statistical evaluation, and 60+ category-aware visualization components.

**Architecture:** Three-phase horizontal build. Phase 1 lays the data foundation (schema, versioning, signal contract, walk-forward, evaluation stages 1-2, viz registry config). Phase 2 builds all visualization components across 8 model category groups plus universals. Phase 3 adds server-side evaluation stages 3-5, interactive drill-down, and model degradation tracking.

**Tech Stack:** Drizzle ORM (SQLite schema), QuestDB (time-series), Python (scikit-learn for evaluation, psutil for resource monitoring), React 19, Recharts, D3, Three.js/R3F, TanStack Query, Tailwind v4, shadcn/ui

**Design Doc:** `docs/plans/2026-02-28-training-analytics-design.md`

---

## Phase 1 — Data Foundation + Signal Contract

### Milestone 1A: Schema Evolution

---

### Task 1: Evolve trainingSessions table

**Files:**
- Modify: `src/shared/schema.ts:60-75`

**Step 1: Add new columns to trainingSessions**

Add columns after the existing `updatedAt` field (line ~71). Keep all existing columns intact — this is an additive change.

```typescript
// In src/shared/schema.ts, replace the trainingSessions definition:

export const trainingSessions = sqliteTable("training_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Existing columns (keep as-is)
  modelName: text("model_name").notNull(),
  status: text("status").notNull().default("running"), // running, paused, completed, failed
  currentEpoch: integer("current_epoch").notNull().default(0),
  maxEpochs: integer("max_epochs").notNull(),
  currentLoss: real("current_loss"),
  currentValLoss: real("current_val_loss"),
  learningRate: real("learning_rate").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),

  // === NEW COLUMNS (Phase 1) ===
  modelType: text("model_type"),                     // hdp-hmm, 2-state-hmm, etc.
  symbol: text("symbol"),                            // ES, NQ, etc.
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
  modelPath: text("model_path"),                      // filesystem path
  diagnostics: text("diagnostics"),                   // JSON blob
  qualityScore: real("quality_score"),                // 0-100
  evaluationGrade: text("evaluation_grade"),          // A/B/C/D/F
  walkForwardGroupId: text("walk_forward_group_id"),  // links WF windows
  windowIndex: integer("window_index"),               // WF window number
  errorMessage: text("error_message"),
  elapsedSec: real("elapsed_sec"),
  resourcePeakMemoryMb: real("resource_peak_memory_mb"),
  resourceAvgCpuPct: real("resource_avg_cpu_pct"),
}, (table) => ({
  modelTypeIdx: index("training_sessions_model_type_idx").on(table.modelType),
  symbolIdx: index("training_sessions_symbol_idx").on(table.symbol),
  statusIdx: index("training_sessions_status_idx").on(table.status),
  versionedModelIdIdx: index("training_sessions_versioned_model_id_idx").on(table.versionedModelId),
  walkForwardGroupIdx: index("training_sessions_wf_group_idx").on(table.walkForwardGroupId),
}));
```

**Step 2: Push schema to SQLite**

Run: `npx drizzle-kit push`
Expected: Schema changes applied to `data/ml_dashboard.db`

**Step 3: Commit**

```bash
git add src/shared/schema.ts
git commit -m "feat(schema): Evolve trainingSessions with versioning, WF, and evaluation columns"
```

---

### Task 2: Add training_metrics table

**Files:**
- Modify: `src/shared/schema.ts` (append after lossHistory table, ~line 91)

**Step 1: Add table definition**

Add after the `lossHistory` table definition:

```typescript
// Per-iteration training metrics — convergence curves that survive restarts
export const trainingMetrics = sqliteTable("training_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  iteration: integer("iteration").notNull(),
  metricName: text("metric_name").notNull(),
  metricValue: real("metric_value").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  sessionMetricIdx: index("training_metrics_session_metric_idx").on(table.sessionId, table.metricName, table.iteration),
  sessionIdx: index("training_metrics_session_idx").on(table.sessionId),
}));

export const insertTrainingMetricSchema = createInsertSchema(trainingMetrics).omit({ id: true, timestamp: true });
export type InsertTrainingMetric = z.infer<typeof insertTrainingMetricSchema>;
export type TrainingMetric = typeof trainingMetrics.$inferSelect;
```

**Step 2: Push schema**

Run: `npx drizzle-kit push`

**Step 3: Commit**

```bash
git add src/shared/schema.ts
git commit -m "feat(schema): Add training_metrics table for per-iteration convergence tracking"
```

---

### Task 3: Add evaluation_results table

**Files:**
- Modify: `src/shared/schema.ts` (append after trainingMetrics)

**Step 1: Add table definition**

```typescript
// Statistical evaluation results — per-test pass/fail with p-values
export const evaluationResults = sqliteTable("evaluation_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  stage: text("stage").notNull(),          // regime_quality, significance, oos_validation, conditioned_performance, benchmark
  testName: text("test_name").notNull(),   // silhouette_score, permutation_test, etc.
  testValue: real("test_value"),
  testPassed: integer("test_passed"),       // 0 or 1
  pValue: real("p_value"),
  details: text("details"),                 // JSON blob for drill-down
  computedAt: integer("computed_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  sessionStageIdx: index("evaluation_results_session_stage_idx").on(table.sessionId, table.stage, table.testName),
  sessionIdx: index("evaluation_results_session_idx").on(table.sessionId),
}));

export const insertEvaluationResultSchema = createInsertSchema(evaluationResults).omit({ id: true, computedAt: true });
export type InsertEvaluationResult = z.infer<typeof insertEvaluationResultSchema>;
export type EvaluationResult = typeof evaluationResults.$inferSelect;
```

**Step 2: Push schema**

Run: `npx drizzle-kit push`

**Step 3: Commit**

```bash
git add src/shared/schema.ts
git commit -m "feat(schema): Add evaluation_results table for statistical test tracking"
```

---

### Milestone 1B: Training Storage Layer

---

### Task 4: Create training storage module

**Files:**
- Create: `src/server/storage/trainingStorage.ts`

This module provides SQLite CRUD for the 3 training tables. Routes and orchestrator call these functions — never touch the DB directly (DIP).

**Step 1: Create the file**

```typescript
/**
 * Training Storage — SQLite CRUD for training sessions, metrics, and evaluations.
 *
 * Routes and orchestrator call these functions — never query the DB directly (DIP).
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

export async function createTrainingSession(data: {
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
  const result = db.insert(trainingSessions).values({
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

  return result;
}

export async function updateSessionProgress(id: number, data: {
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
    .set({ ...data, updatedAt: new Date() })
    .where(eq(trainingSessions.id, id))
    .run();
}

export async function finalizeSession(id: number, data: {
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
      updatedAt: new Date(),
    })
    .where(eq(trainingSessions.id, id))
    .run();
}

export function getSession(id: number) {
  return db.select().from(trainingSessions).where(eq(trainingSessions.id, id)).get();
}

export function getSessionByVersionedId(versionedModelId: string) {
  return db.select().from(trainingSessions)
    .where(eq(trainingSessions.versionedModelId, versionedModelId)).get();
}

export function listSessions(opts?: {
  symbol?: string;
  modelType?: string;
  status?: string;
  limit?: number;
}) {
  let query = db.select().from(trainingSessions).orderBy(desc(trainingSessions.startedAt));

  // Note: Drizzle doesn't chain .where() well — build conditions array
  const conditions = [];
  if (opts?.symbol) conditions.push(eq(trainingSessions.symbol, opts.symbol));
  if (opts?.modelType) conditions.push(eq(trainingSessions.modelType, opts.modelType));
  if (opts?.status) conditions.push(eq(trainingSessions.status, opts.status));

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  if (opts?.limit) {
    query = query.limit(opts.limit) as typeof query;
  }

  return query.all();
}

export function getWalkForwardGroup(groupId: string) {
  return db.select().from(trainingSessions)
    .where(eq(trainingSessions.walkForwardGroupId, groupId))
    .orderBy(trainingSessions.windowIndex)
    .all();
}

/** Mark any "running" sessions as "failed" — call on server startup */
export function markOrphanedSessionsFailed() {
  const updated = db.update(trainingSessions)
    .set({ status: "failed", errorMessage: "Server restarted during training", updatedAt: new Date() })
    .where(eq(trainingSessions.status, "running"))
    .run();
  return updated.changes;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export function insertMetric(data: InsertTrainingMetric) {
  db.insert(trainingMetrics).values(data).run();
}

export function insertMetricsBatch(data: InsertTrainingMetric[]) {
  if (data.length === 0) return;
  db.insert(trainingMetrics).values(data).run();
}

export function getMetrics(sessionId: number, metricName?: string) {
  const conditions = [eq(trainingMetrics.sessionId, sessionId)];
  if (metricName) conditions.push(eq(trainingMetrics.metricName, metricName));

  return db.select().from(trainingMetrics)
    .where(and(...conditions))
    .orderBy(trainingMetrics.iteration)
    .all();
}

export function getMetricNames(sessionId: number): string[] {
  const rows = db.selectDistinct({ metricName: trainingMetrics.metricName })
    .from(trainingMetrics)
    .where(eq(trainingMetrics.sessionId, sessionId))
    .all();
  return rows.map(r => r.metricName);
}

// ─── Evaluation Results ──────────────────────────────────────────────────────

export function insertEvaluation(data: InsertEvaluationResult) {
  db.insert(evaluationResults).values(data).run();
}

export function insertEvaluationsBatch(data: InsertEvaluationResult[]) {
  if (data.length === 0) return;
  db.insert(evaluationResults).values(data).run();
}

export function getEvaluations(sessionId: number, stage?: string) {
  const conditions = [eq(evaluationResults.sessionId, sessionId)];
  if (stage) conditions.push(eq(evaluationResults.stage, stage));

  return db.select().from(evaluationResults)
    .where(and(...conditions))
    .orderBy(evaluationResults.stage, evaluationResults.testName)
    .all();
}

export function getEvaluationSummary(sessionId: number) {
  // Group by stage, return pass/fail counts
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

**Step 2: Commit**

```bash
git add src/server/storage/trainingStorage.ts
git commit -m "feat(storage): Add training storage module for sessions, metrics, and evaluations"
```

---

### Milestone 1C: Model Versioning

---

### Task 5: Create versioning module

**Files:**
- Create: `src/server/training/versioning.ts`

**Step 1: Create the file**

```typescript
/**
 * Model Versioning — Generate unique versioned model IDs.
 *
 * Format: {SYMBOL}_{TIMEFRAME}_{MODEL-TYPE}_{ISO-TIMESTAMP}
 * Example: ES_1h_hdp-hmm_20260227T143022
 *
 * The base modelId (without timestamp) is kept for "latest model" queries.
 */

/** Generate a versioned model ID with current timestamp */
export function generateVersionedModelId(
  symbol: string,
  timeframe: string,
  modelType: string,
): string {
  const now = new Date();
  const ts = now.toISOString()
    .replace(/[-:]/g, "")  // Remove dashes and colons
    .replace(/\.\d{3}Z$/, "")  // Remove milliseconds and Z
    .replace("T", "T");  // Keep T separator
  // Result: "20260227T143022"

  return `${symbol}_${timeframe}_${modelType}_${ts}`;
}

/** Extract the base model ID (without version timestamp) */
export function getBaseModelId(versionedModelId: string): string {
  // Remove the last segment (timestamp): ES_1h_hdp-hmm_20260227T143022 → ES_1h_hdp-hmm
  const parts = versionedModelId.split("_");
  // Find the timestamp part (matches YYYYMMDDTHHMMSS pattern)
  const tsPattern = /^\d{8}T\d{6}$/;
  const tsIdx = parts.findIndex(p => tsPattern.test(p));
  if (tsIdx === -1) return versionedModelId; // No timestamp found, return as-is
  return parts.slice(0, tsIdx).join("_");
}

/** Extract timestamp from versioned model ID */
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

/** Append walk-forward window index to versioned model ID */
export function appendWindowIndex(versionedModelId: string, windowIndex: number): string {
  return `${versionedModelId}_w${windowIndex}`;
}
```

**Step 2: Commit**

```bash
git add src/server/training/versioning.ts
git commit -m "feat(training): Add model versioning module with timestamped IDs"
```

---

### Task 6: Integrate versioning into orchestrator

**Files:**
- Modify: `src/server/training/orchestrator.ts:55-62`

**Step 1: Import versioning**

Add import at top of orchestrator.ts:

```typescript
import { generateVersionedModelId, getBaseModelId } from "./versioning";
import * as trainingStorage from "../storage/trainingStorage";
```

**Step 2: Replace modelId generation**

Replace the current modelId construction (line ~61):

```typescript
// OLD:
// const modelId = `${sym}_${tf}_${request.modelType}`;

// NEW: Versioned model ID
const baseModelId = `${sym}_${tf}_${request.modelType}`;
const modelId = generateVersionedModelId(sym, tf, request.modelType);
```

**Step 3: Persist session to SQLite on creation**

After `const session = createSession(modelId, resolved);` (line ~102), add:

```typescript
// Persist session to SQLite for crash recovery
const dbSession = await trainingStorage.createTrainingSession({
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
// Attach DB session ID to in-memory session for updates
(session as any).dbSessionId = dbSession.id;
```

**Step 4: Update duplicate check**

The existing duplicate check uses `activeSessions.get(modelId)`. Since modelId is now unique (timestamped), the check should use the base ID to prevent concurrent training of the same symbol/timeframe/model:

```typescript
// Check if already training this base model
for (const [existingId, entry] of Array.from(activeSessions.entries())) {
  if (!entry.session.finished && getBaseModelId(existingId) === baseModelId) {
    throw new Error(`Already training ${baseModelId}. Stop it first.`);
  }
}
```

**Step 5: Commit**

```bash
git add src/server/training/orchestrator.ts
git commit -m "feat(training): Integrate versioned model IDs and session persistence"
```

---

### Task 7: Persist metrics and finalize sessions

**Files:**
- Modify: `src/server/training/runners/parsers/hdpHmmParser.ts`
- Modify: `src/server/training/runners/pythonRunner.ts`

**Step 1: Write metrics to SQLite from parser**

In `hdpHmmParser.ts`, import storage and write metrics on `metric` events:

```typescript
import * as trainingStorage from "../../../storage/trainingStorage";
```

In the `parseLine` method, after emitting the metric event, add:

```typescript
case 'metric': {
  // ... existing emit logic ...

  // Persist to SQLite
  const dbSessionId = (session as any).dbSessionId;
  if (dbSessionId && msg.metrics) {
    const entries = Object.entries(msg.metrics as Record<string, number>);
    const batch = entries.map(([name, value]) => ({
      sessionId: dbSessionId,
      iteration: Number(msg.iteration ?? 0),
      metricName: name,
      metricValue: value,
    }));
    trainingStorage.insertMetricsBatch(batch);
  }
  break;
}
```

**Step 2: Finalize session on done/error in pythonRunner**

In `pythonRunner.ts`, in the `close` event handler, add session finalization:

```typescript
import * as trainingStorage from "../../storage/trainingStorage";
```

After the existing `emitSessionEvent(session, "done", ...)` call:

```typescript
const dbSessionId = (session as any).dbSessionId;
if (dbSessionId) {
  await trainingStorage.finalizeSession(dbSessionId, {
    status: exitCode === 0 ? "completed" : "failed",
    diagnostics: diagnosticsData as Record<string, unknown>,
    qualityScore: diagnosticsData?.quality_score as number,
    modelPath: `${config.outputDir}/${config.modelId}`,
    elapsedSec: (Date.now() - session.startedAt) / 1000,
    errorMessage: exitCode !== 0 ? lastStderr : undefined,
  });
}
```

**Step 3: Mark orphaned sessions on startup**

In `src/server/main.ts` (or wherever the Express app bootstraps), add:

```typescript
import { markOrphanedSessionsFailed } from "./storage/trainingStorage";

// After DB initialization
const orphaned = markOrphanedSessionsFailed();
if (orphaned > 0) console.log(`[training] Marked ${orphaned} orphaned session(s) as failed`);
```

**Step 4: Commit**

```bash
git add src/server/training/runners/parsers/hdpHmmParser.ts src/server/training/runners/pythonRunner.ts src/server/main.ts
git commit -m "feat(training): Persist metrics and finalize sessions to SQLite"
```

---

### Milestone 1D: Training API Extensions

---

### Task 8: Add session/metrics/evaluation API routes

**Files:**
- Modify: `src/server/routes/training.ts`

**Step 1: Import storage module**

```typescript
import * as trainingStorage from "../storage/trainingStorage";
```

**Step 2: Add new endpoints (append to existing router)**

```typescript
// ─── Persisted Sessions ──────────────────────────────────────────────────────

router.get("/sessions", async (req, res) => {
  const { symbol, modelType, status, limit } = req.query;
  const sessions = trainingStorage.listSessions({
    symbol: symbol as string,
    modelType: modelType as string,
    status: status as string,
    limit: limit ? Number(limit) : 50,
  });
  res.json({ sessions });
});

router.get("/sessions/:id", async (req, res) => {
  const session = trainingStorage.getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

router.get("/sessions/:id/metrics", async (req, res) => {
  const { metricName } = req.query;
  const metrics = trainingStorage.getMetrics(Number(req.params.id), metricName as string);
  res.json({ metrics });
});

router.get("/sessions/:id/metrics/names", async (req, res) => {
  const names = trainingStorage.getMetricNames(Number(req.params.id));
  res.json({ names });
});

router.get("/sessions/:id/evaluation", async (req, res) => {
  const { stage } = req.query;
  const results = trainingStorage.getEvaluations(Number(req.params.id), stage as string);
  res.json({ results });
});

router.get("/sessions/:id/evaluation/summary", async (req, res) => {
  const summary = trainingStorage.getEvaluationSummary(Number(req.params.id));
  res.json({ summary });
});

router.get("/walk-forward/:groupId", async (req, res) => {
  const windows = trainingStorage.getWalkForwardGroup(req.params.groupId);
  if (windows.length === 0) return res.status(404).json({ error: "Walk-forward group not found" });
  res.json({ groupId: req.params.groupId, windows, totalWindows: windows.length });
});
```

**Step 3: Commit**

```bash
git add src/server/routes/training.ts
git commit -m "feat(api): Add session, metrics, and evaluation endpoints"
```

---

### Milestone 1E: Rich Signal Contract (Python)

---

### Task 9: Create signals.py — compute confidence, entropy, transition_prob, etc.

**Files:**
- Create: `src/ml/shared/signals.py`

**Step 1: Create the file**

```python
"""
Signal Contract — Compute rich regime metadata from model outputs.

Adds: confidence, entropy, magnitude, volatility, duration_bars, transition_prob
to the model_regimes CSV before writing to QuestDB.
"""

import numpy as np
from typing import Optional


def compute_signal_columns(
    assignments: np.ndarray,        # (T,) regime assignments
    posteriors: Optional[np.ndarray],  # (T, K) posterior probabilities (if available)
    close: np.ndarray,              # (T,) close prices
    transition_matrix: Optional[np.ndarray],  # (K, K) transition probabilities
) -> dict:
    """
    Compute 6 signal columns from model outputs.

    Returns dict with keys: confidence, entropy, magnitude, volatility,
    duration_bars, transition_prob — each np.ndarray of shape (T,).
    """
    T = len(assignments)
    K = int(assignments.max()) + 1 if len(assignments) > 0 else 1

    # --- Confidence: max posterior probability per bar ---
    if posteriors is not None and posteriors.shape[1] > 1:
        confidence = posteriors.max(axis=1)
    else:
        confidence = np.ones(T)  # No posteriors available → confidence = 1.0

    # --- Entropy: uncertainty measure ---
    if posteriors is not None and posteriors.shape[1] > 1:
        # Clip to avoid log(0)
        p = np.clip(posteriors, 1e-10, 1.0)
        entropy = -np.sum(p * np.log(p), axis=1)
        # Normalize to [0, 1] by dividing by max possible entropy (log K)
        max_entropy = np.log(K) if K > 1 else 1.0
        entropy = entropy / max_entropy
    else:
        entropy = np.zeros(T)

    # --- Magnitude: per-regime mean return ---
    returns = np.diff(np.log(close))
    returns = np.concatenate([[0.0], returns])  # Pad to match T

    regime_mean_return = {}
    for k in range(K):
        mask = assignments == k
        if mask.sum() > 1:
            regime_mean_return[k] = float(np.mean(returns[mask]))
        else:
            regime_mean_return[k] = 0.0

    magnitude = np.array([regime_mean_return.get(int(a), 0.0) for a in assignments])

    # --- Volatility: per-regime return stdev ---
    regime_vol = {}
    for k in range(K):
        mask = assignments == k
        if mask.sum() > 2:
            regime_vol[k] = float(np.std(returns[mask]))
        else:
            regime_vol[k] = 0.0

    volatility = np.array([regime_vol.get(int(a), 0.0) for a in assignments])

    # --- Duration: average consecutive run length per regime ---
    regime_durations = _compute_regime_durations(assignments, K)
    duration_bars = np.array([regime_durations.get(int(a), 1) for a in assignments])

    # --- Transition probability: P(switch regime at this bar) ---
    if transition_matrix is not None:
        # transition_prob[t] = 1 - P(stay in current regime)
        transition_prob = np.array([
            1.0 - transition_matrix[int(a)][int(a)] if int(a) < len(transition_matrix) else 0.0
            for a in assignments
        ])
    else:
        transition_prob = np.zeros(T)

    return {
        "confidence": confidence,
        "entropy": entropy,
        "magnitude": magnitude,
        "volatility": volatility,
        "duration_bars": duration_bars.astype(int),
        "transition_prob": transition_prob,
    }


def _compute_regime_durations(assignments: np.ndarray, K: int) -> dict:
    """Compute average consecutive run length per regime."""
    durations = {k: [] for k in range(K)}
    if len(assignments) == 0:
        return {k: 1 for k in range(K)}

    current = assignments[0]
    run_len = 1

    for i in range(1, len(assignments)):
        if assignments[i] == current:
            run_len += 1
        else:
            durations[int(current)].append(run_len)
            current = assignments[i]
            run_len = 1
    durations[int(current)].append(run_len)  # Last run

    return {k: int(np.mean(v)) if v else 1 for k, v in durations.items()}
```

**Step 2: Commit**

```bash
git add src/ml/shared/signals.py
git commit -m "feat(python): Add signals.py for rich regime signal contract computation"
```

---

### Task 10: Integrate signals into save.py

**Files:**
- Modify: `src/ml/hdp_hmm/io/save.py`

**Step 1: Import signals module**

Add at top of save.py:

```python
from shared.signals import compute_signal_columns
```

**Step 2: Compute and include signal columns in CSV**

In the `save_model` function, after regime assignments are finalized but before writing the CSV to QuestDB, compute signals:

```python
# Compute rich signal columns
posteriors = getattr(model, 'posteriors_', None)  # (T, K) if available
trans_matrix = getattr(model, 'transition_matrix_', None)

signal_cols = compute_signal_columns(
    assignments=final_assignments,
    posteriors=posteriors,
    close=close_vals,
    transition_matrix=trans_matrix,
)

# Add signal columns to the CSV DataFrame
for col_name, col_data in signal_cols.items():
    df[col_name] = col_data
```

The CSV written to QuestDB `/imp` will now include: `confidence`, `entropy`, `magnitude`, `volatility`, `duration_bars`, `transition_prob` alongside the existing `regime`, `regime_label`, `split` columns.

QuestDB `/imp` auto-discovers new columns — no DDL change needed.

**Step 3: Commit**

```bash
git add src/ml/hdp_hmm/io/save.py
git commit -m "feat(python): Emit rich signal columns (confidence, entropy, transition_prob, etc.)"
```

---

### Milestone 1F: Python Evaluation (Stages 1-2)

---

### Task 11: Create evaluation.py — regime quality + significance tests

**Files:**
- Create: `src/ml/shared/evaluation.py`

**Step 1: Create the file**

```python
"""
Evaluation Pipeline — Statistical validation of regime models.

Stage 1: Regime Quality Assessment (cluster metrics, return separation)
Stage 2: Statistical Significance (permutation test, bootstrap CI)

Results emitted as JSON via protocol.emit_metric() and returned as dict
for inclusion in diagnostics.json.
"""

import numpy as np
from typing import Optional
from scipy import stats
from sklearn.metrics import silhouette_score, calinski_harabasz_score, davies_bouldin_score

from shared.protocol import emit_log, emit_metric


def run_stage1_regime_quality(
    features: np.ndarray,           # (T, D) feature matrix
    assignments: np.ndarray,        # (T,) regime assignments
    close: np.ndarray,              # (T,) close prices
    iteration: int = 0,
) -> dict:
    """
    Stage 1: Regime Quality Assessment.

    Tests: silhouette, calinski-harabasz, davies-bouldin,
           return separation, volatility separation, min duration.

    Returns dict of { test_name: { value, passed, p_value, details } }.
    """
    emit_log("Running Stage 1: Regime Quality Assessment")
    results = {}
    K = int(assignments.max()) + 1
    returns = np.diff(np.log(close))
    returns = np.concatenate([[0.0], returns])

    # --- Silhouette Score ---
    try:
        if K > 1 and K < len(assignments):
            sil = float(silhouette_score(features, assignments, sample_size=min(5000, len(features))))
        else:
            sil = 0.0
        passed = sil > 0.2
        results["silhouette_score"] = {"value": round(sil, 4), "passed": passed, "p_value": None}
        emit_metric("eval_silhouette", sil, iteration)
    except Exception as e:
        results["silhouette_score"] = {"value": None, "passed": False, "p_value": None, "details": str(e)}

    # --- Calinski-Harabasz Index ---
    try:
        if K > 1:
            ch = float(calinski_harabasz_score(features, assignments))
        else:
            ch = 0.0
        results["calinski_harabasz"] = {"value": round(ch, 2), "passed": ch > 10, "p_value": None}
        emit_metric("eval_calinski_harabasz", ch, iteration)
    except Exception as e:
        results["calinski_harabasz"] = {"value": None, "passed": False, "details": str(e)}

    # --- Davies-Bouldin Index ---
    try:
        if K > 1:
            db_score = float(davies_bouldin_score(features, assignments))
        else:
            db_score = 999.0
        passed = db_score < 1.5
        results["davies_bouldin"] = {"value": round(db_score, 4), "passed": passed, "p_value": None}
        emit_metric("eval_davies_bouldin", db_score, iteration)
    except Exception as e:
        results["davies_bouldin"] = {"value": None, "passed": False, "details": str(e)}

    # --- Regime Return Separation (Welch's t-test) ---
    try:
        regime_returns = {k: returns[assignments == k] for k in range(K) if (assignments == k).sum() > 2}
        pairs_tested = 0
        pairs_significant = 0
        min_p = 1.0

        for i, (k1, r1) in enumerate(regime_returns.items()):
            for k2, r2 in list(regime_returns.items())[i + 1:]:
                t_stat, p_val = stats.ttest_ind(r1, r2, equal_var=False)
                pairs_tested += 1
                if p_val < 0.05:
                    pairs_significant += 1
                min_p = min(min_p, p_val)

        passed = pairs_significant >= 2 if pairs_tested >= 3 else pairs_significant >= 1
        results["return_separation"] = {
            "value": pairs_significant,
            "passed": passed,
            "p_value": round(min_p, 6),
            "details": {"pairs_tested": pairs_tested, "pairs_significant": pairs_significant},
        }
        emit_metric("eval_return_separation_pairs", pairs_significant, iteration)
    except Exception as e:
        results["return_separation"] = {"value": None, "passed": False, "details": str(e)}

    # --- Regime Volatility Separation (Levene's test) ---
    try:
        groups = [returns[assignments == k] for k in range(K) if (assignments == k).sum() > 2]
        if len(groups) >= 2:
            stat, p_val = stats.levene(*groups)
            passed = p_val < 0.05
        else:
            stat, p_val, passed = 0.0, 1.0, False
        results["volatility_separation"] = {"value": round(float(stat), 4), "passed": passed, "p_value": round(float(p_val), 6)}
        emit_metric("eval_volatility_levene_p", p_val, iteration)
    except Exception as e:
        results["volatility_separation"] = {"value": None, "passed": False, "details": str(e)}

    # --- Minimum Regime Duration ---
    try:
        durations = _regime_run_lengths(assignments)
        median_dur = float(np.median(durations)) if durations else 0
        passed = median_dur > 5
        results["min_duration"] = {
            "value": round(median_dur, 1),
            "passed": passed,
            "p_value": None,
            "details": {"median": median_dur, "mean": float(np.mean(durations)) if durations else 0},
        }
        emit_metric("eval_median_duration", median_dur, iteration)
    except Exception as e:
        results["min_duration"] = {"value": None, "passed": False, "details": str(e)}

    return results


def run_stage2_significance(
    features: np.ndarray,
    assignments: np.ndarray,
    close: np.ndarray,
    model_quality_score: float,
    n_permutations: int = 1000,
    n_bootstrap: int = 100,
    iteration: int = 0,
) -> dict:
    """
    Stage 2: Statistical Significance.

    Expensive — opt-in via --run-significance-tests CLI flag.
    """
    emit_log(f"Running Stage 2: Significance Tests (n_perm={n_permutations}, n_boot={n_bootstrap})")
    results = {}
    K = int(assignments.max()) + 1

    # --- Permutation Test ---
    try:
        emit_log("Running permutation test...")
        random_scores = []
        for i in range(n_permutations):
            shuffled = np.random.permutation(assignments)
            if K > 1 and K < len(shuffled):
                score = float(silhouette_score(features, shuffled, sample_size=min(2000, len(features))))
            else:
                score = 0.0
            random_scores.append(score)
            if (i + 1) % 100 == 0:
                emit_metric("eval_permutation_progress", (i + 1) / n_permutations * 100, iteration)

        real_score = float(silhouette_score(features, assignments, sample_size=min(5000, len(features)))) if K > 1 else 0.0
        p_value = float(np.mean(np.array(random_scores) >= real_score))
        passed = p_value < 0.05

        results["permutation_test"] = {
            "value": round(real_score, 4),
            "passed": passed,
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
        results["permutation_test"] = {"value": None, "passed": False, "details": str(e)}

    # --- Bootstrap Confidence Interval ---
    try:
        emit_log("Running bootstrap CI...")
        agreement_rates = []
        T = len(assignments)
        for i in range(n_bootstrap):
            idx = np.random.choice(T, size=T, replace=True)
            boot_features = features[idx]
            # Simple: check if assignments are stable under resampling
            # Use silhouette as stability proxy
            if K > 1 and K < len(idx):
                score = float(silhouette_score(boot_features, assignments[idx], sample_size=min(2000, len(idx))))
            else:
                score = 0.0
            agreement_rates.append(score)

        ci_low = float(np.percentile(agreement_rates, 2.5))
        ci_high = float(np.percentile(agreement_rates, 97.5))
        ci_mean = float(np.mean(agreement_rates))

        results["bootstrap_ci"] = {
            "value": round(ci_mean, 4),
            "passed": ci_low > 0.0,  # 95% CI above 0 = stable
            "p_value": None,
            "details": {
                "ci_low": round(ci_low, 4),
                "ci_high": round(ci_high, 4),
                "n_bootstrap": n_bootstrap,
            },
        }
        emit_metric("eval_bootstrap_ci_low", ci_low, iteration)
        emit_metric("eval_bootstrap_ci_high", ci_high, iteration)
    except Exception as e:
        results["bootstrap_ci"] = {"value": None, "passed": False, "details": str(e)}

    return results


def compute_evaluation_grade(stage1: dict, stage2: dict = None) -> str:
    """
    Compute composite evaluation grade A-F.

    A: All Stage 1 pass + Stage 2 permutation p < 0.01
    B: All Stage 1 pass + Stage 2 permutation p < 0.05
    C: Most Stage 1 pass
    D: Some Stage 1 pass
    F: Cluster quality below random
    """
    s1_tests = [v.get("passed", False) for v in stage1.values()]
    s1_pass_count = sum(s1_tests)
    s1_total = len(s1_tests)

    if s1_total == 0:
        return "F"

    s1_pass_rate = s1_pass_count / s1_total

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
    current = assignments[0]
    length = 1
    for i in range(1, len(assignments)):
        if assignments[i] == current:
            length += 1
        else:
            runs.append(length)
            current = assignments[i]
            length = 1
    runs.append(length)
    return runs
```

**Step 2: Commit**

```bash
git add src/ml/shared/evaluation.py
git commit -m "feat(python): Add evaluation.py with Stage 1-2 statistical validation"
```

---

### Task 12: Integrate evaluation into HDP-HMM and 2-State HMM main.py

**Files:**
- Modify: `src/ml/hdp_hmm/main.py`
- Modify: `src/ml/hmm_2state/main.py`

**Step 1: Add evaluation calls after training in hdp_hmm/main.py**

After model.fit() and before save_model(), add:

```python
from shared.evaluation import run_stage1_regime_quality, run_stage2_significance, compute_evaluation_grade

# Stage 1: Regime Quality (always runs)
emit_log("Running evaluation Stage 1: Regime Quality")
stage1_results = run_stage1_regime_quality(
    features=X_normalized,
    assignments=final_assignments,
    close=close_vals,
    iteration=n_iter,
)

# Stage 2: Significance (opt-in via CLI flag)
stage2_results = {}
if args.run_significance_tests:
    emit_log("Running evaluation Stage 2: Significance Tests")
    stage2_results = run_stage2_significance(
        features=X_normalized,
        assignments=final_assignments,
        close=close_vals,
        model_quality_score=quality_score,
        n_permutations=args.n_permutations,
        iteration=n_iter,
    )

# Compute grade
eval_grade = compute_evaluation_grade(stage1_results, stage2_results)
emit_metric("evaluation_grade", ord(eval_grade) - ord("A"), n_iter)
emit_log(f"Evaluation grade: {eval_grade}")
```

**Step 2: Add CLI flags for significance tests**

In the argparse section:

```python
parser.add_argument("--run-significance-tests", action="store_true", default=False,
                    help="Run expensive significance tests (permutation, bootstrap)")
parser.add_argument("--n-permutations", type=int, default=1000,
                    help="Number of permutations for significance test")
```

**Step 3: Include evaluation in diagnostics**

Pass evaluation results to save_model or include in diagnostics:

```python
diagnostics["evaluation"] = {
    "stage1": stage1_results,
    "stage2": stage2_results,
    "grade": eval_grade,
}
```

**Step 4: Do the same for hmm_2state/main.py**

Same pattern — import evaluation, run after training, include in diagnostics.

**Step 5: Commit**

```bash
git add src/ml/hdp_hmm/main.py src/ml/hmm_2state/main.py
git commit -m "feat(python): Integrate evaluation stages 1-2 into HDP-HMM and 2-State HMM"
```

---

### Milestone 1G: Walk-Forward Validation

---

### Task 13: Create walk-forward orchestration module

**Files:**
- Create: `src/server/training/walkforward.ts`

**Step 1: Create the file**

```typescript
/**
 * Walk-Forward Validation — Rolling train/test window orchestration.
 *
 * Computes N windows from a date range, spawns sequential training runs,
 * and aggregates cross-window metrics.
 */

import crypto from "crypto";

export interface WalkForwardConfig {
  trainMonths: number;
  testMonths: number;
  stepMonths?: number; // Default: testMonths
}

export interface WalkForwardWindow {
  index: number;
  trainStart: string;  // ISO date
  trainEnd: string;
  testStart: string;
  testEnd: string;
}

/** Compute walk-forward windows from a date range */
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

  while (true) {
    const trainEnd = addMonths(windowStart, config.trainMonths);
    const testStart = new Date(trainEnd);
    const testEnd = addMonths(testStart, config.testMonths);

    // Stop if test window extends beyond data range
    if (testEnd > end) break;

    windows.push({
      index,
      trainStart: windowStart.toISOString().split("T")[0],
      trainEnd: trainEnd.toISOString().split("T")[0],
      testStart: testStart.toISOString().split("T")[0],
      testEnd: testEnd.toISOString().split("T")[0],
    });

    windowStart = addMonths(windowStart, step);
    index++;

    // Safety: max 50 windows
    if (index >= 50) break;
  }

  return windows;
}

/** Generate a unique walk-forward group ID */
export function generateGroupId(): string {
  return `wf_${crypto.randomUUID().split("-")[0]}`;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}
```

**Step 2: Commit**

```bash
git add src/server/training/walkforward.ts
git commit -m "feat(training): Add walk-forward window computation module"
```

---

### Task 14: Integrate walk-forward into orchestrator

**Files:**
- Modify: `src/shared/trainingTypes.ts` (add walkForward to TrainingRequest)
- Modify: `src/server/training/orchestrator.ts`

**Step 1: Extend TrainingRequest**

In `trainingTypes.ts`, add to TrainingRequest:

```typescript
walkForward?: {
  trainMonths: number;
  testMonths: number;
  stepMonths?: number;
};
```

Also add new SSE event types to TrainingEventType:

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

**Step 2: Add walk-forward dispatch to orchestrator**

In `orchestrator.ts`, modify `launchTrainingPipeline` to check for walk-forward:

```typescript
import { computeWindows, generateGroupId, type WalkForwardWindow } from "./walkforward";
import { appendWindowIndex } from "./versioning";

async function launchTrainingPipeline(/* ... existing params ... */) {
  // ... existing session checks and started event ...

  if (request.walkForward) {
    await launchWalkForwardPipeline(session, runner, resolved, registry, trainingCfg, request);
  } else {
    // Original single-run path
    await runner.start(resolved, session);
  }
}

async function launchWalkForwardPipeline(
  session: TrainingSession,
  runner: ITrainerRunner,
  resolved: ResolvedTrainingConfig,
  registry: ResolvedTrainingConfig["registry"],
  trainingCfg: ReturnType<typeof getTrainingConfig>,
  request: TrainingRequest,
) {
  const dateStart = request.dateRange?.start;
  const dateEnd = request.dateRange?.end;

  if (!dateStart || !dateEnd) {
    emitSessionEvent(session, "error", { message: "Walk-forward requires dateRange.start and dateRange.end" });
    session.finished = true;
    return;
  }

  const windows = computeWindows(dateStart, dateEnd, request.walkForward!);
  const groupId = generateGroupId();

  emitSessionEvent(session, "log", {
    message: `Walk-forward: ${windows.length} windows (${request.walkForward!.trainMonths}m train, ${request.walkForward!.testMonths}m test)`,
    level: "info",
  });

  for (const window of windows) {
    if (session.finished) break; // User stopped

    const windowModelId = appendWindowIndex(resolved.modelId, window.index);

    emitSessionEvent(session, "walk-forward-window-start", {
      window: window.index,
      totalWindows: windows.length,
      trainRange: { start: window.trainStart, end: window.trainEnd },
      testRange: { start: window.testStart, end: window.testEnd },
    });

    // Create a per-window config with date range
    const windowConfig: ResolvedTrainingConfig = {
      ...resolved,
      modelId: windowModelId,
      dateRange: { start: window.trainStart, end: window.testEnd },
    };

    // Persist walk-forward window session
    const dbSession = await trainingStorage.createTrainingSession({
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

    // Run training for this window (blocks until complete)
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

**Step 3: Commit**

```bash
git add src/shared/trainingTypes.ts src/server/training/orchestrator.ts
git commit -m "feat(training): Walk-forward validation with N-window sequential orchestration"
```

---

### Milestone 1H: Visualization Registry Config

---

### Task 15: Create visualizations.json

**Files:**
- Create: `src/config/visualizations.json`

**Step 1: Create the file**

Use the exact JSON from the design doc (section 1.8). This is the full registry mapping model categories → visualization components.

**Step 2: Add API endpoint to serve visualization config**

In `src/server/routes/training.ts`, add:

```typescript
import path from "path";
import fs from "fs";

router.get("/visualizations/:category", (req, res) => {
  const configPath = path.join(process.cwd(), "src/config/visualizations.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  const { category } = req.params;

  // Find group matching this category/subcategory
  const universal = config.universal || [];
  let group = null;

  for (const [groupName, groupDef] of Object.entries(config.groups)) {
    const def = groupDef as any;
    if (def.subcategories?.includes(category) || groupName === category) {
      group = { name: groupName, ...def };
      break;
    }
  }

  if (!group) {
    return res.json({ universal, components: [], conditional: {} });
  }

  res.json({
    universal,
    components: group.components || [],
    conditional: group.conditional || {},
  });
});

router.get("/visualizations", (req, res) => {
  const configPath = path.join(process.cwd(), "src/config/visualizations.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  res.json(config);
});
```

**Step 3: Commit**

```bash
git add src/config/visualizations.json src/server/routes/training.ts
git commit -m "feat(config): Add visualizations.json registry and API endpoint"
```

---

### Task 16: Create useVisualizationRegistry hook

**Files:**
- Create: `src/client/src/hooks/useVisualizationRegistry.ts`

**Step 1: Create the hook**

```typescript
/**
 * useVisualizationRegistry — Resolve visualization components for a model category.
 *
 * Reads config/visualizations.json via API, returns the list of component IDs
 * that should be rendered for the given model's category + subcategory.
 */

import { useQuery } from "@tanstack/react-query";

interface VisualizationConfig {
  universal: string[];
  components: string[];
  conditional: Record<string, string[]>;
}

export function useVisualizationRegistry(subcategory: string | null, modelId?: string) {
  return useQuery<VisualizationConfig>({
    queryKey: ["visualizations", subcategory],
    queryFn: async () => {
      if (!subcategory) return { universal: [], components: [], conditional: {} };
      const res = await fetch(`/api/training/visualizations/${subcategory}`);
      if (!res.ok) throw new Error("Failed to load visualization config");
      return res.json();
    },
    enabled: !!subcategory,
    staleTime: Infinity, // Config doesn't change during session
  });
}

/** Resolve all component IDs for a model */
export function resolveComponents(
  config: VisualizationConfig | undefined,
  modelId?: string,
): string[] {
  if (!config) return [];

  const components = [...config.universal, ...config.components];

  // Add conditional components if modelId matches
  if (modelId && config.conditional) {
    for (const [trigger, extraComponents] of Object.entries(config.conditional)) {
      if (modelId.includes(trigger)) {
        components.push(...extraComponents);
      }
    }
  }

  return components;
}
```

**Step 2: Commit**

```bash
git add src/client/src/hooks/useVisualizationRegistry.ts
git commit -m "feat(hooks): Add useVisualizationRegistry for config-driven component resolution"
```

---

## Phase 1 Checkpoint

At this point, Phase 1 is complete:
- Schema evolved with session persistence, training_metrics, evaluation_results
- Training storage CRUD module
- Versioned model IDs (timestamped)
- Rich signal contract (Python signals.py integrated into save.py)
- Evaluation stages 1-2 in Python
- Walk-forward orchestration with N-window sequential dispatch
- Visualization registry (config/visualizations.json + API + hook)

**Run verification:**

```bash
npm run check    # TypeScript should compile
npx drizzle-kit push  # Schema should push cleanly
```

**Commit checkpoint:**

```bash
git add -A
git commit -m "milestone: Phase 1 complete — data foundation, signals, evaluation, walk-forward"
```

---

## Phase 2 — Visualization Components

### Architecture Note

Each visualization component follows this pattern:
1. **Props interface**: `{ sessionId: number; data?: SomeDataType }`
2. **Data hook**: fetches from API if not passed via props
3. **Pure render**: Recharts/D3/R3F visual
4. **Loading/empty states**: Skeleton or "No data" message
5. **Export from barrel**: `components/training/{group}/index.ts`

Components are lazy-loaded by the VisualizationRouter.

---

### Task 17: Create VisualizationRouter

**Files:**
- Create: `src/client/src/components/training/VisualizationRouter.tsx`

This component reads the visualization registry and renders the appropriate components via lazy loading.

**Step 1: Create the file**

```tsx
/**
 * VisualizationRouter — Reads visualization registry, renders components for model category.
 *
 * OCP: Adding a new visualization = add to visualizations.json + create component.
 * No changes to this router needed.
 */

import { lazy, Suspense, type ComponentType } from "react";
import { useVisualizationRegistry, resolveComponents } from "@/hooks/useVisualizationRegistry";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy-loaded component registry — maps component ID → React component
const COMPONENT_MAP: Record<string, () => Promise<{ default: ComponentType<any> }>> = {
  // Universal
  "convergence-panel": () => import("./universal/ConvergencePanel"),
  "feature-correlation-matrix": () => import("./universal/FeatureCorrelationMatrix"),
  "train-test-split-timeline": () => import("./universal/TrainTestSplitTimeline"),
  "walk-forward-windows": () => import("./universal/WalkForwardWindows"),
  "confidence-calibration": () => import("./universal/ConfidenceCalibration"),
  "data-quality-panel": () => import("./universal/DataQualityPanel"),
  "resource-usage": () => import("./universal/ResourceUsage"),

  // Clustering
  "regime-timeline": () => import("./clustering/RegimeTimeline"),
  "transition-sankey": () => import("./clustering/TransitionSankey"),
  "cluster-scatter": () => import("./clustering/ClusterScatter"),
  "posterior-heatmap": () => import("./clustering/PosteriorHeatmap"),
  "cluster-profile-cards": () => import("./clustering/ClusterProfileCards"),
  "silhouette-plot": () => import("./clustering/SilhouettePlot"),
  "elbow-bic-curve": () => import("./clustering/ElbowBicCurve"),
  "dendrogram": () => import("./clustering/Dendrogram"),
  "som-grid": () => import("./clustering/SomGrid"),

  // Dimensionality Reduction
  "scatter-2d-3d": () => import("./dimreduction/Scatter2D3D"),
  "explained-variance-bar": () => import("./dimreduction/ExplainedVarianceBar"),
  "component-loadings-heatmap": () => import("./dimreduction/ComponentLoadingsHeatmap"),
  "reconstruction-error-plot": () => import("./dimreduction/ReconstructionErrorPlot"),
  "biplot": () => import("./dimreduction/Biplot"),

  // Anomaly Detection
  "anomaly-timeline": () => import("./anomaly/AnomalyTimeline"),
  "score-distribution": () => import("./anomaly/ScoreDistribution"),
  "decision-boundary": () => import("./anomaly/DecisionBoundary"),
  "feature-contribution-breakdown": () => import("./anomaly/FeatureContributionBreakdown"),
  "anomaly-cluster-view": () => import("./anomaly/AnomalyClusterView"),

  // Classification
  "confusion-matrix-heatmap": () => import("./classification/ConfusionMatrixHeatmap"),
  "roc-curve": () => import("./classification/RocCurve"),
  "precision-recall-curve": () => import("./classification/PrecisionRecallCurve"),
  "feature-importance-bar": () => import("./classification/FeatureImportanceBar"),
  "shap-beeswarm": () => import("./classification/ShapBeeswarm"),
  "shap-waterfall": () => import("./classification/ShapWaterfall"),
  "calibration-plot": () => import("./classification/CalibrationPlot"),
  "prediction-timeline": () => import("./classification/PredictionTimeline"),
  "profit-curve": () => import("./classification/ProfitCurve"),
  "learning-curve": () => import("./classification/LearningCurve"),

  // Regression
  "residual-plot": () => import("./regression/ResidualPlot"),
  "prediction-vs-actual": () => import("./regression/PredictionVsActual"),
  "residual-distribution": () => import("./regression/ResidualDistribution"),
  "coefficient-bar": () => import("./regression/CoefficientBar"),
  "prediction-interval": () => import("./regression/PredictionInterval"),
  "rolling-error": () => import("./regression/RollingError"),
  "quantile-fan": () => import("./regression/QuantileFan"),
  "regularization-path": () => import("./regression/RegularizationPath"),

  // Sequence
  "forecast-ribbon": () => import("./sequence/ForecastRibbon"),
  "attention-heatmap": () => import("./sequence/AttentionHeatmap"),
  "hidden-state-timeline": () => import("./sequence/HiddenStateTimeline"),
  "layer-activation-map": () => import("./sequence/LayerActivationMap"),
  "gradcam-overlay": () => import("./sequence/GradcamOverlay"),
  "multi-horizon-error": () => import("./sequence/MultiHorizonError"),
  "sequence-embedding": () => import("./sequence/SequenceEmbedding"),

  // Ensemble / Boosting
  "boosting-loss-curve": () => import("./ensemble/BoostingLossCurve"),
  "tree-count-vs-error": () => import("./ensemble/TreeCountVsError"),
  "feature-importance-3way": () => import("./ensemble/FeatureImportance3Way"),
  "shap-dependence-plot": () => import("./ensemble/ShapDependencePlot"),
  "shap-interaction": () => import("./ensemble/ShapInteraction"),
  "individual-tree-viz": () => import("./ensemble/IndividualTreeViz"),
  "ensemble-diversity": () => import("./ensemble/EnsembleDiversity"),
  "stacking-weights": () => import("./ensemble/StackingWeights"),

  // Deep Learning
  "loss-surface-3d": () => import("./deeplearning/LossSurface3D"),
  "training-curves": () => import("./deeplearning/TrainingCurves"),
  "gradient-flow": () => import("./deeplearning/GradientFlow"),
  "activation-distribution": () => import("./deeplearning/ActivationDistribution"),
  "weight-distribution": () => import("./deeplearning/WeightDistribution"),
  "embedding-space": () => import("./deeplearning/EmbeddingSpace"),
  "reconstruction-grid": () => import("./deeplearning/ReconstructionGrid"),
  "latent-space-walk": () => import("./deeplearning/LatentSpaceWalk"),
};

interface VisualizationRouterProps {
  sessionId: number;
  subcategory: string | null;
  modelId?: string;
  diagnostics?: Record<string, unknown>;
}

export function VisualizationRouter({ sessionId, subcategory, modelId, diagnostics }: VisualizationRouterProps) {
  const { data: config, isLoading } = useVisualizationRegistry(subcategory, modelId);
  const componentIds = resolveComponents(config, modelId);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64 rounded-lg" />
        ))}
      </div>
    );
  }

  if (componentIds.length === 0) {
    return <p className="text-muted-foreground">No visualizations available for this model category.</p>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {componentIds.map((id) => {
        const loader = COMPONENT_MAP[id];
        if (!loader) {
          return (
            <div key={id} className="border rounded-lg p-4 text-muted-foreground">
              Component "{id}" not yet implemented
            </div>
          );
        }

        const LazyComponent = lazy(loader);

        return (
          <Suspense key={id} fallback={<Skeleton className="h-64 rounded-lg" />}>
            <LazyComponent sessionId={sessionId} diagnostics={diagnostics} />
          </Suspense>
        );
      })}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/client/src/components/training/VisualizationRouter.tsx
git commit -m "feat(ui): Add VisualizationRouter with lazy-loaded component registry"
```

---

### Task 18: Create useTrainingMetrics and useEvaluationResults hooks

**Files:**
- Create: `src/client/src/hooks/useTrainingMetrics.ts`
- Create: `src/client/src/hooks/useEvaluationResults.ts`

**Step 1: Create useTrainingMetrics**

```typescript
import { useQuery } from "@tanstack/react-query";

interface TrainingMetricRow {
  iteration: number;
  metricName: string;
  metricValue: number;
  timestamp: number;
}

export function useTrainingMetrics(sessionId: number | null, metricName?: string) {
  return useQuery<{ metrics: TrainingMetricRow[] }>({
    queryKey: ["trainingMetrics", sessionId, metricName],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (metricName) params.set("metricName", metricName);
      const res = await fetch(`/api/training/sessions/${sessionId}/metrics?${params}`);
      if (!res.ok) throw new Error("Failed to fetch training metrics");
      return res.json();
    },
    enabled: !!sessionId,
    refetchInterval: 5000, // Poll while training is active
  });
}

export function useTrainingMetricNames(sessionId: number | null) {
  return useQuery<{ names: string[] }>({
    queryKey: ["trainingMetricNames", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/training/sessions/${sessionId}/metrics/names`);
      if (!res.ok) throw new Error("Failed to fetch metric names");
      return res.json();
    },
    enabled: !!sessionId,
  });
}
```

**Step 2: Create useEvaluationResults**

```typescript
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
    enabled: !!sessionId,
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
    enabled: !!sessionId,
  });
}
```

**Step 3: Commit**

```bash
git add src/client/src/hooks/useTrainingMetrics.ts src/client/src/hooks/useEvaluationResults.ts
git commit -m "feat(hooks): Add useTrainingMetrics and useEvaluationResults data hooks"
```

---

### Tasks 19-26: Universal Visualization Components

Each universal component follows the same pattern. I'll detail the first one fully, then provide the implementation pattern for the rest.

---

### Task 19: Create ConvergencePanel (universal)

**Files:**
- Create: `src/client/src/components/training/universal/ConvergencePanel.tsx`

**Step 1: Create the component**

```tsx
/**
 * ConvergencePanel — Multi-series line chart of per-iteration training metrics.
 *
 * Shows: log_likelihood, n_active_states, convergence_delta, etc.
 * X-axis: iteration. Y-axis: metric value. Toggleable series.
 */

import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useTrainingMetrics, useTrainingMetricNames } from "@/hooks/useTrainingMetrics";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea",
  "#0891b2", "#e11d48", "#65a30d", "#d97706", "#7c3aed",
];

interface Props {
  sessionId: number;
}

export default function ConvergencePanel({ sessionId }: Props) {
  const { data: namesData } = useTrainingMetricNames(sessionId);
  const { data: metricsData, isLoading } = useTrainingMetrics(sessionId);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const chartData = useMemo(() => {
    if (!metricsData?.metrics) return [];

    // Pivot: group by iteration, one column per metric
    const byIter = new Map<number, Record<string, number>>();
    for (const row of metricsData.metrics) {
      if (!byIter.has(row.iteration)) {
        byIter.set(row.iteration, { iteration: row.iteration });
      }
      byIter.get(row.iteration)![row.metricName] = row.metricValue;
    }

    return Array.from(byIter.values()).sort((a, b) => a.iteration - b.iteration);
  }, [metricsData]);

  const metricNames = namesData?.names ?? [];

  const toggleSeries = (name: string) => {
    setHiddenSeries(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (isLoading) return <Card><CardContent className="h-64 animate-pulse" /></Card>;
  if (chartData.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Convergence</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="iteration" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend onClick={(e) => toggleSeries(e.value)} />
            {metricNames
              .filter(name => !hiddenSeries.has(name))
              .map((name, i) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={COLORS[i % COLORS.length]}
                  dot={false}
                  strokeWidth={1.5}
                />
              ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
```

**Step 2: Commit**

```bash
git add src/client/src/components/training/universal/ConvergencePanel.tsx
git commit -m "feat(viz): Add ConvergencePanel — multi-series convergence line chart"
```

---

### Tasks 20-25: Remaining Universal Components

Each follows the same Card + Recharts/D3 pattern. Create these files:

| Task | Component | File | Charting |
|------|-----------|------|----------|
| 20 | FeatureCorrelationMatrix | `universal/FeatureCorrelationMatrix.tsx` | D3 heatmap |
| 21 | TrainTestSplitTimeline | `universal/TrainTestSplitTimeline.tsx` | Recharts horizontal bar |
| 22 | WalkForwardWindows | `universal/WalkForwardWindows.tsx` | Recharts swimlane |
| 23 | ConfidenceCalibration | `universal/ConfidenceCalibration.tsx` | Recharts scatter + line |
| 24 | DataQualityPanel | `universal/DataQualityPanel.tsx` | Recharts bar + distribution |
| 25 | ResourceUsage | `universal/ResourceUsage.tsx` | Recharts dual-axis line |

For each:
1. Create component with standard Card layout
2. Props: `{ sessionId: number; diagnostics?: Record<string, unknown> }`
3. Fetch data from session diagnostics or metrics API
4. Render with appropriate chart type
5. Handle loading/empty states
6. Commit individually

**Commit pattern for each:**
```bash
git add src/client/src/components/training/universal/<Component>.tsx
git commit -m "feat(viz): Add <ComponentName> — <description>"
```

---

### Tasks 26-34: Clustering Visualization Components

| Task | Component | File | Charting | Data Source |
|------|-----------|------|----------|-------------|
| 26 | RegimeTimeline | `clustering/RegimeTimeline.tsx` | Recharts area + opacity | model_regimes + confidence |
| 27 | TransitionSankey | `clustering/TransitionSankey.tsx` | D3-sankey | transition matrix from diagnostics |
| 28 | ClusterScatter | `clustering/ClusterScatter.tsx` | R3F 3D scatter | PCA-projected features |
| 29 | PosteriorHeatmap | `clustering/PosteriorHeatmap.tsx` | D3 heatmap | posterior matrix |
| 30 | ClusterProfileCards | `clustering/ClusterProfileCards.tsx` | Recharts mini-charts in cards | regime_stats from diagnostics |
| 31 | SilhouettePlot | `clustering/SilhouettePlot.tsx` | D3 horizontal bars | silhouette_samples |
| 32 | ElbowBicCurve | `clustering/ElbowBicCurve.tsx` | Recharts line | multi-K results |
| 33 | Dendrogram | `clustering/Dendrogram.tsx` | D3-hierarchy tree | linkage matrix |
| 34 | SomGrid | `clustering/SomGrid.tsx` | D3 hex grid | SOM weights |

Same pattern: Card + chart + data hook + loading states. Commit each individually.

---

### Tasks 35-39: Dimensionality Reduction Components

| Task | Component | File |
|------|-----------|------|
| 35 | Scatter2D3D | `dimreduction/Scatter2D3D.tsx` |
| 36 | ExplainedVarianceBar | `dimreduction/ExplainedVarianceBar.tsx` |
| 37 | ComponentLoadingsHeatmap | `dimreduction/ComponentLoadingsHeatmap.tsx` |
| 38 | ReconstructionErrorPlot | `dimreduction/ReconstructionErrorPlot.tsx` |
| 39 | Biplot | `dimreduction/Biplot.tsx` |

---

### Tasks 40-44: Anomaly Detection Components

| Task | Component | File |
|------|-----------|------|
| 40 | AnomalyTimeline | `anomaly/AnomalyTimeline.tsx` |
| 41 | ScoreDistribution | `anomaly/ScoreDistribution.tsx` |
| 42 | DecisionBoundary | `anomaly/DecisionBoundary.tsx` |
| 43 | FeatureContributionBreakdown | `anomaly/FeatureContributionBreakdown.tsx` |
| 44 | AnomalyClusterView | `anomaly/AnomalyClusterView.tsx` |

---

### Tasks 45-54: Classification Components

| Task | Component | File |
|------|-----------|------|
| 45 | ConfusionMatrixHeatmap | `classification/ConfusionMatrixHeatmap.tsx` |
| 46 | RocCurve | `classification/RocCurve.tsx` |
| 47 | PrecisionRecallCurve | `classification/PrecisionRecallCurve.tsx` |
| 48 | FeatureImportanceBar | `classification/FeatureImportanceBar.tsx` |
| 49 | ShapBeeswarm | `classification/ShapBeeswarm.tsx` |
| 50 | ShapWaterfall | `classification/ShapWaterfall.tsx` |
| 51 | CalibrationPlot | `classification/CalibrationPlot.tsx` |
| 52 | PredictionTimeline | `classification/PredictionTimeline.tsx` |
| 53 | ProfitCurve | `classification/ProfitCurve.tsx` |
| 54 | LearningCurve | `classification/LearningCurve.tsx` |

---

### Tasks 55-62: Regression Components

| Task | Component | File |
|------|-----------|------|
| 55 | ResidualPlot | `regression/ResidualPlot.tsx` |
| 56 | PredictionVsActual | `regression/PredictionVsActual.tsx` |
| 57 | ResidualDistribution | `regression/ResidualDistribution.tsx` |
| 58 | CoefficientBar | `regression/CoefficientBar.tsx` |
| 59 | PredictionInterval | `regression/PredictionInterval.tsx` |
| 60 | RollingError | `regression/RollingError.tsx` |
| 61 | QuantileFan | `regression/QuantileFan.tsx` |
| 62 | RegularizationPath | `regression/RegularizationPath.tsx` |

---

### Tasks 63-69: Sequence Components

| Task | Component | File |
|------|-----------|------|
| 63 | ForecastRibbon | `sequence/ForecastRibbon.tsx` |
| 64 | AttentionHeatmap | `sequence/AttentionHeatmap.tsx` |
| 65 | HiddenStateTimeline | `sequence/HiddenStateTimeline.tsx` |
| 66 | LayerActivationMap | `sequence/LayerActivationMap.tsx` |
| 67 | GradcamOverlay | `sequence/GradcamOverlay.tsx` |
| 68 | MultiHorizonError | `sequence/MultiHorizonError.tsx` |
| 69 | SequenceEmbedding | `sequence/SequenceEmbedding.tsx` |

---

### Tasks 70-77: Ensemble / Boosting Components

| Task | Component | File |
|------|-----------|------|
| 70 | BoostingLossCurve | `ensemble/BoostingLossCurve.tsx` |
| 71 | TreeCountVsError | `ensemble/TreeCountVsError.tsx` |
| 72 | FeatureImportance3Way | `ensemble/FeatureImportance3Way.tsx` |
| 73 | ShapDependencePlot | `ensemble/ShapDependencePlot.tsx` |
| 74 | ShapInteraction | `ensemble/ShapInteraction.tsx` |
| 75 | IndividualTreeViz | `ensemble/IndividualTreeViz.tsx` |
| 76 | EnsembleDiversity | `ensemble/EnsembleDiversity.tsx` |
| 77 | StackingWeights | `ensemble/StackingWeights.tsx` |

---

### Tasks 78-85: Deep Learning Components

| Task | Component | File |
|------|-----------|------|
| 78 | LossSurface3D | `deeplearning/LossSurface3D.tsx` |
| 79 | TrainingCurves | `deeplearning/TrainingCurves.tsx` |
| 80 | GradientFlow | `deeplearning/GradientFlow.tsx` |
| 81 | ActivationDistribution | `deeplearning/ActivationDistribution.tsx` |
| 82 | WeightDistribution | `deeplearning/WeightDistribution.tsx` |
| 83 | EmbeddingSpace | `deeplearning/EmbeddingSpace.tsx` |
| 84 | ReconstructionGrid | `deeplearning/ReconstructionGrid.tsx` |
| 85 | LatentSpaceWalk | `deeplearning/LatentSpaceWalk.tsx` |

---

### Phase 2 Checkpoint

```bash
npm run check     # TypeScript compiles
npm run build     # Production build succeeds
git add -A
git commit -m "milestone: Phase 2 complete — 60+ visualization components across 8 model categories"
```

---

## Phase 3 — Evaluation Depth + Polish

### Task 86: Server-side evaluation stages 3-5

**Files:**
- Create: `src/server/training/evaluation.ts`

Implement:
- Stage 3: OOS validation (query QuestDB model_regimes for test-split rows)
- Stage 4: Regime-conditioned performance (compute Sharpe per regime from QuestDB)
- Stage 5: Benchmarking (compare vs buy & hold, SMA crossover)

Run after Python training completes, triggered from pythonRunner close handler.

**Step 1: Create evaluation.ts with all 3 stages**
**Step 2: Integrate into pythonRunner close handler (call after finalizeSession)**
**Step 3: Commit**

---

### Task 87: Evaluation grade computation and persistence

**Files:**
- Modify: `src/server/training/evaluation.ts`
- Modify: `src/server/storage/trainingStorage.ts`

Compute composite A-F grade from all 5 stages, persist to `trainingSessions.evaluationGrade`.

---

### Task 88: Walk-forward comparison view

**Files:**
- Create: `src/client/src/hooks/useWalkForward.ts`
- Create: `src/client/src/components/training/universal/WalkForwardComparison.tsx`

Overlaid regime assignments across all windows. Shows where the model agrees/disagrees with itself.

---

### Task 89: Model degradation tracking

**Files:**
- Modify: `src/server/storage/trainingStorage.ts` (add historical query)
- Create: `src/client/src/components/training/universal/ModelDegradation.tsx`

Compare quality scores across training sessions for same symbol/timeframe. Sparkline per model.

---

### Task 90: Interactive drill-down wiring

**Files:**
- Modify: `src/client/src/components/training/VisualizationRouter.tsx`

Add click handlers:
- Click regime on chart → expand to ClusterProfileCard
- Click feature on profile → SHAP waterfall
- Click WF window → load that window's evaluation

---

### Phase 3 Checkpoint

```bash
npm run check
npm run build
npm test
git add -A
git commit -m "milestone: Phase 3 complete — evaluation stages 3-5, drill-down, degradation tracking"
```

---

## Verification Checklist

After all phases:

1. **Schema**: `npx drizzle-kit push` — no errors
2. **Types**: `npm run check` — compiles (ignoring pre-existing errors)
3. **Build**: `npm run build` — succeeds
4. **Tests**: `npm test` — passes
5. **Dev server**: `npm run dev` — starts without errors
6. **Training flow**: Click "Train" on dashboard → see versioned model ID in console → session persisted to SQLite → metrics streaming → evaluation grades shown
7. **Walk-forward**: Set date range + walk-forward config → see N sequential windows → summary event
8. **Visualization**: Training results show correct components for model category
9. **Signal contract**: Query QuestDB `model_regimes` → see confidence, entropy, transition_prob columns
10. **Evaluation**: Check `evaluation_results` table → see Stage 1-2 test results with pass/fail
