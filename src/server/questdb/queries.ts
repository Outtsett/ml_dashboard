import { validateSymbol } from "@shared/schema";
import { cachedQuery, OHLCVCache } from "../lib/ohlcvCache";
import { queryQuestDB } from "./connection";

// Validate table name to prevent SQL injection
function validateTableName(tableName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(tableName)) {
    throw new Error("Invalid table name format");
  }
  return tableName;
}

// Validate positive integer
function validatePositiveInt(value: number | undefined, maxValue: number = 1000000): number {
  if (value === undefined) return 0;
  const intVal = Math.floor(value);
  if (isNaN(intVal) || intVal < 0 || intVal > maxValue) {
    throw new Error("Invalid numeric value");
  }
  return intVal;
}

/**
 * Materialized view lookup — pre-computed SAMPLE BY aggregations.
 * For these timeframes we query the view directly (no SAMPLE BY needed).
 * Views auto-refresh on new inserts into the base ohlcv table.
 */
const MATERIALIZED_VIEWS: Record<string, string> = {
  "5m": "ohlcv_5m",
  "15m": "ohlcv_15m",
  "30m": "ohlcv_30m",
  "1h": "ohlcv_1h",
  "4h": "ohlcv_4h",
  "1d": "ohlcv_1d",
  "1w": "ohlcv_1w",
};

