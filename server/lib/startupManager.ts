/**
 * Unified Startup Manager
 * 
 * Single entry point that handles:
 * 1. PostgreSQL: detect → clean stale PID → start → verify
 * 2. QuestDB: detect → start → verify
 * 3. DuckDB: initialize (in-process, no external process)
 * 
 * Each database has independent lifecycle — one failing doesn't block others.
 * Reports a structured status object the frontend can display.
 */

import { execFileSync, spawn, type ChildProcess } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { log } from '../index';

// ── Paths (Windows-specific, matches start-databases.cjs) ──
const PG_CTL = 'E:\\source\\databases\\PostgreSQL\\pgsql\\bin\\pg_ctl.exe';
const PG_DATA = 'E:\\source\\databases\\PostgreSQL\\pgsql\\data';
const PG_LOG = 'E:\\source\\databases\\PostgreSQL\\pgsql\\pg_startup.log'; // Outside data dir to avoid sharing violations
const PG_PID_FILE = path.join(PG_DATA, 'postmaster.pid');

const QUESTDB_JAVA = 'E:\\source\\databases\\questdb-9.3.1-rt-windows-x86-64\\bin\\java.exe';
const QUESTDB_ROOT = 'E:\\source\\databases\\questdb-9.3.1-rt-windows-x86-64';
const QUESTDB_PID_FILE = path.join(process.cwd(), '.questdb.pid');

const QUESTDB_HTTP_PORT = parseInt(process.env.QUESTDB_HTTP_PORT || '9000', 10);
const PG_PORT = 5432;

export interface DbStatus {
  name: string;
  status: 'running' | 'starting' | 'failed' | 'skipped';
  port?: number;
  message: string;
  startedBy: 'already-running' | 'auto-started' | 'failed' | 'not-attempted';
}

export interface StartupReport {
  postgres: DbStatus;
  questdb: DbStatus;
  duckdb: DbStatus;
  overallHealthy: boolean;
  timestamp: string;
}

// ── TCP port check ──
function isPortListening(port: number, host = '127.0.0.1', timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => { sock.destroy(); resolve(false); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

// ── Wait until port is accepting connections ──
async function waitForPort(port: number, timeoutMs = 20000, intervalMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

// ── Stale PID cleanup ──
function cleanStalePidFile(pidFile: string, label: string): boolean {
  if (!fs.existsSync(pidFile)) return false;

  try {
    const content = fs.readFileSync(pidFile, 'utf-8');
    const pid = parseInt(content.split('\n')[0].trim(), 10);
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

// ── PostgreSQL ──
function isPostgresRunning(): boolean {
  try {
    if (!fs.existsSync(PG_CTL)) return false;
    execFileSync(PG_CTL, ['status', '-D', PG_DATA], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function ensurePostgres(): Promise<DbStatus> {
  const base: Omit<DbStatus, 'status' | 'message' | 'startedBy'> = {
    name: 'PostgreSQL',
    port: PG_PORT,
  };

  // Check if pg_ctl exists
  if (!fs.existsSync(PG_CTL)) {
    return { ...base, status: 'skipped', message: 'pg_ctl not found — using remote or external PostgreSQL', startedBy: 'not-attempted' };
  }

  // Already running?
  if (isPostgresRunning()) {
    return { ...base, status: 'running', message: 'Already running on port 5432', startedBy: 'already-running' };
  }

  // Clean stale PID file (the crash scenario)
  cleanStalePidFile(PG_PID_FILE, 'PostgreSQL');

  // Kill any zombie postgres processes that survived a crash
  try {
    const result = execFileSync('tasklist', ['/FI', 'IMAGENAME eq postgres.exe', '/NH', '/FO', 'CSV'], { stdio: 'pipe', encoding: 'utf-8' });
    // Each line: "postgres.exe","PID","..."
    const lines = result.split('\n').filter(l => l.includes('postgres.exe'));
    for (const line of lines) {
      const match = line.match(/"(\d+)"/g);
      if (match && match.length >= 2) {
        const pid = parseInt(match[1].replace(/"/g, ''), 10);
        log(`Killing zombie postgres process PID ${pid}`, 'startup');
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
    }
    if (lines.length > 0) {
      await new Promise(r => setTimeout(r, 2000)); // let processes die
    }
  } catch {}

  // Try to start
  log('Starting PostgreSQL...', 'startup');
  try {
    // Use spawn (async) instead of execFileSync — pg_ctl with -w can take 30+ seconds
    const started = await new Promise<boolean>((resolve) => {
      const proc = spawn(PG_CTL, ['start', '-D', PG_DATA, '-l', PG_LOG], { stdio: 'pipe' });
      proc.on('exit', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
      // Safety timeout — if pg_ctl itself hangs
      setTimeout(() => { try { proc.kill(); } catch {} resolve(false); }, 30_000);
    });

    if (!started) {
      return { ...base, status: 'failed', message: 'pg_ctl start returned non-zero exit code', startedBy: 'failed' };
    }

    const ready = await waitForPort(PG_PORT, 15000);
    if (ready) {
      return { ...base, status: 'running', message: 'Auto-started on port 5432', startedBy: 'auto-started' };
    } else {
      return { ...base, status: 'failed', message: 'Started but port 5432 not responding', startedBy: 'failed' };
    }
  } catch (err: any) {
    return { ...base, status: 'failed', message: `pg_ctl start failed: ${err.message}`, startedBy: 'failed' };
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
  log('═══ Startup Manager: checking databases ═══', 'startup');

  // Run PostgreSQL and QuestDB checks in parallel
  const [pgStatus, questStatus] = await Promise.all([
    ensurePostgres(),
    ensureQuestDB(),
  ]);

  // DuckDB is in-process — it gets initialized separately in index.ts
  const duckdbStatus: DbStatus = {
    name: 'DuckDB',
    status: 'running',
    message: 'In-process (initialized during server startup)',
    startedBy: 'not-attempted',
  };

  const report: StartupReport = {
    postgres: pgStatus,
    questdb: questStatus,
    duckdb: duckdbStatus,
    overallHealthy: pgStatus.status === 'running' || pgStatus.status === 'skipped',
    timestamp: new Date().toISOString(),
  };

  // Pretty-print status
  const icon = (s: DbStatus) => s.status === 'running' ? '✓' : s.status === 'skipped' ? '○' : '✗';
  log(`  ${icon(pgStatus)} PostgreSQL: ${pgStatus.message}`, 'startup');
  log(`  ${icon(questStatus)} QuestDB:    ${questStatus.message}`, 'startup');
  log(`  ${icon(duckdbStatus)} DuckDB:     ${duckdbStatus.message}`, 'startup');
  log(`═══ Overall: ${report.overallHealthy ? 'HEALTHY' : 'DEGRADED'} ═══`, 'startup');

  lastReport = report;
  return report;
}

export function getStartupReport(): StartupReport | null {
  return lastReport;
}
