import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver } from './helpers';

export interface MultiStepParams {
  steps?: number;
  horizons?: number[] | number;
  target?: string;
  aggregation?: 'mean' | 'sum' | 'last';
}

export function generateMultiStepLabelsSQL(
  params: MultiStepParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  // Support both direct 'steps' param and taxonomy 'horizons' array
  const declared = Array.isArray(params.horizons) ? params.horizons.map(Number).filter(Number.isFinite) : [];
  const steps = Math.max(1, Math.floor(
    Number(params.steps) > 0 ? Number(params.steps)
      : declared.length > 0 ? Math.max(...declared)
      : Number(params.horizons) > 0 ? Number(params.horizons) : 5,
  ));
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
    (${aggregatedValue} - close) / NULLIF(close, 0) as target_return_fraction,
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
  label,
  ${steps} as resolution_bars,
  target_return_fraction
FROM labeled
WHERE label IS NOT NULL
ORDER BY timestamp`;
}
