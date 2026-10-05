/**
 * Training Storage — SQLite CRUD for training sessions, metrics, and evaluations.
 *
 * DIP: Routes and orchestrator call these functions — never query the DB directly.
 * SRP: Only concern is read/write of training-related tables.
 * ISP: Each function accepts a narrow param object — callers only provide what they need.
 */

import { eq, desc, and, sql } from "drizzle-orm";
import { db as sqliteDb } from "../database/sqlite";
import {
  trainingSessions,
  trainingMetrics,
  evaluationResults,
  modelStateSnapshots,
  lossHistory,
  runMetrics,
  runs,
  type InsertTrainingMetric,
  type InsertEvaluationResult,
  type InsertRunMetric,
  type InsertLossHistory,
} from "@shared/schema";
import { getEventBus } from "../events/event-bus";
import type { DomainEvent } from "@shared/event-types";
import { log } from "../lib/log";

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
  /** The persisted label set the run trains on — the set's `consumed` rung. */
  labelSetId?: number;
}) {
  return sqliteDb.insert(trainingSessions).values({
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
      labelSetId: data.labelSetId ?? null,
      status: "running",
    }).returning().then(res => res[0]);
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
  sqliteDb.update(trainingSessions)
    .set({ ...data, updatedAt: sql`datetime('now')` })
    .where(eq(trainingSessions.id, id))
    .execute();
}

/** Store the process PID for recovery/cleanup. */
export function updateSessionPid(id: number, pid: number) {
  sqliteDb.update(trainingSessions)
    .set({ pid, updatedAt: sql`datetime('now')` })
    .where(eq(trainingSessions.id, id))
    .execute();
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
  sqliteDb.update(trainingSessions)
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
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(trainingSessions.id, id))
    .execute();
}

/** Get a single session by id. */
export function getSession(id: number) {
  return sqliteDb.select().from(trainingSessions).where(eq(trainingSessions.id, id)).then(res => res[0]);
}

/** Get a session by versioned model ID. */
export function getSessionByVersionedId(versionedModelId: string) {
  return sqliteDb.select().from(trainingSessions)
      .where(eq(trainingSessions.versionedModelId, versionedModelId)).then(res => res[0]);
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

  let query = sqliteDb.select().from(trainingSessions).orderBy(desc(trainingSessions.startedAt));

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  if (opts?.limit) {
    query = query.limit(opts.limit) as typeof query;
  }

  return query;
}

/** Get all sessions in a walk-forward group, ordered by window index. */
export function getWalkForwardGroup(groupId: string) {
  return sqliteDb.select().from(trainingSessions)
      .where(eq(trainingSessions.walkForwardGroupId, groupId))
      .orderBy(trainingSessions.windowIndex);
}

/** Get quality score history for a symbol+modelType combo (for degradation tracking). */
export function getQualityHistory(symbol: string, modelType: string) {
  return sqliteDb.select({
      id: trainingSessions.id,
      versionedModelId: trainingSessions.versionedModelId,
      qualityScore: trainingSessions.qualityScore,
      evaluationGrade: trainingSessions.evaluationGrade,
      startedAt: trainingSessions.startedAt,
      elapsedSec: trainingSessions.elapsedSec,
    })
    .from(trainingSessions)
    .where(and(
      eq(trainingSessions.symbol, symbol),
      eq(trainingSessions.modelType, modelType),
      eq(trainingSessions.status, "completed"),
    ))
    .orderBy(trainingSessions.startedAt);
}

