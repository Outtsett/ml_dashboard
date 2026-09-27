/**
 * Shared types and SQL fragments for the label generators.
 *
 * Every window here is CAUSAL unless its name says forward: a trailing frame
 * ends at the current row, and a trailing statistic is NULL until the frame is
 * full. That last rule is the one the audit found missing — `AVG(x²) - AVG(x)²`
 * over a one-row window is exactly 0, not NULL, so a barrier quoted in
 * volatility units collapsed onto the entry price for the first rows of every
 * bounded request. `guarded()` is what closes it: an aggregate is only reported
 * when the frame holds the rows it was asked for.
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

/** The bar-ordinal column the sampled CTE carries; enrichment and forward regressions index on it. */
export const BAR_INDEX_COLUMN = 'bar_index';

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

/** Trailing frame [current - `before`, current]. */
export function rowsBack(before: number, config: LabelGeneratorConfig): string {
  const beforeClause = before <= 0 ? 'CURRENT ROW' : `${before} PRECEDING`;
  return `OVER (${partitionClause(config)} ${orderClause(config)} ROWS BETWEEN ${beforeClause} AND CURRENT ROW)`;
}

/** Trailing frame that EXCLUDES the current row: [current - `before`, current - 1]. */
export function rowsBackExclusive(before: number, config: LabelGeneratorConfig): string {
  return `OVER (${partitionClause(config)} ${orderClause(config)} ROWS BETWEEN ${Math.max(1, before)} PRECEDING AND 1 PRECEDING)`;
}

/**
 * Forward frame [current, current + `after`]. Deliberate look-ahead: it is what
 * a label IS, and it must never be applied to a feature. DuckDB accepts
 * `N FOLLOWING` as a frame end (QuestDB did not, which is why the older
 * generators build forward statistics as a trailing frame shifted by LEAD).
 */
export function rowsForward(after: number, config: LabelGeneratorConfig): string {
  const afterClause = after <= 0 ? 'CURRENT ROW' : `${after} FOLLOWING`;
  return `OVER (${partitionClause(config)} ${orderClause(config)} ROWS BETWEEN CURRENT ROW AND ${afterClause})`;
}

/**
 * Report `expression` only when the frame holds `needed` non-NULL values of
 * `countOf`; NULL otherwise. Warmup rows are unknown, and an unknown is never
 * rendered as a value.
 */
export function guarded(expression: string, countOf: string, frame: string, needed: number): string {
  return `CASE WHEN COUNT(${countOf}) ${frame} >= ${needed} THEN ${expression} END`;
}

/**
 * Rolling population standard deviation over the trailing frame of
 * `before + 1` rows, NULL until the frame is full.
 *
 * Built from `E[x²] - E[x]²` rather than `stddev_pop(...) OVER`, which DuckDB
 * supports but QuestDB did not; kept because the generators' parity tests were
 * written against this exact form. ABS guards the tiny negative that floating
 * point can leave on a genuinely flat window.
 */
export function rollingStd(expr: string, before: number, config: LabelGeneratorConfig): string {
  const frame = rowsBack(before, config);
  return guarded(
    `SQRT(ABS(AVG(POWER(${expr}, 2)) ${frame} - POWER(AVG(${expr}) ${frame}, 2)))`,
    expr,
    frame,
    before + 1,
  );
}

/** Rolling mean over the trailing frame of `before + 1` rows, NULL until full. */
export function rollingMean(expr: string, before: number, config: LabelGeneratorConfig): string {
  const frame = rowsBack(before, config);
  return guarded(`AVG(${expr}) ${frame}`, expr, frame, before + 1);
}

/**
 * Trailing median of `expr` over the `before` rows BEFORE the current one,
 * NULL until that many are present. The current row is excluded so a bar is
 * never compared against a statistic it is part of.
 */
export function trailingMedian(expr: string, before: number, config: LabelGeneratorConfig): string {
  const frame = rowsBackExclusive(before, config);
  return guarded(`quantile_cont(${expr}, 0.5) ${frame}`, expr, frame, before);
}

/**
 * Pull a backward-window value `n` bars back so it describes the window
 * [t, t+n] as seen from t. Kept for the generators written against it.
 */
export function shiftForward(expr: string, n: number, config: LabelGeneratorConfig): string {
  if (n <= 0) return expr;
  return `LEAD(${expr}, ${n}) ${windowOver(config)}`;
}

/** Wilder true range for a row that carries `previous_close`. */
export function trueRangeExpression(): string {
  return 'GREATEST(high - low, ABS(high - previous_close), ABS(low - previous_close))';
}

// ─── Statistical thresholds ─────────────────────────────────────────────────

