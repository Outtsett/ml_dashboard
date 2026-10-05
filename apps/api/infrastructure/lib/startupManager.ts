/**
 * Unified Startup Manager
 *
 * Single entry point that reports whether the two stores this app actually reads
 * are usable:
 *   1. SQLite: embedded, no external process
 *   2. The lake: Iceberg at E:\lake, read in-process by DuckDB
 *
 * Each store has an independent lifecycle — one failing does not block the other.
 * Returns a structured status object /api/readiness and /api/startup-report serve.
 *
 * Rewritten 2026-09-15. It used to probe lake over HTTP and, failing that,
 * SPAWN a lake JVM from lake_ROOT on every boot. lake was emptied and
 * retired on 2026-09-10 — zero tables, nothing may read or write it — so that
 * path could only ever do one of two things: nothing (java.exe absent, which is
 * the case on this machine, giving status 'skipped'), or start a database
 * serving nothing. Either way `overallHealthy` required lake === 'running',
 * so /api/readiness returned 503 forever while /api/health, which asks the
 * real DuckDB serving layer, returned 200 on the same dependency in the same
 * process. Two probes, opposite answers. The probe now asks the lake.
 */

import { checkLakeHealth } from '../database/lake/connection';
import { log } from './log';

export interface DbStatus {
  name: string;
  status: 'running' | 'starting' | 'failed' | 'skipped';
  port?: number;
  message: string;
  startedBy: 'already-running' | 'auto-started' | 'failed' | 'not-attempted';
}

export interface StartupReport {
  sqlite: DbStatus;
  lake: DbStatus;
  overallHealthy: boolean;
  timestamp: string;
}

/**
 * Is the lake readable? `checkLakeHealth` (named for the layer it replaced)
 * opens the process-wide DuckDB instance, which installs the iceberg and httpfs
 * extensions and defines one view per serving table, then counts those views.
 * Zero views means the instance came up but the lake behind it did not.
 */
async function checkLake(): Promise<DbStatus> {
  const base = { name: 'Lake (Iceberg via DuckDB)' } as const;
  try {
    const healthy = await checkLakeHealth();
    return healthy
      ? { ...base, status: 'running', message: 'Serving views defined over the Iceberg lake', startedBy: 'already-running' }
      : { ...base, status: 'failed', message: 'DuckDB opened but no serving views are defined — is AIStor up?', startedBy: 'failed' };
  } catch (err) {
    return { ...base, status: 'failed', message: `Lake unreachable: ${(err as Error).message}`, startedBy: 'failed' };
  }
}

// ── Main startup orchestrator ──
let lastReport: StartupReport | null = null;

export async function runStartupSequence(): Promise<StartupReport> {
  log('--- Startup Manager: checking stores ---', 'startup');

  // SQLite is embedded — available as soon as the file opens.
  const sqliteStatus: DbStatus = {
    name: 'SQLite',
    status: 'running',
    message: 'Embedded (data/ml_dashboard.db)',
    startedBy: 'not-attempted',
  };

  const lakeStatus = await checkLake();

  const report: StartupReport = {
    sqlite: sqliteStatus,
    lake: lakeStatus,
    overallHealthy: sqliteStatus.status === 'running' && lakeStatus.status === 'running',
    timestamp: new Date().toISOString(),
  };

  const icon = (s: DbStatus) => (s.status === 'running' ? '+' : s.status === 'skipped' ? 'o' : 'x');
  log(`  ${icon(sqliteStatus)} SQLite:  ${sqliteStatus.message}`, 'startup');
  log(`  ${icon(lakeStatus)} Lake:    ${lakeStatus.message}`, 'startup');
  log(`--- Overall: ${report.overallHealthy ? 'HEALTHY' : 'DEGRADED'} ---`, 'startup');

  lastReport = report;
  return report;
}

export function getStartupReport(): StartupReport | null {
  return lastReport;
}

