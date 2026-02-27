/**
 * Column standardization for market data.
 * Converts various source formats into unified schema:
 *   ts (TIMESTAMP), symbol (VARCHAR), open, high, low, close (DOUBLE), volume (BIGINT)
 */

export interface ColumnMapping {
  ts: string;
  symbol?: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  tsTransform?: string;
  priceTransform?: string;
}

/**
 * Detect column mapping for a data source by examining its column names.
 * Returns null if columns can't be mapped.
 */
export function detectMapping(columns: string[]): ColumnMapping | null {
  const lower = columns.map(c => c.toLowerCase());

  // Timestamp detection
  let ts = '';
  let tsTransform: string | undefined;
  if (lower.includes('ts_event')) {
    ts = 'ts_event';
    tsTransform = 'to_timestamp(ts_event / 1000000000)';
  } else if (lower.includes('ts')) {
    ts = 'ts';
  } else if (lower.includes('timestamp')) {
    ts = 'timestamp';
  } else if (lower.includes('time')) {
    ts = 'time';
  } else if (lower.includes('date')) {
    ts = 'date';
  }
  if (!ts) return null;

  // OHLCV detection
  const open = lower.includes('open') ? columns[lower.indexOf('open')] : null;
  const high = lower.includes('high') ? columns[lower.indexOf('high')] : null;
  const low = lower.includes('low') ? columns[lower.indexOf('low')] : null;
  const close = lower.includes('close') ? columns[lower.indexOf('close')] : null;
  const volume = lower.includes('volume') ? columns[lower.indexOf('volume')]
    : lower.includes('vol') ? columns[lower.indexOf('vol')]
    : lower.includes('tick_volume') ? columns[lower.indexOf('tick_volume')]
    : null;

  if (!open || !high || !low || !close) return null;

  // Symbol detection
  const symbol = lower.includes('symbol') ? columns[lower.indexOf('symbol')]
    : lower.includes('instrument_id') ? columns[lower.indexOf('instrument_id')]
    : lower.includes('ticker') ? columns[lower.indexOf('ticker')]
    : undefined;

  return {
    ts: columns[lower.indexOf(ts.toLowerCase())]!,
    symbol,
    open, high, low, close,
    volume: volume || 'volume',
    tsTransform,
  };
}

/**
 * Generate a SQL INSERT...SELECT that reads a Parquet file
 * and inserts standardized rows into the ohlcv table.
 */
export function buildInsertSQL(
  parquetPath: string,
  mapping: ColumnMapping,
  symbolOverride?: string,
  priceScale?: number,
): string {
  const safePath = parquetPath.replace(/\\/g, '/');
  const tsExpr = mapping.tsTransform || `CAST(${mapping.ts} AS TIMESTAMP)`;
  const priceFn = (col: string) => priceScale ? `(${col} / ${priceScale})` : col;
  const symbolExpr = symbolOverride
    ? `'${symbolOverride}'`
    : mapping.symbol
      ? `CAST(${mapping.symbol} AS VARCHAR)`
      : "'UNKNOWN'";

  return `
    INSERT INTO ohlcv
    SELECT
      ${tsExpr} AS ts,
      ${symbolExpr} AS symbol,
      ${priceFn(mapping.open)} AS open,
      ${priceFn(mapping.high)} AS high,
      ${priceFn(mapping.low)} AS low,
      ${priceFn(mapping.close)} AS close,
      CAST(COALESCE(${mapping.volume}, 0) AS BIGINT) AS volume
    FROM read_parquet('${safePath}')
  `;
}
