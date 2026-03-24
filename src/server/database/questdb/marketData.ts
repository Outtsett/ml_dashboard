/**
 * QuestDB Market Data Queries — OHLCV, rollover stitching, symbol stats.
 *
 * Updated to support separate tables for Forex and Futures.
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
  "1m": "_1m",
  "5m": "_5m",
  "15m": "_15m",
  "30m": "_30m",
  "1h": "_1h",
  "4h": "_4h",
  "1d": "_1d",
  "1w": "_1w",
};

// ─── Instrument Detection ───────────────────────────────────────────────────

export type InstrumentType = "forex" | "futures_contract" | "futures_root" | "generic";

export function detectInstrumentType(symbol: string): InstrumentType {
  const s = symbol.toUpperCase();
  // Forex: AUDUSD, EURJPY, etc. (6 chars) or EUR/USD
  if (s.length === 6 && !/\d/.test(s)) return "forex";
  if (s.includes("/")) return "forex";

  // Futures Contract: MNQZ24 (Root + Month + Year)
  const futuresContractMatch = s.match(/^([A-Z]+)[FGHJKMNQUVXZ]\d{1,2}$/);
  if (futuresContractMatch) return "futures_contract";

  // Futures Root: ES, MNQ, NQ, CL (1-4 uppercase letters)
  const futuresRootMatch = s.match(/^[A-Z]{1,4}$/);
  if (futuresRootMatch) return "futures_root";

  return "generic";
}

export function getBaseTableForType(type: InstrumentType): string {
  switch (type) {
    case "forex": return "ohlcv_forex";
    case "futures_contract":
    case "futures_root": return "ohlcv";  // futures data lives in legacy ohlcv table
    default: return "ohlcv";
  }
}

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
  const type = detectInstrumentType(symbol);
  
  // If it's a futures root, we must use the stitching logic instead
  if (type === "futures_root") {
    const bars = await getStitchedOHLCV(symbol, timeframe, startTime, endTime, limit);
    return bars;
  }

  const baseTable = getBaseTableForType(type);
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

  // Try materialized view first (e.g. ohlcv_forex_5m, ohlcv_5m)
  const suffix = MATERIALIZED_VIEWS[timeframe];
  if (suffix) {
    const matView = `${baseTable}${suffix}`;
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
      // Fallback to sample by if view doesn't exist
    }
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
    FROM ${baseTable}
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
      `SELECT symbol, timestamp, sum(volume) as volume FROM ohlcv
       WHERE symbol ~ '${contractRegex}'${timeFilter}
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

  const suffix = MATERIALIZED_VIEWS[timeframe];
  const validTimeframes: Record<string, string> = {
    '1m': 'SAMPLE BY 1m', '5m': 'SAMPLE BY 5m',
    '15m': 'SAMPLE BY 15m', '30m': 'SAMPLE BY 30m', '1h': 'SAMPLE BY 1h',
    '4h': 'SAMPLE BY 4h', '1d': 'SAMPLE BY 1d', '1w': 'SAMPLE BY 7d',
  };

  const makeQuery = (range: { symbol: string; start: string; end: string }) => {
    const sym = range.symbol.replace(/'/g, "''");
    const s = range.start + 'T00:00:00.000Z';
    const e = range.end + 'T23:59:59.999Z';

    if (suffix) {
      const matView = `ohlcv${suffix}`;
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

  const suffix = MATERIALIZED_VIEWS[timeframe];
  const validTimeframes: Record<string, string> = {
    "1m": "SAMPLE BY 1m", "5m": "SAMPLE BY 5m",
    "15m": "SAMPLE BY 15m", "30m": "SAMPLE BY 30m", "1h": "SAMPLE BY 1h",
    "4h": "SAMPLE BY 4h", "1d": "SAMPLE BY 1d", "1w": "SAMPLE BY 7d",
  };

  const querySegment = (seg: typeof segments[number]) => {
    const sym = seg.contract.replace(/'/g, "''");
    const s = seg.start;
    const e = seg.end;

    if (suffix) {
      const matView = `ohlcv${suffix}`;
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
  const forex = await queryQuestDB<{ symbol: string }>(`SELECT DISTINCT symbol FROM ohlcv_forex`);
  const futures = await queryQuestDB<{ symbol: string }>(`SELECT DISTINCT symbol FROM ohlcv WHERE symbol ~ '^[A-Z]{1,4}[FGHJKMNQUVXZ][0-9]{1,2}$'`);
  const legacy = await queryQuestDB<{ symbol: string }>(`SELECT DISTINCT symbol FROM ohlcv`);
  
  const all = new Set([
    ...forex.map(r => r.symbol),
    ...futures.map(r => r.symbol),
    ...legacy.map(r => r.symbol)
  ]);
  
  return [...all];
}

export async function getSymbolStats(symbol: string): Promise<{
  symbol: string;
  rowCount: number;
  earliest: Date;
  latest: Date;
  timeSpanDays: number;
}> {
  const safeSymbol = validateSymbol(symbol);
  const type = detectInstrumentType(symbol);
  const baseTable = getBaseTableForType(type);
  const escapedSymbol = safeSymbol.replace(/'/g, "''");

  const sql = `
    SELECT
      symbol,
      count() as row_count,
      min(timestamp) as earliest,
      max(timestamp) as latest
    FROM ${baseTable}
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

