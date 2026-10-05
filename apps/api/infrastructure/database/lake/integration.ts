import { getOHLCVSampleBy, checkLakeHealth, servingSnapshot } from ".";
import { getCircuitBreaker } from "../../lib/circuitBreaker";
import { pipelineMetrics } from "../../lib/metrics";
import { logInfo } from "../../lib/log";

const lakeCircuit = getCircuitBreaker('lake');

export interface LakeIntegrationConfig {
  enablelake: boolean;
  batchSize: number;
}

const defaultConfig: LakeIntegrationConfig = {
  enablelake: true,
  batchSize: 5000
};

let config = { ...defaultConfig };

export function setLakeConfig(newConfig: Partial<LakeIntegrationConfig>): void {
  config = { ...config, ...newConfig };
}

export function getLakeConfig(): LakeIntegrationConfig {
  return { ...config };
}

export async function insertOHLCVToLake(
  data: { symbol: string; timestamp: number | Date; open: number; high: number; low: number; close: number; volume: number }[],
  symbol: string
): Promise<{ success: boolean; insertedTolake: number; error?: string }> {
  if (!config.enablelake || data.length === 0) {
    return { success: false, insertedTolake: 0, error: 'Ingestion disabled or no data' };
  }

  // Reported before the circuit breaker sees it. insertLakeBatch now raises —
  // this server is read-only over the lake — and letting that failure repeat
  // five times would trip the breaker, after which every caller gets a generic
  // "circuit open" instead of the reason and the restore path.
  return {
    success: false,
    insertedTolake: 0,
    error:
      `[lake] Writing ${data.length} bars for ${symbol} is not available. lake was ` +
      "retired on 2026-09-10 and this server is read-only over the lake. Land new data " +
      "through datalake (scripts/land_raw.py, then scripts/migrate_to_iceberg.py). " +
      "Restore path if lake is ever needed again: " +
      "s3://meta/lake_schema/lake_schema_latest.sql plus the parquet at " +
      `s3://${servingSnapshot()}/.`,
  };
}


export async function queryOHLCVFromLake(
  symbol: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<{ success: boolean; data: Awaited<ReturnType<typeof getOHLCVSampleBy>>; source: 'lake' | 'none'; error?: string }> {
  if (!config.enablelake) {
    return { success: false, data: [], source: 'none', error: 'lake disabled' };
  }

  const queryStart = Date.now();

  try {
    const data = await lakeCircuit.execute(async () => {
      return await getOHLCVSampleBy(symbol, timeframe, startTime, endTime, limit);
    });

    const latency = Date.now() - queryStart;
    pipelineMetrics.recordlakeQuery(symbol, timeframe, latency, data.length, true);

    return { success: true, data, source: 'lake' };
  } catch (error) {
    const latency = Date.now() - queryStart;
    pipelineMetrics.recordlakeQuery(symbol, timeframe, latency, 0, false);

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
export async function initializeLake(): Promise<{ success: boolean; error?: string }> {
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const healthy = await checkLakeHealth();
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

export async function getLakeIntegrationStatus(): Promise<{
  enabled: boolean;
  healthy: boolean;
  circuitState: string;
  config: LakeIntegrationConfig;
}> {
  let healthy = false;
  try {
    healthy = await checkLakeHealth();
  } catch {
    healthy = false;
  }

  return {
    enabled: config.enablelake,
    healthy,
    circuitState: lakeCircuit.getState(),
    config
  };
}

export async function getLakeRowCount(symbol: string): Promise<number> {
  if (!config.enablelake) {
    return 0;
  }

  const safeSymbol = symbol.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase();
  if (!safeSymbol || safeSymbol.length > 20) {
    console.warn(`[lake] Invalid symbol for row count: ${symbol}`);
    return 0;
  }

  try {
    const { queryLakeFast } = await import(".");
    const result = await lakeCircuit.execute(async () => {
      const sql = `SELECT COUNT(*) as cnt FROM ohlcv WHERE symbol = '${safeSymbol}'`;
      return queryLakeFast<{ cnt: number | bigint }>(sql);
    });
    return Number(result[0]?.cnt ?? 0);
  } catch (error) {
    console.warn(`[lake] Failed to get row count for ${symbol}:`, error);
    return 0;
  }
}

