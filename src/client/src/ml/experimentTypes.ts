/**
 * Experiment ledger types — re-exports from MLStudioContext + helpers.
 *
 * Originally a stand-alone module so the W4.d SSE bridge could import these
 * shapes without pulling on the rest of MLStudioContext during the W4.c
 * extension. Once W4.c landed, the canonical declarations now live in
 * `MLStudioContext.tsx`; this module forwards them and adds runtime helpers
 * (fold-metric merging, summary derivation) that don't belong in the context
 * file.
 */

import type {
  ExperimentRecord,
  ExperimentStatus,
  ExperimentSummary,
  FoldMetric,
  LabelStrategy,
  ObjectiveConfig,
  Timeframe,
  WalkForwardConfig,
} from "./MLStudioContext";

export type {
  ExperimentRecord,
  ExperimentStatus,
  ExperimentSummary,
  FoldMetric,
  LabelStrategy,
  ObjectiveConfig,
  Timeframe,
  WalkForwardConfig,
};

// Helpers

/**
 * Construct an empty FoldMetric stub for a given fold index. Used by the
 * SSE bridge when the first per-fold metric arrives for a fold that hasn't
 * been recorded yet.
 */
export function emptyFoldMetric(foldIdx: number): FoldMetric {
  return {
    fold: foldIdx,
    sharpe: null,
    profitFactor: null,
    ece: null,
    trainLoss: null,
    valLoss: null,
    trades: null,
  };
}

/**
 * Map a metric name like "fold_2_sharpe" to a fold index + canonical
 * FoldMetric field, or null if the name doesn't match the per-fold pattern.
 *
 * Recognised aliases per section 5.1 of the plan:
 *   sharpe / sharpe_ratio / sharpe_after_costs -> sharpe
 *   pf / profit_factor                          -> profitFactor
 *   ece / calibration_ece                       -> ece
 *   train_loss / loss_train                     -> trainLoss
 *   val_loss / loss_val / valid_loss            -> valLoss
 *   trades / n_trades / num_trades              -> trades
 */
const FOLD_METRIC_ALIASES: Record<string, keyof FoldMetric> = {
  sharpe: "sharpe",
  sharpe_ratio: "sharpe",
  sharpe_after_costs: "sharpe",
  pf: "profitFactor",
  profit_factor: "profitFactor",
  ece: "ece",
  calibration_ece: "ece",
  train_loss: "trainLoss",
  loss_train: "trainLoss",
  val_loss: "valLoss",
  loss_val: "valLoss",
  valid_loss: "valLoss",
  trades: "trades",
  n_trades: "trades",
  num_trades: "trades",
};

const FOLD_KEY_RE = /^fold[_-](\d+)[_-](.+)$/;

export interface ParsedFoldMetric {
  foldIdx: number;
  field: keyof FoldMetric;
}

export function parseFoldMetricKey(key: string): ParsedFoldMetric | null {
  const m = FOLD_KEY_RE.exec(key);
  if (!m) return null;
  const foldIdx = Number(m[1]);
  if (!Number.isFinite(foldIdx) || foldIdx < 0) return null;
  const tail = m[2]!.toLowerCase();
  const field = FOLD_METRIC_ALIASES[tail];
  if (!field || field === "fold") return null;
  return { foldIdx, field };
}

/**
 * Merge a single metric value into the foldMetrics[] array (immutable).
 * Creates a new fold entry if one doesn't exist for the fold index.
 */
export function mergeFoldMetric(
  current: FoldMetric[],
  foldIdx: number,
  field: keyof FoldMetric,
  value: number,
): FoldMetric[] {
  if (field === "fold") return current;
  const idx = current.findIndex((f) => f.fold === foldIdx);
  if (idx === -1) {
    const stub = { ...emptyFoldMetric(foldIdx), [field]: value };
    return [...current, stub].sort((a, b) => a.fold - b.fold);
  }
  const existing = current[idx]!;
  const next = { ...existing, [field]: value };
  const out = current.slice();
  out[idx] = next;
  return out;
}

/**
 * Replace (or append) a fold's metrics with a structured dict from a
 * `fold_complete` event. Aliases are resolved the same way as
 * `parseFoldMetricKey`.
 */
export function applyFoldComplete(
  current: FoldMetric[],
  foldIdx: number,
  metrics: Record<string, number>,
): FoldMetric[] {
  let out = current;
  if (!out.some((f) => f.fold === foldIdx)) {
    out = [...out, emptyFoldMetric(foldIdx)].sort((a, b) => a.fold - b.fold);
  }
  for (const [rawKey, value] of Object.entries(metrics)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const tail = rawKey.toLowerCase();
    const field = FOLD_METRIC_ALIASES[tail];
    if (!field || field === "fold") continue;
    out = mergeFoldMetric(out, foldIdx, field, value);
  }
  return out;
}

/**
 * Derive an ExperimentSummary from completed fold metrics. Non-null values
 * are means across folds; isStarred defaults false (the reducer flips it
 * via the auto-star rule defined in section 2.3 of the plan).
 */
export function deriveSummaryFromFolds(
  folds: FoldMetric[],
): ExperimentSummary {
  const meanField = (field: keyof FoldMetric): number | null => {
    if (field === "fold") return null;
    const vals = folds
      .map((f) => f[field])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const sharpeVals = folds
    .map((f) => f.sharpe)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const dispersion =
    sharpeVals.length > 1
      ? Math.sqrt(
          sharpeVals.reduce((acc, v) => {
            const mean =
              sharpeVals.reduce((a, b) => a + b, 0) / sharpeVals.length;
            return acc + (v - mean) ** 2;
          }, 0) /
            (sharpeVals.length - 1),
        )
      : null;
  return {
    sharpe: meanField("sharpe"),
    profitFactor: meanField("profitFactor"),
    winRate: null,
    maxDrawdown: null,
    ece: meanField("ece"),
    meanTradePnl: null,
    foldDispersion: dispersion,
    isStarred: false,
  };
}
