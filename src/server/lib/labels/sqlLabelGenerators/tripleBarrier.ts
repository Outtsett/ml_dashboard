import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rowsBetween } from './helpers';

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
