import { db } from './db';
import { sql } from 'drizzle-orm';
import { getCircuitBreaker, CircuitOpenError, getAllCircuitBreakerStats } from '../lib/circuitBreaker';
import { pipelineMetrics } from '../lib/metrics';
import { logInfo } from "../lib/log";

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
  degraded?: boolean;
  databases: DatabaseHealthStatus[];
  circuitBreakers: ReturnType<typeof getAllCircuitBreakerStats>;
}

const healthCache: Map<string, DatabaseHealthStatus> = new Map();
const HEALTH_CHECK_INTERVAL = 30000;

export async function checkSqliteHealth(): Promise<DatabaseHealthStatus> {
  const startTime = Date.now();

  try {
    await db.execute(sql`SELECT 1`);

    const latencyMs = Date.now() - startTime;
    const status: DatabaseHealthStatus = {
      database: 'sqlite',
      healthy: true,
      latencyMs,
      lastCheck: new Date(),
    };

    pipelineMetrics.recordDatabaseHealth('sqlite', true, latencyMs);
    healthCache.set('sqlite', status);
    return status;

  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const status: DatabaseHealthStatus = {
      database: 'sqlite',
      healthy: false,
      latencyMs,
      lastCheck: new Date(),
      error: (error as Error).message,
    };

    pipelineMetrics.recordDatabaseHealth('sqlite', false, latencyMs);
    healthCache.set('sqlite', status);
    return status;
  }
}

export async function checkLakeHealth(): Promise<DatabaseHealthStatus> {
  const breaker = getCircuitBreaker('lake', {
    failureThreshold: 3,
    timeout: 15000, // 15s timeout to accommodate 10s health check + safety
    resetTimeout: 30000
  });

  const startTime = Date.now();

  try {
    await breaker.execute(async () => {
      const { checkLakeHealth: questCheck } = await import('./lake');
      const healthy = await questCheck();
      if (!healthy) {
        throw new Error('lake health check failed');
      }
    });

    const latencyMs = Date.now() - startTime;
    const status: DatabaseHealthStatus = {
      database: 'lake',
      healthy: true,
      latencyMs,
      lastCheck: new Date(),
      circuitState: breaker.getState()
    };

    pipelineMetrics.recordDatabaseHealth('lake', true, latencyMs);
    healthCache.set('lake', status);
    return status;

  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const isCircuitOpen = error instanceof CircuitOpenError;

    const status: DatabaseHealthStatus = {
      database: 'lake',
      healthy: false,
      latencyMs,
      lastCheck: new Date(),
      error: isCircuitOpen ? 'Circuit breaker open' : (error as Error).message,
      circuitState: breaker.getState()
    };

    pipelineMetrics.recordDatabaseHealth('lake', false, latencyMs);
    healthCache.set('lake', status);
    return status;
  }
}

export async function runHealthChecks(): Promise<HealthCheckResult> {
  const [sqlite, lake] = await Promise.all([
    checkSqliteHealth(),
    checkLakeHealth(),
  ]);

  const databases = [sqlite, lake];
  const overall = sqlite.healthy && lake.healthy;

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
      console.warn(`[DatabaseHealth] ${primaryName} failed, trying ${fallbackName}:`, error);
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

  logInfo('[DatabaseHealth] Health monitoring started');
}

export function stopHealthMonitoring(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    logInfo('[DatabaseHealth] Health monitoring stopped');
  }
}

