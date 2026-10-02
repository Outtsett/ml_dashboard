/**
 * Promotion Gate Evaluator (W7.c)
 *
 * SRP: pure evaluator. Reads gate definitions from `promotion_gates`, fetches
 *      each metric value from its source-specific store, applies comparator,
 *      returns aggregated pass/fail with per-gate detail. Caller (registry
 *      route) handles HTTP, audit logging, and the override path.
 *
 * Inputs come from heterogenous sources per backend plan §5:
 *   sharpe_after_costs           backtest_runs.sharpeRatio (most-recent matched run)
 *   ece                          diagnostics.json @ model_versions.diagnostics_path
 *   fold_dispersion              std() of diagnostics.json per_fold_metrics[].sharpe
 *   bootstrap_pvalue_vs_baseline runBootstrap() LRU cache (W6.b cached result)
 *   paper_pnl_14d                deployments.paper_pnl WHERE mode='paper' AND age<=14d
 *   prediction_drift             null until W9 (gate seeded enforced=0)
 *
 * A null measured value with `enforced=true` blocks promotion. With
 * `enforced=false` (the W7-seeded prediction_drift gate), the gate is reported
 * but does not block.
 */

import fs from 'fs';
import path from 'path';
import { and, eq, desc, gte } from 'drizzle-orm';
import { db } from '../database/db';
import {
  modelVersions,
  promotionGates,
  backtestRuns,
  deployments,
  type ModelVersionStatus,
  type PromotionGate,
} from '@shared/schema';

export type GateMetric =
  | 'sharpe_after_costs'
  | 'ece'
  | 'fold_dispersion'
  | 'bootstrap_pvalue_vs_baseline'
  | 'paper_pnl_14d'
  | 'prediction_drift';

export interface GateResult {
  gate: PromotionGate;
  measuredValue: number | null;
  passed: boolean;
  reason?: string;
}

export interface GateEvaluation {
  allowed: boolean;
  results: GateResult[];
}

// ─── Comparator ──────────────────────────────────────────────────────────────

function compare(value: number, op: PromotionGate['comparator'], threshold: number): boolean {
  switch (op) {
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '>':  return value > threshold;
    case '<':  return value < threshold;
    case '==': return value === threshold;
    case '!=': return value !== threshold;
  }
}

// ─── Diagnostics file loader ────────────────────────────────────────────────

interface DiagnosticsFile {
  ece?: number;
  per_fold_metrics?: Array<{ sharpe?: number; [k: string]: unknown }>;
  [k: string]: unknown;
}

function resolveDiagnosticsPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function loadDiagnostics(diagnosticsPath: string): DiagnosticsFile | null {
  try {
    const abs = resolveDiagnosticsPath(diagnosticsPath);
    if (!fs.existsSync(abs)) return null;
    const raw = fs.readFileSync(abs, 'utf-8');
    return JSON.parse(raw) as DiagnosticsFile;
  } catch {
    return null;
  }
}

// ─── Per-metric fetchers ────────────────────────────────────────────────────

interface MetricFetchContext {
  versionId: number;
  catalogId: string;
  symbol: string;
  timeframe: string;
  diagnosticsPath: string;
}

interface MetricFetchResult {
  value: number | null;
  reason?: string;
}

async function fetchSharpeAfterCosts(ctx: MetricFetchContext): Promise<MetricFetchResult> {
  const rows = db
    .select({ sharpe: backtestRuns.sharpeRatio })
    .from(backtestRuns)
    .where(and(eq(backtestRuns.symbol, ctx.symbol), eq(backtestRuns.timeframe, ctx.timeframe)))
    .orderBy(desc(backtestRuns.createdAt))
    .limit(1)
    .all();
  const sharpe = rows[0]?.sharpe;
  if (sharpe == null || !Number.isFinite(sharpe)) {
    return { value: null, reason: 'no completed backtest_runs row for this symbol/timeframe' };
  }
  return { value: sharpe };
}

function fetchEce(ctx: MetricFetchContext): MetricFetchResult {
  const diag = loadDiagnostics(ctx.diagnosticsPath);
  if (!diag) {
    return { value: null, reason: `diagnostics.json missing or unreadable at ${ctx.diagnosticsPath}` };
  }
  if (typeof diag.ece !== 'number' || !Number.isFinite(diag.ece)) {
    return { value: null, reason: 'diagnostics.json has no `ece` field' };
  }
  return { value: diag.ece };
}

function fetchFoldDispersion(ctx: MetricFetchContext): MetricFetchResult {
  const diag = loadDiagnostics(ctx.diagnosticsPath);
  if (!diag) {
    return { value: null, reason: `diagnostics.json missing or unreadable at ${ctx.diagnosticsPath}` };
  }
  const folds = diag.per_fold_metrics;
  if (!Array.isArray(folds) || folds.length < 2) {
    return { value: null, reason: 'per_fold_metrics needs at least 2 folds for std()' };
  }
  const sharpes = folds
    .map((f) => (typeof f?.sharpe === 'number' ? f.sharpe : NaN))
    .filter((v) => Number.isFinite(v));
  if (sharpes.length < 2) {
    return { value: null, reason: 'per_fold_metrics has fewer than 2 finite sharpe values' };
  }
  const mean = sharpes.reduce((a, b) => a + b, 0) / sharpes.length;
  const variance = sharpes.reduce((a, b) => a + (b - mean) ** 2, 0) / sharpes.length; // population
  return { value: Math.sqrt(variance) };
}

