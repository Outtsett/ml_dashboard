/**
 * pgAdmin 4 Process Supervisor — Lifecycle, Adoption, Health Watchdog & Embedding.
 *
 * Runs pgAdmin 4 in Desktop Mode (SERVER_MODE = False) on dedicated port 5055,
 * pre-configured for zero-login automatic authentication, permissive iframe CSP,
 * and automatic connection to PostgreSQL 17 + TimescaleDB (127.0.0.1:5432).
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "@nestjs/common";
import { isPortOpen, killTree, resolvePortOwner } from "../../sidecar/ports";

const logger = new Logger("pgAdminSupervisor");

export type PgAdminStatus = "stopped" | "starting" | "ready" | "error";

export interface PgAdminRuntimeState {
  status: PgAdminStatus;
  port: number;
  url: string;
  pid: number | null;
  adopted: boolean;
  startedAt?: string;
  error?: string;
  restarts: number;
}

const PGADMIN_PORT = 5055;
const PGADMIN_HOST = "127.0.0.1";
const PGADMIN_URL = `http://${PGADMIN_HOST}:${PGADMIN_PORT}`;

const PYTHON_EXE = "C:\\Users\\tyler\\AppData\\Local\\Programs\\pgAdmin 4\\python\\python.exe";
const PGADMIN_PY = "C:\\Users\\tyler\\AppData\\Local\\Programs\\pgAdmin 4\\web\\pgAdmin4.py";
const RUNTIME_DIR = "C:\\Users\\tyler\\AppData\\Local\\Programs\\pgAdmin 4\\runtime";
const LOG_FILE = path.join(process.cwd(), "logs", "pgadmin.log");

interface InternalState {
  status: PgAdminStatus;
  pid: number | null;
  child: ChildProcess | null;
  adopted: boolean;
  startedAt?: string;
  error?: string;
  restarts: number;
  stoppedByUser: boolean;
  startPromise: Promise<void> | null;
}

const state: InternalState = {
  status: "stopped",
  pid: null,
  child: null,
  adopted: false,
  restarts: 0,
  stoppedByUser: false,
  startPromise: null,
};

let watchdogTimer: NodeJS.Timeout | null = null;
const WATCHDOG_INTERVAL_MS = 15_000;

/**
 * Probes the pgAdmin HTTP server to verify it is responsive and accepting connections.
 */
async function probeHealth(timeoutMs = 4000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(PGADMIN_URL, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.status === 200 || res.status === 302;
  } catch {
    return false;
  }
}

/**
 * Returns current snapshot of pgAdmin supervisor state.
 */
export async function getPgAdminStatus(): Promise<PgAdminRuntimeState> {
  // If marked ready or starting, verify port is actually open
  const open = await isPortOpen(PGADMIN_PORT, 400);
  if (!open && state.status === "ready") {
    state.status = "stopped";
    state.pid = null;
  } else if (open && state.status === "stopped") {
    const owner = resolvePortOwner(PGADMIN_PORT);
    state.status = "ready";
    state.pid = owner.pid;
    state.adopted = true;
  }

  return {
    status: state.status,
    port: PGADMIN_PORT,
    url: PGADMIN_URL,
    pid: state.pid,
    adopted: state.adopted,
    startedAt: state.startedAt,
    error: state.error,
    restarts: state.restarts,
  };
}

/**
 * Starts and supervises the pgAdmin 4 process.
 * If already running on port 5055, adopts the running process.
 */
