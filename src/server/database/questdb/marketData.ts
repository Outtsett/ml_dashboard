/**
 * QuestDB Market Data Queries — OHLCV, rollover stitching, symbol stats.
 *
 * Unified schema: single `ohlcv` table for all asset classes (futures, forex,
 * equities, crypto) with `asset_class` and `root` SYMBOL columns.
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

/** Timeframe label -> materialized view name */
const MAT_VIEW: Record<string, string> = {
  "5m": "ohlcv_5m",
  "15m": "ohlcv_15m",
  "30m": "ohlcv_30m",
  "1h": "ohlcv_1h",
  "4h": "ohlcv_4h",
  "1d": "ohlcv_1d",
  "1w": "ohlcv_1w",
};

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
  // Futures root symbols: use fast root-column query for 1m (base table),
  // rollover stitching only for higher timeframes where price continuity matters
  if (isFuturesRoot(symbol)) {
    if (timeframe === "1m") {
      return getFastRootOHLCV(symbol, startTime, endTime, limit);
    }
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

  // Try materialized view first (ohlcv_5m, ohlcv_1h, etc.)
  const matView = MAT_VIEW[timeframe];
  if (matView) {
    const sql = `
      SELECT symbol, timestamp, open, high, low, close, volume
      FROM ${matView}
      ${whereClause}
      ORDER BY timestamp
      ${limitClause}
    `;
    try {
      const rows = await queryQuestDB(sql);
      if (rows.length > 0) return rows;
    } catch {
      // Fallback to SAMPLE BY if view doesn't exist
    }
  }

  // Fallback: SAMPLE BY on base table
  const sampleByClause = SAMPLE_BY[timeframe] || "SAMPLE BY 1m";

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

    // Use root column (SYMBOL INDEX) instead of regex scan
    const dailyBars = await queryQuestDB<{ symbol: string; timestamp: Date | string; volume: number }>(
      `SELECT symbol, timestamp, sum(volume) as volume FROM ohlcv
       WHERE root = '${escaped}' AND asset_class = 'futures'
       AND symbol != '${escaped}'${timeFilter}
       SAMPLE BY 1d ALIGN TO CALENDAR
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

  const makeQuery = (range: { symbol: string; start: string; end: string }) => {
    const sym = range.symbol.replace(/'/g, "''");
    const s = range.start + 'T00:00:00.000Z';
    const e = range.end + 'T23:59:59.999Z';

    const matView = MAT_VIEW[timeframe];
    if (matView) {
      return queryQuestDB(
        `SELECT symbol, timestamp, open, high, low, close, volume
         FROM ${matView}
         WHERE symbol = '${sym}' AND timestamp >= '${s}' AND timestamp <= '${e}'
         ORDER BY timestamp`
      );
    }
    const sampleBy = SAMPLE_BY[timeframe] || 'SAMPLE BY 1m';
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

export async function getStitchedOHLCV(
  root: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number,
  adjustment: AdjustmentMode = "none",
): Promise<StitchedOHLCVBar[]> {
  const safeLimit = limit ? Math.min(Math.floor(limit), 100000) : undefined;

  let schedule: import("../../lib/rollover").RolloverRecord[] = [];
  try {
    schedule = await getRolloverSchedule(root);
  } catch {
    // fall back
  }

  if (schedule.length === 0) {
    const fallbackBars = await getFrontMonthOHLCV(root, timeframe, startTime, endTime, limit);
    return fallbackBars.map((r: any) => ({ ...r, activeContract: r.symbol }));
  }

  const segments = buildContractSegments(schedule, startTime, endTime);
  if (segments.length === 0) return [];

  const querySegment = (seg: typeof segments[number]) => {
    const sym = seg.contract.replace(/'/g, "''");
    const s = seg.start;
    const e = seg.end;

    const matView = MAT_VIEW[timeframe];
    if (matView) {
      return queryQuestDB(
        `SELECT symbol, timestamp, open, high, low, close, volume
         FROM ${matView}
         WHERE symbol = '${sym}' AND timestamp >= '${s}' AND timestamp <= '${e}'
         ORDER BY timestamp`
      );
    }
    const sampleBy = SAMPLE_BY[timeframe] || "SAMPLE BY 1m";
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
  const rows = await queryQuestDB<{ symbol: string }>(
    `SELECT DISTINCT symbol FROM ohlcv_1d ORDER BY symbol`
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
