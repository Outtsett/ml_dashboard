/**
 * QuestDB Market Data Queries — OHLCV, rollover stitching, symbol stats.
 *
 * Used by chart rendering, training export, and analytics.
 */

import { validateSymbol } from "@shared/schema";
import type { AdjustmentMode, StitchedOHLCVBar } from "@shared/ohlcv";
import { cachedQuery, OHLCVCache } from "../../lib/ohlcvCache";
import { queryQuestDB } from "./connection";
import {
  getRolloverSchedule,
  buildContractSegments,
  applyAdjustment,
} from "../../lib/rollover";

// ─── Materialized View Lookup ───────────────────────────────────────────────

const MATERIALIZED_VIEWS: Record<string, string> = {
  "5m": "ohlcv_5m",
  "15m": "ohlcv_15m",
  "30m": "ohlcv_30m",
  "1h": "ohlcv_1h",
  "4h": "ohlcv_4h",
  "1d": "ohlcv_1d",
  "1w": "ohlcv_1w",
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

  // Try materialized view first
  const matView = MATERIALIZED_VIEWS[timeframe];
  if (matView) {
    const sql = `
      SELECT symbol, timestamp, open, high, low, close, volume
      FROM ${matView}
      ${whereClause}
      ORDER BY timestamp
      ${limitClause}
    `;
    const rows = await queryQuestDB(sql);
    if (rows.length > 0) return rows;
  }

  // Fallback: SAMPLE BY on base table
  const validTimeframes: Record<string, string> = {
    "1m": "SAMPLE BY 1m", "5m": "SAMPLE BY 5m",
    "15m": "SAMPLE BY 15m", "30m": "SAMPLE BY 30m",
    "1h": "SAMPLE BY 1h", "4h": "SAMPLE BY 4h",
    "1d": "SAMPLE BY 1d", "1w": "SAMPLE BY 7d",
  };

  const sampleByClause = validTimeframes[timeframe] || "SAMPLE BY 1m";

  const sql = `
    SELECT
      symbol,
      timestamp,
      first(open) as open,
      max(high) as high,
      min(low) as low,
      last(close) as close,
      sum(volume) as volume
    FROM ohlcv
    ${whereClause}
    ${sampleByClause}
    ALIGN TO CALENDAR
    ${limitClause}
  `;

  return await queryQuestDB(sql);
}

// ─── Front-Month Stitching ──────────────────────────────────────────────────

