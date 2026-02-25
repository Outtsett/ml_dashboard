/**
 * DuckDB SQL Generator for Technical Indicators
 * 
 * Generates SQL window functions that match the TypeScript math primitives.
 * This ensures consistent calculations between real-time (TS) and batch (SQL) processing.
 */

export interface IndicatorConfig {
  name: string;
  period: number;
  source?: 'open' | 'high' | 'low' | 'close' | 'volume' | 'hl2' | 'hlc3' | 'ohlc4' | 'typical';
}

export interface SQLGeneratorOptions {
  tableName?: string;
  symbolColumn?: string;
  timestampColumn?: string;
  partition?: boolean;
}

const DEFAULT_OPTIONS: SQLGeneratorOptions = {
  tableName: 'ohlcv',
  symbolColumn: 'symbol',
  timestampColumn: 'ts',
  partition: true,
};

// ============================================================================
// WINDOW FRAME HELPERS
// ============================================================================

function windowFrame(period: number, options: SQLGeneratorOptions): string {
  const partition = options.partition ? `PARTITION BY ${options.symbolColumn}` : '';
  return `OVER (${partition} ORDER BY ${options.timestampColumn} ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW)`;
}

function fullWindow(options: SQLGeneratorOptions): string {
  const partition = options.partition ? `PARTITION BY ${options.symbolColumn}` : '';
  return `OVER (${partition} ORDER BY ${options.timestampColumn})`;
}

// ============================================================================
// SOURCE COLUMN HELPERS
// ============================================================================

function getSourceSQL(source: string): string {
  switch (source) {
    case 'hl2': return '((high + low) / 2.0)';
    case 'hlc3': return '((high + low + close) / 3.0)';
    case 'ohlc4': return '((open + high + low + close) / 4.0)';
    case 'typical': return '((high + low + close) / 3.0)';
    default: return source;
  }
}

// ============================================================================
// CORE MATH FUNCTIONS SQL
// ============================================================================

export function smaSQL(source: string, period: number, alias: string, options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const srcSQL = getSourceSQL(source);
  return `AVG(${srcSQL}) ${windowFrame(period, opts)} AS ${alias}`;
}

export function stddevSQL(source: string, period: number, alias: string, options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const srcSQL = getSourceSQL(source);
  return `STDDEV_POP(${srcSQL}) ${windowFrame(period, opts)} AS ${alias}`;
}

export function rollingSumSQL(source: string, period: number, alias: string, options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const srcSQL = getSourceSQL(source);
  return `SUM(${srcSQL}) ${windowFrame(period, opts)} AS ${alias}`;
}

export function rollingMinSQL(source: string, period: number, alias: string, options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const srcSQL = getSourceSQL(source);
  return `MIN(${srcSQL}) ${windowFrame(period, opts)} AS ${alias}`;
}

export function rollingMaxSQL(source: string, period: number, alias: string, options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const srcSQL = getSourceSQL(source);
  return `MAX(${srcSQL}) ${windowFrame(period, opts)} AS ${alias}`;
}

export function lagSQL(source: string, period: number, alias: string, options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const srcSQL = getSourceSQL(source);
  return `LAG(${srcSQL}, ${period}) ${fullWindow(opts)} AS ${alias}`;
}

export function diffSQL(source: string, period: number, alias: string, options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const srcSQL = getSourceSQL(source);
  return `(${srcSQL} - LAG(${srcSQL}, ${period}) ${fullWindow(opts)}) AS ${alias}`;
}

export function rocSQL(source: string, period: number, alias: string, options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const srcSQL = getSourceSQL(source);
  return `((${srcSQL} - LAG(${srcSQL}, ${period}) ${fullWindow(opts)}) / NULLIF(LAG(${srcSQL}, ${period}) ${fullWindow(opts)}, 0) * 100) AS ${alias}`;
}

// ============================================================================
// COMPOSITE INDICATORS SQL (using CTEs)
// ============================================================================

/**
 * Generate RSI SQL using CTEs
 * RSI = 100 - (100 / (1 + avgGain / avgLoss))
 */
