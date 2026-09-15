import { getOHLCVSampleBy, checkQuestDBHealth } from ".";
import { getCircuitBreaker } from "../../lib/circuitBreaker";
import { pipelineMetrics } from "../../lib/metrics";
import { logInfo } from "../../lib/log";

const questdbCircuit = getCircuitBreaker('questdb');

export interface QuestDBIntegrationConfig {
  enableQuestDB: boolean;
  batchSize: number;
}

const defaultConfig: QuestDBIntegrationConfig = {
  enableQuestDB: true,
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
  data: { symbol: string; timestamp: number | Date; open: number; high: number; low: number; close: number; volume: number }[],
  symbol: string
): Promise<{ success: boolean; insertedToQuestDB: number; error?: string }> {
  if (!config.enableQuestDB || data.length === 0) {
    return { success: false, insertedToQuestDB: 0, error: 'Ingestion disabled or no data' };
  }

  // Reported before the circuit breaker sees it. insertOHLCVBatch now raises —
  // this server is read-only over the lake — and letting that failure repeat
  // five times would trip the breaker, after which every caller gets a generic
  // "circuit open" instead of the reason and the restore path.
  return {
    success: false,
    insertedToQuestDB: 0,
    error:
      `[lake] Writing ${data.length} bars for ${symbol} is not available. QuestDB was ` +
      "retired on 2026-09-10 and this server is read-only over the lake. Land new data " +
      "through datalake (scripts/land_raw.py, then scripts/migrate_to_iceberg.py). " +
      "Restore path if QuestDB is ever needed again: " +
      "s3://meta/questdb_schema/questdb_schema_latest.sql plus the parquet at " +
      "s3://derived/recipe=questdb_full_2026-09-09/.",
  };
}


export async function queryOHLCVFromQuestDB(
  symbol: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<{ success: boolean; data: Awaited<ReturnType<typeof getOHLCVSampleBy>>; source: 'questdb' | 'none'; error?: string }> {
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

/**
 * Bring the serving layer up.
 *
 * No pool to prime and no schema to create: the lake's schema is datalake's,
 * and the first health check is what builds the DuckDB view catalog. The retry
 * loop is kept because AIStor can still be starting when this server boots.
 */
export async function initializeQuestDB(): Promise<{ success: boolean; error?: string }> {
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const healthy = await checkQuestDBHealth();
      if (!healthy) {
        throw new Error('Lake serving layer not responding');
      }

      logInfo(`[lake] Serving layer initialized on attempt ${attempt}/${MAX_RETRIES}`);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // exponential backoff: 2s, 4s, 8s, 16s
        console.warn(`[lake] Startup attempt ${attempt}/${MAX_RETRIES} failed (${msg}). Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`[lake] All ${MAX_RETRIES} startup attempts failed. Last error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  }

  return { success: false, error: 'Unexpected: exhausted retries' };
}

export async function getQuestDBIntegrationStatus(): Promise<{
  enabled: boolean;
  healthy: boolean;
  circuitState: string;
  config: QuestDBIntegrationConfig;
}> {
  let healthy = false;
  try {
    healthy = await checkQuestDBHealth();
  } catch {
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
    const { queryQuestDBFast } = await import(".");
    const result = await questdbCircuit.execute(async () => {
      const sql = `SELECT COUNT(*) as cnt FROM ohlcv WHERE symbol = '${safeSymbol}'`;
      return queryQuestDBFast<{ cnt: number | bigint }>(sql);
    });
    return Number(result[0]?.cnt ?? 0);
  } catch (error) {
    console.warn(`[QuestDB] Failed to get row count for ${symbol}:`, error);
    return 0;
  }
}
