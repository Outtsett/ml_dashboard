/**
 * The post-pass that turns a generator's rows into contract rows.
 *
 * Think of it as: the generator writes what happened (the label, and how many
 * bars later it was known); this pass writes what it was worth and how much it
 * can be trusted — the price at resolution, the realised return in points and
 * in volatility units, whether it clears the round trip, how many other labels
 * were open at the same time (and so how unique this one is), and whether the
 * row may train at all.
 *
 * Everything is one DuckDB statement over the staged rows and the same sampled
 * bars the generator read, keyed by bar ordinal rather than by clock time:
 * sessions have gaps, and `t + h bars` is a different instant from
 * `t + h × timeframe`.
 *
 * Sample weights follow López de Prado, Advances in Financial Machine Learning:
 *   concurrency c_t  — labels whose span [event, resolution] covers bar t (4.2)
 *   uniqueness       — mean of 1 / c_t over the label's span (4.5), in (0, 1]
 *   attribution      — |Σ r_t / c_t| over the span's 1-bar log returns, scaled
 *                      to mean 1 across the set (4.10)
 * All three are prefix sums over the bar ordinal, so the pass is linear in the
 * bar count whatever the horizons are.
 */
import { LABEL_VOLATILITY_WINDOW_BARS } from '@shared/labels/contract';
import type { LabelGeneratorConfig } from './sqlLabelGenerators/helpers';
import { BAR_INDEX_COLUMN, sampledBarsCte } from './sqlLabelGenerators/helpers';

export interface EnrichmentInput {
  /** `read_parquet('<local staging file>')` — the generator's rows. */
  stagingSource: string;
  /** Columns present in the staged rows (from DESCRIBE), so optional generator columns are only referenced when they exist. */
  stagedColumns: string[];
  config: LabelGeneratorConfig;
  /** Canonical round-trip cost for the symbol in points; null when the symbol is unpriced. */
  roundTripCostPoints: number | null;
}

function sqlLiteral(value: unknown): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * The SELECT that yields contract rows. The caller wraps it in a COPY.
 *
 * The staged rows are joined to the bars on the event timestamp, and to the
 * bars again on `event ordinal + resolution_bars` for the resolution bar.
 */
