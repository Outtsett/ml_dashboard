/**
 * Model Checkpoints hook — fetches checkpoints with parsed performance metrics.
 *
 * SRP: Fetch + parse checkpoint diagnostics into usable form.
 * DIP: Uses checkpointApi abstraction.
 */

import { useQuery } from '@tanstack/react-query';
import { checkpointApi } from "@/infrastructure/api/api_service";
import { QUERY_KEYS } from "@/shared/utils/types";
import type { ModelCheckpoint, CheckpointPerformance } from "@/shared/utils/types";

// ── Diagnostics Parsing ─────────────────────────────────────────────────────

/**
 * Extract a numeric metric value from a self-describing diagnostics object.
 * Handles both flat values and {value, renderer, ...} MetricDeclaration shapes.
 */
function extractMetric(metrics: Record<string, unknown>, key: string): number | null {
  const entry = metrics[key];
  if (entry == null) return null;
  if (typeof entry === 'number') return entry;
  if (typeof entry === 'object' && entry !== null && 'value' in entry) {
    const v = (entry as { value: unknown }).value;
    if (typeof v === 'number') return v;
  }
  return null;
}

/** Parse diagnosticsJson into CheckpointPerformance. */
export function parsePerformance(diagnosticsJson: string | null): CheckpointPerformance {
  const empty: CheckpointPerformance = {
    profitFactor: null,
    sharpeRatio: null,
    winRate: null,
    nTrades: null,
    maxDrawdown: null,
    accuracy: null,
    valLoss: null,
    trainLoss: null,
    rocAuc: null,
    codebookUtilization: null,
  };

  if (!diagnosticsJson) return empty;

  try {
    const diag = JSON.parse(diagnosticsJson);
    // Metrics may be at top level or nested under 'metrics'
    const metrics: Record<string, unknown> = diag.metrics ?? diag;

    return {
      profitFactor: extractMetric(metrics, 'profit_factor'),
      sharpeRatio: extractMetric(metrics, 'sharpe_ratio'),
      winRate: extractMetric(metrics, 'win_rate'),
      nTrades: extractMetric(metrics, 'n_trades'),
      maxDrawdown: extractMetric(metrics, 'max_drawdown'),
      accuracy: extractMetric(metrics, 'barrier_class_accuracy')
        ?? extractMetric(metrics, 'val_barrier_class_accuracy'),
      valLoss: extractMetric(metrics, 'val_loss'),
      trainLoss: extractMetric(metrics, 'train_loss'),
      rocAuc: extractMetric(metrics, 'roc_auc'),
      codebookUtilization: extractMetric(metrics, 'codebook_utilization'),
    };
  } catch {
    return empty;
  }
}

// ── Enriched Checkpoint ─────────────────────────────────────────────────────

export interface EnrichedCheckpoint extends ModelCheckpoint {
  perf: CheckpointPerformance;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useModelCheckpoints(params?: Record<string, string>) {
  return useQuery<EnrichedCheckpoint[]>({
    queryKey: [...QUERY_KEYS.modelCheckpoints, params],
    queryFn: async () => {
      const raw = await checkpointApi.list(params) as ModelCheckpoint[];
      return raw.map((cp) => ({
        ...cp,
        perf: parsePerformance(cp.diagnosticsJson),
      }));
    },
    staleTime: 30_000,
  });
}

// ── Aggregate Stats ─────────────────────────────────────────────────────────

export interface CheckpointAggregateStats {
  totalCheckpoints: number;
  activeCheckpoints: number;
  bestProfitFactor: number | null;
  avgSharpe: number | null;
  avgWinRate: number | null;
  totalTrades: number;
}

export function computeAggregateStats(checkpoints: EnrichedCheckpoint[]): CheckpointAggregateStats {
  const active = checkpoints.filter(c => c.isActive === 1);
  const pfs = checkpoints.map(c => c.perf.profitFactor).filter((v): v is number => v != null);
  const sharpes = checkpoints.map(c => c.perf.sharpeRatio).filter((v): v is number => v != null);
  const wrs = checkpoints.map(c => c.perf.winRate).filter((v): v is number => v != null);
  const trades = checkpoints.map(c => c.perf.nTrades).filter((v): v is number => v != null);

  return {
    totalCheckpoints: checkpoints.length,
    activeCheckpoints: active.length,
    bestProfitFactor: pfs.length > 0 ? Math.max(...pfs) : null,
    avgSharpe: sharpes.length > 0 ? sharpes.reduce((a, b) => a + b, 0) / sharpes.length : null,
    avgWinRate: wrs.length > 0 ? wrs.reduce((a, b) => a + b, 0) / wrs.length : null,
    totalTrades: trades.reduce((a, b) => a + b, 0),
  };
}
