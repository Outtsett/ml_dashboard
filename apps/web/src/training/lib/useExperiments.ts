/**
 * useExperiments — TanStack Query wrapper over /api/training/sessions and
 * /api/training/sessions/:id/evaluation/summary.
 *
 * Surfaces a flat row shape suitable for the experiment ledger DenseTable.
 * Heavy fields (per-iteration metrics, evaluation rows) are intentionally
 * left out — those are fetched on row click via a separate hook.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/** Server row from /api/training/sessions — kept loose because the schema
 *  evolves and Drizzle inferSelect types aren't shared 1:1 across the boundary. */
interface SessionRowRaw {
  id: number;
  modelName: string;
  modelType: string | null;
  symbol: string | null;
  timeframe: string | null;
  versionedModelId: string | null;
  status: string;
  currentEpoch: number;
  maxEpochs: number;
  currentLoss: number | null;
  currentValLoss: number | null;
  learningRate: number;
  qualityScore: number | null;
  evaluationGrade: string | null;
  walkForwardGroupId: string | null;
  windowIndex: number | null;
  elapsedSec: number | null;
  resourcePeakMemoryMb: number | null;
  startedAt: number | string;
  updatedAt: number | string;
  errorMessage: string | null;
  hyperparameters: string | null;
  trainDateStart: number | null;
  trainDateEnd: number | null;
  testDateStart: number | null;
  testDateEnd: number | null;
}

export interface ExperimentRow {
  id: number;
  modelName: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  status: string;
  /** Best validation loss seen so far (lower is better). */
  valLoss: number | null;
  /** Final train loss. */
  trainLoss: number | null;
  qualityScore: number | null;
  grade: string | null;
  /** Heuristic headline metric — promoted from qualityScore when present, else
   *  derived from inverse val loss. The Experiments page uses this as the
   *  default sort column. Callers can swap once /api/training/sessions exposes
   *  cost_adj_sharpe directly. */
  headline: number | null;
  walkForwardGroup: string | null;
  windowIndex: number | null;
  elapsedSec: number | null;
  peakMemoryMb: number | null;
  startedAt: number;
  updatedAt: number;
  versionedModelId: string | null;
  errorMessage: string | null;
  hyperparameters: Record<string, unknown> | null;
}

function toEpochMs(v: number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseHyperparams(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function deriveHeadline(row: SessionRowRaw): number | null {
  if (row.qualityScore != null && Number.isFinite(row.qualityScore)) {
    return row.qualityScore;
  }
  // Fallback: inverse val-loss, clamped to [-10, 10] so the column stays sortable
  // when no qualityScore is recorded yet. This is a deliberate proxy, NOT a
  // replacement for cost_adj_sharpe — once /api/training/sessions exposes the
  // real metric (Phase 3 backend work), swap here.
  if (row.currentValLoss != null && Number.isFinite(row.currentValLoss) && row.currentValLoss > 0) {
    return Math.max(-10, Math.min(10, 1 / row.currentValLoss));
  }
  return null;
}

function mapRow(raw: SessionRowRaw): ExperimentRow {
  return {
    id: raw.id,
    modelName: raw.modelName ?? "",
    modelType: raw.modelType ?? "",
    symbol: raw.symbol ?? "",
    timeframe: raw.timeframe ?? "",
    status: raw.status ?? "",
    valLoss: raw.currentValLoss,
    trainLoss: raw.currentLoss,
    qualityScore: raw.qualityScore,
    grade: raw.evaluationGrade,
    headline: deriveHeadline(raw),
    walkForwardGroup: raw.walkForwardGroupId,
    windowIndex: raw.windowIndex,
    elapsedSec: raw.elapsedSec,
    peakMemoryMb: raw.resourcePeakMemoryMb,
    startedAt: toEpochMs(raw.startedAt),
    updatedAt: toEpochMs(raw.updatedAt),
    versionedModelId: raw.versionedModelId,
    errorMessage: raw.errorMessage,
    hyperparameters: parseHyperparams(raw.hyperparameters),
  };
}

export interface UseExperimentsOpts {
  /** Filter by symbol. */
  symbol?: string;
  /** Filter by modelType. */
  modelType?: string;
  /** Filter by status. */
  status?: string;
  /** Server-side limit. Default 500 (the ledger is paginated client-side
   *  beyond that). */
  limit?: number;
  /** Auto-refetch interval in ms. Default 30000 (30s) — the ledger is read-mostly. */
  refetchMs?: number;
}

export function useExperiments(opts: UseExperimentsOpts = {}) {
  const { symbol, modelType, status, limit = 500, refetchMs = 30_000 } = opts;

  const query = useQuery({
    queryKey: ["training-sessions-list", { symbol, modelType, status, limit }],
    queryFn: async (): Promise<ExperimentRow[]> => {
      const params = new URLSearchParams();
      if (symbol) params.set("symbol", symbol);
      if (modelType) params.set("modelType", modelType);
      if (status) params.set("status", status);
      params.set("limit", String(limit));
      const url = `/api/training/sessions?${params.toString()}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      const body = (await r.json()) as { sessions: SessionRowRaw[] };
      return (body.sessions ?? []).map(mapRow);
    },
    refetchInterval: refetchMs,
  });

  return query;
}

/** Derived summary stats over a set of ExperimentRow — fed into the KPI strip. */
export interface ExperimentSummary {
  total: number;
  last7d: number;
  best30dHeadline: number | null;
  meanElapsedSec: number | null;
  totalGpuHours: number | null;
}

export function useExperimentSummary(rows: ExperimentRow[] | undefined): ExperimentSummary {
  return useMemo(() => {
    if (!rows || rows.length === 0) {
      return { total: 0, last7d: 0, best30dHeadline: null, meanElapsedSec: null, totalGpuHours: null };
    }
    const now = Date.now();
    const d7 = now - 7 * 86_400_000;
    const d30 = now - 30 * 86_400_000;

    let last7d = 0;
    let bestHeadline: number | null = null;
    let elapsedSum = 0;
    let elapsedCount = 0;

    for (const r of rows) {
      if (r.startedAt >= d7) last7d += 1;
      if (r.startedAt >= d30 && r.headline != null) {
        if (bestHeadline == null || r.headline > bestHeadline) bestHeadline = r.headline;
      }
      if (r.elapsedSec != null && Number.isFinite(r.elapsedSec)) {
        elapsedSum += r.elapsedSec;
        elapsedCount += 1;
      }
    }
    const meanElapsed = elapsedCount > 0 ? elapsedSum / elapsedCount : null;
    // GPU-hours is an over-approximation: elapsed wall-clock × #runs. The
    // server doesn't yet expose accelerator utilization per session. Treat
    // this as a "time-on-task" metric, not a true GPU-hour count.
    const totalGpuHours = elapsedCount > 0 ? elapsedSum / 3600 : null;

    return {
      total: rows.length,
      last7d,
      best30dHeadline: bestHeadline,
      meanElapsedSec: meanElapsed,
      totalGpuHours,
    };
  }, [rows]);
}