export function buildEnrichmentSql(input: EnrichmentInput): string {
  const { stagingSource, stagedColumns, config, roundTripCostPoints } = input;
  const has = (column: string) => stagedColumns.includes(column);
  const cost = roundTripCostPoints === null ? 'NULL::DOUBLE' : String(roundTripCostPoints);
  const volatilityWindow = LABEL_VOLATILITY_WINDOW_BARS;

  const realizedPrice = has('realized_price')
    ? 'COALESCE(e.realized_price, e.resolution_close)'
    : 'e.resolution_close';
  const reasonHint = has('usable_reason_hint') ? 'e.usable_reason_hint' : 'NULL::VARCHAR';
  const exclude = ['event_bar_index', 'resolution_bar_index', ...(has('usable_reason_hint') ? ['usable_reason_hint'] : [])];

  return `
WITH ${sampledBarsCte(config)},
bars AS (
  SELECT
    timestamp, close, ${BAR_INDEX_COLUMN},
    close - LAG(close) OVER (ORDER BY ${BAR_INDEX_COLUMN}) AS change_points_1bar,
    LN(close / NULLIF(LAG(close) OVER (ORDER BY ${BAR_INDEX_COLUMN}), 0)) AS log_return_1bar
  FROM sampled_ohlcv
),
bars_with_volatility AS (
  SELECT *,
    CASE WHEN COUNT(change_points_1bar) OVER (ORDER BY ${BAR_INDEX_COLUMN} ROWS BETWEEN ${volatilityWindow - 1} PRECEDING AND CURRENT ROW) >= ${volatilityWindow}
         THEN stddev_pop(change_points_1bar) OVER (ORDER BY ${BAR_INDEX_COLUMN} ROWS BETWEEN ${volatilityWindow - 1} PRECEDING AND CURRENT ROW)
    END AS trailing_volatility_points
  FROM bars
),
staged AS (
  SELECT * FROM ${stagingSource}
),
events AS (
  SELECT
    s.*,
    b.${BAR_INDEX_COLUMN} AS event_bar_index,
    b.${BAR_INDEX_COLUMN} + CAST(s.resolution_bars AS BIGINT) AS resolution_bar_index,
    b.trailing_volatility_points
  FROM staged s
  JOIN bars_with_volatility b ON b.timestamp = s.timestamp
),
resolved AS (
  SELECT e.*, rb.timestamp AS resolution_timestamp, rb.close AS resolution_close
  FROM events e
  LEFT JOIN bars rb ON rb.${BAR_INDEX_COLUMN} = e.resolution_bar_index
),
span_edges AS (
  SELECT event_bar_index AS ${BAR_INDEX_COLUMN}, COUNT(*) AS delta FROM events GROUP BY 1
  UNION ALL
  SELECT resolution_bar_index + 1 AS ${BAR_INDEX_COLUMN}, -COUNT(*) AS delta FROM events GROUP BY 1
),
edges AS (
  SELECT ${BAR_INDEX_COLUMN}, SUM(delta) AS delta FROM span_edges GROUP BY 1
),
concurrency AS (
  SELECT b.${BAR_INDEX_COLUMN}, b.log_return_1bar,
    SUM(COALESCE(d.delta, 0)) OVER (ORDER BY b.${BAR_INDEX_COLUMN}) AS concurrent_label_count
  FROM bars b
  LEFT JOIN edges d USING (${BAR_INDEX_COLUMN})
),
prefix AS (
  SELECT ${BAR_INDEX_COLUMN}, concurrent_label_count,
    SUM(CASE WHEN concurrent_label_count > 0 THEN 1.0 / concurrent_label_count ELSE 0 END) OVER (ORDER BY ${BAR_INDEX_COLUMN}) AS uniqueness_prefix,
    SUM(CASE WHEN concurrent_label_count > 0 THEN COALESCE(log_return_1bar, 0) / concurrent_label_count ELSE 0 END) OVER (ORDER BY ${BAR_INDEX_COLUMN}) AS attribution_prefix
  FROM concurrency
),
weighted AS (
  SELECT
    e.*,
    p_event.concurrent_label_count,
    (p_end.uniqueness_prefix - COALESCE(p_before.uniqueness_prefix, 0)) / (CAST(e.resolution_bars AS DOUBLE) + 1) AS sample_uniqueness_weight,
    ABS(p_end.attribution_prefix - p_event.attribution_prefix) AS return_attribution_raw
  FROM resolved e
  JOIN prefix p_event ON p_event.${BAR_INDEX_COLUMN} = e.event_bar_index
  LEFT JOIN prefix p_end ON p_end.${BAR_INDEX_COLUMN} = e.resolution_bar_index
  LEFT JOIN prefix p_before ON p_before.${BAR_INDEX_COLUMN} = e.event_bar_index - 1
),
priced AS (
  SELECT
    e.* EXCLUDE (${exclude.join(', ')}),
    ${reasonHint} AS usable_reason_hint_kept,
    ${realizedPrice} AS realized_price_resolved,
    ${cost} AS round_trip_cost_points
  FROM weighted e
),
valued AS (
  SELECT
    * EXCLUDE (realized_price_resolved${has('realized_price') ? ', realized_price' : ''}),
    realized_price_resolved AS realized_price,
    realized_price_resolved - close AS realized_return_points,
    (realized_price_resolved - close) / NULLIF(close, 0) AS realized_return_fraction,
    (realized_price_resolved - close) / NULLIF(trailing_volatility_points * SQRT(GREATEST(CAST(resolution_bars AS DOUBLE), 1)), 0) AS realized_return_volatility_units,
    ABS(realized_price_resolved - close) - round_trip_cost_points AS realized_return_net_of_cost_points,
    CASE WHEN round_trip_cost_points IS NULL THEN NULL ELSE ABS(realized_price_resolved - close) > round_trip_cost_points END AS clears_round_trip_cost,
    CASE
      WHEN usable_reason_hint_kept IS NOT NULL THEN usable_reason_hint_kept
      WHEN resolution_timestamp IS NULL THEN 'unresolved'
      WHEN trailing_volatility_points IS NULL THEN 'volatility_warmup'
      WHEN trailing_volatility_points = 0 THEN 'zero_volatility'
      ELSE 'ok'
    END AS usable_reason
  FROM priced
)
SELECT
  * EXCLUDE (usable_reason_hint_kept, return_attribution_raw),
  return_attribution_raw / NULLIF(AVG(return_attribution_raw) OVER (), 0) AS return_attribution_weight,
  usable_reason = 'ok' AS usable
FROM valued
ORDER BY timestamp`;
}

export { sqlLiteral as enrichmentSqlLiteral };
