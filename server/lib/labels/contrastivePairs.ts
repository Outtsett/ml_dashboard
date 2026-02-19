/**
 * Contrastive Pair Generation for Self-Supervised Learning
 * 
 * Generates positive/negative pairs for contrastive learning objectives.
 * Supports temporal, augmentation-based, and statistical pair mining.
 */

export interface ContrastivePairConfig {
  symbol: string;
  windowSize: number;
}

export interface TemporalPairParams {
  positiveRadius: number;
  negativeMinGap: number;
  samplesPerAnchor: number;
}

export interface AugmentationPairParams {
  jitterScale: number;
  scalingRange: [number, number];
  cropRatio: number;
}

export interface StatisticalPairParams {
  numRollingWindows: number;
  alphaLevel: number;
  correlationThreshold: number;
}

export interface ContrastivePair {
  anchorIdx: number;
  positiveIdx: number;
  negativeIdx: number;
  pairType: 'temporal' | 'augmentation' | 'statistical';
}

export interface ContrastiveWindow {
  startIdx: number;
  endIdx: number;
  data: number[];
}

// ============================================================================
// TEMPORAL CONTRASTIVE PAIRS
// ============================================================================

export function generateTemporalPairsSQL(
  params: TemporalPairParams,
  config: ContrastivePairConfig
): string {
  const { positiveRadius, negativeMinGap, samplesPerAnchor } = params;
  const { symbol, windowSize } = config;
  
  return `
WITH indexed_data AS (
  SELECT 
    timestamp,
    symbol,
    close,
    ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY timestamp) as idx
  FROM ohlcv
  WHERE symbol = '${symbol}'
),
anchor_windows AS (
  SELECT 
    idx as anchor_idx,
    timestamp as anchor_ts
  FROM indexed_data
  WHERE idx >= ${windowSize}
    AND idx <= (SELECT MAX(idx) - ${windowSize} FROM indexed_data)
),
positive_candidates AS (
  SELECT 
    a.anchor_idx,
    i.idx as candidate_idx,
    ABS(a.anchor_idx - i.idx) as distance,
    'positive' as pair_type
  FROM anchor_windows a
  CROSS JOIN indexed_data i
  WHERE i.idx != a.anchor_idx
    AND ABS(a.anchor_idx - i.idx) <= ${positiveRadius}
    AND i.idx >= ${windowSize}
    AND i.idx <= (SELECT MAX(idx) - ${windowSize} FROM indexed_data)
),
negative_candidates AS (
  SELECT 
    a.anchor_idx,
    i.idx as candidate_idx,
    ABS(a.anchor_idx - i.idx) as distance,
    'negative' as pair_type
  FROM anchor_windows a
  CROSS JOIN indexed_data i
  WHERE ABS(a.anchor_idx - i.idx) >= ${negativeMinGap}
    AND i.idx >= ${windowSize}
    AND i.idx <= (SELECT MAX(idx) - ${windowSize} FROM indexed_data)
),
sampled_positives AS (
  SELECT 
    anchor_idx,
    candidate_idx as positive_idx,
    ROW_NUMBER() OVER (PARTITION BY anchor_idx ORDER BY RANDOM()) as pos_rank
  FROM positive_candidates
),
sampled_negatives AS (
  SELECT 
    anchor_idx,
    candidate_idx as negative_idx,
    ROW_NUMBER() OVER (PARTITION BY anchor_idx ORDER BY RANDOM()) as neg_rank
  FROM negative_candidates
),
paired AS (
  SELECT 
    p.anchor_idx,
    p.positive_idx,
    n.negative_idx,
    p.pos_rank as sample_num
  FROM sampled_positives p
  INNER JOIN sampled_negatives n 
    ON p.anchor_idx = n.anchor_idx AND p.pos_rank = n.neg_rank
  WHERE p.pos_rank <= ${samplesPerAnchor}
)
SELECT 
  anchor_idx,
  positive_idx,
  negative_idx,
  'temporal' as pair_type
FROM paired
ORDER BY anchor_idx, sample_num`;
}

// ============================================================================
// STATISTICAL HYPOTHESIS PAIRS (Cross-asset or temporal)
// ============================================================================

