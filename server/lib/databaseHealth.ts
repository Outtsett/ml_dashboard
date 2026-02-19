import { pool } from '../db';
import { getCircuitBreaker, CircuitOpenError, getAllCircuitBreakerStats } from './circuitBreaker';
import { pipelineMetrics } from './metrics';

export interface DatabaseHealthStatus {
  database: string;
  healthy: boolean;
  latencyMs: number;
  lastCheck: Date;
  error?: string;
  circuitState?: string;
}

export interface HealthCheckResult {
  overall: boolean;
  databases: DatabaseHealthStatus[];
  circuitBreakers: ReturnType<typeof getAllCircuitBreakerStats>;
}

const healthCache: Map<string, DatabaseHealthStatus> = new Map();
const HEALTH_CHECK_INTERVAL = 30000;

export async function checkPostgresHealth(): Promise<DatabaseHealthStatus> {
  const breaker = getCircuitBreaker('postgres', {
    failureThreshold: 3,
    timeout: 5000,
    resetTimeout: 30000
  });
  
  const startTime = Date.now();
  
  try {
    await breaker.execute(async () => {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
    });
    
    const latencyMs = Date.now() - startTime;
    const status: DatabaseHealthStatus = {
      database: 'postgres',
      healthy: true,
      latencyMs,
      lastCheck: new Date(),
      circuitState: breaker.getState()
    };
    
    pipelineMetrics.recordDatabaseHealth('postgres', true, latencyMs);
    healthCache.set('postgres', status);
    return status;
    
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const isCircuitOpen = error instanceof CircuitOpenError;
    
    const status: DatabaseHealthStatus = {
      database: 'postgres',
      healthy: false,
      latencyMs,
      lastCheck: new Date(),
      error: isCircuitOpen ? 'Circuit breaker open' : error.message,
      circuitState: breaker.getState()
    };
    
    pipelineMetrics.recordDatabaseHealth('postgres', false, latencyMs);
    healthCache.set('postgres', status);
    return status;
  }
}

export async function checkQuestDBHealth(): Promise<DatabaseHealthStatus> {
  const breaker = getCircuitBreaker('questdb', {
    failureThreshold: 2,
    timeout: 3000,
    resetTimeout: 60000
  });
  
  const startTime = Date.now();
  
  try {
    await breaker.execute(async () => {
      const { checkQuestDBHealth: questCheck } = await import('../questdb');
      const healthy = await questCheck();
      if (!healthy) {
        throw new Error('QuestDB health check failed');
      }
    });
    
    const latencyMs = Date.now() - startTime;
    const status: DatabaseHealthStatus = {
      database: 'questdb',
      healthy: true,
      latencyMs,
      lastCheck: new Date(),
      circuitState: breaker.getState()
    };
    
    pipelineMetrics.recordDatabaseHealth('questdb', true, latencyMs);
    healthCache.set('questdb', status);
    return status;
    
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const isCircuitOpen = error instanceof CircuitOpenError;
    
    const status: DatabaseHealthStatus = {
      database: 'questdb',
      healthy: false,
      latencyMs,
      lastCheck: new Date(),
      error: isCircuitOpen ? 'Circuit breaker open' : error.message,
      circuitState: breaker.getState()
    };
    
    pipelineMetrics.recordDatabaseHealth('questdb', false, latencyMs);
    healthCache.set('questdb', status);
    return status;
  }
}

export async function checkDuckDBHealth(): Promise<DatabaseHealthStatus> {
  const startTime = Date.now();
  
  try {
    const { runQuery } = await import('../duckdb');
    await runQuery('SELECT 1');
    
    const latencyMs = Date.now() - startTime;
    const status: DatabaseHealthStatus = {
      database: 'duckdb',
      healthy: true,
      latencyMs,
      lastCheck: new Date()
    };
    
    pipelineMetrics.recordDatabaseHealth('duckdb', true, latencyMs);
    healthCache.set('duckdb', status);
    return status;
    
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const status: DatabaseHealthStatus = {
      database: 'duckdb',
      healthy: false,
      latencyMs,
      lastCheck: new Date(),
      error: error.message
    };
    
    pipelineMetrics.recordDatabaseHealth('duckdb', false, latencyMs);
    healthCache.set('duckdb', status);
    return status;
  }
}

export async function runHealthChecks(): Promise<HealthCheckResult> {
  const [postgres, questdb, duckdb] = await Promise.all([
    checkPostgresHealth(),
    checkQuestDBHealth(),
    checkDuckDBHealth()
  ]);
  
  const databases = [postgres, questdb, duckdb];
  const overall = databases.some(db => db.healthy && db.database === 'postgres');
  
  return {
    overall,
    databases,
    circuitBreakers: getAllCircuitBreakerStats()
  };
}

export function getCachedHealth(database: string): DatabaseHealthStatus | undefined {
  return healthCache.get(database);
}

export async function executeWithFallback<T>(
  primaryFn: () => Promise<T>,
  fallbackFn: () => Promise<T>,
  primaryName: string = 'primary',
  fallbackName: string = 'fallback'
): Promise<{ result: T; source: string }> {
  const primaryBreaker = getCircuitBreaker(primaryName);
  
  if (!primaryBreaker.isOpen()) {
    try {
      const result = await primaryBreaker.execute(primaryFn);
      return { result, source: primaryName };
    } catch (error) {
      console.warn(`[DatabaseHealth] ${primaryName} failed, trying ${fallbackName}`);
    }
  }
  
  const result = await fallbackFn();
  return { result, source: fallbackName };
}

let healthCheckInterval: NodeJS.Timeout | null = null;

export function startHealthMonitoring(): void {
  if (healthCheckInterval) return;
  
  runHealthChecks().catch(console.error);
  
  healthCheckInterval = setInterval(() => {
    runHealthChecks().catch(console.error);
  }, HEALTH_CHECK_INTERVAL);
  
  console.log('[DatabaseHealth] Health monitoring started');
}

export function stopHealthMonitoring(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    console.log('[DatabaseHealth] Health monitoring stopped');
  }
}
