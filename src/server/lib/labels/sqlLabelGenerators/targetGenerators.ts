/**
 * Target/regression label generators: FutureReturn, FutureVolatility,
 * MarketRegime, Signal, MultiStep
 */

import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rowsBetween } from './helpers';

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
  horizons?: number[];
  target?: string;
  aggregation: 'mean' | 'sum' | 'last';
}

export function generateMultiStepLabelsSQL(
  params: MultiStepParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  // Support both direct 'steps' param and taxonomy 'horizons' array
  const steps = params.steps || (params.horizons ? Math.max(...(Array.isArray(params.horizons) ? params.horizons : [1])) : 5);
  const aggregation = params.aggregation || 'last';
  
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