export function generateStatisticalPairsSQL(
  params: StatisticalPairParams,
  config: ContrastivePairConfig,
  multiAsset: boolean = false
): string {
  const { numRollingWindows, correlationThreshold } = params;
  const { symbol, windowSize } = config;
  
  if (multiAsset) {
    // Cross-asset correlation-based pairs
    return `
WITH returns_data AS (
  SELECT 
    timestamp,
    symbol,
    (close - LAG(close, 1) OVER (PARTITION BY symbol ORDER BY timestamp)) / 
      LAG(close, 1) OVER (PARTITION BY symbol ORDER BY timestamp) as returns
  FROM ohlcv
  WHERE timestamp >= (SELECT MIN(timestamp) FROM ohlcv WHERE symbol = '${symbol}')
),
rolling_corr AS (
  SELECT 
    a.symbol as symbol_a,
    b.symbol as symbol_b,
    a.timestamp,
    CORR(a.returns, b.returns) OVER (
      PARTITION BY a.symbol, b.symbol 
      ORDER BY a.timestamp 
      ROWS BETWEEN ${numRollingWindows - 1} PRECEDING AND CURRENT ROW
    ) as rolling_correlation
  FROM returns_data a
  INNER JOIN returns_data b ON a.timestamp = b.timestamp AND a.symbol < b.symbol
),
correlation_stats AS (
  SELECT 
    symbol_a,
    symbol_b,
    AVG(CASE WHEN rolling_correlation >= ${correlationThreshold} THEN 1 ELSE 0 END) as high_corr_ratio,
    COUNT(*) as num_windows
  FROM rolling_corr
  WHERE rolling_correlation IS NOT NULL
  GROUP BY symbol_a, symbol_b
),
positive_pairs AS (
  SELECT symbol_a, symbol_b, 'positive' as pair_type
  FROM correlation_stats
  WHERE high_corr_ratio >= 0.6
),
negative_pairs AS (
  SELECT symbol_a, symbol_b, 'negative' as pair_type
  FROM correlation_stats
  WHERE high_corr_ratio <= 0.2
)
SELECT * FROM positive_pairs
UNION ALL
SELECT * FROM negative_pairs
ORDER BY pair_type, symbol_a, symbol_b`;
  } else {
    // Single-asset temporal correlation-based pairs
    return `
WITH indexed_data AS (
  SELECT 
    timestamp,
    close,
    (close - LAG(close, 1) OVER (ORDER BY timestamp)) / 
      LAG(close, 1) OVER (ORDER BY timestamp) as returns,
    ROW_NUMBER() OVER (ORDER BY timestamp) as idx
  FROM ohlcv
  WHERE symbol = '${symbol}'
),
window_returns AS (
  SELECT 
    idx as window_start,
    ARRAY_AGG(returns ORDER BY idx) FILTER (WHERE idx <= window_start + ${windowSize - 1}) as return_window
  FROM indexed_data
  WHERE idx <= (SELECT MAX(idx) - ${windowSize} FROM indexed_data)
  GROUP BY idx
),
pairwise_corr AS (
  SELECT 
    a.window_start as idx_a,
    b.window_start as idx_b,
    -- Approximate correlation via dot product of normalized returns
    (SELECT SUM(ra * rb) FROM UNNEST(a.return_window, b.return_window) AS t(ra, rb)) / 
      NULLIF(SQRT(
        (SELECT SUM(ra * ra) FROM UNNEST(a.return_window) AS t(ra)) * 
        (SELECT SUM(rb * rb) FROM UNNEST(b.return_window) AS t(rb))
      ), 0) as correlation
  FROM window_returns a
  CROSS JOIN window_returns b
  WHERE a.window_start < b.window_start
    AND b.window_start - a.window_start >= ${windowSize}  -- Non-overlapping
)
SELECT 
  idx_a as anchor_idx,
  idx_b as pair_idx,
  correlation,
  CASE 
    WHEN correlation >= ${correlationThreshold} THEN 'positive'
    WHEN correlation <= -${correlationThreshold} THEN 'hard_negative'
    ELSE 'negative'
  END as pair_type
FROM pairwise_corr
WHERE ABS(correlation) >= 0.1  -- Filter very low correlation pairs
ORDER BY ABS(correlation) DESC`;
  }
}

// ============================================================================
// DATA AUGMENTATION FUNCTIONS (Applied in JavaScript, not SQL)
// ============================================================================

export interface AugmentedView {
  data: number[];
  augmentationType: string;
  params: Record<string, number>;
}

export function applyJitter(
  data: number[],
  scale: number,
  seed?: number
): AugmentedView {
  // Use seeded random for reproducibility
  const random = seed !== undefined ? seededRandom(seed) : Math.random;
  const augmented = data.map(v => v + (random() - 0.5) * 2 * scale * Math.abs(v));
  return {
    data: augmented,
    augmentationType: 'jitter',
    params: { scale },
  };
}

export function applyScaling(
  data: number[],
  scalingRange: [number, number],
  seed?: number
): AugmentedView {
  const random = seed !== undefined ? seededRandom(seed) : Math.random;
  const scale = scalingRange[0] + random() * (scalingRange[1] - scalingRange[0]);
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const augmented = data.map(v => mean + (v - mean) * scale);
  return {
    data: augmented,
    augmentationType: 'scaling',
    params: { scale },
  };
}

export function applyRandomCrop(
  data: number[],
  cropRatio: number,
  seed?: number
): AugmentedView {
  const random = seed !== undefined ? seededRandom(seed) : Math.random;
  const cropLength = Math.floor(data.length * cropRatio);
  const maxStart = data.length - cropLength;
  const start = Math.floor(random() * maxStart);
  const augmented = data.slice(start, start + cropLength);
  return {
    data: augmented,
    augmentationType: 'crop',
    params: { cropRatio, start, length: cropLength },
  };
}