export async function getFrontMonthRanges(
  root: string,
  startTime?: number,
  endTime?: number,
): Promise<{ symbol: string; start: string; end: string }[]> {
  const safeRoot = validateSymbol(root);

  const cacheKey = OHLCVCache.key('questdb', `fm_${safeRoot}`, 'ranges', {
    startTime, endTime,
  });

  return cachedQuery(cacheKey, async () => {
    const escaped = safeRoot.replace(/'/g, "''");
    const contractRegex = `^${escaped}[FGHJKMNQUVXZ][0-9]{1,2}$`;

    // Floor start / ceil end to day boundaries — ohlcv_1d bars sit at midnight,
    // so a sub-day startTime would miss the current day's daily bar.
    let timeFilter = '';
    if (startTime) {
      const dayStart = new Date(startTime);
      dayStart.setUTCHours(0, 0, 0, 0);
      timeFilter += ` AND timestamp >= '${dayStart.toISOString()}'`;
    }
    if (endTime) {
      const dayEnd = new Date(endTime);
      dayEnd.setUTCHours(23, 59, 59, 999);
      timeFilter += ` AND timestamp <= '${dayEnd.toISOString()}'`;
    }

    const dailyBars = await queryQuestDB<{ symbol: string; timestamp: Date | string; volume: number }>(
      `SELECT symbol, timestamp, volume FROM ohlcv_1d
       WHERE symbol ~ '${contractRegex}'${timeFilter}
       ORDER BY timestamp`
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

  const matView = MATERIALIZED_VIEWS[timeframe];
  const validTimeframes: Record<string, string> = {
    '1m': 'SAMPLE BY 1m', '5m': 'SAMPLE BY 5m',
    '15m': 'SAMPLE BY 15m', '30m': 'SAMPLE BY 30m', '1h': 'SAMPLE BY 1h',
    '4h': 'SAMPLE BY 4h', '1d': 'SAMPLE BY 1d', '1w': 'SAMPLE BY 7d',
  };

  const makeQuery = (range: { symbol: string; start: string; end: string }) => {
    const sym = range.symbol.replace(/'/g, "''");
    const s = range.start + 'T00:00:00.000Z';
    const e = range.end + 'T23:59:59.999Z';

    if (matView) {
      return queryQuestDB(
        `SELECT symbol, timestamp, open, high, low, close, volume
         FROM ${matView}
         WHERE symbol = '${sym}' AND timestamp >= '${s}' AND timestamp <= '${e}'
         ORDER BY timestamp`
      );
    }
    const sampleBy = validTimeframes[timeframe] || 'SAMPLE BY 1m';
    return queryQuestDB(
      `SELECT symbol, timestamp, first(open) as open, max(high) as high,
              min(low) as low, last(close) as close, sum(volume) as volume
       FROM ohlcv
       WHERE symbol = '${sym}' AND timestamp >= '${s}' AND timestamp <= '${e}'
       ${sampleBy} ALIGN TO CALENDAR`
    );
  };

  let allBars: any[] = [];
  const BATCH_SIZE = 10;
  for (let i = 0; i < ranges.length; i += BATCH_SIZE) {
    const batch = ranges.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(makeQuery));
    allBars = allBars.concat(results.flat());
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

// ─── Rollover-Driven Stitching ───────────────────────────────────────────────

/**
 * Fetch rollover-stitched OHLCV bars for a futures root symbol.
 *
 * Uses the pre-computed `rollovers` table (near-instant lookup) instead of
 * volume-based front-month scanning. Applies Panama additive or ratio
 * back-adjustment so chart prices are gap-free across roll boundaries.
 *
 * Falls back to volume-based `getFrontMonthOHLCV()` when no rollover data
 * exists for the requested root.
 */
export async function getStitchedOHLCV(
  root: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number,
  adjustment: AdjustmentMode = "none",
): Promise<StitchedOHLCVBar[]> {
  const safeLimit = limit ? Math.min(Math.floor(limit), 100000) : undefined;

  // Step 1: Get rollover schedule from cache (24h TTL)
  let schedule: import("../../lib/rollover").RolloverRecord[] = [];
  try {
    schedule = await getRolloverSchedule(root);
  } catch {
    // rollovers table may not exist — fall back
  }

  // Fall back to volume-based stitching if no rollover data
  if (schedule.length === 0) {
    const fallbackBars = await getFrontMonthOHLCV(root, timeframe, startTime, endTime, limit);
    return fallbackBars.map((r: any) => ({ ...r, activeContract: r.symbol }));
  }

  // Step 2: Build per-contract segments from roll boundaries
  const segments = buildContractSegments(schedule, startTime, endTime);
  if (segments.length === 0) return [];

  // Step 3: Query each segment's bars and apply adjustment
  const matView = MATERIALIZED_VIEWS[timeframe];
  const validTimeframes: Record<string, string> = {
    "1m": "SAMPLE BY 1m", "5m": "SAMPLE BY 5m",
    "15m": "SAMPLE BY 15m", "30m": "SAMPLE BY 30m", "1h": "SAMPLE BY 1h",
    "4h": "SAMPLE BY 4h", "1d": "SAMPLE BY 1d", "1w": "SAMPLE BY 7d",
  };

  const querySegment = (seg: typeof segments[number]) => {
    const sym = seg.contract.replace(/'/g, "''");
    const s = seg.start;
    const e = seg.end;

    if (matView) {
      return queryQuestDB(
        `SELECT symbol, timestamp, open, high, low, close, volume
         FROM ${matView}
         WHERE symbol = '${sym}' AND timestamp >= '${s}' AND timestamp <= '${e}'
         ORDER BY timestamp`
      );
    }
    const sampleBy = validTimeframes[timeframe] || "SAMPLE BY 1m";
    return queryQuestDB(
      `SELECT symbol, timestamp, first(open) as open, max(high) as high,
              min(low) as low, last(close) as close, sum(volume) as volume
       FROM ohlcv
       WHERE symbol = '${sym}' AND timestamp >= '${s}' AND timestamp <= '${e}'
       ${sampleBy} ALIGN TO CALENDAR`
    );
  };

  let allBars: StitchedOHLCVBar[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (seg) => {
        const raw = await querySegment(seg);
        return applyAdjustment(raw, seg.contract, seg, adjustment);
      })
    );
    allBars = allBars.concat(results.flat());
  }

  // Step 4: Sort chronologically and apply limit
  allBars.sort((a, b) => {
    const tsA = typeof a.timestamp === "number" ? a.timestamp : new Date(String(a.timestamp)).getTime();
    const tsB = typeof b.timestamp === "number" ? b.timestamp : new Date(String(b.timestamp)).getTime();
    return tsA - tsB;
  });

  if (safeLimit && allBars.length > safeLimit) {
    allBars = allBars.slice(allBars.length - safeLimit);
  }

  return allBars;
}

// ─── Symbol Stats ───────────────────────────────────────────────────────────

export async function getSymbolsInQuestDB(): Promise<string[]> {
  const sql = `SELECT DISTINCT symbol FROM ohlcv`;
  const result = await queryQuestDB<{ symbol: string }>(sql);
  return result.map(r => r.symbol);
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
