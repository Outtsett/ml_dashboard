/**
 * Shared types and SQL helper fragments for label generators
 */

export interface LabelGeneratorConfig {
  symbol: string;
  tableName?: string;
  timestampColumn?: string;
  symbolColumn?: string;
  timeframeMinutes?: number;
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
 * Wrap a generator's SQL output with a SAMPLE BY CTE when timeframe > 1 minute.
 *
 * When timeframeMinutes > 1, prepends a `sampled_ohlcv` CTE that aggregates
 * 1-minute bars using QuestDB SAMPLE BY, and rewrites references to the base
 * table to use the sampled CTE instead.
 *
 * When timeframeMinutes <= 1 (or absent), returns the SQL unchanged.
 */
export function wrapWithSampleBy(
  sql: string,
  config: LabelGeneratorConfig,
): string {
  const tf = config.timeframeMinutes || 1;
  if (tf <= 1) return sql;

  const table = config.tableName || 'ohlcv';
  const symbol = config.symbol;
  const interval = minutesToSampleBy(tf);

  const sampledCTE = `sampled_ohlcv AS (
  SELECT timestamp, symbol,
    first(open) as open, max(high) as high, min(low) as low, last(close) as close, sum(volume) as volume
  FROM ${table}
  WHERE symbol = '${symbol}'
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