/** Mark any "running" sessions as "failed" — call on server startup to clean up orphans. */
export async function markOrphanedSessionsFailed(): number {
  // Find PIDs of orphaned sessions to kill them (production-like resilience)
  const orphans = await sqliteDb.select({ id: trainingSessions.id, pid: trainingSessions.pid })
      .from(trainingSessions)
      .where(eq(trainingSessions.status, "running"));

  for (const orphan of orphans) {
    if (orphan.pid) {
      try {
        // Best effort kill — prevent zombie python processes from eating GPU/RAM
        process.kill(orphan.pid, "SIGTERM");
      } catch {
        // Already dead or permission denied
      }
    }
  }

  const result = sqliteDb.update(trainingSessions)
    .set({
      status: "failed",
      errorMessage: "Server restarted during training",
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(trainingSessions.status, "running"))
    .execute();
  return result.changes;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

/** Insert a single metric row. */
export function insertMetric(data: InsertTrainingMetric) {
  sqliteDb.insert(trainingMetrics).values(data).execute();
}

/** Insert a batch of metric rows (one per metric name per iteration). */
export function insertMetricsBatch(data: InsertTrainingMetric[]) {
  if (data.length === 0) return;
  sqliteDb.insert(trainingMetrics).values(data).execute();
}

/** Get metrics for a session, optionally filtered by metric name. */
export function getMetrics(sessionId: number, metricName?: string) {
  const conditions = [eq(trainingMetrics.sessionId, sessionId)];
  if (metricName) conditions.push(eq(trainingMetrics.metricName, metricName));

  return sqliteDb.select().from(trainingMetrics)
      .where(and(...conditions))
      .orderBy(trainingMetrics.iteration);
}

/** Get distinct metric names for a session (for convergence chart series selection). */
export async function getMetricNames(sessionId: number): string[] {
  const rows = await sqliteDb.selectDistinct({ metricName: trainingMetrics.metricName })
      .from(trainingMetrics)
      .where(eq(trainingMetrics.sessionId, sessionId));
  return rows.map(r => r.metricName);
}

// ─── Evaluation Results ──────────────────────────────────────────────────────

/** Insert a single evaluation test result. */
export function insertEvaluation(data: InsertEvaluationResult) {
  sqliteDb.insert(evaluationResults).values(data).execute();
}

/** Insert a batch of evaluation results (e.g., all Stage 1 tests at once). */
export function insertEvaluationsBatch(data: InsertEvaluationResult[]) {
  if (data.length === 0) return;
  sqliteDb.insert(evaluationResults).values(data).execute();
}

/** Get evaluation results for a session, optionally filtered by stage. */
export function getEvaluations(sessionId: number, stage?: string) {
  const conditions = [eq(evaluationResults.sessionId, sessionId)];
  if (stage) conditions.push(eq(evaluationResults.stage, stage));

  return sqliteDb.select().from(evaluationResults)
      .where(and(...conditions))
      .orderBy(evaluationResults.stage, evaluationResults.testName);
}

/** Get per-stage pass/fail summary for a session. */
export function getEvaluationSummary(sessionId: number) {
  return sqliteDb.select({
      stage: evaluationResults.stage,
      totalTests: sql<number>`count(*)`,
      passedTests: sql<number>`sum(case when ${evaluationResults.testPassed} = 1 then 1 else 0 end)`,
      failedTests: sql<number>`sum(case when ${evaluationResults.testPassed} = 0 then 1 else 0 end)`,
    })
    .from(evaluationResults)
    .where(eq(evaluationResults.sessionId, sessionId))
    .groupBy(evaluationResults.stage);
}

// ─── Model State Snapshots ────────────────────────────────────────────────────

/** Insert a single model state snapshot (full model state at a given iteration). */
export function insertModelStateSnapshot(data: {
  sessionId: number;
  iteration: number;
  snapshot: string;
}) {
  sqliteDb.insert(modelStateSnapshots).values(data).execute();
}

/** Get model state snapshots for a session, ordered by iteration descending. */
export function getModelStateSnapshots(sessionId: number, limit?: number) {
  let query = sqliteDb.select().from(modelStateSnapshots)
    .where(eq(modelStateSnapshots.sessionId, sessionId))
    .orderBy(desc(modelStateSnapshots.iteration));

  if (limit) {
    query = query.limit(limit) as typeof query;
  }

  return query;
}

/** Get a specific model state snapshot by session + iteration. */
export function getModelStateSnapshot(sessionId: number, iteration: number) {
  return sqliteDb.select().from(modelStateSnapshots)
      .where(and(
        eq(modelStateSnapshots.sessionId, sessionId),
        eq(modelStateSnapshots.iteration, iteration),
      )).then(res => res[0]);
}

/** Get the latest (highest iteration) model state snapshot for a session. */
export function getLatestModelStateSnapshot(sessionId: number) {
  return sqliteDb.select().from(modelStateSnapshots)
      .where(eq(modelStateSnapshots.sessionId, sessionId))
      .orderBy(desc(modelStateSnapshots.iteration))
      .limit(1).then(res => res[0]);
}

// ─── Loss History ─────────────────────────────────────────────────────────────

/** Insert a batch of loss-history rows (epoch, loss, valLoss) for the 3D surface. */
export function insertLossHistoryBatch(rows: InsertLossHistory[]) {
  if (rows.length === 0) return;
  sqliteDb.insert(lossHistory).values(rows).execute();
}

// ─── Run Metrics (durable, provenance-keyed per-iteration metrics) ───────────

/** Insert a batch of `run_metrics` rows. Chunked so the SQLite variable cap is never hit. */
export function insertRunMetricsBatch(rows: InsertRunMetric[]) {
  if (rows.length === 0) return;
  const CHUNK = 150; // 11 bound columns x 150 = 1650 variables, well under 32766
  for (let i = 0; i < rows.length; i += CHUNK) {
    sqliteDb.insert(runMetrics).values(rows.slice(i, i + CHUNK)).execute();
  }
}

/** All metric rows for a run, ordered by iteration then insertion order. */
export function getRunMetrics(runId: string, metricName?: string) {
  const conditions = [eq(runMetrics.runId, runId)];
  if (metricName) conditions.push(eq(runMetrics.metricName, metricName));
  return sqliteDb.select().from(runMetrics)
      .where(and(...conditions))
      .orderBy(runMetrics.iteration, runMetrics.id);
}

/** Row count for a run — the cheap "did anything land?" probe. */
export async function countRunMetrics(runId: string): number {
  const row = (await sqliteDb.select({ n: sql<number>`count(*)` })
      .from(runMetrics).where(eq(runMetrics.runId, runId)))[0];
  return row?.n ?? 0;
}

/** Latest provenance identity for a legacy model id, for events that carry none. */
export function getLatestRunForModelId(legacyModelId: string) {
  return sqliteDb.select({
      runId: runs.runId,
      experimentId: runs.experimentId,
      trialIdx: runs.trialIdx,
      foldIdx: runs.foldIdx,
    })
    .from(runs)
    .where(eq(runs.legacyModelId, legacyModelId))
    .orderBy(desc(runs.startedAt))
    .limit(1).then(res => res[0]);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Durable training-metric recorder
//
// Why here and not in the parser: `emitSessionEvent` already publishes every
// parsed training event onto the domain event bus. Subscribing to that bus is
// the one place that sees ALL events from ALL runners and parsers without any
// runner or parser knowing that persistence exists.
//
// What lands where:
//   run_metrics        — one row per (metric name, iteration), provenance-keyed
//   training_metrics   — the same numbers keyed by training_sessions.id, so the
//                        pre-existing GET /training/sessions/:id/metrics route
//                        keeps answering
//   loss_history       — one row per epoch that reported BOTH loss and val_loss
//                        (both columns are NOT NULL)
//   training_sessions  — current_epoch / current_loss / current_val_loss /
//                        total_bars / total_features, so a page reload shows
//                        real numbers instead of 0/None
//
// Writes are buffered and flushed on a timer or at a row threshold, and every
// flush is wrapped: a DB error is logged and the buffer dropped, never thrown
// back into the stdout handler that is driving the training stream.
// ═════════════════════════════════════════════════════════════════════════════

/** Flush when this many rows are buffered for one model. */
const METRIC_FLUSH_ROWS = 100;
/** Flush at most this often while a run is streaming (milliseconds). */
const METRIC_FLUSH_INTERVAL_MS = 750;

interface SessionProgressDelta {
  currentEpoch?: number;
  currentLoss?: number;
  currentValLoss?: number;
  totalBars?: number;
  totalFeatures?: number;
}

interface RecorderState {
  modelId: string;
  /** null = not resolved yet; -1 = resolved absent, stop retrying. */
  dbSessionId: number | null;
  runId: string | null;
  experimentId: string | null;
  runMetricRows: InsertRunMetric[];
  legacyMetricRows: InsertTrainingMetric[];
  lossRows: InsertLossHistory[];
  progress: SessionProgressDelta;
  progressDirty: boolean;
  timer: NodeJS.Timeout | null;
}

const recorderStates = new Map<string, RecorderState>();
let recorderSubscribed = false;

function getRecorderState(modelId: string): RecorderState {
  let state = recorderStates.get(modelId);
  if (!state) {
    state = {
      modelId,
      dbSessionId: null,
      runId: null,
      experimentId: null,
      runMetricRows: [],
      legacyMetricRows: [],
      lossRows: [],
      progress: {},
      progressDirty: false,
      timer: null,
    };
    recorderStates.set(modelId, state);
  }
  return state;
}

/** Resolve (and cache) the training_sessions row id for a versioned model id. */
function resolveDbSessionId(state: RecorderState): number | null {
  if (state.dbSessionId !== null) {
    return state.dbSessionId === -1 ? null : state.dbSessionId;
  }
  try {
    const row = getSessionByVersionedId(state.modelId);
    if (!row) return null; // session row may not be committed yet — retry next event
    state.dbSessionId = row.id;
    return row.id;
  } catch {
    return null;
  }
}

/** Resolve (and cache) run/experiment identity, from the event or the runs table. */
function resolveRunIdentity(state: RecorderState, data: Record<string, unknown>) {
  const eventRunId = typeof data.run_id === "string" ? data.run_id : null;
  const eventExperimentId = typeof data.experiment_id === "string" ? data.experiment_id : null;
  if (eventRunId) state.runId = eventRunId;
  if (eventExperimentId) state.experimentId = eventExperimentId;
  if (state.runId && state.experimentId) return;
  try {
    const row = getLatestRunForModelId(state.modelId);
    if (row) {
      state.runId = state.runId ?? row.runId;
      state.experimentId = state.experimentId ?? row.experimentId;
    }
  } catch {
    // Provenance is observability — its absence must not stop metric capture.
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toIntOrNull(value: unknown): number | null {
  const n = toNumber(value);
  return n === null ? null : Math.trunc(n);
}

const LOSS_NAMES = new Set(["loss", "train_loss", "training_loss"]);
const VAL_LOSS_NAMES = new Set(["val_loss", "valid_loss", "validation_loss", "val_log_loss"]);

/**
 * Loss names as the runners actually spell them.
 *
 * The literal sets above matched nothing the wired runners emit. xgb_classifier
 * builds its keys as `${split}_${metric}` (main.py:217), so a run reports
 * `train_logloss` / `val_logloss` — no underscore before "loss" — and the
 * `loss_history` insert gate below could never be satisfied. That is why the
 * table held 0 rows after three completed runs while 26 terminal metrics landed
 * in run_metrics.
 */
const TRAIN_LOSS_PATTERN = /^(?:train|training)_(?:log)?loss$/;
const VALIDATION_LOSS_PATTERN = /^(?:val|valid|validation)_(?:log)?loss$/;

/**
 * Envelope and control keys that are not measurements.
 *
 * Needed because an epoch_metric payload carries its numbers FLAT beside these
 * rather than nested under `metrics`, so the flat fallback has to know what to
 * skip. Keep in sync with protocol.py::_envelope.
 */
const NON_METRIC_KEYS = new Set([
  "type", "v", "kind", "ts", "mono_ns", "seq", "run_id", "experiment_id",
  "catalog_id", "trial_idx", "fold_idx", "config_hash", "manifest_hash",
  "data", "message", "level", "phase", "iteration", "total", "epoch", "fold",
  "trial", "split", "name", "unit",
]);

/** Numeric measurements on an event, from `metrics` or flat beside the envelope. */
function collectMetricEntries(data: Record<string, unknown>): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  const nested = data.metrics;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    for (const [name, raw] of Object.entries(nested as Record<string, unknown>)) {
      const value = toNumber(raw);
      if (value !== null) out.push([name, value]);
    }
    if (out.length > 0) return out;
  }
  for (const [name, raw] of Object.entries(data)) {
    if (NON_METRIC_KEYS.has(name)) continue;
    const value = toNumber(raw);
    if (value !== null) out.push([name, value]);
  }
  return out;
}

/** True when this metric name means the training loss for the epoch. */
function isTrainLossName(lower: string): boolean {
  return LOSS_NAMES.has(lower) || TRAIN_LOSS_PATTERN.test(lower);
}

/** True when this metric name means the validation loss for the epoch. */
function isValidationLossName(lower: string): boolean {
  return VAL_LOSS_NAMES.has(lower) || VALIDATION_LOSS_PATTERN.test(lower);
}

/** Keys that mean "how many bars / features did this run actually use". */
const BAR_COUNT_KEYS = new Set([
  "bars_loaded", "total_bars", "totalbars", "n_bars", "nbars", "n_rows", "bar_count",
]);
const FEATURE_COUNT_KEYS = new Set([
  "total_features", "totalfeatures", "n_features", "nfeatures", "feature_count",
]);

/**
 * Depth-limited search for a bar/feature count anywhere in a nested payload.
 * `config` and `done`'s `diagnostics` are free-form, so the count is found by
 * name rather than by a path that only one runner happens to use.
 */
function harvestCounts(value: unknown, into: SessionProgressDelta, depth = 0): void {
  if (depth > 4 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (into.totalBars === undefined && BAR_COUNT_KEYS.has(lower)) {
      const n = toIntOrNull(child);
      if (n !== null && n > 0) into.totalBars = n;
      continue;
    }
    if (into.totalFeatures === undefined && FEATURE_COUNT_KEYS.has(lower)) {
      const n = toIntOrNull(child);
      if (n !== null && n > 0) into.totalFeatures = n;
      continue;
    }
    harvestCounts(child, into, depth + 1);
  }
}

/**
 * Final metrics from a `done` payload's diagnostics.
 *
 * Runners that report only at the end (xgb_classifier is one — it emits
 * `progress` and `log` while training, and every number in
 * `diagnostics.metrics`) would otherwise leave no metric row at all. The two
 * shapes seen in the repo are `{name: 3.4}` and the declared form
 * `{name: {value: 3.4, renderer: "gauge", ...}}`.
 */
function harvestFinalMetrics(diagnostics: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return out;
  const metrics = (diagnostics as Record<string, unknown>).metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return out;
  for (const [name, entry] of Object.entries(metrics as Record<string, unknown>)) {
    let value = toNumber(entry);
    if (value === null && entry && typeof entry === "object" && !Array.isArray(entry)) {
      value = toNumber((entry as Record<string, unknown>).value);
    }
    if (value !== null) out[name] = value;
  }
  return out;
}

function bufferedRowCount(state: RecorderState): number {
  return state.runMetricRows.length + state.legacyMetricRows.length + state.lossRows.length;
}

function scheduleFlush(state: RecorderState): void {
  if (bufferedRowCount(state) >= METRIC_FLUSH_ROWS) {
    flushRecorderState(state);
    return;
  }
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    flushRecorderState(state);
  }, METRIC_FLUSH_INTERVAL_MS);
  state.timer.unref?.();
}

/** Write everything buffered for one model. Never throws. */
function flushRecorderState(state: RecorderState): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  const runRows = state.runMetricRows;
  const legacyRows = state.legacyMetricRows;
  const lossRows = state.lossRows;
  const progress = state.progress;
  const progressDirty = state.progressDirty;
  state.runMetricRows = [];
  state.legacyMetricRows = [];
  state.lossRows = [];
  state.progress = {};
  state.progressDirty = false;

  try {
    if (runRows.length) insertRunMetricsBatch(runRows);
  } catch (err) {
    log(`run_metrics insert failed for ${state.modelId}: ${(err as Error).message}`, "training");
  }
  try {
    if (legacyRows.length) insertMetricsBatch(legacyRows);
  } catch (err) {
    log(`training_metrics insert failed for ${state.modelId}: ${(err as Error).message}`, "training");
  }
  try {
    if (lossRows.length) insertLossHistoryBatch(lossRows);
  } catch (err) {
    log(`loss_history insert failed for ${state.modelId}: ${(err as Error).message}`, "training");
  }
  try {
    const dbSessionId = resolveDbSessionId(state);
    if (progressDirty && dbSessionId !== null && Object.keys(progress).length > 0) {
      updateSessionProgress(dbSessionId, progress);
    }
  } catch (err) {
    log(`training_sessions progress update failed for ${state.modelId}: ${(err as Error).message}`, "training");
  }
}