/** Standard normal cumulative distribution (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return 0.5 * (1 + (z < 0 ? -erf : erf));
}

/** Standard normal quantile (Acklam's rational approximation, |relative error| < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error(`normalQuantile needs 0 < p < 1, got ${p}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;
  let q: number;
  if (p < low) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > high) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/**
 * The two-sided threshold that keeps the family-wise false-positive rate of
 * `tests` comparisons at the rate a single test at `singleTestThreshold` has
 * (Šidák). A threshold of 2.0 over 18 horizons becomes ~3.0.
 */
export function sidakThreshold(singleTestThreshold: number, tests: number): number {
  if (!(singleTestThreshold > 0) || tests <= 1) return singleTestThreshold;
  const alpha = 2 * (1 - normalCdf(singleTestThreshold));
  const alphaPerTest = 1 - Math.pow(1 - alpha, 1 / tests);
  return normalQuantile(1 - alphaPerTest / 2);
}

// ─── Timeframes and the sampled bars ────────────────────────────────────────

/**
 * Convert timeframeMinutes to a short interval label.
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
 * Convert timeframeMinutes to a DuckDB INTERVAL literal for `time_bucket`.
 * Always minutes: `time_bucket` anchors on the epoch, so `INTERVAL '1440 minutes'`
 * and `INTERVAL '1 day'` bucket identically, and one unit removes a class of
 * off-by-one between the two spellings.
 */
export function minutesToInterval(minutes: number): string {
  const n = Math.max(1, Math.floor(minutes));
  return `INTERVAL '${n} minutes'`;
}

/**
 * The `sampled_ohlcv` CTE body: the instrument's bars at the requested
 * timeframe, one row per bucket, with a bar ordinal.
 *
 * `arg_min`/`arg_max`, never `first`/`last` — DuckDB's are order-unspecified
 * within a group, so a bucket spanning many input rows could return any of
 * them and the open would drift between runs.
 *
 * Aggregation is not skipped at 1 minute: the base `ohlcv` table is sub-minute,
 * so without it a "1m" request labelled one row per tick.
 */
export function sampledBarsCte(config: LabelGeneratorConfig): string {
  const tf = config.timeframeMinutes || 1;
  const table = config.tableName || 'ohlcv';
  const from = config.sourceFrom || table;
  const predicate = config.sourcePredicate || `symbol = '${config.symbol}'`;
  return `sampled_ohlcv AS (
  SELECT bucket_timestamp AS timestamp, symbol, open, high, low, close, volume,
         ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY bucket_timestamp) AS ${BAR_INDEX_COLUMN}
  FROM (
    SELECT
      time_bucket(${minutesToInterval(tf)}, timestamp) AS bucket_timestamp,
      symbol,
      arg_min(open, timestamp) as open,
      max(high) as high,
      min(low) as low,
      arg_max(close, timestamp) as close,
      sum(volume) as volume
    FROM ${from}
    WHERE ${predicate}
    GROUP BY 1, symbol
  ) AS bucketed
  ORDER BY timestamp
)`;
}

/**
 * Wrap a generator's SQL with the `sampled_ohlcv` CTE and point every
 * `FROM <table>` / `JOIN <table>` in it at the sampled rows.
 */
export function wrapWithSampleBy(sql: string, config: LabelGeneratorConfig): string {
  const tf = config.timeframeMinutes || 1;
  if (tf < 1) return sql;
  const table = config.tableName || 'ohlcv';
  const sampledCTE = sampledBarsCte(config);

  // Replace table references BEFORE prepending the CTE so the CTE's own FROM is untouched.
  const tablePattern = new RegExp(`(FROM|JOIN)\\s+${escapeRegExp(table)}\\b`, 'gi');
  const rewrittenSQL = sql.replace(tablePattern, `$1 sampled_ohlcv`);

  const trimmed = rewrittenSQL.trimStart();
  if (trimmed.startsWith('WITH ')) {
    return `WITH ${sampledCTE},\n${trimmed.slice(5)}`;
  }
  return `WITH ${sampledCTE}\n${trimmed}`;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Push a [start, end] window (epoch ms) into every instrument predicate of a
 * generated SQL. The window functions (LEAD / LAG / OVER) block predicate
 * pushdown, so an outer WHERE would label all of history first and filter
 * second; injecting into `WHERE symbol = '...'` bounds the scan itself. Accepts
 * an optional alias (`WHERE o.symbol = ...`), which meta_label uses.
 */
export function boundByWindow(sql: string, window: { startMs?: number | null; endMs?: number | null }): string {
  const filters: string[] = [];
  if (window.startMs !== null && window.startMs !== undefined && Number.isFinite(window.startMs)) {
    filters.push(`timestamp >= '${new Date(window.startMs).toISOString()}'`);
  }
  if (window.endMs !== null && window.endMs !== undefined && Number.isFinite(window.endMs)) {
    filters.push(`timestamp <= '${new Date(window.endMs).toISOString()}'`);
  }
  if (filters.length === 0) return sql;
  return sql.replace(/(WHERE\s+(?:\w+\.)?symbol\s*=\s*'[^']*')/gi, `$1 AND ${filters.join(' AND ')}`);
}
