import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver } from './helpers';

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
