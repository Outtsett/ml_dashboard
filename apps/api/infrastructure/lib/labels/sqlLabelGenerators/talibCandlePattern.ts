/**
 * TA-Lib candle patterns — overlay the 61 named pattern vocabulary on the chart.
 *
 * Named for the model that produced the vocabulary. More than one candle-pattern
 * vocabulary exists across these repos and they are not interchangeable: TA-Lib's
 * 61 are hand-written rules shipped by a library, while the VQ-VAE archetypes in
 * `Trading/quant/model/scripts/discover_candle_patterns.py` are a codebook learned
 * from the same bars. A label called `candle_pattern` says nothing about which of
 * those it is; `talib_candle_pattern` does.
 *
 * Reads a MATERIALIZED table, not OHLCV
 * -------------------------------------
 * TA-Lib is a C library and its patterns cannot be expressed as lake SQL, so
 * unlike every other generator here this one does not compute anything — it reads
 * `talib_candle_patterns`, written by
 * `Trading/quant/analytics/structure/to_lake.py`. That split is the workspace's
 * database-boundary rule applied as intended: heavy math outside the database,
 * indexed lookup inside it.
 *
 * The table is LONG — one row per (bar, pattern that fired), no zero rows. On
 * MNQ 1m, 78.84% of bars fire at least one pattern (mean 1.93, max 11), so a bar
 * with no row is a bar where nothing fired, not a gap in coverage.
 *
 * Timeframe is matched, not assumed
 * ---------------------------------
 * A hammer on 5m bars is not a hammer on 1m bars — the pattern is a claim about
 * the bars it was computed on. Rows are keyed by `timeframe` and this generator
 * selects the one matching the chart, so patterns can never be drawn under
 * candles whose shape did not trigger them. If the requested timeframe was never
 * ingested the overlay comes back empty rather than silently falling back to 1m
 * and marking the wrong bars.
 *
 * Label vocabulary
 * ----------------
 * `pattern = 'any'` (default): the battery's net direction on that bar —
 *   -1 / 0 / +1 from the sign of the summed signed values. 0 means the firing
 *   patterns contradicted each other exactly.
 *
 * `pattern = '<name>'`: that pattern's own value, in
 *   {-2, -1, -0.8, +0.8, +1, +2}. The magnitude is not uniform across the
 *   battery — measured over 87,885 MNQ 1m bars, `engulfing`/`harami`/`haramicross`
 *   emit ±80 as well as ±100, `hikkake`/`hikkakemod` emit ±200, and the other 48
 *   that fire emit ±100 only. It is the pattern's own confidence statement, so it
 *   passes through rather than being collapsed to a sign. Everything lands inside
 *   [-2, 2], which `labelMarkerStyle` renders as the signed encoding with
 *   magnitude driving marker size — a ±2 hikkake draws a larger arrow than a ±1
 *   one, with no extra plumbing.
 *
 * Output: { timestamp, symbol, close, label, resolution_bars (0: the pattern describes the bar) }.
 */

import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG } from './helpers';

/** Table written by `structure/to_lake.py` in the quant workspace. */
export const TALIB_PATTERN_TABLE = 'talib_candle_patterns';

export interface TalibCandlePatternParams {
  /** `'any'` for the net direction, or a bare pattern name such as `engulfing`. */
  pattern?: string;
  /**
   * Bar size the patterns were computed on, e.g. `1m`. Defaults to the chart's
   * own timeframe derived from `config.timeframeMinutes`.
   */
  timeframe?: string;
}

/**
 * Pattern names are interpolated into SQL, so they are restricted to the shape
 * TA-Lib actually produces — lowercase letters and digits, after the `talib_`
 * prefix is stripped at ingest (`3whitesoldiers`, `engulfing`, `hikkakemod`).
 * Anything else is rejected rather than escaped: there is no legitimate pattern
 * name containing a quote, so a value carrying one is a bug or an injection
 * attempt and both deserve to fail loudly.
 */
const PATTERN_NAME = /^[a-z0-9]+$/;

/** Minutes -> the timeframe label used as the ingest key. */
export function timeframeLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function generateTalibCandlePatternLabelsSQL(
  params: TalibCandlePatternParams,
  config: LabelGeneratorConfig,
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const pattern = (params.pattern ?? 'any').trim().toLowerCase();
  const timeframe = params.timeframe ?? timeframeLabel(cfg.timeframeMinutes ?? 1);

  if (pattern !== 'any' && !PATTERN_NAME.test(pattern)) {
    throw new Error(
      `Invalid TA-Lib pattern name '${params.pattern}'. Expected 'any' or a bare ` +
      `lowercase name such as 'engulfing' — the ingest strips the 'talib_' prefix.`,
    );
  }
  if (!PATTERN_NAME.test(timeframe)) {
    throw new Error(`Invalid timeframe '${timeframe}'.`);
  }

  const symbol = config.symbol.replace(/'/g, "''");
  const patternFilter = pattern === 'any' ? '' : `\n    AND pattern = '${pattern}'`;

  // The bar's close comes from the OHLCV source rather than the pattern table:
  // the pattern table stores no price, and the overlay wants markers anchored to
  // the same candles the chart drew.
  const priceFrom = cfg.sourceFrom || cfg.tableName;
  const pricePredicate = cfg.sourcePredicate || `${cfg.symbolColumn} = '${symbol}'`;

  return `
WITH fired AS (
  SELECT
    timestamp,
    symbol,
    ${pattern === 'any'
      ? `CASE
      WHEN sum(value) > 0 THEN 1
      WHEN sum(value) < 0 THEN -1
      ELSE 0
    END as label`
      : `sum(value) as label`}
  FROM ${TALIB_PATTERN_TABLE}
  WHERE symbol = '${symbol}'
    AND timeframe = '${timeframe}'${patternFilter}
  GROUP BY timestamp, symbol
),
bars AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    close
  FROM ${priceFrom}
  WHERE ${pricePredicate}
)
SELECT
  f.timestamp as timestamp,
  f.symbol as symbol,
  b.close as close,
  f.label as label,
  0 as resolution_bars
FROM fired f
JOIN bars b ON f.timestamp = b.timestamp
ORDER BY f.timestamp
`.trim();
}

