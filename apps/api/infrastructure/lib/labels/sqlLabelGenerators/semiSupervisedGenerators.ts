/**
 * Semi-supervised label generators: PseudoConfidence, ConsistencyPerturbation
 */

import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rowsBetween, rollingStd } from './helpers';

// ============================================================================
// PSEUDO CONFIDENCE LABELS (Semi-supervised)
// ============================================================================

export interface PseudoConfidenceParams {
  horizonBars?: number;
  confidenceThreshold?: number;
  teacherPredColumn?: string;
  teacherConfColumn?: string;
  classBalancing?: boolean;
}

export function generatePseudoConfidenceLabelsSQL(
  params: PseudoConfidenceParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const horizon = Math.max(1, Math.floor(Number(params.horizonBars ?? 5)));
  // The taxonomy declares the threshold as a FRACTION (0.5-0.99, default 0.9).
  // Dividing that by 100 turned the default into 0.009 and the confidence gate
  // let almost everything through. A value above 1 is read as a percentage so
  // an older caller still gets what it asked for.
  const rawThreshold = Number(params.confidenceThreshold ?? 0.9);
  const confDecimal = rawThreshold > 1 ? rawThreshold / 100 : rawThreshold;

  return `
WITH base AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    LEAD(close, ${horizon}) ${windowOver(cfg)} as future_close,
    ${rollingStd('close', 20, cfg)} as local_vol
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
with_returns AS (
  SELECT
    timestamp,
    symbol,
    close,
    (future_close - close) / NULLIF(close, 0) as future_return_fraction,
    local_vol / NULLIF(close, 0) as normalized_vol
  FROM base
  WHERE future_close IS NOT NULL
    AND local_vol IS NOT NULL
),
with_confidence AS (
  SELECT
    timestamp,
    symbol,
    close,
    future_return_fraction,
    normalized_vol,
    ABS(future_return_fraction) / NULLIF(normalized_vol + 0.001, 0) as signal_strength,
    CASE WHEN future_return_fraction > 0 THEN 1 ELSE -1 END as direction
  FROM with_returns
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    future_return_fraction,
    signal_strength,
    direction,
    CASE
      WHEN signal_strength > ${confDecimal * 3} THEN direction
      ELSE NULL  -- Low confidence, unlabeled
    END as label,
    LEAST(1.0, signal_strength / 3.0) as confidence
  FROM with_confidence
)
SELECT
  timestamp,
  symbol,
  close,
  label,
  ${horizon} as resolution_bars,
  future_return_fraction,
  confidence
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}

// ============================================================================
// CONSISTENCY PERTURBATION LABELS (Semi-supervised)
// ============================================================================

export interface ConsistencyPerturbationParams {
  perturbationType?: 'noise' | 'dropout' | 'mixup';
  perturbationStrength?: number;
  perturbationScale?: number;
  consistencyWindowBars?: number;
  numPerturbations?: number;
}

export function generateConsistencyPerturbationLabelsSQL(
  params: ConsistencyPerturbationParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  // `numPerturbations` (default 2) used to stand in for this window when it was
  // absent, which produced a 3-bar SMA and called it consistency. The window is
  // its own parameter now, declared in the taxonomy with its own default.
  const consistencyWindow = Math.max(2, Math.floor(Number(params.consistencyWindowBars ?? 20)));

  return `
WITH base AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    open, high, low, close, volume,
    ROW_NUMBER() ${windowOver(cfg)} as row_idx,
    LEAD(close, 1) ${windowOver(cfg)} as next_close,
    AVG(close) ${rowsBetween(consistencyWindow, 0, cfg)} as sma_${consistencyWindow}
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
with_features AS (
  SELECT
    timestamp,
    symbol,
    close,
    row_idx,
    next_close,
    sma_${consistencyWindow},
    (close - sma_${consistencyWindow}) / NULLIF(sma_${consistencyWindow}, 0) as deviation,
    (next_close - close) / NULLIF(close, 0) as future_return_fraction
  FROM base
  WHERE next_close IS NOT NULL
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    row_idx,
    deviation,
    future_return_fraction,
    CASE
      WHEN future_return_fraction > 0 THEN 1
      ELSE -1
    END as label,
    CASE
      WHEN ABS(deviation) < 0.01 THEN 0.3  -- Near SMA = lower confidence
      WHEN ABS(deviation) > 0.02 THEN 0.9  -- Far from SMA = higher confidence
      ELSE 0.6
    END as consistency_weight
  FROM with_features
)
SELECT
  timestamp,
  symbol,
  close,
  label,
  1 as resolution_bars,
  future_return_fraction,
  consistency_weight
FROM labeled
ORDER BY timestamp`;
}
