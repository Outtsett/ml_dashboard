/**
 * Semi-supervised label generators: PseudoConfidence, ConsistencyPerturbation
 */

import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rowsBetween, rollingStd } from './helpers';

// ============================================================================
// PSEUDO CONFIDENCE LABELS (Semi-supervised)
// ============================================================================

export interface PseudoConfidenceParams {
  horizon?: number;
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
  // The taxonomy for this generator declares teacherPredColumn /
  // teacherConfColumn / confidenceThreshold / classBalancing — it never sends
  // `horizon`, so the template interpolated `undefined` straight into
  // `LEAD(close, undefined)` and QuestDB answered "Invalid column: undefined".
  // Both values are defaulted so the generator is callable from its own
  // declared parameter set.
  const horizon = params.horizon ?? 5;
  const confidenceThreshold = params.confidenceThreshold ?? 90;
  const confDecimal = confidenceThreshold / 100;
  
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
    (future_close - close) / NULLIF(close, 0) as future_return,
    local_vol / NULLIF(close, 0) as normalized_vol
  FROM base
  WHERE future_close IS NOT NULL
),
with_confidence AS (
  SELECT
    timestamp,
    symbol,
    close,
    future_return,
    normalized_vol,
    ABS(future_return) / NULLIF(normalized_vol + 0.001, 0) as signal_strength,
    CASE WHEN future_return > 0 THEN 1 ELSE -1 END as direction
  FROM with_returns
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    future_return,
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
  future_return,
  label,
  confidence
FROM labeled
ORDER BY timestamp`;
}

// ============================================================================
// CONSISTENCY PERTURBATION LABELS (Semi-supervised)
// ============================================================================

export interface ConsistencyPerturbationParams {
  perturbationType: 'noise' | 'dropout' | 'mixup';
  perturbationStrength?: number;
  perturbationScale?: number;
  consistencyWindow?: number;
  numPerturbations?: number;
}

export function generateConsistencyPerturbationLabelsSQL(
  params: ConsistencyPerturbationParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  // Support both param name variants from taxonomy
  const consistencyWindow = params.consistencyWindow || params.numPerturbations || 20;
  
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
    (next_close - close) / NULLIF(close, 0) as future_return
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
    future_return,
    CASE 
      WHEN future_return > 0 THEN 1
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
  future_return,
  label,
  consistency_weight
FROM labeled
ORDER BY timestamp`;
}