/** Queue one metric value for both the provenance table and the legacy table. */
function recordMetricValue(
  state: RecorderState,
  name: string,
  value: number,
  opts: {
    iteration: number | null;
    total: number | null;
    foldIdx: number | null;
    trialIdx: number | null;
    seq: number | null;
    ts: string | null;
  },
): void {
  if (state.runId && state.experimentId) {
    state.runMetricRows.push({
      runId: state.runId,
      experimentId: state.experimentId,
      trialIdx: opts.trialIdx,
      foldIdx: opts.foldIdx,
      metricName: name,
      metricValue: value,
      iteration: opts.iteration,
      total: opts.total,
      seq: opts.seq,
      ts: opts.ts,
    });
  }
  const dbSessionId = resolveDbSessionId(state);
  if (dbSessionId !== null) {
    state.legacyMetricRows.push({
      sessionId: dbSessionId,
      iteration: opts.iteration ?? 0,
      metricName: name,
      metricValue: value,
    });
  }
  const lower = name.toLowerCase();
  if (isTrainLossName(lower)) {
    state.progress.currentLoss = value;
    state.progressDirty = true;
  } else if (isValidationLossName(lower)) {
    state.progress.currentValLoss = value;
    state.progressDirty = true;
  }
  if (opts.iteration !== null && opts.iteration > (state.progress.currentEpoch ?? -1)) {
    state.progress.currentEpoch = opts.iteration;
    state.progressDirty = true;
  }
}