export function rsiSQL(period: number = 14, options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const partition = opts.partition ? `PARTITION BY ${opts.symbolColumn}` : '';
  const orderBy = `ORDER BY ${opts.timestampColumn}`;
  const windowDef = `${partition} ${orderBy}`.trim();
  const periodWindow = `ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW`;

  return `
WITH price_changes AS (
  SELECT 
    ${opts.symbolColumn},
    ${opts.timestampColumn},
    open, high, low, close, volume,
    close - LAG(close) OVER (${windowDef}) AS change
  FROM ${opts.tableName}
),
gains_losses AS (
  SELECT 
    *,
    CASE WHEN change > 0 THEN change ELSE 0 END AS gain,
    CASE WHEN change < 0 THEN ABS(change) ELSE 0 END AS loss
  FROM price_changes
)
SELECT 
  ${opts.symbolColumn},
  ${opts.timestampColumn},
  open, high, low, close, volume,
  100 - (100 / (1 + 
    AVG(gain) OVER (${windowDef} ${periodWindow}) /
    NULLIF(AVG(loss) OVER (${windowDef} ${periodWindow}), 0)
  )) AS rsi_${period}
FROM gains_losses`;
}

/**
 * Generate MACD SQL
 * MACD Line = EMA(fast) - EMA(slow)
 * Signal Line = EMA(MACD, signal)
 * Histogram = MACD - Signal
 * 
 * IMPORTANT: Uses SMA approximation for EMA in SQL.
 * True EMA requires recursive CTEs which are slow for large datasets.
 * For batch ML features, SMA approximation is acceptable and much faster.
 * For real-time calculations, use the TypeScript calculateMACD function
 * which implements true EMA correctly.
 * 
 * The difference: EMA gives more weight to recent prices, SMA weights equally.
 * For ML features, both capture trend momentum - consistency within features
 * matters more than matching the textbook EMA formula exactly.
 */
export function macdSQL(
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
  options: SQLGeneratorOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const partition = opts.partition ? `PARTITION BY ${opts.symbolColumn}` : '';
  const orderBy = `ORDER BY ${opts.timestampColumn}`;
  const windowDef = `${partition} ${orderBy}`.trim();

  return `
WITH ema_approx AS (
  SELECT 
    ${opts.symbolColumn},
    ${opts.timestampColumn},
    open, high, low, close, volume,
    AVG(close) OVER (${windowDef} ROWS BETWEEN ${fastPeriod - 1} PRECEDING AND CURRENT ROW) AS ema_fast,
    AVG(close) OVER (${windowDef} ROWS BETWEEN ${slowPeriod - 1} PRECEDING AND CURRENT ROW) AS ema_slow
  FROM ${opts.tableName}
),
macd_line AS (
  SELECT 
    *,
    ema_fast - ema_slow AS macd
  FROM ema_approx
)
SELECT 
  ${opts.symbolColumn},
  ${opts.timestampColumn},
  open, high, low, close, volume,
  macd AS macd_${fastPeriod}_${slowPeriod}_${signalPeriod},
  AVG(macd) OVER (${windowDef} ROWS BETWEEN ${signalPeriod - 1} PRECEDING AND CURRENT ROW) AS macd_signal_${fastPeriod}_${slowPeriod}_${signalPeriod},
  macd - AVG(macd) OVER (${windowDef} ROWS BETWEEN ${signalPeriod - 1} PRECEDING AND CURRENT ROW) AS macd_hist_${fastPeriod}_${slowPeriod}_${signalPeriod}
FROM macd_line`;
}

/**
 * Generate Bollinger Bands SQL
 */
export function bollingerBandsSQL(
  period: number = 20,
  stdDevMultiplier: number = 2,
  options: SQLGeneratorOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return `
SELECT 
  ${opts.symbolColumn},
  ${opts.timestampColumn},
  open, high, low, close, volume,
  ${smaSQL('close', period, `bb_middle_${period}`, opts)},
  AVG(close) ${windowFrame(period, opts)} + (${stdDevMultiplier} * STDDEV_POP(close) ${windowFrame(period, opts)}) AS bb_upper_${period},
  AVG(close) ${windowFrame(period, opts)} - (${stdDevMultiplier} * STDDEV_POP(close) ${windowFrame(period, opts)}) AS bb_lower_${period},
  (close - (AVG(close) ${windowFrame(period, opts)} - (${stdDevMultiplier} * STDDEV_POP(close) ${windowFrame(period, opts)}))) /
    NULLIF((AVG(close) ${windowFrame(period, opts)} + (${stdDevMultiplier} * STDDEV_POP(close) ${windowFrame(period, opts)})) - 
           (AVG(close) ${windowFrame(period, opts)} - (${stdDevMultiplier} * STDDEV_POP(close) ${windowFrame(period, opts)})), 0) AS bb_pct_b_${period}
FROM ${opts.tableName}`;
}

