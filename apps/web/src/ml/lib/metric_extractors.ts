/**
 * Metric extraction — Converts raw diagnostics JSON into normalized MetricValue records.
 *
 * SRP: Pure extraction logic. No rendering, no fetching.
 * OCP: New metric extractor = add entry to EXTRACTORS map. No other files change.
 * DIP: Consumers depend on MetricSnapshot interface, never touch raw diagnostics shape.
 */

import type { Diagnostics } from "@/ml/components/regime-analytics/types";

// ── Normalized metric value (what the UI renders) ────────────────────────────

export interface MetricValue {
  id: string;
  value: number | string | null;
  passed?: boolean;
  pValue?: number | null;
  details?: Record<string, unknown>;
}

export interface MetricSnapshot {
  modelId: string;
  modelLabel: string;  // e.g., "MNQ 30m"
  category: string;    // metrics key (e.g., "clustering")
  timestamp: string;   // trained_at
  qualityScore: number;
  grade: string;
  universal: MetricValue[];
  categoryMetrics: MetricValue[];
}

// ── Extraction helpers ───────────────────────────────────────────────────────

function safeGet(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ── Universal metric extractors ──────────────────────────────────────────────

export function extractUniversalMetrics(d: Diagnostics): MetricValue[] {
  const wf = d.walk_forward;
  const oos = d.out_of_sample;
  const evalData = d.evaluation;

  // Convergence ratio: how flattened is the LL curve in the last 20%?
  let convergenceRatio: number | null = null;
  if (d.convergence_summary) {
    // We approximate from quality_score weight — actual ratio lives in Python quality.py
    convergenceRatio = null; // Will be shown as N/A; actual value requires convergence data
  }

  // Generalization gap: |train_switch_rate - test_switch_rate| / train_switch_rate
  let genGap: number | null = null;
  if (oos) {
    const trainSR = oos.train_switch_rate ?? 0;
    const testSR = oos.test_switch_rate ?? 0;
    genGap = trainSR > 0 ? Math.abs(trainSR - testSR) / trainSR : null;
  }

  return [
    { id: 'quality_score', value: d.quality_score ?? null },
    { id: 'evaluation_grade', value: evalData?.grade ?? null },
    { id: 'convergence_ratio', value: convergenceRatio },
    { id: 'generalization_gap', value: genGap != null ? Math.round(genGap * 1000) / 1000 : null },
    { id: 'stability_score', value: wf?.stability_score ?? null },
    { id: 'training_time_sec', value: d.training_time_sec ?? null },
  ];
}

// ── Clustering metric extractors ──────────────────────────────────────────────

function extractClusteringMetrics(d: Diagnostics): MetricValue[] {
  const e = d.evaluation;
  const s1 = e?.stage1 ?? {};
  const s2 = e?.stage2 ?? {};
  const s3 = e?.stage3 ?? {};
  const s4 = e?.stage4 ?? {};
  const s5 = e?.stage5 ?? {};
  const oos = d.out_of_sample;

  const val = (stage: Record<string, unknown>, key: string): MetricValue => {
    const test = stage[key] as Record<string, unknown> | undefined;
    if (!test) return { id: key, value: null };
    return {
      id: key,
      value: (test.value as number | null) ?? null,
      passed: test.passed as boolean | undefined,
      pValue: (test.p_value as number | null) ?? null,
      details: test.details as Record<string, unknown> | undefined,
    };
  };

  return [
    // cluster_quality
    val(s1, 'silhouette_score'),
    val(s1, 'calinski_harabasz'),
    val(s1, 'davies_bouldin'),
    { id: 'n_regimes', value: d.n_regimes ?? null },
    val(s1, 'min_duration'),
    // cluster_separation
    val(s1, 'return_separation'),
    val(s1, 'volatility_separation'),
    // cluster_significance
    { id: 'permutation_p', value: numOrNull(safeGet(s2, 'permutation_test.p_value')), passed: safeGet(s2, 'permutation_test.passed') as boolean | undefined },
    { id: 'bootstrap_ci_low', value: numOrNull(safeGet(s2, 'bootstrap_ci.details.ci_low')), passed: safeGet(s2, 'bootstrap_ci.passed') as boolean | undefined },
    // cluster_oos
    { id: 'oos_distribution_similarity', value: oos?.distribution_similarity ?? null },
    val(s3, 'oos_confidence_calibration'),
    val(s3, 'oos_return_separation'),
    val(s3, 'regime_distribution_drift'),
    // cluster_trading
    val(s4, 'regime_sharpe'),
    val(s4, 'long_bull_short_bear'),
    val(s5, 'vs_buy_and_hold'),
    val(s5, 'vs_sma_crossover'),
    val(s5, 'regime_information_ratio'),
  ];
}

// ── Category extractor registry (OCP) ────────────────────────────────────────

type MetricExtractor = (d: Diagnostics) => MetricValue[];

const CATEGORY_EXTRACTORS: Record<string, MetricExtractor> = {
  clustering: extractClusteringMetrics,
  // Future categories — each gets its own extractor when training is implemented
  classification: () => [],
  regression: () => [],
  'ensemble-boosting': () => [],
  'dimensionality-reduction': () => [],
  'anomaly-detection': () => [],
  sequence: () => [],
  'reinforcement-learning': () => [],
  probabilistic: extractClusteringMetrics,
  generative: () => [],
  statistical: () => [],
};

/** Build a full metric snapshot for one model */
export function buildMetricSnapshot(
  modelId: string,
  modelLabel: string,
  category: string,
  diagnostics: Diagnostics,
): MetricSnapshot {
  const universal = extractUniversalMetrics(diagnostics);
  const extractor = CATEGORY_EXTRACTORS[category] ?? (() => []);
  const categoryMetrics = extractor(diagnostics);

  return {
    modelId,
    modelLabel,
    category,
    timestamp: diagnostics.trained_at ?? '',
    qualityScore: diagnostics.quality_score ?? 0,
    grade: diagnostics.evaluation?.grade ?? '--',
    universal,
    categoryMetrics,
  };
}
