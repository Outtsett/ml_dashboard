/**
 * OHLCV Query Orchestration — health check, time-window estimation,
 * caching, and row normalization.
 *
 * Updated to handle separate Forex/Futures markets and automated rollover stitching.
 */

import { checkQuestDBHealth, getOHLCVSampleBy, queryQuestDB } from '.';
import { cachedQuery, OHLCVCache } from '../../cache/ohlcv';
import { normalizeTimestamp } from '../../lib/normalize';
import { detectInstrumentType, getBaseTableForType } from './marketData';

// ─── Types ──────────────────────────────────────────────────

export interface OHLCVQueryParams {
  symbol: string;
  timeframe?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export interface NormalizedOHLCVRow {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  activeContract?: string; // For stitched futures
}

// ─── Timeframe Parsing ──────────────────────────────────────

export function parseTimeframeMinutes(tf: string): number {
  const match = tf.match(/^(\d+)(s|m|h|d)?$/i);
  if (!match) return 1;

  const value = parseInt(match[1]!);
  const unit = (match[2] || 'm').toLowerCase();

  switch (unit) {
    case 's': return value / 60;
    case 'm': return value;
    case 'h': return value * 60;
    case 'd': return value * 1440;
    default:  return value;
  }
}

// ─── Time Window Estimation ─────────────────────────────────

export async function estimateTimeWindow(
  symbol: string,
  tfLabel: string,
  limitNum: number,
  qdbHealthy: boolean,
): Promise<number | undefined> {
  if (!qdbHealthy) return undefined;

  try {
    const type = detectInstrumentType(symbol);
    const baseTable = getBaseTableForType(type);
    const safeEsc = symbol.replace(/'/g, "''");
    
    // For futures roots, we might not have data in the base table with that symbol
    // but the stitching logic handles it. We'll check the base table for the root
    // or one of its contracts.
    let sql = `SELECT max(timestamp) as latest FROM ${baseTable} WHERE symbol = '${safeEsc}'`;
    if (type === "futures_root") {
      sql = `SELECT max(timestamp) as latest FROM ${baseTable} WHERE root = '${safeEsc}'`;
    }

    const [row] = await queryQuestDB<{ latest: Date | string | null }>(sql);
    if (!row?.latest) return undefined;

    const latestMs =
      row.latest instanceof Date
        ? row.latest.getTime()
        : new Date(String(row.latest)).getTime();

    const tfMinutes = parseTimeframeMinutes(tfLabel);
    return latestMs - limitNum * tfMinutes * 3 * 60_000;
  } catch {
    return undefined;
  }
}

// ─── Main OHLCV Query ───────────────────────────────────────

/**
 * Full OHLCV query pipeline:
 * 1. Health check
 * 2. Instrument detection (Forex vs Futures vs Root)
 * 3. Time-window estimation
 * 4. Cache lookup
 * 5. QuestDB Query (Sampled or Stitched)
 * 6. Normalization
 */
export async function queryOHLCV(params: OHLCVQueryParams): Promise<NormalizedOHLCVRow[]> {
  const {
    symbol,
    timeframe,
    startTime: startMs,
    endTime: endMs,
    limit,
  } = params;

  const tfLabel = timeframe || '1m';
  const limitNum = limit ?? 500;

  let qdbHealthy = false;
  try {
    qdbHealthy = await checkQuestDBHealth();
  } catch {}

  if (!qdbHealthy) return [];

  let effectiveStart = startMs;
  const effectiveEnd = endMs;
  if (!effectiveStart && !effectiveEnd) {
    const estimated = await estimateTimeWindow(symbol, tfLabel, limitNum, qdbHealthy);
    if (estimated !== undefined) {
      effectiveStart = estimated;
    }
  }

  const cacheKey = OHLCVCache.key('ohlcv', symbol, 0, {
    startTime: effectiveStart,
    endTime: effectiveEnd,
    limit: limitNum,
    extra: tfLabel,
  });

  try {
    const data = await cachedQuery(cacheKey, () =>
      getOHLCVSampleBy(symbol, tfLabel, effectiveStart, effectiveEnd, limitNum),
    );

    return data.map((r) => ({
      timestamp: normalizeTimestamp(r.timestamp),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      activeContract: ("activeContract" in r && r.activeContract) || ("symbol" in r ? r.symbol : undefined),
    }));
  } catch (qdbErr) {
    console.warn('[ohlcv] QuestDB query failed:', (qdbErr as Error).message);
    return [];
  }
}