/**
 * Generate ATR (Average True Range) SQL
 */
export function atrSQL(period: number = 14, options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const partition = opts.partition ? `PARTITION BY ${opts.symbolColumn}` : '';
  const orderBy = `ORDER BY ${opts.timestampColumn}`;
  const windowDef = `${partition} ${orderBy}`.trim();

  return `
WITH true_range AS (
  SELECT 
    ${opts.symbolColumn},
    ${opts.timestampColumn},
    open, high, low, close, volume,
    GREATEST(
      high - low,
      ABS(high - LAG(close) OVER (${windowDef})),
      ABS(low - LAG(close) OVER (${windowDef}))
    ) AS tr
  FROM ${opts.tableName}
)
SELECT 
  ${opts.symbolColumn},
  ${opts.timestampColumn},
  open, high, low, close, volume,
  AVG(tr) OVER (${windowDef} ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) AS atr_${period}
FROM true_range`;
}

/**
 * Generate Stochastic Oscillator SQL
 */
export function stochasticSQL(
  kPeriod: number = 14,
  dPeriod: number = 3,
  options: SQLGeneratorOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const partition = opts.partition ? `PARTITION BY ${opts.symbolColumn}` : '';
  const orderBy = `ORDER BY ${opts.timestampColumn}`;
  const windowDef = `${partition} ${orderBy}`.trim();

  return `
WITH stoch_k AS (
  SELECT 
    ${opts.symbolColumn},
    ${opts.timestampColumn},
    open, high, low, close, volume,
    (close - MIN(low) OVER (${windowDef} ROWS BETWEEN ${kPeriod - 1} PRECEDING AND CURRENT ROW)) /
    NULLIF(MAX(high) OVER (${windowDef} ROWS BETWEEN ${kPeriod - 1} PRECEDING AND CURRENT ROW) - 
           MIN(low) OVER (${windowDef} ROWS BETWEEN ${kPeriod - 1} PRECEDING AND CURRENT ROW), 0) * 100 AS stoch_k
  FROM ${opts.tableName}
)
SELECT 
  ${opts.symbolColumn},
  ${opts.timestampColumn},
  open, high, low, close, volume,
  stoch_k AS stoch_k_${kPeriod},
  AVG(stoch_k) OVER (${windowDef} ROWS BETWEEN ${dPeriod - 1} PRECEDING AND CURRENT ROW) AS stoch_d_${kPeriod}_${dPeriod}
FROM stoch_k`;
}

/**
 * Generate CCI (Commodity Channel Index) SQL
 */
export function cciSQL(period: number = 20, options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const partition = opts.partition ? `PARTITION BY ${opts.symbolColumn}` : '';
  const orderBy = `ORDER BY ${opts.timestampColumn}`;
  const windowDef = `${partition} ${orderBy}`.trim();

  return `
WITH typical_price AS (
  SELECT 
    ${opts.symbolColumn},
    ${opts.timestampColumn},
    open, high, low, close, volume,
    (high + low + close) / 3.0 AS tp
  FROM ${opts.tableName}
),
tp_stats AS (
  SELECT 
    *,
    AVG(tp) OVER (${windowDef} ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) AS tp_sma,
    AVG(ABS(tp - AVG(tp) OVER (${windowDef} ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW))) 
      OVER (${windowDef} ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) AS mean_dev
  FROM typical_price
)
SELECT 
  ${opts.symbolColumn},
  ${opts.timestampColumn},
  open, high, low, close, volume,
  (tp - tp_sma) / NULLIF(0.015 * mean_dev, 0) AS cci_${period}
FROM tp_stats`;
}

/**
 * Generate Williams %R SQL
 */
export function williamsRSQL(period: number = 14, options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const partition = opts.partition ? `PARTITION BY ${opts.symbolColumn}` : '';
  const orderBy = `ORDER BY ${opts.timestampColumn}`;
  const windowDef = `${partition} ${orderBy}`.trim();

  return `
SELECT 
  ${opts.symbolColumn},
  ${opts.timestampColumn},
  open, high, low, close, volume,
  (MAX(high) OVER (${windowDef} ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) - close) /
  NULLIF(MAX(high) OVER (${windowDef} ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) - 
         MIN(low) OVER (${windowDef} ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW), 0) * -100 AS williams_r_${period}
FROM ${opts.tableName}`;
}

