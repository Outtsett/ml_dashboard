/**
 * DuckDB SQL Label Generators
 * 
 * Vectorized SQL implementations of label generation methods for ML training.
 * These run efficiently on large datasets using DuckDB's columnar engine.
 */

export interface LabelGeneratorConfig {
  symbol: string;
  tableName?: string;
  timestampColumn?: string;
  symbolColumn?: string;
}

const DEFAULT_CONFIG: Partial<LabelGeneratorConfig> = {
  tableName: 'ohlcv',
  timestampColumn: 'timestamp',
  symbolColumn: 'symbol',
};

// ============================================================================
// HELPER SQL FRAGMENTS
// ============================================================================

function partitionClause(config: LabelGeneratorConfig): string {
  return `PARTITION BY ${config.symbolColumn || 'symbol'}`;
}

function orderClause(config: LabelGeneratorConfig): string {
  return `ORDER BY ${config.timestampColumn || 'timestamp'}`;
}

function windowOver(config: LabelGeneratorConfig): string {
  return `OVER (${partitionClause(config)} ${orderClause(config)})`;
}

function rowsBetween(before: number, after: number, config: LabelGeneratorConfig): string {
  const beforeClause = before === 0 ? 'CURRENT ROW' : `${before} PRECEDING`;
  const afterClause = after === 0 ? 'CURRENT ROW' : `${after} FOLLOWING`;
  return `OVER (${partitionClause(config)} ${orderClause(config)} ROWS BETWEEN ${beforeClause} AND ${afterClause})`;
}

// ============================================================================
// DIRECTION LABELS (Simple)
// ============================================================================

export interface DirectionParams {
  horizon: number;
  threshold: number;
  numClasses: 2 | 3;
}

export function generateDirectionLabelsSQL(
  params: DirectionParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { horizon, threshold, numClasses } = params;
  const thresholdDecimal = threshold / 100;
  
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
    (future_close - close) / close as future_return,
    CASE 
      WHEN future_close IS NULL THEN NULL
      ${numClasses === 3 ? `
      WHEN (future_close - close) / close > ${thresholdDecimal} THEN 1
      WHEN (future_close - close) / close < -${thresholdDecimal} THEN -1
      ELSE 0
      ` : `
      WHEN future_close >= close THEN 1
      ELSE -1
      `}
    END as label
  FROM base
)
SELECT 
  timestamp,
  symbol,
  close,
  future_return,
  label
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}

// ============================================================================
// TRIPLE BARRIER LABELS
// ============================================================================

export interface TripleBarrierParams {
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldingPeriod: number;
  minReturn: number;
  volatilityAdjust: boolean;
  volatilityWindow: number;
}

