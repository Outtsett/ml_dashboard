/**
 * Label Service Helpers
 *
 * Shared utilities for label generation: QuestDB queries and timestamp handling.
 */

import type { MetaLabelParams } from './sqlLabelGenerators';

/** Map timeframe in minutes to QuestDB materialized view name. */
export function getTimeframeTable(timeframeMinutes?: number): string {
  if (!timeframeMinutes || timeframeMinutes <= 1) return 'ohlcv';
  const map: Record<number, string> = {
    5: 'ohlcv_5m',
    15: 'ohlcv_15m',
    30: 'ohlcv_30m',
    60: 'ohlcv_1h',
    240: 'ohlcv_4h',
    1440: 'ohlcv_1d',
    10080: 'ohlcv_1w',
  };
  return map[timeframeMinutes] || 'ohlcv';
}

/** Convert a timestamp value (Date, string, number, bigint) to epoch milliseconds. */
function toEpochMs(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'bigint') return Number(val);
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string') return new Date(val).getTime();
  return Number(val);
}

/**
 * Execute label SQL against QuestDB and return results with numeric timestamps.
 * Uses PG wire protocol for standard SQL execution.
 */
export async function queryLabels(sql: string): Promise<Array<Record<string, unknown>>> {
  const { queryQuestDB } = await import('../../database/questdb');
  const rows = await queryQuestDB(sql);
  return rows.map((row: Record<string, unknown>) => {
    const converted = { ...row };
    if (converted.timestamp !== undefined && converted.timestamp !== null) {
      converted.timestamp = toEpochMs(converted.timestamp);
    }
    return converted;
  });
}

/**
 * Build a combined SQL for meta_label that inlines direction labels as a CTE.
 * Avoids the need for a DuckDB temp table — runs entirely on QuestDB.
 */
export function buildMetaLabelSQL(
  metaParams: MetaLabelParams,
  symbol: string,
  tableName: string = 'ohlcv',
): string {
  const txCost = (metaParams.transactionCostBps || 10) / 10000;
  const minProfit = (metaParams.minProfitBps || 20) / 10000;
  const primaryCol = metaParams.primarySignalColumn || 'label';
  const metaHorizon = metaParams.horizon || 5;
  const wo = `OVER (PARTITION BY symbol ORDER BY timestamp)`;

  return `
WITH dir_source AS (
  SELECT timestamp, symbol, close,
    LEAD(close, 1) ${wo} as future_close
  FROM ${tableName}
  WHERE symbol = '${symbol}'
),
primary_labels AS (
  SELECT timestamp, symbol, close,
    CASE WHEN future_close >= close THEN 1 ELSE -1 END as ${primaryCol}
  FROM dir_source
  WHERE future_close IS NOT NULL
),
meta_base AS (
  SELECT o.timestamp, o.symbol, o.close,
    p.${primaryCol} as primary_signal,
    LEAD(o.close, ${metaHorizon}) ${wo} as future_close
  FROM ${tableName} o
  INNER JOIN primary_labels p ON o.timestamp = p.timestamp AND o.symbol = p.symbol
  WHERE o.symbol = '${symbol}'
),
with_pnl AS (
  SELECT timestamp, symbol, close, primary_signal, future_close,
    CASE
      WHEN primary_signal = 0 OR future_close IS NULL THEN NULL
      ELSE primary_signal * (future_close - close) / close - ${txCost}
    END as net_pnl
  FROM meta_base
  WHERE primary_signal != 0
),
meta_labeled AS (
  SELECT timestamp, symbol, close, primary_signal, net_pnl,
    CASE WHEN net_pnl >= ${minProfit} THEN 1 ELSE 0 END as label
  FROM with_pnl
  WHERE net_pnl IS NOT NULL
)
SELECT * FROM meta_labeled
ORDER BY timestamp`;
}

// Backward-compat type export
export interface LoadOHLCVOptions {
  symbol: string;
  limit?: number;
  startTimestamp?: number;
  endTimestamp?: number;
  timeframeMinutes?: number;
}
