import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver } from './helpers';

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

  // `returnCalc` contains a window function, so it cannot appear in a WHERE
  // clause ("window function is not allowed in WHERE clause"). Both branches
  // therefore project it in a CTE and filter the resulting column.
  const rawCTE = `raw_returns AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    ${returnCalc} as future_return
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
)`;

  if (!normalize) {
    return `
WITH ${rawCTE}
SELECT
  timestamp,
  symbol,
  close,
  future_return as label
FROM raw_returns
WHERE future_return IS NOT NULL
ORDER BY timestamp`;
  }

  return `
WITH ${rawCTE},
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
ORDER BY r.timestamp`;
}