export function generateTripleBarrierLabelsSQL(
  params: TripleBarrierParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { takeProfitPct, stopLossPct, maxHoldingPeriod, minReturn, volatilityAdjust, volatilityWindow } = params;
  
  const tpDecimal = takeProfitPct / 100;
  const slDecimal = stopLossPct / 100;
  const minRetDecimal = minReturn / 100;
  
  // Generate LEAD columns for looking forward
  const leadColumns = Array.from({ length: maxHoldingPeriod }, (_, i) => 
    `LEAD(high, ${i + 1}) ${windowOver(cfg)} as future_high_${i + 1},
     LEAD(low, ${i + 1}) ${windowOver(cfg)} as future_low_${i + 1},
     LEAD(close, ${i + 1}) ${windowOver(cfg)} as future_close_${i + 1}`
  ).join(',\n    ');
  
  // Generate barrier hit detection
  const barrierChecks = Array.from({ length: maxHoldingPeriod }, (_, i) => {
    const idx = i + 1;
    return `
      WHEN future_high_${idx} >= upper_barrier AND future_low_${idx} <= lower_barrier THEN 
        CASE WHEN (future_high_${idx} - close) / close >= (close - future_low_${idx}) / close THEN 1 ELSE -1 END
      WHEN future_high_${idx} >= upper_barrier THEN 1
      WHEN future_low_${idx} <= lower_barrier THEN -1`;
  }).join('');
  
  const volAdjustSQL = volatilityAdjust ? `
log_returns AS (
  SELECT 
    timestamp,
    LN(close / LAG(close, 1) ${windowOver(cfg)}) as log_return
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
vol_calc AS (
  SELECT 
    timestamp,
    log_return,
    STDDEV_POP(log_return) ${rowsBetween(volatilityWindow - 1, 0, cfg)} as rolling_vol
  FROM log_returns
),
vol_stats AS (
  SELECT AVG(rolling_vol) as avg_vol FROM vol_calc WHERE rolling_vol IS NOT NULL
),
vol_ratio AS (
  SELECT 
    v.timestamp,
    v.rolling_vol / NULLIF(s.avg_vol, 0) as vol_scale
  FROM vol_calc v
  CROSS JOIN vol_stats s
),
  ` : '';
  
  return `
WITH returns_calc AS (
  SELECT 
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    open, high, low, close, volume,
    LN(close / LAG(close, 1) ${windowOver(cfg)}) as log_return
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
${volAdjustSQL}
with_barriers AS (
  SELECT 
    r.timestamp,
    r.symbol,
    r.close,
    ${volatilityAdjust ? 
      `r.close * (1 + ${tpDecimal} * COALESCE(v.vol_scale, 1)) as upper_barrier,
       r.close * (1 - ${slDecimal} * COALESCE(v.vol_scale, 1)) as lower_barrier,` :
      `r.close * (1 + ${tpDecimal}) as upper_barrier,
       r.close * (1 - ${slDecimal}) as lower_barrier,`}
    ${leadColumns}
  FROM returns_calc r
  ${volatilityAdjust ? 'LEFT JOIN vol_ratio v ON r.timestamp = v.timestamp' : ''}
),
labeled AS (
  SELECT 
    timestamp,
    symbol,
    close,
    upper_barrier,
    lower_barrier,
    future_close_${maxHoldingPeriod} as exit_close,
    CASE 
      ${barrierChecks}
      WHEN future_close_${maxHoldingPeriod} IS NOT NULL THEN 0
      ELSE NULL
    END as label,
    CASE 
      WHEN future_close_${maxHoldingPeriod} IS NOT NULL 
      THEN (future_close_${maxHoldingPeriod} - close) / close 
      ELSE NULL 
    END as exit_return
  FROM with_barriers
)
SELECT 
  timestamp,
  symbol,
  close,
  label,
  exit_return,
  upper_barrier,
  lower_barrier
FROM labeled
WHERE label IS NOT NULL
  AND ABS(exit_return) >= ${minRetDecimal}
ORDER BY timestamp`;
}

// ============================================================================
// N-PERIOD MIN-MAX (NPMM) LABELS
// ============================================================================

export interface NPMMParams {
  lookbackPeriod: number;
  lookforwardPeriod: number;
  confirmationBars: number;
  minMovePct: number;
}

export function generateNPMMLabelsSQL(
  params: NPMMParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { lookbackPeriod, lookforwardPeriod, confirmationBars, minMovePct } = params;
  const minMoveDecimal = minMovePct / 100;
  
  return `
WITH base AS (
  SELECT 
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    ROW_NUMBER() ${windowOver(cfg)} as row_num,
    MIN(close) ${rowsBetween(lookbackPeriod, lookforwardPeriod, cfg)} as window_min,
    MAX(close) ${rowsBetween(lookbackPeriod, lookforwardPeriod, cfg)} as window_max,
    LEAD(close, ${confirmationBars}) ${windowOver(cfg)} as future_close_confirm,
    MAX(close) ${rowsBetween(0, lookforwardPeriod, cfg)} as max_after,
    MIN(close) ${rowsBetween(0, lookforwardPeriod, cfg)} as min_after
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
extrema AS (
  SELECT 
    timestamp,
    symbol,
    close,
    row_num,
    window_min,
    window_max,
    future_close_confirm,
    max_after,
    min_after,
    CASE 
      WHEN close = window_min AND future_close_confirm > close THEN 1  -- Local min (buy signal)
      WHEN close = window_max AND future_close_confirm < close THEN -1 -- Local max (sell signal)
      ELSE NULL
    END as raw_label,
    CASE 
      WHEN close = window_min THEN (max_after - close) / close
      WHEN close = window_max THEN (close - min_after) / close
      ELSE NULL
    END as move_size
  FROM base
),
filtered AS (
  SELECT 
    timestamp,
    symbol,
    close,
    raw_label as label,
    move_size
  FROM extrema
  WHERE raw_label IS NOT NULL
    AND move_size >= ${minMoveDecimal}
)
SELECT * FROM filtered
ORDER BY timestamp`;
}

// ============================================================================
// VOLATILITY-ADAPTIVE DIRECTION LABELS
// ============================================================================

export interface VolatilityAdaptiveParams {
  horizon: number;
  volatilityWindow: number;
  threshold: number;
  numClasses: 2 | 3;
}

