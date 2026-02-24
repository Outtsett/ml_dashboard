/**
 * Unified Normalization
 *
 * Shared normalization logic for both training and inference.
 * Training computes and returns stats; inference applies saved training stats.
 *
 * Think of it as: During training you measure the "ruler" (mean/std).
 * During inference you use that SAME ruler — you don't re-measure,
 * because the model was trained with those exact measurements.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface NormalizationStats {
  means: number[];
  stds: number[];
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Identify feature indices that are naturally bounded [0,1] and shouldn't be z-scored.
 * These include RSI, stochastic, Williams %R, Bollinger %B, shadow percentages,
 * and cyclical time features.
 */
export function getBoundedFeatureIndices(featureNames: string[]): Set<number> {
  const bounded = new Set<number>();
  featureNames.forEach((name, idx) => {
    if (
      name.startsWith('rsi_') ||
      name === 'stoch_k' || name === 'stoch_d' ||
      name === 'williams_r' ||
      name === 'bb_pct_b' ||
      name === 'upper_shadow_pct' || name === 'lower_shadow_pct' || name === 'body_pct' ||
      name.endsWith('_sin') || name.endsWith('_cos')
    ) {
      bounded.add(idx);
    }
  });
  return bounded;
}

// ============================================================================
// NORMALIZATION FUNCTIONS
// ============================================================================

/**
 * Z-score normalize feature data, computing and returning stats.
 * Used during TRAINING — you need the stats to save alongside the model.
 *
 * Bounded features (RSI, stochastic, etc.) are left as-is.
 * Z-scores are clipped to [-5, 5] to prevent extreme values.
 */
export function zScoreNormalize(data: number[][], featureNames: string[]): {
  normalized: number[][];
  stats: NormalizationStats;
} {
  if (data.length === 0) return { normalized: data, stats: { means: [], stds: [] } };

  const numFeatures = data[0]!.length;
  const means: number[] = new Array(numFeatures).fill(0);
  const stds: number[] = new Array(numFeatures).fill(0);
  const boundedFeatures = getBoundedFeatureIndices(featureNames);

  // Compute means
  for (const row of data) {
    for (let j = 0; j < numFeatures; j++) {
      means[j]! += row[j]!;
    }
  }
  for (let j = 0; j < numFeatures; j++) {
    means[j]! /= data.length;
  }

  // Compute stds
  for (const row of data) {
    for (let j = 0; j < numFeatures; j++) {
      stds[j]! += (row[j]! - means[j]!) ** 2;
    }
  }
  for (let j = 0; j < numFeatures; j++) {
    stds[j] = Math.sqrt(stds[j]! / data.length);
  }

  // Normalize
  const normalized = data.map(row =>
    row.map((val, j) => {
      if (boundedFeatures.has(j)) {
        return val; // Already bounded — keep as-is
      }
      if (stds[j]! < 1e-10) return 0;
      const z = (val - means[j]!) / stds[j]!;
      return Math.max(-5, Math.min(5, z));
    })
  );

  return { normalized, stats: { means, stds } };
}

/**
 * Normalize features using optional pre-computed stats (from training).
 * Used during INFERENCE — applies the same ruler as training.
 *
 * If no stats are provided, computes local stats (less ideal but still works).
 * This is the "flexible" version that handles both cases.
 */
export function normalizeFeatures(
  data: number[][],
  featureNames: string[],
  stats?: NormalizationStats,
): number[][] {
  if (data.length === 0) return data;
  const numFeatures = data[0]!.length;
  const boundedFeatures = getBoundedFeatureIndices(featureNames);

  if (stats) {
    // Use training stats for normalization (ensures consistency)
    return data.map(row =>
      row.map((val, j) => {
        if (boundedFeatures.has(j)) return val;
        if (!stats.stds[j] || stats.stds[j]! < 1e-10) return 0;
        const z = (val - stats.means[j]!) / stats.stds[j]!;
        return Math.max(-5, Math.min(5, z));
      })
    );
  }

  // No training stats — compute local stats (fallback)
  const means = new Array(numFeatures).fill(0);
  const stds = new Array(numFeatures).fill(0);

  for (const row of data) {
    for (let j = 0; j < numFeatures; j++) means[j]! += row[j]!;
  }
  for (let j = 0; j < numFeatures; j++) means[j]! /= data.length;

  for (const row of data) {
    for (let j = 0; j < numFeatures; j++) stds[j]! += (row[j]! - means[j]!) ** 2;
  }
  for (let j = 0; j < numFeatures; j++) stds[j] = Math.sqrt(stds[j]! / data.length);

  return data.map(row =>
    row.map((val, j) => {
      if (boundedFeatures.has(j)) return val;
      if (stds[j]! < 1e-10) return 0;
      const z = (val - means[j]!) / stds[j]!;
      return Math.max(-5, Math.min(5, z));
    })
  );
}
