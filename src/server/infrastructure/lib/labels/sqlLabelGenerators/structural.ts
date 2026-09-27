/**
 * Structural — bar-level swing-structure classification.
 *
 * For each bar, compares its high/low to the rolling max-high / min-low over
 * the previous `pivotLookback` bars (current row excluded — critical for
 * preventing leakage). Maps the (broke_high?, broke_low?) truth table to a
 * 5-class swing-structure label suitable for swing/structural models.
 *
 *   high > prev_max_high AND low >= prev_min_low  →  +2  (HH — clean breakout up)
 *   high <= prev_max_high AND low > prev_min_low  →  +1  (HL — held above prior low)
 *   high <= prev_max_high AND low < prev_min_low  →  -2  (LL — clean breakdown)
 *   high > prev_max_high AND low < prev_min_low   →  -1  (LH — outside / engulfing)
 *   ELSE                                          →   0  (inside / boundary)
 *
 * The current-row-excluded window (`ROWS BETWEEN N PRECEDING AND 1 PRECEDING`)
 * is essential — including the current row would make `high <= prev_max_high`
 * trivially true and leak the answer.
 *
 * Output: { timestamp, symbol, close, label, resolution_bars (0: the bar itself), high, low,
 * previous_maximum_high, previous_minimum_low }
 * where label ∈ {-2, -1, 0, 1, 2}.
 */

import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, partitionClause, orderClause } from './helpers';

export interface StructuralParams {
  pivotLookbackBars?: number;
}

export function generateStructuralLabelsSQL(
  params: StructuralParams,
  config: LabelGeneratorConfig,
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const N = Math.max(2, Math.floor(Number(params.pivotLookbackBars ?? 5)));

  return `
WITH base AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    high,
    low,
    MAX(high) OVER (${partitionClause(cfg)} ${orderClause(cfg)} ROWS BETWEEN ${N} PRECEDING AND 1 PRECEDING) as previous_maximum_high,
    MIN(low) OVER (${partitionClause(cfg)} ${orderClause(cfg)} ROWS BETWEEN ${N} PRECEDING AND 1 PRECEDING) as previous_minimum_low,
    -- A partial window at the start of the series is not the pattern this
    -- label describes: the Python kernel that trains on it refuses those bars
    -- (src/ml/shared/labels.py structural_labels), so the preview must too.
    COUNT(*) OVER (${partitionClause(cfg)} ${orderClause(cfg)} ROWS BETWEEN ${N} PRECEDING AND 1 PRECEDING) as prior_bars
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    high,
    low,
    previous_maximum_high,
    previous_minimum_low,
    CASE
      WHEN previous_maximum_high IS NULL OR previous_minimum_low IS NULL OR prior_bars < ${N} THEN NULL
      WHEN high > previous_maximum_high AND low >= previous_minimum_low THEN 2
      WHEN high <= previous_maximum_high AND low > previous_minimum_low THEN 1
      WHEN high <= previous_maximum_high AND low < previous_minimum_low THEN -2
      WHEN high > previous_maximum_high AND low < previous_minimum_low THEN -1
      ELSE 0
    END as label
  FROM base
)
SELECT
  timestamp,
  symbol,
  close,
  label,
  0 as resolution_bars,
  high,
  low,
  previous_maximum_high,
  previous_minimum_low
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}
