/**
 * Shared types and SQL helper fragments for label generators
 */

export interface LabelGeneratorConfig {
  symbol: string;
  tableName?: string;
  timestampColumn?: string;
  symbolColumn?: string;
  timeframeMinutes?: number;
  /**
   * Resolved FROM target for the aggregation CTE — a bare table, or a
   * parenthesised sub-select for a front-month-stitched futures root. Falls
   * back to `tableName` when the caller has not resolved a source.
   * See `labelSource.ts`.
   */
  sourceFrom?: string;
  /** WHERE predicate identifying the instrument inside `sourceFrom`. */
  sourcePredicate?: string;
}

export const DEFAULT_CONFIG: Partial<LabelGeneratorConfig> = {
  tableName: 'ohlcv',
  timestampColumn: 'timestamp',
  symbolColumn: 'symbol',
  timeframeMinutes: 1,
};

export function partitionClause(config: LabelGeneratorConfig): string {
  return `PARTITION BY ${config.symbolColumn || 'symbol'}`;
}

export function orderClause(config: LabelGeneratorConfig): string {
  return `ORDER BY ${config.timestampColumn || 'timestamp'}`;
}

export function windowOver(config: LabelGeneratorConfig): string {
  return `OVER (${partitionClause(config)} ${orderClause(config)})`;
}

export function rowsBetween(before: number, after: number, config: LabelGeneratorConfig): string {
  const beforeClause = before === 0 ? 'CURRENT ROW' : `${before} PRECEDING`;
  const afterClause = after === 0 ? 'CURRENT ROW' : `${after} FOLLOWING`;
  return `OVER (${partitionClause(config)} ${orderClause(config)} ROWS BETWEEN ${beforeClause} AND ${afterClause})`;
}

/**
 * Backward-only window frame: [CURRENT ROW - `before`, CURRENT ROW].
 *
 * QuestDB accepts only `<number> PRECEDING` and `CURRENT ROW` as a frame END —
 * `N FOLLOWING` is rejected with "frame end supports _number_ PRECEDING and
 * CURRENT ROW only". Every forward-looking label therefore has to be built as
 * a backward frame plus a LEAD shift; see `shiftForward`.
 */
export function rowsBack(before: number, config: LabelGeneratorConfig): string {
  const beforeClause = before <= 0 ? 'CURRENT ROW' : `${before} PRECEDING`;
  return `OVER (${partitionClause(config)} ${orderClause(config)} ROWS BETWEEN ${beforeClause} AND CURRENT ROW)`;
}

/**
 * Rolling population standard deviation over a trailing frame.
 *
 * QuestDB has no windowed `stddev_pop` — using it returns "non-window function
 * called in window context". `avg`, `min` and `max` ARE window functions, so
 * the deviation is rebuilt from the identity
 *   sd = sqrt( E[x²] - E[x]² )
 * ABS guards the case where floating-point error makes the difference a tiny
 * negative, which would otherwise produce NaN for a genuinely flat window.
 */
export function rollingStd(expr: string, before: number, config: LabelGeneratorConfig): string {
  const frame = rowsBack(before, config);
  return `SQRT(ABS(AVG(POWER(${expr}, 2)) ${frame} - POWER(AVG(${expr}) ${frame}, 2)))`;
}

/**
 * Pull a backward-window value `n` bars back so it describes the window
 * [t, t+n] as seen from t.
 *
 * A backward aggregate evaluated at t+n spans exactly the bars a forward
 * aggregate at t would cover, so `LEAD(agg, n)` is the forward statistic.
 * This is deliberate look-ahead: it is what a label IS. It must never be
 * applied to a feature.
 *
 * `expr` must already be a plain column from an inner CTE — QuestDB cannot
 * nest a window function inside another window function's argument.
 */
export function shiftForward(expr: string, n: number, config: LabelGeneratorConfig): string {
  if (n <= 0) return expr;
  return `LEAD(${expr}, ${n}) ${windowOver(config)}`;
}

/**
 * Convert timeframeMinutes to a QuestDB SAMPLE BY interval string.
 * e.g., 1 -> '1m', 5 -> '5m', 60 -> '1h', 240 -> '4h', 1440 -> '1d', 10080 -> '7d'
 */
export function minutesToSampleBy(minutes: number): string {
  if (minutes <= 1) return '1m';
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/**
 * Wrap a generator's SQL output with a SAMPLE BY CTE.
 *
 * Prepends a `sampled_ohlcv` CTE that aggregates the base table to the
 * requested timeframe using QuestDB SAMPLE BY, and rewrites references to the
 * base table to use the sampled CTE instead.
 *
 * The 1-minute case is NOT a no-op. The base `ohlcv` table is sub-minute
 * (~3-second rows; 96.7M of them for MNQ), so skipping aggregation at tf=1
 * generated one label per tick instead of one per candle. With a 5000-row
 * preview cap that returned 3.2 hours of labels — which collapsed onto 131
 * one-minute bars inside a 102-day chart and rendered off-screen. Aggregating
 * at 1m makes the cap mean 5000 candles instead of 5000 ticks.
 */
export function wrapWithSampleBy(
  sql: string,
  config: LabelGeneratorConfig,
): string {
  const tf = config.timeframeMinutes || 1;
  if (tf < 1) return sql;

  const table = config.tableName || 'ohlcv';
  const symbol = config.symbol;
  const interval = minutesToSampleBy(tf);

  // This CTE is the single point where an instrument is turned into rows, so
  // it is where adaptive source resolution lands: a futures root arrives here
  // as a front-month-stitched sub-select, everything else as a plain table.
  const from = config.sourceFrom || table;
  const predicate = config.sourcePredicate || `symbol = '${symbol}'`;

  const sampledCTE = `sampled_ohlcv AS (
  SELECT timestamp, symbol,
    first(open) as open, max(high) as high, min(low) as low, last(close) as close, sum(volume) as volume
  FROM ${from}
  WHERE ${predicate}
  SAMPLE BY ${interval} ALIGN TO CALENDAR
)`;

  // First, replace table references in the generator's SQL BEFORE prepending the CTE.
  // This avoids accidentally replacing the FROM inside the sampled_ohlcv CTE definition.
  const tablePattern = new RegExp(`(FROM|JOIN)\\s+${escapeRegExp(table)}\\b`, 'gi');
  const rewrittenSQL = sql.replace(tablePattern, `$1 sampled_ohlcv`);

  // Then prepend the sampled_ohlcv CTE
  const trimmed = rewrittenSQL.trimStart();
  if (trimmed.startsWith('WITH ')) {
    return `WITH ${sampledCTE},\n${trimmed.slice(5)}`;
  }
  // No CTE — wrap with WITH
  return `WITH ${sampledCTE}\n${trimmed}`;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
