/**
 * Range Bucket — quantize next-N-bar close-to-close delta into K symmetric buckets.
 *
 * Mirrors the `range_class` head used by trading_model's `transformer_range`:
 * the label is the bucket index 0..K-1 corresponding to where the price delta
 * (in price units, NOT percent) over `horizon` bars lands.
 *
 * Buckets are symmetric around zero with total width = nBuckets * bucketWidthPts.
 * Edge tails are clipped to bucket 0 / nBuckets-1.
 *
 *   bucket_index = clamp(
 *     floor((delta + halfRange) / bucketWidthPts),
 *     0, nBuckets - 1
 *   )
 *
 * For nBuckets=21, bucketWidthPts=2: covers ±21 points around close, in 2pt
 * buckets. Center bucket = 10 (delta ∈ [-1, +1)). Headline metric for
 * downstream training: within-K-pt accuracy.
 *
 * Output: { timestamp, symbol, close, future_close, delta_pts, label }
 * where label ∈ {0, 1, ..., nBuckets - 1}.
 */

import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver } from './helpers';

export interface RangeBucketParams {
  horizon?: number;
  nBuckets?: number;
  bucketWidthPts?: number;
}

export function generateRangeBucketLabelsSQL(
  params: RangeBucketParams,
  config: LabelGeneratorConfig,
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const horizon = Math.max(1, params.horizon ?? 16);
  const nBuckets = Math.max(2, params.nBuckets ?? 21);
  const bucketWidthPts = Math.max(0.0001, params.bucketWidthPts ?? 2);
  // Symmetric coverage: nBuckets * bucketWidthPts total, centered on zero.
  const halfRange = (nBuckets * bucketWidthPts) / 2;
  const maxIdx = nBuckets - 1;

  return `
WITH base AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    LEAD(close, ${horizon}) ${windowOver(cfg)} as future_close
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    future_close,
    future_close - close as delta_pts,
    CASE
      WHEN future_close IS NULL THEN NULL
      ELSE CAST(
        LEAST(
          ${maxIdx},
          GREATEST(
            0,
            FLOOR((future_close - close + ${halfRange}) / ${bucketWidthPts})
          )
        ) AS INT
      )
    END as label
  FROM base
)
SELECT
  timestamp,
  symbol,
  close,
  future_close,
  delta_pts,
  label
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}