export function startPgAdminSupervisor(): Promise<void> {
  if (state.startPromise) {
    return state.startPromise;
  }

  state.stoppedByUser = false;
  state.startPromise = (async () => {
    try {
      // 1. Check if already open on port 5055
      const alreadyOpen = await isPortOpen(PGADMIN_PORT, 500);
      if (alreadyOpen) {
        const owner = resolvePortOwner(PGADMIN_PORT);
        logger.log(`Port ${PGADMIN_PORT} is already open (PID ${owner.pid}). Probing pgAdmin...`);
        const healthy = await probeHealth(3000);
        if (healthy) {
          logger.log(`Adopted running pgAdmin instance at ${PGADMIN_URL} (PID ${owner.pid})`);
          state.status = "ready";
          state.pid = owner.pid;
          state.adopted = true;
          state.startedAt = new Date().toISOString();
          startWatchdog();
          return;
        }
        logger.warn(`Port ${PGADMIN_PORT} is open but unhealthily held by ${owner.description}. Terminating stale process...`);
        if (owner.pid) {
          killTree(owner.pid);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // 2. Validate prerequisites
      if (!fs.existsSync(PYTHON_EXE)) {
        throw new Error(`pgAdmin Python binary not found at ${PYTHON_EXE}`);
      }
      if (!fs.existsSync(PGADMIN_PY)) {
        throw new Error(`pgAdmin main script not found at ${PGADMIN_PY}`);
      }

      state.status = "starting";
      state.error = undefined;

      // 3. Ensure log directory exists and open append file descriptor
      const logDir = path.dirname(LOG_FILE);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const outFd = fs.openSync(LOG_FILE, "a");

      logger.log(`Spawning pgAdmin 4 in Desktop Mode on port ${PGADMIN_PORT}...`);

      const child = spawn(PYTHON_EXE, [PGADMIN_PY], {
        cwd: path.dirname(PGADMIN_PY),
        env: {
          ...process.env,
          PYTHONPATH: path.dirname(PGADMIN_PY),
          PATH: `${RUNTIME_DIR};${process.env.PATH || ""}`,
          PGADMIN_PORT: String(PGADMIN_PORT),
          SERVER_MODE: "False",
        },
        stdio: ["ignore", outFd, outFd],
        detached: false,
        windowsHide: true,
      });


      state.child = child;
      state.pid = child.pid ?? null;
      state.adopted = false;

      child.on("error", (err) => {
        logger.error(`pgAdmin process error: ${err.message}`);
        state.status = "error";
        state.error = err.message;
      });

      child.on("exit", (code, signal) => {
        logger.warn(`pgAdmin exited with code ${code}, signal ${signal}`);
        state.child = null;
        state.pid = null;
        if (!state.stoppedByUser) {
          state.status = "stopped";
        }
      });

      // 4. Poll until port 5055 is answering (timeout 25 seconds)
      const startTime = Date.now();
      const timeoutMs = 25_000;
      let isReady = false;

      while (Date.now() - startTime < timeoutMs) {
        await new Promise((r) => setTimeout(r, 800));
        const portOpen = await isPortOpen(PGADMIN_PORT, 400);
        if (portOpen) {
          const responds = await probeHealth(1500);
          if (responds) {
            isReady = true;
            break;
          }
        }
      }

      if (isReady) {
        state.status = "ready";
        state.startedAt = new Date().toISOString();
        logger.log(`pgAdmin 4 successfully initialized and ready at ${PGADMIN_URL} (zero-login Desktop Mode)`);
      } else {
        state.status = "error";
        state.error = "pgAdmin process started but did not respond within 25s timeout";
        logger.error(state.error);
      }

      startWatchdog();
    } catch (err) {
      const msg = (err as Error).message;
      logger.error(`Failed to start pgAdmin supervisor: ${msg}`);
      state.status = "error";
      state.error = msg;
    } finally {
      state.startPromise = null;
    }
  })();

  return state.startPromise;
}

/**
 * Periodically verifies pgAdmin is alive and running on port 5055.
 */
function startWatchdog(): void {
  if (watchdogTimer) return;

  watchdogTimer = setInterval(async () => {
    if (state.stoppedByUser) return;

    const open = await isPortOpen(PGADMIN_PORT, 500);
    if (!open) {
      logger.warn(`pgAdmin is not listening on port ${PGADMIN_PORT}. Triggering supervisor restart...`);
      state.restarts++;
      state.status = "starting";
      state.startPromise = null;
      startPgAdminSupervisor().catch((err) => {
        logger.error(`Watchdog restart failed: ${err.message}`);
      });
    }
  }, WATCHDOG_INTERVAL_MS);
}

/**
 * Gracefully stops the supervised pgAdmin process.
 */
export async function stopPgAdmin(): Promise<void> {
  state.stoppedByUser = true;
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }

  const pid = state.pid;
  if (pid) {
    logger.log(`Stopping pgAdmin process tree (PID ${pid})...`);
    killTree(pid);
    state.pid = null;
    state.child = null;
  } else {
    // If not tracked directly, check port owner
    const owner = resolvePortOwner(PGADMIN_PORT);
    if (owner.pid) {
      logger.log(`Terminating port ${PGADMIN_PORT} owner (PID ${owner.pid})...`);
      killTree(owner.pid);
    }
  }

  state.status = "stopped";
}

/**
 * Forces a clean restart of pgAdmin.
 */
export async function restartPgAdmin(): Promise<void> {
  await stopPgAdmin();
  await new Promise((r) => setTimeout(r, 1000));
  await startPgAdminSupervisor();
}


