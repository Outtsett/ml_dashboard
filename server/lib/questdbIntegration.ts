import { InsertOhlcv } from "@shared/schema";
import { insertOHLCVBatch, OHLCVRow, getOHLCVSampleBy, checkQuestDBHealth, createOHLCVTable } from "../questdb";
import { getCircuitBreaker } from "./circuitBreaker";
import { pipelineMetrics } from "./metrics";

const questdbCircuit = getCircuitBreaker('questdb');

export interface QuestDBIntegrationConfig {
  enableQuestDB: boolean;
  syncToPg: boolean;
  batchSize: number;
}

const defaultConfig: QuestDBIntegrationConfig = {
  enableQuestDB: true,
  syncToPg: false,
  batchSize: 5000
};

let config = { ...defaultConfig };

export function setQuestDBConfig(newConfig: Partial<QuestDBIntegrationConfig>): void {
  config = { ...config, ...newConfig };
}

export function getQuestDBConfig(): QuestDBIntegrationConfig {
  return { ...config };
}

export async function insertOHLCVToQuestDB(
  data: InsertOhlcv[],
  symbol: string
): Promise<{ success: boolean; insertedToQuestDB: number; error?: string }> {
  if (!config.enableQuestDB || data.length === 0) {
    return { success: false, insertedToQuestDB: 0, error: 'QuestDB disabled or no data' };
  }

  const startTime = Date.now();
  
  try {
    const result = await questdbCircuit.execute(async () => {
      const rows: OHLCVRow[] = data.map(d => ({
        symbol: d.symbol,
        timestamp: new Date(d.timestamp),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume
      }));

      for (let i = 0; i < rows.length; i += config.batchSize) {
        const batch = rows.slice(i, i + config.batchSize);
        await insertOHLCVBatch(batch);
      }

      return rows.length;
    });

    const latency = Date.now() - startTime;
    pipelineMetrics.recordQuestDBInsert(symbol, result, latency, true);

    return { success: true, insertedToQuestDB: result };
  } catch (error) {
    const latency = Date.now() - startTime;
    pipelineMetrics.recordQuestDBInsert(symbol, 0, latency, false);

    return {
      success: false,
      insertedToQuestDB: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function queryOHLCVFromQuestDB(
  symbol: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<{ success: boolean; data: any[]; source: 'questdb' | 'postgres' | 'none'; error?: string }> {
  if (!config.enableQuestDB) {
    return { success: false, data: [], source: 'none', error: 'QuestDB disabled' };
  }

  const queryStart = Date.now();

  try {
    const data = await questdbCircuit.execute(async () => {
      return await getOHLCVSampleBy(symbol, timeframe, startTime, endTime, limit);
    });

    const latency = Date.now() - queryStart;
    pipelineMetrics.recordQuestDBQuery(symbol, timeframe, latency, data.length, true);

    return { success: true, data, source: 'questdb' };
  } catch (error) {
    const latency = Date.now() - queryStart;
    pipelineMetrics.recordQuestDBQuery(symbol, timeframe, latency, 0, false);

    return {
      success: false,
      data: [],
      source: 'none',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function initializeQuestDB(): Promise<{ success: boolean; error?: string }> {
  try {
    const healthy = await checkQuestDBHealth();
    if (!healthy) {
      return { success: false, error: 'QuestDB not responding' };
    }

    await createOHLCVTable();
    console.log('[QuestDB] OHLCV table initialized');
    
    return { success: true };
  } catch (error) {
    console.error('[QuestDB] Initialization failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function getQuestDBStatus(): Promise<{
  enabled: boolean;
  healthy: boolean;
  circuitState: string;
  config: QuestDBIntegrationConfig;
}> {
  let healthy = false;
  try {
    healthy = await checkQuestDBHealth();
  } catch (e) {
    healthy = false;
  }

  return {
    enabled: config.enableQuestDB,
    healthy,
    circuitState: questdbCircuit.getState(),
    config
  };
}

export async function getQuestDBRowCount(symbol: string): Promise<number> {
  if (!config.enableQuestDB) {
    return 0;
  }

  const safeSymbol = symbol.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase();
  if (!safeSymbol || safeSymbol.length > 20) {
    console.warn(`[QuestDB] Invalid symbol for row count: ${symbol}`);
    return 0;
  }

  try {
    const { queryQuestDB } = await import('../questdb');
    const result = await questdbCircuit.execute(async () => {
      const sql = `SELECT COUNT(*) as cnt FROM ohlcv WHERE symbol = '${safeSymbol}'`;
      return queryQuestDB(sql);
    });
    return result[0]?.cnt || 0;
  } catch (error) {
    console.warn(`[QuestDB] Failed to get row count for ${symbol}:`, error);
    return 0;
  }
}
