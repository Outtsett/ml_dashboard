/**
 * QuestDB Market Data Queries — OHLCV, front-month stitching, symbol stats.
 *
 * Unified schema: single `ohlcv` table for all asset classes (futures, forex,
 * equities, crypto) with `asset_class` and `root` SYMBOL columns.
 *
 * Futures continuous contracts are built by volume-based front-month detection
 * directly from OHLCV data — no separate rollovers table needed.
 */

import { validateSymbol } from "@shared/schema";
import type { StitchedOHLCVBar } from "@shared/ohlcv";
import { cachedQuery, OHLCVCache } from "../../cache/ohlcv";
import { queryQuestDB, queryQuestDBFast } from "./connection";
import { isFuturesRoot } from "../../lib/futures";

// ─── Instrument Detection (kept for downstream consumers) ────────────────────

export type InstrumentType = "forex" | "futures_contract" | "futures_root" | "generic";

export function detectInstrumentType(symbol: string): InstrumentType {
  const s = symbol.toUpperCase();
  if (s.length === 6 && !/\d/.test(s)) return "forex";
  if (s.includes("/")) return "forex";
  const futuresContractMatch = s.match(/^([A-Z]+)[FGHJKMNQUVXZ]\d{1,2}$/);
  if (futuresContractMatch) return "futures_contract";
  const futuresRootMatch = s.match(/^[A-Z]{1,4}$/);
  if (futuresRootMatch) return "futures_root";
  return "generic";
}

/** All instrument types now use the unified ohlcv table. */
export function getBaseTableForType(_type: InstrumentType): string {
  return "ohlcv";
}

// ─── Materialized View Lookup ───────────────────────────────────────────────

/** Timeframe → SAMPLE BY clause. All resampling is on-the-fly from base ohlcv table. */
const SAMPLE_BY: Record<string, string> = {
  "1m": "SAMPLE BY 1m", "5m": "SAMPLE BY 5m",
  "15m": "SAMPLE BY 15m", "30m": "SAMPLE BY 30m",
  "1h": "SAMPLE BY 1h", "4h": "SAMPLE BY 4h",
  "1d": "SAMPLE BY 1d", "1w": "SAMPLE BY 7d",
};

// ─── Validation Helpers ─────────────────────────────────────────────────────

function validatePositiveInt(value: number | undefined, maxValue: number = 1000000): number {
  if (value === undefined) return 0;
  const intVal = Math.floor(value);
  if (isNaN(intVal) || intVal < 0 || intVal > maxValue) {
    throw new Error("Invalid numeric value");
  }
  return intVal;
}

// ─── OHLCV Queries ──────────────────────────────────────────────────────────

