import { storage } from "../storage";
import { insertOHLCVToQuestDB } from "./questdbIntegration";
import { checkQuestDBHealth, createOHLCVTable } from "../questdb";

export interface MigrationProgress {
  symbol: string;
  totalRows: number;
  migratedRows: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface MigrationResult {
  success: boolean;
  symbolsMigrated: number;
  totalRowsMigrated: number;
  errors: string[];
  duration: number;
}

const migrationProgress = new Map<string, MigrationProgress>();

export async function checkQuestDBReady(): Promise<{ ready: boolean; error?: string }> {
  try {
    const healthy = await checkQuestDBHealth();
    if (!healthy) {
      return { ready: false, error: 'QuestDB not responding' };
    }
    
    await createOHLCVTable();
    return { ready: true };
  } catch (error) {
    return { 
      ready: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

export async function migrateSymbol(
  symbol: string,
  batchSize: number = 10000
): Promise<MigrationProgress> {
  const progress: MigrationProgress = {
    symbol,
    totalRows: 0,
    migratedRows: 0,
    status: 'in_progress',
    startedAt: new Date()
  };
  migrationProgress.set(symbol, progress);

  try {
    const countResult = await storage.getOhlcvCount(symbol);
    progress.totalRows = countResult;

    if (progress.totalRows === 0) {
      progress.status = 'completed';
      progress.completedAt = new Date();
      return progress;
    }

    let offset = 0;
    while (offset < progress.totalRows) {
      const batch = await storage.getOhlcvDataPaginated(symbol, offset, batchSize);
      
      if (batch.length === 0) break;

      const result = await insertOHLCVToQuestDB(batch.map((row: any) => ({
        symbol: row.symbol,
        timestamp: typeof row.timestamp === 'number' ? row.timestamp : new Date(row.timestamp).getTime(),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume
      })), symbol);

      if (!result.success) {
        progress.status = 'failed';
        progress.error = result.error;
        return progress;
      }

      progress.migratedRows += batch.length;
      offset += batchSize;

      console.log(`[Migration] ${symbol}: ${progress.migratedRows}/${progress.totalRows} rows migrated`);
    }

    progress.status = 'completed';
    progress.completedAt = new Date();
    return progress;

  } catch (error) {
    progress.status = 'failed';
    progress.error = error instanceof Error ? error.message : String(error);
    return progress;
  }
}

export async function migrateAllSymbols(batchSize: number = 10000): Promise<MigrationResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let symbolsMigrated = 0;
  let totalRowsMigrated = 0;

  const readyCheck = await checkQuestDBReady();
  if (!readyCheck.ready) {
    return {
      success: false,
      symbolsMigrated: 0,
      totalRowsMigrated: 0,
      errors: [readyCheck.error || 'QuestDB not ready'],
      duration: Date.now() - startTime
    };
  }

  const symbols = await storage.getDistinctSymbols();
  console.log(`[Migration] Starting migration for ${symbols.length} symbols`);

  for (const symbol of symbols) {
    try {
      const result = await migrateSymbol(symbol, batchSize);
      
      if (result.status === 'completed') {
        symbolsMigrated++;
        totalRowsMigrated += result.migratedRows;
      } else if (result.status === 'failed') {
        errors.push(`${symbol}: ${result.error}`);
      }
    } catch (error) {
      errors.push(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    success: errors.length === 0,
    symbolsMigrated,
    totalRowsMigrated,
    errors,
    duration: Date.now() - startTime
  };
}

export function getMigrationProgress(): Map<string, MigrationProgress> {
  return new Map(migrationProgress);
}

export function getMigrationProgressArray(): MigrationProgress[] {
  return Array.from(migrationProgress.values());
}
