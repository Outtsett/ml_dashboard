/**
 * Supervised label generators: Direction, Triple Barrier, NPMM,
 * Volatility-Adaptive, Trend-Scanning, Meta-Label
 */

import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rowsBetween } from './helpers';

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
    END as label
  FROM with_pnl
  WHERE net_pnl IS NOT NULL
)
SELECT * FROM labeled
ORDER BY timestamp`;
}
