/**
 * Unified Startup Manager
 *
 * Single entry point that handles:
 * 1. SQLite: embedded, no external process needed
 * 2. QuestDB: detect -> start -> verify
 * 3. DuckDB: initialize (in-process, no external process)
 *
 * Each database has independent lifecycle — one failing doesn't block others.
 * Reports a structured status object the frontend can display.
 */

import { execFileSync, spawn, type ChildProcess } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { log } from '../log';

// ── Paths (Windows-specific) ──
const QUESTDB_JAVA = 'E:\\source\\databases\\questdb-9.3.1-rt-windows-x86-64\\bin\\java.exe';
const QUESTDB_ROOT = 'E:\\source\\databases\\questdb-9.3.1-rt-windows-x86-64';
const QUESTDB_PID_FILE = path.join(process.cwd(), '.questdb.pid');

const QUESTDB_HTTP_PORT = parseInt(process.env.QUESTDB_HTTP_PORT || '9000', 10);

export interface DbStatus {
  name: string;
  status: 'running' | 'starting' | 'failed' | 'skipped';
  port?: number;
  message: string;
  startedBy: 'already-running' | 'auto-started' | 'failed' | 'not-attempted';
}

export interface StartupReport {
  sqlite: DbStatus;
  questdb: DbStatus;
  duckdb: DbStatus;
  overallHealthy: boolean;
  timestamp: string;
}

// ── Stale PID cleanup ──
function cleanStalePidFile(pidFile: string, label: string): boolean {
  if (!fs.existsSync(pidFile)) return false;

  try {
    const content = fs.readFileSync(pidFile, 'utf-8');
    const pid = parseInt((content.split('\n')[0] ?? '').trim(), 10);
    if (isNaN(pid)) {
      log(`Removing corrupt PID file for ${label}`, 'startup');
      fs.unlinkSync(pidFile);
      return true;
    }

    // Check if process is actually alive
    try {
      process.kill(pid, 0); // doesn't kill — just tests existence
      return false; // process is alive, PID file is valid
    } catch {
      log(`Cleaning stale PID file for ${label} (PID ${pid} is dead)`, 'startup');
      fs.unlinkSync(pidFile);
      return true;
    }
  } catch (err: any) {
    log(`Error checking PID file for ${label}: ${err.message}`, 'startup');
    return false;
  }
}

// ── QuestDB ──
async function isQuestDBReady(): Promise<boolean> {
  try {
    const resp = await fetch(`http://localhost:${QUESTDB_HTTP_PORT}/exec?query=SELECT%201`);
    return resp.ok;
  } catch {
    return false;
  }
}

async function ensureQuestDB(): Promise<DbStatus> {
  const base: Omit<DbStatus, 'status' | 'message' | 'startedBy'> = {
    name: 'QuestDB',
    port: QUESTDB_HTTP_PORT,
  };

  // Already running?
  if (await isQuestDBReady()) {
    return { ...base, status: 'running', message: `Already running on port ${QUESTDB_HTTP_PORT}`, startedBy: 'already-running' };
  }

  // Check if java.exe exists
  if (!fs.existsSync(QUESTDB_JAVA)) {
    return { ...base, status: 'skipped', message: 'QuestDB java.exe not found — external instance expected', startedBy: 'not-attempted' };
  }

  // Clean stale PID
  cleanStalePidFile(QUESTDB_PID_FILE, 'QuestDB');

  // Start as detached process
  log('Starting QuestDB...', 'startup');
  try {
    const questdb = spawn(
      QUESTDB_JAVA,
      ['-m', 'io.questdb/io.questdb.ServerMain', '-d', QUESTDB_ROOT],
      { stdio: 'ignore', detached: true }
    );
    questdb.unref();

    fs.writeFileSync(QUESTDB_PID_FILE, String(questdb.pid), 'utf-8');
    log(`QuestDB process spawned (PID: ${questdb.pid})`, 'startup');

    // Wait for HTTP endpoint
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (await isQuestDBReady()) {
        return { ...base, status: 'running', message: `Auto-started on port ${QUESTDB_HTTP_PORT}`, startedBy: 'auto-started' };
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    return { ...base, status: 'failed', message: 'Started but HTTP endpoint not responding after 30s', startedBy: 'failed' };
  } catch (err: any) {
    return { ...base, status: 'failed', message: `QuestDB start failed: ${err.message}`, startedBy: 'failed' };
  }
}

// ── Main startup orchestrator ──
let lastReport: StartupReport | null = null;

export async function runStartupSequence(): Promise<StartupReport> {
  log('--- Startup Manager: checking databases ---', 'startup');

  // SQLite is embedded — always available
  const sqliteStatus: DbStatus = {
    name: 'SQLite',
    status: 'running',
    message: 'Embedded (data/ml_dashboard.db)',
    startedBy: 'not-attempted',
  };

  // QuestDB needs external process
  const questStatus = await ensureQuestDB();

  // DuckDB is in-process — it gets initialized separately in index.ts
  const duckdbStatus: DbStatus = {
    name: 'DuckDB',
    status: 'running',
    message: 'In-process (initialized during server startup)',
    startedBy: 'not-attempted',
  };

  const report: StartupReport = {
    sqlite: sqliteStatus,
    questdb: questStatus,
    duckdb: duckdbStatus,
    overallHealthy: sqliteStatus.status === 'running' && questStatus.status === 'running',
    timestamp: new Date().toISOString(),
  };

  // Pretty-print status
  const icon = (s: DbStatus) => s.status === 'running' ? '+' : s.status === 'skipped' ? 'o' : 'x';
  log(`  ${icon(sqliteStatus)} SQLite:     ${sqliteStatus.message}`, 'startup');
  log(`  ${icon(questStatus)} QuestDB:    ${questStatus.message}`, 'startup');
  log(`  ${icon(duckdbStatus)} DuckDB:     ${duckdbStatus.message}`, 'startup');
  log(`--- Overall: ${report.overallHealthy ? 'HEALTHY' : 'DEGRADED'} ---`, 'startup');

  lastReport = report;
  return report;
}

export function getStartupReport(): StartupReport | null {
  return lastReport;
}