export async function getOHLCVSampleBy(
  symbol: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<any[]> {
  // Validate inputs to prevent SQL injection
  const safeSymbol = validateSymbol(symbol);
  const safeStartTime = startTime ? validatePositiveInt(startTime, Number.MAX_SAFE_INTEGER) : undefined;
  const safeEndTime = endTime ? validatePositiveInt(endTime, Number.MAX_SAFE_INTEGER) : undefined;
  const safeLimit = limit ? validatePositiveInt(limit, 100000) : undefined;

  // Build WHERE clause with escaped symbol
  const escapedSymbol = safeSymbol.replace(/'/g, "''");
  let whereClause = `WHERE symbol = '${escapedSymbol}'`;
  if (safeStartTime) {
    whereClause += ` AND timestamp >= '${new Date(safeStartTime).toISOString()}'`;
  }
  if (safeEndTime) {
    whereClause += ` AND timestamp <= '${new Date(safeEndTime).toISOString()}'`;
  }

  const limitClause = safeLimit ? `LIMIT ${safeLimit}` : "";

  // Check if a materialized view exists for this timeframe
  const matView = MATERIALIZED_VIEWS[timeframe];
  if (matView) {
    // Query pre-computed materialized view directly — no SAMPLE BY needed
    const sql = `
      SELECT symbol, timestamp, open, high, low, close, volume
      FROM ${matView}
      ${whereClause}
      ORDER BY timestamp
      ${limitClause}
    `;
    const rows = await queryQuestDB(sql);
    // If view is still backfilling and returned 0 rows, fall back to SAMPLE BY
    if (rows.length > 0) return rows;
  }

  // Fallback: SAMPLE BY on the base ohlcv table (used for 1m or when views are empty)
  const validTimeframes: Record<string, string> = {
    "1m": "SAMPLE BY 1m",
    "5m": "SAMPLE BY 5m",
    "15m": "SAMPLE BY 15m",
    "30m": "SAMPLE BY 30m",
    "1h": "SAMPLE BY 1h",
    "4h": "SAMPLE BY 4h",
    "1d": "SAMPLE BY 1d",
    "1w": "SAMPLE BY 7d",
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

/**
 * Determine front-month contract ranges for a futures root.
 * Queries ohlcv_1d for daily volume leadership, returns contiguous
 * (contract, start, end) date ranges.
 *
 * Extracted so both chart queries and training export can reuse.
 */
export async function getFrontMonthRanges(
  root: string,
  startTime?: number,
  endTime?: number,
): Promise<{ symbol: string; start: string; end: string }[]> {
  const safeRoot = validateSymbol(root);

  // Cache key: daily volume leadership changes at most once per day
  const cacheKey = OHLCVCache.key('questdb', `fm_${safeRoot}`, 'ranges', {
    startTime, endTime,
  });

  return cachedQuery(cacheKey, async () => {
    const escaped = safeRoot.replace(/'/g, "''");
    const contractRegex = `^${escaped}[FGHJKMNQUVXZ][0-9]{1,2}$`;

    let timeFilter = '';
    if (startTime) {
      timeFilter += ` AND timestamp >= '${new Date(startTime).toISOString()}'`;
    }
    if (endTime) {
      timeFilter += ` AND timestamp <= '${new Date(endTime).toISOString()}'`;
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

/**
 * Query OHLCV for a futures root (e.g. "ES") by stitching front-month
 * contracts together based on daily volume leadership.
 *
 * Uses getFrontMonthRanges() for range detection, then queries bars
 * for each range in parallel batches.
 */
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

  // Query bars for each range in parallel
  const matView = MATERIALIZED_VIEWS[timeframe];
  const validTimeframes: Record<string, string> = {
    '1m': 'SAMPLE BY 1m', '5m': 'SAMPLE BY 5m',
    '15m': 'SAMPLE BY 15m', '30m': 'SAMPLE BY 30m', '1h': 'SAMPLE BY 1h',
    '4h': 'SAMPLE BY 4h', '1d': 'SAMPLE BY 1d', '1w': 'SAMPLE BY 7d',
  };

  // Build query functions for each range, execute in batches to avoid pool exhaustion
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

  // Execute in batches of 10 to stay within pool limits
  let allBars: any[] = [];
  const BATCH_SIZE = 10;
  for (let i = 0; i < ranges.length; i += BATCH_SIZE) {
    const batch = ranges.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(makeQuery));
    allBars = allBars.concat(results.flat());
  }

  // Sort chronologically
  allBars.sort((a, b) => {
    const tsA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
    const tsB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
    return tsA - tsB;
  });

  // Apply limit (keep oldest — matches SAMPLE BY + LIMIT behavior)
  if (safeLimit && allBars.length > safeLimit) {
    allBars = allBars.slice(0, safeLimit);
  }

  return allBars;
}

export async function getQuestDBTables(): Promise<any[]> {
  const sql = "SHOW TABLES;";
  return await queryQuestDB(sql);
}

export async function getQuestDBTableInfo(tableName: string): Promise<any[]> {
  // Validate table name to prevent SQL injection
  const safeTableName = validateTableName(tableName);
  const sql = `SHOW COLUMNS FROM ${safeTableName};`;
  return await queryQuestDB(sql);
}

export async function getQuestDBPartitions(tableName: string): Promise<any[]> {
  // Validate table name to prevent SQL injection
  const safeTableName = validateTableName(tableName);
  const escapedName = safeTableName.replace(/'/g, "''");
  const sql = `SELECT * FROM table_partitions('${escapedName}');`;
  return await queryQuestDB(sql);
}

export async function getQuestDBTableRowCount(tableName: string): Promise<number> {
  // Validate table name to prevent SQL injection
  const safeTableName = validateTableName(tableName);
  const result = await queryQuestDB<{ count: string }>(`SELECT count() as count FROM ${safeTableName};`);
  return parseInt(result[0]?.count || "0");
}

export async function getQuestDBTablePreview(tableName: string, limit = 100): Promise<any[]> {
  // Validate inputs to prevent SQL injection
  const safeTableName = validateTableName(tableName);
  const safeLimit = validatePositiveInt(limit, 1000);
  const sql = `SELECT * FROM ${safeTableName} LIMIT ${safeLimit};`;
  return await queryQuestDB(sql);
}

export async function getQuestDBStats(): Promise<any> {
  try {
    const tables = await getQuestDBTables();
    const stats: any = {
      connected: true,
      tables: tables.length,
      tableDetails: [],
    };
    
    for (const table of tables) {
      const tableName = table.table_name || table.name || table.tableName;
      if (tableName) {
        try {
          const rowCount = await getQuestDBTableRowCount(tableName);
          const partitions = await getQuestDBPartitions(tableName);
          stats.tableDetails.push({
            name: tableName,
            rowCount,
            partitionCount: partitions.length,
          });
        } catch (e) {
          stats.tableDetails.push({
            name: tableName,
            error: String(e),
          });
        }
      }
    }
    
    return stats;
  } catch (error) {
    return {
      connected: false,
      error: String(error),
    };
  }
}

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
