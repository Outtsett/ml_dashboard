/**
 * Label Service Helpers
 *
 * Shared utilities for label generation: QuestDB queries and timestamp handling.
 */

import type { MetaLabelParams } from './sqlLabelGenerators';

/** All timeframes use the base ohlcv table with SAMPLE BY at query time. */
export function getTimeframeTable(_timeframeMinutes?: number): string {
  return 'ohlcv';
}

/** Convert a timestamp value (Date, string, number, bigint) to epoch milliseconds. */
function toEpochMs(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'bigint') return Number(val);
  if (val instanceof Date) {
    // No offset arithmetic. The pg-wire driver used to parse QuestDB's
    // zone-less wall clock as LOCAL time, and this subtracted the host offset
    // to undo that. The serving layer is DuckDB with `SET TimeZone='UTC'` and
    // hands back a correct UTC Date, so the subtraction had become the bug it
    // was written to fix: every preview timestamp arrived seven hours early on
    // this UTC-7 host (2024-06-01T17:00Z for the 2024-06-02T00:00Z daily bar),
    // and the resolver read every pre-rolled table's coverage as ending seven
    // hours before it does.
    return val.getTime();
  }
  if (typeof val === 'string') return new Date(val).getTime();
  return Number(val);
}

/**
 * How long a label query may run before the serving layer interrupts it.
 *
 * Express cuts the socket at 30s, so a query that outlives that answered
 * nobody. Without a deadline of its own it kept running anyway — un-cancellable
 * — and every later label request queued behind it. Measured: a preview that
 * takes 2s on an idle server timed out at 60s while an earlier unbounded query
 * was still holding the engine.
 */
export const LABEL_QUERY_TIMEOUT_MS = 25_000;

/**
 * Execute label SQL against the lake serving layer and return results with
 * numeric timestamps. The deadline is passed through to DuckDB so a runaway
 * query is interrupted, not merely abandoned.
 */
export async function queryLabels(
  sql: string,
  timeoutMs: number = LABEL_QUERY_TIMEOUT_MS,
): Promise<Array<Record<string, unknown>>> {
  const { queryQuestDB } = await import('../../database/questdb');
  const rows = await queryQuestDB(sql, timeoutMs);
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
 * Inlines direction labels as a CTE — no temp tables needed.
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
  const primarySource = metaParams.primarySource ?? 'trailing_momentum';
  const primaryLookback = Math.max(1, Number(metaParams.primaryLookback ?? 20));
  const primaryThreshold = Math.max(0, Number(metaParams.primaryThresholdBps ?? 10)) / 10000;
  const wo = `OVER (PARTITION BY symbol ORDER BY timestamp)`;
  // Inside meta_base two aliased relations both expose symbol/timestamp, so the
  // window there must qualify its columns — unqualified gives
  // "Ambiguous column [name=symbol]".
  const woQualified = `OVER (PARTITION BY o.symbol ORDER BY o.timestamp)`;

  // The primary model. Meta-labelling asks "when this signal fires, is it worth
  // taking?", so the signal has to be one that exists at bar t. The original
  // primary here was sign(close[t+1] - close[t]) — a perfect one-bar oracle —
  // which made every meta-label a statement about a signal nobody could have
  // held. It survives only as an explicitly named leakage self-test.
  const primaryExpr = primarySource === 'next_bar_oracle'
    ? `CASE WHEN future_close IS NULL THEN 0 WHEN future_close >= close THEN 1 ELSE -1 END`
    : `CASE
      WHEN past_close IS NULL OR past_close = 0 THEN 0
      WHEN (close - past_close) / past_close > ${primaryThreshold} THEN 1
      WHEN (close - past_close) / past_close < -${primaryThreshold} THEN -1
      ELSE 0
    END`;

  return `
WITH dir_source AS (
  SELECT timestamp, symbol, close,
    LEAD(close, 1) ${wo} as future_close,
    LAG(close, ${primaryLookback}) ${wo} as past_close
  FROM ${tableName}
  WHERE symbol = '${symbol}'
),
primary_labels AS (
  SELECT timestamp, symbol, close,
    ${primaryExpr} as ${primaryCol}
  FROM dir_source
),
meta_base AS (
  SELECT o.timestamp, o.symbol, o.close,
    p.${primaryCol} as primary_signal,
    LEAD(o.close, ${metaHorizon}) ${woQualified} as future_close
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
