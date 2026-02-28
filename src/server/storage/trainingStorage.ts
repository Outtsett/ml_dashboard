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