export function applyTimeWarping(
  data: number[],
  warpScale: number = 0.1,
  seed?: number
): AugmentedView {
  const random = seed !== undefined ? seededRandom(seed) : Math.random;
  const n = data.length;
  
  // Generate warping path
  const warpPath: number[] = [];
  let t = 0;
  while (t < n - 1) {
    warpPath.push(Math.floor(t));
    t += 1 + (random() - 0.5) * warpScale;
  }
  warpPath.push(n - 1);
  
  // Interpolate to original length
  const augmented: number[] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (warpPath.length - 1);
    const idx = Math.floor(pos);
    const frac = pos - idx;
    if (idx >= warpPath.length - 1) {
      augmented.push(data[warpPath[warpPath.length - 1]]);
    } else {
      const srcIdx1 = warpPath[idx];
      const srcIdx2 = warpPath[idx + 1];
      augmented.push(data[srcIdx1] * (1 - frac) + data[srcIdx2] * frac);
    }
  }
  
  return {
    data: augmented,
    augmentationType: 'time_warp',
    params: { warpScale },
  };
}

// Simple seeded random number generator
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ============================================================================
// PAIR GENERATION PIPELINE
// ============================================================================

export interface ContrastivePairResult {
  pairs: ContrastivePair[];
  stats: {
    numAnchors: number;
    numPositives: number;
    numNegatives: number;
    avgPositiveDistance: number;
    avgNegativeDistance: number;
  };
}

export function generateContrastivePairsFromSQL(
  rows: Array<{ anchor_idx: number; positive_idx: number; negative_idx: number; pair_type: string }>
): ContrastivePairResult {
  const pairs: ContrastivePair[] = rows.map(r => ({
    anchorIdx: r.anchor_idx,
    positiveIdx: r.positive_idx,
    negativeIdx: r.negative_idx,
    pairType: r.pair_type as 'temporal' | 'augmentation' | 'statistical',
  }));
  
  const anchors = new Set(pairs.map(p => p.anchorIdx));
  const positiveDistances = pairs.map(p => Math.abs(p.anchorIdx - p.positiveIdx));
  const negativeDistances = pairs.map(p => Math.abs(p.anchorIdx - p.negativeIdx));
  
  return {
    pairs,
    stats: {
      numAnchors: anchors.size,
      numPositives: pairs.length,
      numNegatives: pairs.length,
      avgPositiveDistance: positiveDistances.reduce((a, b) => a + b, 0) / positiveDistances.length || 0,
      avgNegativeDistance: negativeDistances.reduce((a, b) => a + b, 0) / negativeDistances.length || 0,
    },
  };
}

// ============================================================================
// AUGMENTATION-BASED PAIR GENERATION (In-memory)
// ============================================================================

export function generateAugmentationPairs(
  windows: ContrastiveWindow[],
  params: AugmentationPairParams,
  samplesPerAnchor: number = 4
): { 
  pairs: Array<{ anchor: ContrastiveWindow; positive: AugmentedView; negativeIdx: number }>;
  stats: { numPairs: number; augmentations: string[] };
} {
  const pairs: Array<{ anchor: ContrastiveWindow; positive: AugmentedView; negativeIdx: number }> = [];
  const augmentations = new Set<string>();
  
  windows.forEach((anchor, anchorIdx) => {
    for (let s = 0; s < samplesPerAnchor; s++) {
      // Create positive pair via augmentation
      const augType = s % 4;
      let positive: AugmentedView;
      
      switch (augType) {
        case 0:
          positive = applyJitter(anchor.data, params.jitterScale, anchorIdx * 1000 + s);
          break;
        case 1:
          positive = applyScaling(anchor.data, params.scalingRange, anchorIdx * 1000 + s);
          break;
        case 2:
          positive = applyRandomCrop(anchor.data, params.cropRatio, anchorIdx * 1000 + s);
          break;
        default:
          positive = applyTimeWarping(anchor.data, 0.1, anchorIdx * 1000 + s);
      }
      
      augmentations.add(positive.augmentationType);
      
      // Sample random negative (different window)
      let negativeIdx = Math.floor(Math.random() * windows.length);
      while (negativeIdx === anchorIdx) {
        negativeIdx = Math.floor(Math.random() * windows.length);
      }
      
      pairs.push({ anchor, positive, negativeIdx });
    }
  });
  
  return {
    pairs,
    stats: {
      numPairs: pairs.length,
      augmentations: Array.from(augmentations),
    },
  };
}

// ============================================================================
// EXPORT GENERATOR REGISTRY
// ============================================================================

export const CONTRASTIVE_SQL_GENERATORS = {
  temporal: generateTemporalPairsSQL,
  statistical: generateStatisticalPairsSQL,
} as const;

export type ContrastiveGeneratorType = keyof typeof CONTRASTIVE_SQL_GENERATORS;
