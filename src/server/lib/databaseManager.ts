/**
 * Database Manager — OHLCV query orchestration.
 *
 * Pure business logic for querying OHLCV data from QuestDB with
 * time-window estimation, caching, and row normalization.
 * Extracted from the /ohlcv/:symbol route handler (SRP).
 */

import { checkQuestDBHealth, getOHLCVSampleBy, queryQuestDB } from '../questdb';
import { ohlcvCache, cachedQuery, OHLCVCache } from './ohlcvCache';
import { normalizeTimestamp } from './normalize';

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
}

// ─── Timeframe Parsing ──────────────────────────────────────

/**
 * Parse a timeframe string (e.g. "1m", "5m", "1h", "1d", "30s") into minutes.
 * Defaults to 1 minute for unrecognised formats.
 */
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

/**
 * When the caller provides no start/end time, estimate a reasonable window
 * by looking up the latest timestamp for the symbol in QuestDB and working
 * backwards based on the requested bar count and timeframe.
 *
 * Returns the estimated start timestamp (epoch-ms), or undefined if
 * estimation is not possible (QuestDB unhealthy, no data, etc.).
 */
export async function estimateTimeWindow(
  symbol: string,
  tfLabel: string,
  limitNum: number,
  qdbHealthy: boolean,
): Promise<number | undefined> {
  if (!qdbHealthy) return undefined;

  try {
    const safeEsc = symbol.replace(/'/g, "''");
    const [row] = await queryQuestDB(
      `SELECT max(timestamp) as latest FROM ohlcv WHERE symbol = '${safeEsc}'`,
    );
    if (!row?.latest) return undefined;

    const latestMs =
      row.latest instanceof Date
        ? row.latest.getTime()
        : new Date(String(row.latest)).getTime();

    const tfMinutes = parseTimeframeMinutes(tfLabel);

    // 3x multiplier provides a comfortable buffer to ensure we fetch enough bars
    return latestMs - limitNum * tfMinutes * 3 * 60_000;
  } catch {
    /* fall through without estimation */
    return undefined;
  }
}

// ─── Main OHLCV Query ───────────────────────────────────────

/**
 * Full OHLCV query pipeline: health check, time-window estimation,
 * cache lookup, QuestDB SAMPLE BY query, and row normalization.
 *
 * Returns an array of normalized OHLCV rows. Returns an empty array
 * when QuestDB is unavailable or the query fails.
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

  // Check QuestDB availability
  let qdbHealthy = false;
  try {
    qdbHealthy = await checkQuestDBHealth();
  } catch {}

  // Estimate time window when no start/end provided
  let effectiveStart = startMs;
  let effectiveEnd = endMs;
  if (!effectiveStart && !effectiveEnd) {
    const estimated = await estimateTimeWindow(symbol, tfLabel, limitNum, qdbHealthy);
    if (estimated !== undefined) {
      effectiveStart = estimated;
    }
  }

  // Build cache key
  const cacheKey = OHLCVCache.key('ohlcv', symbol, 0, {
    startTime: effectiveStart,
    endTime: effectiveEnd,
    limit: limitNum,
  });

  if (!qdbHealthy) return [];

  try {
    const data = await cachedQuery(cacheKey, () =>
      getOHLCVSampleBy(symbol, tfLabel, effectiveStart, effectiveEnd, limitNum),
    );

    return data.map((r: any) => ({
      timestamp: normalizeTimestamp(r.timestamp),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));
  } catch (qdbErr: any) {
    console.warn('[ohlcv] QuestDB query failed:', qdbErr.message);
    return [];
  }
}
