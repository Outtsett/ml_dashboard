import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rowsBetween } from './helpers';

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
