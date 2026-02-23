/**
 * Unified Ingestion Service
 * Coordinates writes across QuestDB and DuckDB
 * Ensures data consistency and provides a single entry point for market data ingestion
 */

import { validateSymbol } from "@shared/schema";
import { db } from "../db";
import { uploads, instruments } from "@shared/schema";
import { eq } from "drizzle-orm";

// Types for OHLCV data
export interface OHLCVRecord {
  symbol: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IngestionResult {
  success: boolean;
  recordsProcessed: number;
  errors: string[];
  targets: {
    questdb: { success: boolean; count: number; error?: string };
    duckdb: { success: boolean; count: number; error?: string };
  };
}

export interface IngestionOptions {
  batchSize?: number;
  skipQuestDB?: boolean;
  skipDuckDB?: boolean;
  validateData?: boolean;
  deduplicateByTimestamp?: boolean;
}

const DEFAULT_OPTIONS: IngestionOptions = {
  batchSize: 10000,
  skipQuestDB: false,
  skipDuckDB: false,
  validateData: true,
  deduplicateByTimestamp: true,
};

/**
 * Validate a single OHLCV record
 */
function validateOHLCVRecord(record: OHLCVRecord): string[] {
  const errors: string[] = [];
  
  if (!record.symbol || typeof record.symbol !== 'string') {
    errors.push('Invalid symbol');
  }
  
  if (!Number.isFinite(record.timestamp) || record.timestamp <= 0) {
    errors.push('Invalid timestamp');
  }
  
  if (!Number.isFinite(record.open) || record.open < 0) {
    errors.push('Invalid open price');
  }
  
  if (!Number.isFinite(record.high) || record.high < 0) {
    errors.push('Invalid high price');
  }
  
  if (!Number.isFinite(record.low) || record.low < 0) {
    errors.push('Invalid low price');
  }
  
  if (!Number.isFinite(record.close) || record.close < 0) {
    errors.push('Invalid close price');
  }
  
  if (!Number.isFinite(record.volume) || record.volume < 0) {
    errors.push('Invalid volume');
  }
  
  // OHLC sanity checks
  if (record.high < record.low) {
    errors.push('High price less than low price');
  }
  
  if (record.open > record.high || record.open < record.low) {
    errors.push('Open price outside high-low range');
  }
  
  if (record.close > record.high || record.close < record.low) {
    errors.push('Close price outside high-low range');
  }
  
  return errors;
}

/**
 * Deduplicate records by timestamp, keeping the latest value for each timestamp
 */
function deduplicateByTimestamp(records: OHLCVRecord[]): OHLCVRecord[] {
  const seen = new Map<string, OHLCVRecord>();
  
  for (const record of records) {
    const key = `${record.symbol}-${record.timestamp}`;
    seen.set(key, record); // Later records overwrite earlier ones
  }
  
  return Array.from(seen.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Ingest OHLCV data to QuestDB via ILP
 */
async function ingestToQuestDB(
  records: OHLCVRecord[],
  batchSize: number
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    // Dynamic import to avoid circular dependencies
    const { insertOHLCVBatch } = await import("../questdb");
    
    let totalInserted = 0;
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      // Convert timestamp number to Date for QuestDB OHLCVRow format
      const questdbBatch = batch.map(r => ({
        symbol: r.symbol,
        timestamp: new Date(r.timestamp),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      }));
      await insertOHLCVBatch(questdbBatch);
      totalInserted += batch.length;
    }
    
    return { success: true, count: totalInserted };
  } catch (error) {
    return { 
      success: false, 
      count: 0, 
      error: error instanceof Error ? error.message : 'Unknown QuestDB error' 
    };
  }
}

/**
 * Ingest OHLCV data to DuckDB (Parquet)
 */
async function ingestToDuckDB(
  records: OHLCVRecord[],
  symbol: string
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    // Dynamic import to avoid circular dependencies
    const { bulkLoadOHLCV } = await import("../duckdb");
    
    // bulkLoadOHLCV expects array with timestamp, open, high, low, close, volume
    const duckdbRecords = records.map(r => ({
      symbol: r.symbol,
      timestamp: r.timestamp,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
    
    await bulkLoadOHLCV(symbol, duckdbRecords);
    
    return { success: true, count: records.length };
  } catch (error) {
    return { 
      success: false, 
      count: 0, 
      error: error instanceof Error ? error.message : 'Unknown DuckDB error' 
    };
  }
}

/**
 * Main unified ingestion function
 * Coordinates writes across all database targets
 */
export async function ingestOHLCV(
  records: OHLCVRecord[],
  options: IngestionOptions = {}
): Promise<IngestionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const errors: string[] = [];
  
  // Validate and normalize symbol
  const symbols = new Set(records.map(r => r.symbol));
  if (symbols.size === 0) {
    return {
      success: false,
      recordsProcessed: 0,
      errors: ['No records provided'],
      targets: {
        questdb: { success: false, count: 0, error: 'No records' },
        duckdb: { success: false, count: 0, error: 'No records' },
      },
    };
  }
  
  // Normalize symbols
  let processedRecords = records.map(r => ({
    ...r,
    symbol: validateSymbol(r.symbol),
  }));
  
  // Validate data if enabled
  if (opts.validateData) {
    const validRecords: OHLCVRecord[] = [];
    
    for (const record of processedRecords) {
      const recordErrors = validateOHLCVRecord(record);
      if (recordErrors.length === 0) {
        validRecords.push(record);
      } else {
        errors.push(`Record at ${record.timestamp}: ${recordErrors.join(', ')}`);
      }
    }
    
    processedRecords = validRecords;
  }
  
  // Deduplicate if enabled
  if (opts.deduplicateByTimestamp) {
    processedRecords = deduplicateByTimestamp(processedRecords);
  }
  
  // Initialize results
  const result: IngestionResult = {
    success: true,
    recordsProcessed: processedRecords.length,
    errors,
    targets: {
      questdb: { success: true, count: 0 },
      duckdb: { success: true, count: 0 },
    },
  };

  // Ingest to each target in parallel where possible
  const promises: Promise<void>[] = [];

  // QuestDB
  if (!opts.skipQuestDB) {
    promises.push(
      ingestToQuestDB(processedRecords, opts.batchSize!).then(r => {
        result.targets.questdb = r;
        if (!r.success) result.success = false;
      })
    );
  }
  
  // DuckDB - per symbol
  if (!opts.skipDuckDB) {
    const symbolGroups = new Map<string, OHLCVRecord[]>();
    for (const record of processedRecords) {
      const group = symbolGroups.get(record.symbol) || [];
      group.push(record);
      symbolGroups.set(record.symbol, group);
    }
    
    let duckdbTotal = 0;
    let duckdbError: string | undefined;
    
    for (const [symbol, symbolRecords] of Array.from(symbolGroups.entries())) {
      promises.push(
        ingestToDuckDB(symbolRecords, symbol).then(r => {
          if (r.success) {
            duckdbTotal += r.count;
          } else {
            duckdbError = r.error;
            result.success = false;
          }
          result.targets.duckdb = { 
            success: !duckdbError, 
            count: duckdbTotal, 
            error: duckdbError 
          };
        })
      );
    }
  }
  
  // Wait for all ingestion operations
  await Promise.all(promises);
  
  return result;
}

/**
 * Create or update instrument metadata
 */
export async function upsertInstrument(
  symbol: string,
  metadata: {
    name: string;
    assetType: 'futures' | 'forex';
    exchange?: string;
    tickSize: number;
    tickValue: number;
    pointValue: number;
    contractSize?: number;
    currency?: string;
    marginRequirement?: number;
    tradingHours?: string;
    decimalPlaces?: number;
  }
): Promise<void> {
  const normalizedSymbol = validateSymbol(symbol);
  
  const existing = await db.select()
    .from(instruments)
    .where(eq(instruments.symbol, normalizedSymbol))
    .limit(1);
  
  if (existing.length > 0) {
    await db.update(instruments)
      .set({
        name: metadata.name,
        assetType: metadata.assetType,
        exchange: metadata.exchange,
        tickSize: metadata.tickSize,
        tickValue: metadata.tickValue,
        pointValue: metadata.pointValue,
        contractSize: metadata.contractSize ?? 1,
        currency: metadata.currency ?? 'USD',
        marginRequirement: metadata.marginRequirement,
        tradingHours: metadata.tradingHours,
        decimalPlaces: metadata.decimalPlaces ?? 2,
      })
      .where(eq(instruments.symbol, normalizedSymbol));
  } else {
    await db.insert(instruments).values({
      symbol: normalizedSymbol,
      name: metadata.name,
      assetType: metadata.assetType,
      exchange: metadata.exchange,
      tickSize: metadata.tickSize,
      tickValue: metadata.tickValue,
      pointValue: metadata.pointValue,
      contractSize: metadata.contractSize ?? 1,
      currency: metadata.currency ?? 'USD',
      marginRequirement: metadata.marginRequirement,
      tradingHours: metadata.tradingHours,
      decimalPlaces: metadata.decimalPlaces ?? 2,
    });
  }
}

/**
 * Track an upload in the database
 */
export async function trackUpload(
  filename: string,
  symbol: string,
  recordCount: number,
  status: 'processing' | 'completed' | 'failed' = 'completed'
): Promise<number> {
  const normalizedSymbol = validateSymbol(symbol);
  
  const result = await db.insert(uploads).values({
    filename,
    symbol: normalizedSymbol,
    recordCount,
    status,
  }).returning({ id: uploads.id });
  
  return result[0].id;
}

/**
 * Update upload status
 */
export async function updateUploadStatus(
  uploadId: number,
  status: 'processing' | 'completed' | 'failed',
  recordCount?: number
): Promise<void> {
  const updateData: any = { status };
  if (recordCount !== undefined) {
    updateData.recordCount = recordCount;
  }
  
  await db.update(uploads)
    .set(updateData)
    .where(eq(uploads.id, uploadId));
}