async function fetchBootstrapPvalue(_ctx: MetricFetchContext): Promise<MetricFetchResult> {
  // Plan §5: surfaces the cached p-value from W6.b runBootstrap LRU. The cache
  // is keyed by content-hash of (series + params) which the gate evaluator does
  // not have access to here. Rather than recompute (which would block on Python
  // spawn + 10k resamples), we surface a typed "not yet computed" reason — the
  // frontend prompts the user to run /api/eval/block-bootstrap first, which
  // populates the cache for the subsequent gate eval.
  return {
    value: null,
    reason: 'bootstrap not yet computed; run /api/eval/block-bootstrap first',
  };
}

function fetchPaperPnl14d(ctx: MetricFetchContext): MetricFetchResult {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .select({ pnl: deployments.paperPnl })
    .from(deployments)
    .where(and(
      eq(deployments.versionId, ctx.versionId),
      eq(deployments.mode, 'paper'),
      gte(deployments.startedAt, cutoff),
    ))
    .all();
  if (rows.length === 0) {
    return { value: null, reason: 'no paper deployments started within last 14 days' };
  }
  const total = rows.reduce((acc, r) => acc + (r.pnl ?? 0), 0);
  return { value: total };
}

function fetchPredictionDrift(_ctx: MetricFetchContext): MetricFetchResult {
  return { value: null, reason: 'W9 not shipped — prediction_drift unavailable' };
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

async function fetchMetric(metric: string, ctx: MetricFetchContext): Promise<MetricFetchResult> {
  switch (metric as GateMetric) {
    case 'sharpe_after_costs':           return fetchSharpeAfterCosts(ctx);
    case 'ece':                          return fetchEce(ctx);
    case 'fold_dispersion':              return fetchFoldDispersion(ctx);
    case 'bootstrap_pvalue_vs_baseline': return fetchBootstrapPvalue(ctx);
    case 'paper_pnl_14d':                return fetchPaperPnl14d(ctx);
    case 'prediction_drift':             return fetchPredictionDrift(ctx);
    default:
      return { value: null, reason: `unknown gate metric: ${metric}` };
  }
}

// ─── Public entry ───────────────────────────────────────────────────────────

/**
 * Evaluate every promotion gate for the (fromStatus → toStatus) transition.
 *
 * Pass semantics:
 *   - `enforced=true` + null measurement → fail (block promotion)
 *   - `enforced=true` + measurement      → compare to threshold
 *   - `enforced=false`                   → always pass (informational only)
 *
 * `allowed` is true only when EVERY enforced gate passes.
 */
export async function evaluateGates(
  versionId: number,
  toStatus: ModelVersionStatus,
): Promise<GateEvaluation> {
  // Load the version row (need symbol/timeframe/diagnosticsPath + current status)
  const [version] = db
    .select({
      versionId: modelVersions.versionId,
      catalogId: modelVersions.catalogId,
      status: modelVersions.status,
      symbol: modelVersions.symbol,
      timeframe: modelVersions.timeframe,
      diagnosticsPath: modelVersions.diagnosticsPath,
    })
    .from(modelVersions)
    .where(eq(modelVersions.versionId, versionId))
    .all();

  if (!version) {
    throw new Error(`model version ${versionId} not found`);
  }

  const fromStatus = version.status;

  const gates = db
    .select()
    .from(promotionGates)
    .where(and(
      eq(promotionGates.fromStatus, fromStatus),
      eq(promotionGates.toStatus, toStatus),
    ))
    .all();

  const ctx: MetricFetchContext = {
    versionId: version.versionId,
    catalogId: version.catalogId,
    symbol: version.symbol,
    timeframe: version.timeframe,
    diagnosticsPath: version.diagnosticsPath,
  };

  const results: GateResult[] = [];
  for (const gate of gates) {
    const fetched = await fetchMetric(gate.metric, ctx);
    let passed: boolean;
    let reason: string | undefined = fetched.reason;

    if (!gate.enforced) {
      passed = true;
      reason = reason ?? 'gate not enforced (informational only)';
    } else if (fetched.value === null) {
      passed = false;
    } else {
      passed = compare(fetched.value, gate.comparator, gate.threshold);
      reason = passed ? undefined : `${fetched.value} ${gate.comparator} ${gate.threshold} failed`;
    }

    results.push({ gate, measuredValue: fetched.value, passed, reason });
  }

  const allowed = results.every((r) => r.passed);
  return { allowed, results };
}
