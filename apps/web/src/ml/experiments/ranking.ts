/**
 * Leaderboard ranking for experiments.
 *
 * Pure functions, no React. The headline metric is cost-adjusted Sharpe —
 * `summary.sharpe`, which the fold-metric aliases populate from
 * `sharpe_after_costs`. Ranking on a gross Sharpe would reward strategies that
 * trade themselves to death, so there is deliberately no fallback to a
 * pre-cost figure: an experiment that did not report one is unranked, not
 * optimistically ranked.
 */

import type { ExperimentRecord } from "../MLStudioContext";

export interface RankedExperiment {
  experiment: ExperimentRecord;
  /** 1-based position. */
  rank: number;
  /** Cost-adjusted Sharpe, the value ranked on. */
  score: number;
  /** Per-fold Sharpe series, oldest fold first, for the sparkline. */
  curve: number[];
  /**
   * Cross-fold standard deviation of Sharpe relative to its mean. High values
   * mean the headline number is carried by one or two lucky folds.
   */
  fragility: number | null;
  /** True when the result looks fold-dependent enough to distrust. */
  isFragile: boolean;
}

/**
 * Fragility threshold: cross-fold dispersion at or above this fraction of the
 * mean means the folds disagree about as much as they agree.
 *
 * Not a hard reject — a fragile result is still shown and still ranked. It is
 * flagged so a headline Sharpe of 2.1 that is really "3.9, 0.2, 2.2" cannot be
 * read as a stable 2.1.
 */
export const FRAGILITY_THRESHOLD = 0.5;

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Per-fold Sharpe series, fold order preserved. */
export function sharpeCurve(experiment: ExperimentRecord): number[] {
  return [...experiment.foldMetrics]
    .sort((a, b) => a.fold - b.fold)
    .map((f) => f.sharpe)
    .filter(finite);
}

/**
 * Dispersion relative to mean magnitude, or null when it cannot be computed.
 *
 * Uses |mean| in the denominator so a strategy with a mean Sharpe near zero
 * does not produce an explosive ratio, and a negative mean is treated by
 * magnitude rather than flipping the sign.
 */
export function fragility(experiment: ExperimentRecord): number | null {
  const dispersion = experiment.summary?.foldDispersion;
  const mean = experiment.summary?.sharpe;
  if (!finite(dispersion) || !finite(mean)) return null;
  if (Math.abs(mean) < 1e-9) return null;
  return dispersion / Math.abs(mean);
}

/**
 * Rank completed experiments by cost-adjusted Sharpe, descending.
 *
 * Only `done` experiments are eligible: a running experiment's partial folds
 * would rank it against completed ones on a different amount of evidence, and
 * a failed one has no result to rank.
 *
 * Ties break toward the more trustworthy result, in order:
 *   1. lower fragility — consistent across folds beats lucky in one
 *   2. more folds — more evidence for the same number
 *   3. earlier completion — stable ordering, so equal rows do not shuffle
 */
export function rankExperiments(experiments: ExperimentRecord[]): RankedExperiment[] {
  const eligible = experiments.filter(
    (e) => e.status === "done" && finite(e.summary?.sharpe),
  );

  const scored = eligible.map((experiment) => {
    const frag = fragility(experiment);
    return {
      experiment,
      score: experiment.summary!.sharpe as number,
      curve: sharpeCurve(experiment),
      fragility: frag,
      isFragile: frag !== null && frag >= FRAGILITY_THRESHOLD,
      rank: 0,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    // An unknown fragility must not win a tie against a known-good one, so
    // null sorts last rather than being treated as zero.
    const af = a.fragility ?? Number.POSITIVE_INFINITY;
    const bf = b.fragility ?? Number.POSITIVE_INFINITY;
    if (af !== bf) return af - bf;

    if (b.curve.length !== a.curve.length) return b.curve.length - a.curve.length;

    const at = Date.parse(a.experiment.completedAt ?? "") || 0;
    const bt = Date.parse(b.experiment.completedAt ?? "") || 0;
    return at - bt;
  });

  return scored.map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/**
 * Rank movement since a previous ranking.
 *
 * Positive means "moved up the board". Returns null for an experiment that was
 * not previously ranked — a new entrant has not moved, and rendering it as a
 * large jump would overstate what happened.
 */
export function rankDelta(
  current: RankedExperiment[],
  previous: Map<string, number>,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const entry of current) {
    const before = previous.get(entry.experiment.id);
    out.set(entry.experiment.id, before === undefined ? null : before - entry.rank);
  }
  return out;
}

/** Snapshot of id → rank, for feeding the next `rankDelta` call. */
export function rankSnapshot(ranked: RankedExperiment[]): Map<string, number> {
  return new Map(ranked.map((r) => [r.experiment.id, r.rank]));
}