export async function getOHLCVSampleBy(
  symbol: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<any[]> {
  // Futures root symbols: always use volume-based stitching at ALL timeframes.
  // This ensures the chart always shows the highest-volume (front-month) contract
  // with seamless rollover — no mixed contracts from different expirations.
  if (isFuturesRoot(symbol)) {
    return getStitchedOHLCV(symbol, timeframe, startTime, endTime, limit);
  }

  const safeSymbol = validateSymbol(symbol);
  const safeStartTime = startTime ? validatePositiveInt(startTime, Number.MAX_SAFE_INTEGER) : undefined;
  const safeEndTime = endTime ? validatePositiveInt(endTime, Number.MAX_SAFE_INTEGER) : undefined;
  const safeLimit = limit ? validatePositiveInt(limit, 100000) : undefined;

  const escapedSymbol = safeSymbol.replace(/'/g, "''");
  let whereClause = `WHERE symbol = '${escapedSymbol}'`;
  if (safeStartTime) {
    whereClause += ` AND timestamp >= '${new Date(safeStartTime).toISOString()}'`;
  }
  if (safeEndTime) {
    whereClause += ` AND timestamp <= '${new Date(safeEndTime).toISOString()}'`;
  }

  const limitClause = safeLimit ? `LIMIT ${safeLimit}` : "";
  const sampleByClause = SAMPLE_BY[timeframe] || "SAMPLE BY 1m";

  const sql = `
    SELECT
      symbol,
      timestamp,
      first(open) as open,
      max(high) as high,
      min(low) as low,
      last(close) as close,
      sum(volume) as volume,
      -- Anatomy (First Principles)
      CASE 
        WHEN (max(high) - min(low)) > 0 THEN abs(last(close) - first(open)) / (max(high) - min(low)) 
        ELSE 0 
      END as body_magnitude,
      CASE 
        WHEN (max(high) - min(low)) > 0 THEN (max(high) - CASE WHEN last(close) > first(open) THEN last(close) ELSE first(open) END) / (max(high) - min(low))
        ELSE 0 
      END as upper_wick_pct,
      CASE 
        WHEN (max(high) - min(low)) > 0 THEN (CASE WHEN last(close) > first(open) THEN first(open) ELSE last(close) END - min(low)) / (max(high) - min(low))
        ELSE 0 
      END as lower_wick_pct,
      (last(close) > first(open)) as is_bullish
    FROM ohlcv
    ${whereClause}
    ${sampleByClause}
    ALIGN TO CALENDAR
    ${limitClause}
  `;

  return await queryQuestDBFast(sql);
}

// ─── Front-Month Stitching ──────────────────────────────────────────────────

/**
 * Get the full front-month date ranges for a futures root (no time filters).
 * Cached aggressively with a long-lived key so paginated requests don't re-scan.
 */
async function getFullFrontMonthRanges(
  root: string,
): Promise<{ symbol: string; start: string; end: string }[]> {
  const safeRoot = validateSymbol(root);

  const cacheKey = OHLCVCache.key('questdb', `fm_${safeRoot}`, 'ranges_full', {});

  return cachedQuery(cacheKey, async () => {
    const escaped = safeRoot.replace(/'/g, "''");

    const dailyBars = await queryQuestDB<{ symbol: string; timestamp: Date | string; volume: number }>(
      `SELECT symbol, timestamp, sum(volume) as volume FROM ohlcv
       WHERE root = '${escaped}' AND asset_class = 'futures'
       
       SAMPLE BY 1d ALIGN TO CALENDAR
       ORDER BY timestamp`,
      30_000, // 30s timeout — this is the heaviest single query in the pipeline
    );

    if (dailyBars.length === 0) return [];

    const leaders = new Map<string, { symbol: string; volume: number }>();
    for (const bar of dailyBars) {
      const day = bar.timestamp instanceof Date
        ? bar.timestamp.toISOString().slice(0, 10)
        : new Date(String(bar.timestamp)).toISOString().slice(0, 10);
      const vol = Number(bar.volume);
      const existing = leaders.get(day);
      if (!existing || vol > existing.volume) {
        leaders.set(day, { symbol: bar.symbol, volume: vol });
      }
    }

    const ranges: { symbol: string; start: string; end: string }[] = [];
    let current: { symbol: string; start: string; end: string } | null = null;
    for (const [day, { symbol }] of [...leaders.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!current || current.symbol !== symbol) {
        if (current) ranges.push(current);
        current = { symbol, start: day, end: day };
      } else {
        current.end = day;
      }
    }
    if (current) ranges.push(current);

    return ranges;
  });
}

export async function getFrontMonthRanges(
  root: string,
  startTime?: number,
  endTime?: number,
): Promise<{ symbol: string; start: string; end: string }[]> {
  // Fetch the full (unbounded) ranges — cached aggressively
  const allRanges = await getFullFrontMonthRanges(root);
  if (allRanges.length === 0) return allRanges;

  // If no time filters, return everything
  if (!startTime && !endTime) return allRanges;

  // Filter ranges that overlap [startTime, endTime]
  const startDay = startTime
    ? new Date(startTime).toISOString().slice(0, 10)
    : '0000-01-01';
  const endDay = endTime
    ? new Date(endTime).toISOString().slice(0, 10)
    : '9999-12-31';

  return allRanges.filter(r => r.end >= startDay && r.start <= endDay);
}

export async function getFrontMonthOHLCV(
  root: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<any[]> {
  const safeLimit = limit ? Math.min(Math.floor(limit), 100000) : undefined;

  const ranges = await getFrontMonthRanges(root, startTime, endTime);
  if (ranges.length === 0) return [];

  const sampleBy = SAMPLE_BY[timeframe] || 'SAMPLE BY 1m';

  // Build a single UNION ALL query to eliminate N+1 round-trips.
  // Each range gets its own sub-select with SAMPLE BY, then we sort the union.
  // QuestDB supports UNION ALL between SAMPLE BY queries.
  const MAX_RANGES_PER_QUERY = 50; // QuestDB may have limits on query complexity
  let allBars: any[] = [];

  for (let i = 0; i < ranges.length; i += MAX_RANGES_PER_QUERY) {
    const batch = ranges.slice(i, i + MAX_RANGES_PER_QUERY);

    const unionParts = batch.map(range => {
      const sym = range.symbol.replace(/'/g, "''");
      const s = range.start + 'T00:00:00.000Z';
      const e = range.end + 'T23:59:59.999Z';
      return `(SELECT symbol, timestamp, first(open) as open, max(high) as high,
                min(low) as low, last(close) as close, sum(volume) as volume,
                -- Anatomy
                CASE WHEN (max(high)-min(low))>0 THEN abs(last(close)-first(open))/(max(high)-min(low)) ELSE 0 END as body_magnitude,
                CASE WHEN (max(high)-min(low))>0 THEN (max(high)-CASE WHEN last(close)>first(open) THEN last(close) ELSE first(open) END)/(max(high)-min(low)) ELSE 0 END as upper_wick_pct,
                CASE WHEN (max(high)-min(low))>0 THEN (CASE WHEN last(close)>first(open) THEN first(open) ELSE last(close) END-min(low))/(max(high)-min(low)) ELSE 0 END as lower_wick_pct,
                (last(close) > first(open)) as is_bullish
         FROM ohlcv
         WHERE symbol = '${sym}' AND timestamp >= '${s}' AND timestamp <= '${e}'
         ${sampleBy} ALIGN TO CALENDAR)`;
    });

    const sql = unionParts.join('\nUNION ALL\n') + '\nORDER BY timestamp';
    const rows = await queryQuestDBFast(sql); // 30s timeout
    allBars = allBars.concat(rows);
  }

  allBars.sort((a, b) => {
    const tsA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
    const tsB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
    return tsA - tsB;
  });

  if (safeLimit && allBars.length > safeLimit) {
    allBars = allBars.slice(0, safeLimit);
  }

  return allBars;
}

// ─── Fast Root Query (1m, no stitching — uses root SYMBOL INDEX) ─────────────

async function getFastRootOHLCV(
  root: string,
  startTime?: number,
  endTime?: number,
  limit?: number,
): Promise<any[]> {
  const escaped = root.replace(/'/g, "''");
  let where = `WHERE root = '${escaped}' AND asset_class = 'futures'`;
  if (startTime) where += ` AND timestamp >= '${new Date(startTime).toISOString()}'`;
  if (endTime) where += ` AND timestamp <= '${new Date(endTime).toISOString()}'`;
  const lim = limit ? `LIMIT ${Math.min(Math.floor(limit), 100000)}` : "";

  const sql = `
    SELECT symbol, timestamp, open, high, low, close, volume
    FROM ohlcv
    ${where}
    ORDER BY timestamp DESC
    ${lim}
  `;
  const rows = await queryQuestDB(sql);
  rows.reverse(); // return ASC
  return rows;
}

// ─── Rollover-Driven Stitching ───────────────────────────────────────────────

/**
 * Build a continuous futures contract by volume-based front-month detection.
 * Each bar comes from whichever contract had the highest daily volume.
 * No separate rollovers table — derived entirely from OHLCV data.
 *
 * Returns bars with `activeContract` populated so the client can display
 * rollover boundaries on the HUD.
 */
export async function getStitchedOHLCV(
  root: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number,
  _adjustment?: string,
): Promise<StitchedOHLCVBar[]> {
  const bars = await getFrontMonthOHLCV(root, timeframe, startTime, endTime, limit);
  return bars.map((r: any) => ({
    timestamp: r.timestamp,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
    activeContract: r.symbol,
  }));
}

// ─── Symbol Stats ───────────────────────────────────────────────────────────

export async function getSymbolsInQuestDB(): Promise<string[]> {
  const rows = await queryQuestDB<{ symbol: string }>(
    `SELECT DISTINCT symbol FROM symbols ORDER BY symbol`
  );
  return rows.map(r => r.symbol);
}

export async function getSymbolStats(symbol: string): Promise<{
  symbol: string;
  rowCount: number;
  earliest: Date;
  latest: Date;
  timeSpanDays: number;
}> {
  const safeSymbol = validateSymbol(symbol);
  const escapedSymbol = safeSymbol.replace(/'/g, "''");

  const sql = `
    SELECT
      symbol,
      count() as row_count,
      min(timestamp) as earliest,
      max(timestamp) as latest
    FROM ohlcv
    WHERE symbol = '${escapedSymbol}'
  `;

  const result = await queryQuestDB<any>(sql);

  if (result.length === 0 || !result[0].row_count) {
    throw new Error(`No data found for symbol ${safeSymbol}`);
  }

  const row = result[0];
  const earliest = new Date(row.earliest);
  const latest = new Date(row.latest);
  const timeSpanDays = (latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24);

  return {
    symbol: row.symbol,
    rowCount: parseInt(row.row_count),
    earliest,
    latest,
    timeSpanDays: Math.round(timeSpanDays * 100) / 100
  };
}
