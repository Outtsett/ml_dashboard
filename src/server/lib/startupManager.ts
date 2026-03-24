/**
 * Unified Startup Manager
 *
 * Single entry point that handles:
 * 1. SQLite: embedded, no external process needed
 * 2. QuestDB: detect -> start -> verify
 *
 * Each database has independent lifecycle — one failing doesn't block others.
 * Reports a structured status object the frontend can display.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { log } from './log';
import { getMotiveWaveWatcher } from './motivewave';

// ── Paths (configurable via env, fallback to legacy defaults) ──
const QUESTDB_ROOT = process.env.QUESTDB_ROOT || '';
const QUESTDB_JAVA = process.env.QUESTDB_JAVA || (QUESTDB_ROOT ? path.join(QUESTDB_ROOT, 'bin', 'java.exe') : '');
const QUESTDB_PID_FILE = path.join(process.cwd(), '.questdb.pid');

const QUESTDB_HOST = process.env.QUESTDB_HOST || 'localhost';
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
    const resp = await fetch(`http://${QUESTDB_HOST}:${QUESTDB_HTTP_PORT}/exec?query=SELECT%201`);
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

  const report: StartupReport = {
    sqlite: sqliteStatus,
    questdb: questStatus,
    overallHealthy: sqliteStatus.status === 'running' && questStatus.status === 'running',
    timestamp: new Date().toISOString(),
  };

  // MotiveWave auto-start: if config has autoStart=true and QuestDB is ready, start watcher
  if (questStatus.status === 'running') {
    try {
      const watcher = getMotiveWaveWatcher(); // loads persisted config on first call
      const config = watcher.getConfig();
      if (config.autoStart && config.watchDir) {
        log(`Auto-starting MotiveWave watcher on: ${config.watchDir}`, 'startup');
        watcher.start().then(() => {
          log('  + MotiveWave watcher started', 'startup');
        }).catch((err: any) => {
          log(`  x MotiveWave watcher failed: ${err.message}`, 'startup');
        });
      }
    } catch (err: any) {
      log(`  x MotiveWave auto-start check failed: ${err.message}`, 'startup');
    }
  }

  // Pretty-print status
  const icon = (s: DbStatus) => s.status === 'running' ? '+' : s.status === 'skipped' ? 'o' : 'x';
  log(`  ${icon(sqliteStatus)} SQLite:     ${sqliteStatus.message}`, 'startup');
  log(`  ${icon(questStatus)} QuestDB:    ${questStatus.message}`, 'startup');
  log(`--- Overall: ${report.overallHealthy ? 'HEALTHY' : 'DEGRADED'} ---`, 'startup');

  lastReport = report;
  return report;
}

export function getStartupReport(): StartupReport | null {
  return lastReport;
}
