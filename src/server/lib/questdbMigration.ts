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

// PostgreSQL OHLCV source removed — data already lives in QuestDB.
// These functions are kept as stubs for callers that reference them.

export async function migrateSymbol(
  symbol: string,
  _batchSize: number = 10000
): Promise<MigrationProgress> {
  return {
    symbol,
    totalRows: 0,
    migratedRows: 0,
    status: 'completed',
    completedAt: new Date(),
  };
}

export async function migrateAllSymbols(_batchSize: number = 10000): Promise<MigrationResult> {
  return {
    success: true,
    symbolsMigrated: 0,
    totalRowsMigrated: 0,
    errors: [],
    duration: 0,
  };
}

export function getMigrationProgress(): Map<string, MigrationProgress> {
  return new Map(migrationProgress);
}

export function getMigrationProgressArray(): MigrationProgress[] {
  return Array.from(migrationProgress.values());
}
