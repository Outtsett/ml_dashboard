import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rowsBack, rollingStd, shiftForward } from './helpers';

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
  const span = Math.max(1, horizon);

  // Two things QuestDB refuses that this generator used to do:
  //   1. a window function inside an aggregate's argument
  //      (`STDDEV_POP(LN(close / LAG(close,1) OVER (...))) OVER (...)`
  //       -> "Invalid column: LAG"), so log_return is materialised first;
  //   2. `N FOLLOWING` as a frame end, so the forward volatility over
  //      [t, t+h-1] is computed as a BACKWARD window and pulled back with
  //      LEAD(..., h-1). See `shiftForward` in helpers.
  const backwardVol = (() => {
    switch (method) {
      case 'parkinson':
        return `SQRT(1.0 / (4.0 * LN(2.0)) * AVG(POWER(LN(high / low), 2)) ${rowsBack(span - 1, cfg)})`;
      case 'garman_klass':
        return `SQRT(AVG(0.5 * POWER(LN(high / low), 2) - (2 * LN(2) - 1) * POWER(LN(close / open), 2)) ${rowsBack(span - 1, cfg)})`;
      default:
        return rollingStd('log_return', span - 1, cfg);
    }
  })();

  return `
WITH base AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    open,
    high,
    low,
    LN(close / LAG(close, 1) ${windowOver(cfg)}) as log_return
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
trailing AS (
  SELECT
    timestamp,
    symbol,
    close,
    log_return,
    ${backwardVol} as trailing_volatility
  FROM base
),
shifted AS (
  SELECT
    timestamp,
    symbol,
    close,
    ${shiftForward('trailing_volatility', span - 1, cfg)} as future_volatility
  FROM trailing
)
SELECT
  timestamp,
  symbol,
  close,
  future_volatility as label
FROM shifted
WHERE future_volatility IS NOT NULL
  AND future_volatility > 0
ORDER BY timestamp`;
}