/**
 * Persist one parsed training event. Exported so a unit test can feed
 * synthetic events straight through the write path without a live runner.
 */
export function recordTrainingEvent(
  modelId: string,
  type: string,
  data: Record<string, unknown>,
): void {
  if (!modelId) return;
  const state = getRecorderState(modelId);

  try {
    resolveRunIdentity(state, data);

    const envelopeSeq = toIntOrNull(data.seq);
    const envelopeTs = typeof data.ts === "string" ? data.ts : null;
    const envelopeTrial = toIntOrNull(data.trial_idx);
    const envelopeFold = toIntOrNull(data.fold_idx);

    switch (type) {
      case "started": {
        resolveDbSessionId(state);
        break;
      }

      case "progress": {
        const iteration = toIntOrNull(data.iteration);
        if (iteration !== null && iteration > (state.progress.currentEpoch ?? -1)) {
          state.progress.currentEpoch = iteration;
          state.progressDirty = true;
        }
        break;
      }

      case "metric": {
        const name = typeof data.name === "string" ? data.name : null;
        const value = toNumber(data.value);
        if (name && value !== null) {
          recordMetricValue(state, name, value, {
            iteration: toIntOrNull(data.iteration),
            total: toIntOrNull(data.total),
            foldIdx: envelopeFold,
            trialIdx: envelopeTrial,
            seq: envelopeSeq,
            ts: envelopeTs,
          });
        }
        break;
      }

      case "epoch_metric": {
        const iteration = toIntOrNull(data.epoch) ?? toIntOrNull(data.iteration);
        const total = toIntOrNull(data.total);
        const foldIdx = toIntOrNull(data.fold) ?? envelopeFold;
        let epochLoss: number | null = null;
        let epochValLoss: number | null = null;
        for (const [name, value] of collectMetricEntries(data)) {
          recordMetricValue(state, name, value, {
            iteration, total, foldIdx, trialIdx: envelopeTrial, seq: envelopeSeq, ts: envelopeTs,
          });
          const lower = name.toLowerCase();
          if (isTrainLossName(lower)) epochLoss = value;
          else if (isValidationLossName(lower)) epochValLoss = value;
        }
        // loss_history.loss and .val_loss are both NOT NULL — only an epoch
        // that reported both is a row that table can hold.
        const dbSessionId = resolveDbSessionId(state);
        if (dbSessionId !== null && iteration !== null && epochLoss !== null && epochValLoss !== null) {
          state.lossRows.push({
            sessionId: dbSessionId,
            epoch: iteration,
            loss: epochLoss,
            valLoss: epochValLoss,
          });
        }
        break;
      }

      case "fold_complete": {
        const foldIdx = toIntOrNull(data.fold_idx) ?? toIntOrNull(data.fold) ?? envelopeFold;
        const metrics = (data.metrics ?? {}) as Record<string, unknown>;
        for (const [name, raw] of Object.entries(metrics)) {
          const value = toNumber(raw);
          if (value === null) continue;
          recordMetricValue(state, `fold.${name}`, value, {
            iteration: foldIdx,
            total: null,
            foldIdx,
            trialIdx: envelopeTrial,
            seq: envelopeSeq,
            ts: envelopeTs,
          });
        }
        break;
      }

      case "config": {
        const found: SessionProgressDelta = {};
        harvestCounts(data.config, found);
        if (found.totalBars !== undefined) { state.progress.totalBars = found.totalBars; state.progressDirty = true; }
        if (found.totalFeatures !== undefined) { state.progress.totalFeatures = found.totalFeatures; state.progressDirty = true; }
        break;
      }

      case "done": {
        const found: SessionProgressDelta = {};
        harvestCounts(data.diagnostics, found);
        if (found.totalBars !== undefined) { state.progress.totalBars = found.totalBars; state.progressDirty = true; }
        if (found.totalFeatures !== undefined) { state.progress.totalFeatures = found.totalFeatures; state.progressDirty = true; }
        // A runner that reports only at the end still gets durable rows.
        // `iteration: null` marks them terminal rather than per-step.
        for (const [name, value] of Object.entries(harvestFinalMetrics(data.diagnostics))) {
          recordMetricValue(state, name, value, {
            iteration: null,
            total: null,
            foldIdx: envelopeFold,
            trialIdx: envelopeTrial,
            seq: envelopeSeq,
            ts: envelopeTs,
          });
        }
        flushRecorderState(state);
        recorderStates.delete(modelId);
        return;
      }

      case "error": {
        flushRecorderState(state);
        recorderStates.delete(modelId);
        return;
      }

      default:
        return;
    }

    scheduleFlush(state);
  } catch (err) {
    // A recorder fault must never propagate into the stdout handler that is
    // driving the live training stream.
    log(`training metric recorder failed on '${type}' for ${modelId}: ${(err as Error).message}`, "training");
  }
}

/**
 * Subscribe the recorder to the domain event bus. Idempotent — safe to call
 * from every module that wants to guarantee persistence is live.
 */
export function ensureTrainingMetricRecorder(): void {
  if (recorderSubscribed) return;
  recorderSubscribed = true;
  getEventBus().on("training.event", (event: DomainEvent) => {
    const payload = event.data as {
      modelId?: string;
      type?: string;
      data?: Record<string, unknown>;
    };
    recordTrainingEvent(
      payload.modelId ?? "",
      payload.type ?? "",
      payload.data ?? {},
    );
  });
  log("durable training-metric recorder attached to the event bus", "training");
}

/** Flush everything buffered — called on shutdown and by tests. */
export function flushTrainingMetricRecorder(): void {
  for (const state of Array.from(recorderStates.values())) {
    flushRecorderState(state);
  }
}