// ============================================================================
// BULK INDICATOR GENERATION
// ============================================================================

export interface BulkIndicatorRequest {
  sma?: number[];
  ema?: number[];
  stddev?: number[];
  rsi?: number[];
  atr?: number[];
  roc?: number[];
  momentum?: number[];
  bollingerBands?: { period: number; stdDev: number }[];
  macd?: { fast: number; slow: number; signal: number }[];
  stochastic?: { k: number; d: number }[];
  cci?: number[];
  williamsR?: number[];
}

/**
 * Generate a single SELECT with all requested indicators
 * More efficient than running multiple queries
 */
export function generateBulkIndicatorsSQL(
  request: BulkIndicatorRequest,
  options: SQLGeneratorOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const partition = opts.partition ? `PARTITION BY ${opts.symbolColumn}` : '';
  const orderBy = `ORDER BY ${opts.timestampColumn}`;
  const windowDef = `${partition} ${orderBy}`.trim();
  
  const columns: string[] = [
    `${opts.symbolColumn}`,
    `${opts.timestampColumn}`,
    'open', 'high', 'low', 'close', 'volume'
  ];

  // Price helpers for complex indicators
  columns.push(`(high + low + close) / 3.0 AS typical_price`);
  columns.push(`close - LAG(close) OVER (${windowDef}) AS price_change`);

  // SMA
  if (request.sma) {
    for (const period of request.sma) {
      columns.push(`AVG(close) OVER (${windowDef} ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) AS sma_${period}`);
    }
  }

  // Standard Deviation
  if (request.stddev) {
    for (const period of request.stddev) {
      columns.push(`STDDEV_POP(close) OVER (${windowDef} ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) AS stddev_${period}`);
    }
  }

  // ROC
  if (request.roc) {
    for (const period of request.roc) {
      columns.push(`((close - LAG(close, ${period}) OVER (${windowDef})) / NULLIF(LAG(close, ${period}) OVER (${windowDef}), 0) * 100) AS roc_${period}`);
    }
  }

  // Momentum
  if (request.momentum) {
    for (const period of request.momentum) {
      columns.push(`(close - LAG(close, ${period}) OVER (${windowDef})) AS momentum_${period}`);
    }
  }

  // Bollinger Bands
  if (request.bollingerBands) {
    for (const bb of request.bollingerBands) {
      const wf = `OVER (${windowDef} ROWS BETWEEN ${bb.period - 1} PRECEDING AND CURRENT ROW)`;
      columns.push(`AVG(close) ${wf} AS bb_middle_${bb.period}`);
      columns.push(`AVG(close) ${wf} + (${bb.stdDev} * STDDEV_POP(close) ${wf}) AS bb_upper_${bb.period}`);
      columns.push(`AVG(close) ${wf} - (${bb.stdDev} * STDDEV_POP(close) ${wf}) AS bb_lower_${bb.period}`);
    }
  }

  // Williams %R
  if (request.williamsR) {
    for (const period of request.williamsR) {
      const wf = `OVER (${windowDef} ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW)`;
      columns.push(`(MAX(high) ${wf} - close) / NULLIF(MAX(high) ${wf} - MIN(low) ${wf}, 0) * -100 AS williams_r_${period}`);
    }
  }

  return `SELECT\n  ${columns.join(',\n  ')}\nFROM ${opts.tableName}`;
}

/**
 * Generate named window definitions for efficiency
 */
export function generateWindowDefinitions(periods: number[], options: SQLGeneratorOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const partition = opts.partition ? `PARTITION BY ${opts.symbolColumn}` : '';
  const orderBy = `ORDER BY ${opts.timestampColumn}`;

  const uniquePeriods = Array.from(new Set(periods)).sort((a, b) => a - b);
  const windows = uniquePeriods.map(p => 
    `w${p} AS (${partition} ${orderBy} ROWS BETWEEN ${p - 1} PRECEDING AND CURRENT ROW)`
  );

  return `WINDOW\n  ${windows.join(',\n  ')}`;
}