export function generateVolatilityAdaptiveLabelsSQL(
  params: VolatilityAdaptiveParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { horizon, volatilityWindow, threshold, numClasses } = params;
  
  return `
WITH returns_calc AS (
  SELECT 
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    (close - LAG(close, 1) ${windowOver(cfg)}) / LAG(close, 1) ${windowOver(cfg)} as return_1bar,
    LEAD(close, ${horizon}) ${windowOver(cfg)} as future_close
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
with_volatility AS (
  SELECT 
    timestamp,
    symbol,
    close,
    return_1bar,
    future_close,
    (future_close - close) / close as future_return,
    STDDEV_POP(return_1bar) ${rowsBetween(volatilityWindow - 1, 0, cfg)} as rolling_vol
  FROM returns_calc
),
labeled AS (
  SELECT 
    timestamp,
    symbol,
    close,
    future_return,
    rolling_vol,
    future_return / NULLIF(rolling_vol, 0) as z_score,
    CASE 
      WHEN future_close IS NULL OR rolling_vol IS NULL OR rolling_vol = 0 THEN NULL
      ${numClasses === 3 ? `
      WHEN ABS(future_return) >= ${threshold} * rolling_vol AND future_return > 0 THEN 1
      WHEN ABS(future_return) >= ${threshold} * rolling_vol AND future_return < 0 THEN -1
      ELSE 0
      ` : `
      WHEN future_return >= 0 THEN 1
      ELSE -1
      `}
    END as label
  FROM with_volatility
)
SELECT 
  timestamp,
  symbol,
  close,
  future_return,
  rolling_vol,
  z_score,
  label
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}

// ============================================================================
// TREND-SCANNING LABELS
// ============================================================================

export interface TrendScanningParams {
  minHorizon: number;
  maxHorizon: number;
  tThreshold: number;
  minSamples: number;
}

export function generateTrendScanningLabelsSQL(
  params: TrendScanningParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { minHorizon, maxHorizon, tThreshold } = params;
  
  // Generate horizon-specific t-stat calculations
  // Simplified: use slope sign and magnitude as proxy for t-stat
  const horizonCalcs = Array.from(
    { length: maxHorizon - minHorizon + 1 }, 
    (_, i) => {
      const h = minHorizon + i;
      return `
        (LEAD(close, ${h}) ${windowOver(cfg)} - close) / close / ${h} as slope_${h},
        ABS((LEAD(close, ${h}) ${windowOver(cfg)} - close) / close) / 
          NULLIF(STDDEV_POP((close - LAG(close, 1) ${windowOver(cfg)}) / LAG(close, 1) ${windowOver(cfg)}) 
            ${rowsBetween(h - 1, 0, cfg)}, 0) as pseudo_tstat_${h}`;
    }
  ).join(',\n    ');
  
  // Find best horizon
  const horizonComparisons = Array.from(
    { length: maxHorizon - minHorizon + 1 },
    (_, i) => `pseudo_tstat_${minHorizon + i}`
  ).join(', ');
  
  const slopeCases = Array.from(
    { length: maxHorizon - minHorizon + 1 },
    (_, i) => {
      const h = minHorizon + i;
      return `WHEN best_horizon = ${h} THEN slope_${h}`;
    }
  ).join('\n      ');
  
  const tstatCases = Array.from(
    { length: maxHorizon - minHorizon + 1 },
    (_, i) => {
      const h = minHorizon + i;
      return `WHEN best_horizon = ${h} THEN pseudo_tstat_${h}`;
    }
  ).join('\n      ');
  
  return `
WITH horizon_stats AS (
  SELECT 
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    ${horizonCalcs}
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
with_best_horizon AS (
  SELECT 
    *,
    (SELECT h FROM (VALUES ${Array.from({ length: maxHorizon - minHorizon + 1 }, (_, i) => 
      `(${minHorizon + i}, pseudo_tstat_${minHorizon + i})`).join(', ')}) AS t(h, tstat) 
     ORDER BY tstat DESC NULLS LAST LIMIT 1) as best_horizon
  FROM horizon_stats
),
labeled AS (
  SELECT 
    timestamp,
    symbol,
    close,
    best_horizon,
    CASE 
      ${slopeCases}
    END as best_slope,
    CASE 
      ${tstatCases}
    END as best_tstat,
    CASE 
      WHEN (CASE ${tstatCases} END) >= ${tThreshold} THEN 
        CASE WHEN (CASE ${slopeCases} END) > 0 THEN 1 ELSE -1 END
      ELSE 0
    END as label
  FROM with_best_horizon
)
SELECT 
  timestamp,
  symbol,
  close,
  label,
  best_horizon as optimal_horizon,
  best_tstat as t_statistic,
  best_slope as trend_slope
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}

// ============================================================================
// META-LABEL GENERATION
// ============================================================================

export interface MetaLabelParams {
  primarySignalColumn: string;
  horizon: number;
  transactionCostBps: number;
  minProfitBps: number;
}

export function generateMetaLabelsSQL(
  params: MetaLabelParams,
  config: LabelGeneratorConfig,
  primaryLabelsTable: string = 'primary_labels'
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { primarySignalColumn, horizon, transactionCostBps, minProfitBps } = params;
  const txCost = transactionCostBps / 10000;
  const minProfit = minProfitBps / 10000;
  
  return `
WITH base AS (
  SELECT 
    o.${cfg.timestampColumn} as timestamp,
    o.${cfg.symbolColumn} as symbol,
    o.close,
    p.${primarySignalColumn} as primary_signal,
    LEAD(o.close, ${horizon}) ${windowOver(cfg)} as future_close
  FROM ${cfg.tableName} o
  INNER JOIN ${primaryLabelsTable} p ON o.${cfg.timestampColumn} = p.timestamp 
    AND o.${cfg.symbolColumn} = p.symbol
  WHERE o.${cfg.symbolColumn} = '${config.symbol}'
),
with_pnl AS (
  SELECT 
    timestamp,
    symbol,
    close,
    primary_signal,
    future_close,
    CASE 
      WHEN primary_signal = 0 OR future_close IS NULL THEN NULL
      ELSE primary_signal * (future_close - close) / close - ${txCost}
    END as net_pnl
  FROM base
  WHERE primary_signal != 0
),
labeled AS (
  SELECT 
    timestamp,
    symbol,
    close,
    primary_signal,
    net_pnl,
    CASE 
      WHEN net_pnl >= ${minProfit} THEN 1
      ELSE 0
    END as meta_label
  FROM with_pnl
  WHERE net_pnl IS NOT NULL
)
SELECT * FROM labeled
ORDER BY timestamp`;
}

// ============================================================================
// FUTURE RETURN (Regression Target)
// ============================================================================

export interface FutureReturnParams {
  horizon: number;
  returnType: 'simple' | 'log';
  normalize: boolean;
}

export function generateFutureReturnLabelsSQL(
  params: FutureReturnParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { horizon, returnType, normalize } = params;
  
  const returnCalc = returnType === 'log' 
    ? `LN(LEAD(close, ${horizon}) ${windowOver(cfg)} / close)` 
    : `(LEAD(close, ${horizon}) ${windowOver(cfg)} - close) / close`;
  
  const normalizeSQL = normalize ? `
WITH raw_returns AS (
  SELECT 
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    ${returnCalc} as future_return
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
stats AS (
  SELECT 
    AVG(future_return) as mean_return,
    STDDEV_POP(future_return) as std_return
  FROM raw_returns
  WHERE future_return IS NOT NULL
)
SELECT 
  r.timestamp,
  r.symbol,
  r.close,
  r.future_return as raw_return,
  (r.future_return - s.mean_return) / NULLIF(s.std_return, 0) as label
FROM raw_returns r
CROSS JOIN stats s
WHERE r.future_return IS NOT NULL
ORDER BY r.timestamp` : `
SELECT 
  ${cfg.timestampColumn} as timestamp,
  ${cfg.symbolColumn} as symbol,
  close,
  ${returnCalc} as label
FROM ${cfg.tableName}
WHERE ${cfg.symbolColumn} = '${config.symbol}'
  AND ${returnCalc} IS NOT NULL
ORDER BY timestamp`;

  return normalizeSQL;
}

// ============================================================================
// FUTURE VOLATILITY (Regression Target)
// ============================================================================

export interface FutureVolatilityParams {
  horizon: number;
  method: 'std' | 'parkinson' | 'garman_klass';
}

export function generateFutureVolatilityLabelsSQL(
  params: FutureVolatilityParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { horizon, method } = params;
  
  let volCalc: string;
  switch (method) {
    case 'parkinson':
      // Parkinson estimator: sqrt(1/(4*ln(2)) * mean(ln(H/L)^2))
      volCalc = `SQRT(1.0 / (4.0 * LN(2.0)) * AVG(POWER(LN(high / low), 2)) ${rowsBetween(0, horizon - 1, cfg)})`;
      break;
    case 'garman_klass':
      // Garman-Klass: sqrt(0.5*ln(H/L)^2 - (2*ln(2)-1)*ln(C/O)^2)
      volCalc = `SQRT(AVG(0.5 * POWER(LN(high / low), 2) - (2 * LN(2) - 1) * POWER(LN(close / open), 2)) ${rowsBetween(0, horizon - 1, cfg)})`;
      break;
    default: // std
      volCalc = `STDDEV_POP(LN(close / LAG(close, 1) ${windowOver(cfg)})) ${rowsBetween(0, horizon - 1, cfg)}`;
  }
  
  return `
WITH with_vol AS (
  SELECT 
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    open,
    high,
    low,
    LN(close / LAG(close, 1) ${windowOver(cfg)}) as log_return,
    ${volCalc} as future_volatility
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
)
SELECT 
  timestamp,
  symbol,
  close,
  future_volatility as label
FROM with_vol
WHERE future_volatility IS NOT NULL
  AND future_volatility > 0
ORDER BY timestamp`;
}

// ============================================================================
// MARKET REGIME LABELS
// ============================================================================

export interface MarketRegimeParams {
  volatilityWindow: number;
  trendWindow: number;
  numRegimes: number;
}

export function generateMarketRegimeLabelsSQL(
  params: MarketRegimeParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { volatilityWindow, trendWindow, numRegimes } = params;
  
  // Rule-based regime detection (simplified HMM-like)
  // Regimes: 0=low-vol-down, 1=low-vol-up, 2=high-vol-down, 3=high-vol-up
  return `
WITH metrics AS (
  SELECT 
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    -- Rolling volatility
    STDDEV_POP(LN(close / LAG(close, 1) ${windowOver(cfg)})) 
      ${rowsBetween(volatilityWindow - 1, 0, cfg)} as rolling_vol,
    -- Rolling trend (slope of close over trendWindow)
    (close - LAG(close, ${trendWindow}) ${windowOver(cfg)}) / 
      NULLIF(LAG(close, ${trendWindow}) ${windowOver(cfg)}, 0) as trend_pct
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
with_percentiles AS (
  SELECT 
    *,
    PERCENT_RANK() OVER (ORDER BY rolling_vol) as vol_pctile,
    PERCENT_RANK() OVER (ORDER BY trend_pct) as trend_pctile
  FROM metrics
  WHERE rolling_vol IS NOT NULL AND trend_pct IS NOT NULL
),
labeled AS (
  SELECT 
    timestamp,
    symbol,
    close,
    rolling_vol,
    trend_pct,
    vol_pctile,
    trend_pctile,
    CASE 
      ${numRegimes === 4 ? `
      WHEN vol_pctile < 0.5 AND trend_pct < 0 THEN 0  -- Low vol, down
      WHEN vol_pctile < 0.5 AND trend_pct >= 0 THEN 1 -- Low vol, up
      WHEN vol_pctile >= 0.5 AND trend_pct < 0 THEN 2 -- High vol, down
      ELSE 3  -- High vol, up
      ` : numRegimes === 3 ? `
      WHEN trend_pct > 0.01 THEN 2  -- Uptrend
      WHEN trend_pct < -0.01 THEN 0 -- Downtrend
      ELSE 1 -- Sideways
      ` : `
      WHEN trend_pct >= 0 THEN 1
      ELSE 0
      `}
    END as label
  FROM with_percentiles
)
SELECT 
  timestamp,
  symbol,
  close,
  label,
  rolling_vol,
  trend_pct,
  CASE label
    ${numRegimes === 4 ? `
    WHEN 0 THEN 'low_vol_down'
    WHEN 1 THEN 'low_vol_up'
    WHEN 2 THEN 'high_vol_down'
    ELSE 'high_vol_up'
    ` : numRegimes === 3 ? `
    WHEN 0 THEN 'downtrend'
    WHEN 1 THEN 'sideways'
    ELSE 'uptrend'
    ` : `
    WHEN 0 THEN 'bearish'
    ELSE 'bullish'
    `}
  END as regime_name
FROM labeled
ORDER BY timestamp`;
}

// ============================================================================
// SIGNAL LABELS (Buy/Sell/Hold)
// ============================================================================

export interface SignalParams {
  entryThreshold: number;
  exitThreshold: number;
  holdPeriod: number;
}

export function generateSignalLabelsSQL(
  params: SignalParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { entryThreshold, exitThreshold, holdPeriod } = params;
  const entryDecimal = entryThreshold / 100;
  const exitDecimal = exitThreshold / 100;
  
  return `
WITH base AS (
  SELECT 
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    LAG(close, 1) ${windowOver(cfg)} as prev_close,
    LEAD(close, ${holdPeriod}) ${windowOver(cfg)} as future_close
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
with_returns AS (
  SELECT
    timestamp,
    symbol,
    close,
    (close - prev_close) / NULLIF(prev_close, 0) as current_return,
    (future_close - close) / NULLIF(close, 0) as future_return
  FROM base
  WHERE prev_close IS NOT NULL
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    current_return,
    future_return,
    CASE
      WHEN future_return IS NULL THEN NULL
      WHEN future_return > ${entryDecimal} THEN 1   -- Buy signal
      WHEN future_return < -${exitDecimal} THEN -1  -- Sell signal
      ELSE 0                                         -- Hold
    END as label
  FROM with_returns
)
SELECT 
  timestamp,
  symbol,
  close,
  future_return,
  label
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}

// ============================================================================
// MULTI-STEP SEQUENCE LABELS
// ============================================================================

export interface MultiStepParams {
  steps: number;
  aggregation: 'mean' | 'sum' | 'last';
}

export function generateMultiStepLabelsSQL(
  params: MultiStepParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { steps, aggregation } = params;
  
  const futureColumns = Array.from({ length: steps }, (_, i) => 
    `LEAD(close, ${i + 1}) ${windowOver(cfg)} as future_close_${i + 1}`
  ).join(',\n    ');
  
  let aggregatedValue: string;
  if (aggregation === 'mean') {
    const cols = Array.from({ length: steps }, (_, i) => `future_close_${i + 1}`).join(' + ');
    aggregatedValue = `(${cols}) / ${steps}`;
  } else if (aggregation === 'sum') {
    aggregatedValue = Array.from({ length: steps }, (_, i) => `future_close_${i + 1}`).join(' + ');
  } else {
    aggregatedValue = `future_close_${steps}`;
  }
  
  return `
WITH base AS (
  SELECT 
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    ${futureColumns}
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    future_close_${steps} as final_close,
    (${aggregatedValue} - close) / NULLIF(close, 0) as target_return,
    CASE 
      WHEN future_close_${steps} IS NULL THEN NULL
      WHEN ${aggregatedValue} > close THEN 1
      ELSE 0
    END as label
  FROM base
)
SELECT 
  timestamp,
  symbol,
  close,
  target_return,
  label
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}

// ============================================================================
// PSEUDO CONFIDENCE LABELS (Semi-supervised)
// ============================================================================

export interface PseudoConfidenceParams {
  horizon: number;
  confidenceThreshold: number;
}

export function generatePseudoConfidenceLabelsSQL(
  params: PseudoConfidenceParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { horizon, confidenceThreshold } = params;
  const confDecimal = confidenceThreshold / 100;
  
  return `
WITH base AS (
  SELECT 
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    LEAD(close, ${horizon}) ${windowOver(cfg)} as future_close,
    STDDEV(close) ${rowsBetween(20, 0, cfg)} as local_vol
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
  perturbationStrength: number;
  consistencyWindow: number;
}

export function generateConsistencyPerturbationLabelsSQL(
  params: ConsistencyPerturbationParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { consistencyWindow } = params;
  
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

// ============================================================================
// EXPORT GENERATOR REGISTRY
// ============================================================================

export const LABEL_SQL_GENERATORS = {
  direction: generateDirectionLabelsSQL,
  triple_barrier: generateTripleBarrierLabelsSQL,
  npmm: generateNPMMLabelsSQL,
  volatility_adaptive: generateVolatilityAdaptiveLabelsSQL,
  trend_scanning: generateTrendScanningLabelsSQL,
  meta_label: generateMetaLabelsSQL,
  future_return: generateFutureReturnLabelsSQL,
  future_volatility: generateFutureVolatilityLabelsSQL,
  regime: generateMarketRegimeLabelsSQL,
  signal: generateSignalLabelsSQL,
  multi_step: generateMultiStepLabelsSQL,
  pseudo_confidence: generatePseudoConfidenceLabelsSQL,
  consistency_perturbation: generateConsistencyPerturbationLabelsSQL,
} as const;

export type LabelGeneratorType = keyof typeof LABEL_SQL_GENERATORS;
