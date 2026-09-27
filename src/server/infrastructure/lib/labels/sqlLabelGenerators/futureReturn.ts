/**
 * Future return — a continuous regression target.
 *
 * `normalize` divides the forward return by TRAILING statistics of the same
 * h-bar return measured backward (close[t] / close[t-h] - 1 over the last
 * `normalizationWindowBars` bars, NULL until the window is full). The previous
 * version standardised with the mean and deviation of the WHOLE queried range,
 * so a bar's label changed with the query's end date.
 */
import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rollingMean, rollingStd } from './helpers';

export interface FutureReturnParams {
  horizonBars?: number;
  returnType?: 'simple' | 'log';
  normalize?: boolean;
  normalizationWindowBars?: number;
}

export function generateFutureReturnLabelsSQL(
  params: FutureReturnParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const horizon = Math.max(1, Math.floor(Number(params.horizonBars ?? 1)));
  const returnType = params.returnType ?? 'simple';
  const normalize = Boolean(params.normalize);
  const window = Math.max(2, Math.floor(Number(params.normalizationWindowBars ?? 250)));

  const forward = returnType === 'log'
    ? `LN(LEAD(close, ${horizon}) ${windowOver(cfg)} / NULLIF(close, 0))`
    : `(LEAD(close, ${horizon}) ${windowOver(cfg)} - close) / NULLIF(close, 0)`;
  const backward = returnType === 'log'
    ? `LN(close / NULLIF(LAG(close, ${horizon}) ${windowOver(cfg)}, 0))`
    : `(close - LAG(close, ${horizon}) ${windowOver(cfg)}) / NULLIF(LAG(close, ${horizon}) ${windowOver(cfg)}, 0)`;

  const rawCTE = `raw_returns AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    close,
    ${forward} as future_return_fraction,
    ${backward} as trailing_return_fraction
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
  future_return_fraction as label,
  ${horizon} as resolution_bars,
  future_return_fraction
FROM raw_returns
WHERE future_return_fraction IS NOT NULL
ORDER BY timestamp`;
  }

  return `
WITH ${rawCTE},
trailing_statistics AS (
  SELECT
    timestamp, symbol, close, future_return_fraction,
    ${rollingMean('trailing_return_fraction', window - 1, cfg)} as trailing_return_mean_fraction,
    ${rollingStd('trailing_return_fraction', window - 1, cfg)} as trailing_return_standard_deviation_fraction
  FROM raw_returns
)
SELECT
  timestamp,
  symbol,
  close,
  (future_return_fraction - trailing_return_mean_fraction) / NULLIF(trailing_return_standard_deviation_fraction, 0) as label,
  ${horizon} as resolution_bars,
  future_return_fraction,
  trailing_return_mean_fraction,
  trailing_return_standard_deviation_fraction
FROM trailing_statistics
WHERE future_return_fraction IS NOT NULL
  AND trailing_return_standard_deviation_fraction IS NOT NULL
  AND trailing_return_standard_deviation_fraction > 0
ORDER BY timestamp`;
}
