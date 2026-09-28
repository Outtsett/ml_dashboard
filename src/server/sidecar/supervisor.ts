/**
 * Sidecar lifecycle — spawn, adopt, health-watch, restart, stop.
 *
 * The rules, each paid for by a failure this repo has already had:
 *
 * - **Adopt before spawn.** `tsx --watch` restarts the dashboard on every
 *   server-file save and leaves its children running (see marimo/servers.ts).
 *   A healthy process on the pinned port that answers `/health` with this
 *   sidecar's slug is adopted, never duplicated. A port held by anything else
 *   is a named failure — the port is never changed to dodge it.
 * - **stdio goes to a file, never a pipe.** A piped child outlives the
 *   dashboard process on a restart, and its next write to the dead pipe is an
 *   EPIPE that kills it. `logs/sidecar-<slug>.log` survives both sides.
 * - **Watched, not trusted.** An autostart sidecar that stops answering is
 *   restarted by the watchdog; the live hub's capture has gaps otherwise.
 */

import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { Logger } from "@nestjs/common";
import { findSidecar, loadSidecarsConfig, resolveCommand, resolveCwd, type Sidecar } from "./config";
import { isPortOpen, killTree, resolvePortOwner } from "./ports";

const logger = new Logger("Sidecars");

export type SidecarStatus = "stopped" | "starting" | "ready" | "error";

export interface SidecarRuntime {
  slug: string;
  label: string;
  description: string;
  port: number;
  proxyPrefix: string;
  status: SidecarStatus;
  error?: string;
  pid?: number;
  adopted: boolean;
  startedAt?: string;
  restarts: number;
  health?: Record<string, unknown>;
}

interface State {
  status: SidecarStatus;
  error?: string;
  pid?: number;
  child?: ChildProcess;
  adopted: boolean;
  startedAt?: string;
  restarts: number;
  health?: Record<string, unknown>;
  startPromise?: Promise<void>;
  /** Set by an explicit stop so the watchdog leaves the sidecar down. */
  stoppedByUser: boolean;
  /** Consecutive failed watchdog restarts; the next attempt waits
   *  WATCHDOG_MS * 2^failures (capped), so a sidecar that cannot start does
   *  not respawn every 15 s forever. */
  failures: number;
  nextAttemptAt: number;
}

const STATE = new Map<string, State>();
const HEALTH_TIMEOUT_MS = 2_000;
const POLL_MS = 300;
const WATCHDOG_MS = 15_000;
let watchdog: NodeJS.Timeout | null = null;

const LOG_DIR = path.join(process.cwd(), "logs");

export function logPath(slug: string): string {
  return path.join(LOG_DIR, `sidecar-${slug}.log`);
}

function state(slug: string): State {
  let s = STATE.get(slug);
  if (!s) {
    s = { status: "stopped", adopted: false, restarts: 0, stoppedByUser: false, failures: 0, nextAttemptAt: 0 };
    STATE.set(slug, s);
  }
  return s;
}

function runtime(sidecar: Sidecar): SidecarRuntime {
  const s = state(sidecar.slug);
  return {
    slug: sidecar.slug,
    label: sidecar.label,
    description: sidecar.description,
    port: sidecar.port,
    proxyPrefix: sidecar.proxyPrefix,
    status: s.status,
    error: s.error,
    pid: s.pid,
    adopted: s.adopted,
    startedAt: s.startedAt,
    restarts: s.restarts,
    health: s.health,
  };
}

/** `/health` must answer `{status: "ok", sidecar: <slug>}`; anything else on
 *  the port is not ours. */
async function probe(sidecar: Sidecar): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${sidecar.port}/health`, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return body && body.status === "ok" && body.sidecar === sidecar.slug ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function logTailFromFile(slug: string, bytes = 1_500): string {
  try {
    const file = logPath(slug);
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, "r");
    const length = Math.min(bytes, size);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    fs.closeSync(fd);
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

export function logTail(slug: string, bytes = 20_000): string {
  return logTailFromFile(slug, bytes);
}

async function startInternal(sidecar: Sidecar): Promise<void> {
  const s = state(sidecar.slug);

  const adoptable = await probe(sidecar);
  if (adoptable) {
    const owner = resolvePortOwner(sidecar.port);
    Object.assign(s, {
      status: "ready" as const,
      error: undefined,
      adopted: s.child === undefined,
      pid: s.child?.pid ?? owner.pid ?? undefined,
      health: adoptable,
      startedAt: s.startedAt ?? (typeof adoptable.startedAt === "string" ? adoptable.startedAt : undefined),
    });
    if (s.adopted) logger.log(`${sidecar.slug}: adopted the healthy process on port ${sidecar.port} (${owner.description})`);
    return;
  }

  if (await isPortOpen(sidecar.port)) {
    const owner = resolvePortOwner(sidecar.port);
    s.status = "error";
    s.error =
      `Port ${sidecar.port} for sidecar "${sidecar.slug}" is held by something that does not answer as this sidecar — ` +
      `${owner.description}. Free it or change src/config/sidecars.json; the dashboard never picks another port.`;
    logger.error(s.error);
    return;
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const out = fs.openSync(logPath(sidecar.slug), "a");
  fs.writeSync(out, `\n===== ${new Date().toISOString()} starting ${sidecar.slug} =====\n`);

  const child = spawn(resolveCommand(sidecar), sidecar.args, {
    cwd: resolveCwd(sidecar),
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", DASHBOARD_PORT: process.env.PORT ?? "5000" },
  });
  fs.closeSync(out); // the child holds its own handle
  Object.assign(s, {
    status: "starting" as const,
    error: undefined,
    child,
    pid: child.pid,
    adopted: false,
    startedAt: new Date().toISOString(),
    health: undefined,
  });

  child.on("exit", (code, signal) => {
    if (s.child !== child) return;
    s.child = undefined;
    s.pid = undefined;
    if (s.status !== "stopped") {
      s.status = "error";
      s.error = `${sidecar.slug} exited (code ${code ?? "null"}, signal ${signal ?? "null"}). Log tail:\n${logTailFromFile(sidecar.slug)}`;
      logger.error(`${sidecar.slug} exited unexpectedly (code ${code})`);
    }
  });
  child.on("error", (err) => {
    s.status = "error";
    s.error = `failed to spawn ${sidecar.slug}: ${err.message}`;
    logger.error(s.error);
  });

  const deadline = Date.now() + sidecar.readyTimeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (s.status === "error") return;
    const health = await probe(sidecar);
    if (health) {
      s.status = "ready";
      s.health = health;
      logger.log(`${sidecar.slug}: ready on port ${sidecar.port} (PID ${child.pid})`);
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  s.status = "error";
  s.error = `${sidecar.slug} did not answer /health within ${sidecar.readyTimeoutSeconds}s. Log tail:\n${logTailFromFile(sidecar.slug)}`;
  if (child.pid) killTree(child.pid);
  s.child = undefined;
  s.pid = undefined;
}

/** Starts, adopts, or returns the already-ready sidecar. Concurrent callers
 *  share one start. */
export async function ensureSidecar(slug: string): Promise<SidecarRuntime> {
  const sidecar = findSidecar(slug);
  if (!sidecar) throw new Error(`unknown sidecar "${slug}"`);
  const s = state(slug);
  s.stoppedByUser = false;
  if (s.status === "ready" && (await probe(sidecar))) return runtime(sidecar);
  if (!s.startPromise) {
    s.startPromise = startInternal(sidecar).finally(() => {
      s.startPromise = undefined;
    });
  }
  await s.startPromise;
  return runtime(sidecar);
}

export async function stopSidecar(slug: string): Promise<SidecarRuntime> {
  const sidecar = findSidecar(slug);
  if (!sidecar) throw new Error(`unknown sidecar "${slug}"`);
  const s = state(slug);
  s.stoppedByUser = true;
  s.status = "stopped";
  const pid = s.pid ?? s.child?.pid ?? (s.adopted ? resolvePortOwner(sidecar.port).pid ?? undefined : undefined);
  if (pid) killTree(pid);
  s.child = undefined;
  s.pid = undefined;
  s.adopted = false;
  s.health = undefined;
  return runtime(sidecar);
}

export async function restartSidecar(slug: string): Promise<SidecarRuntime> {
  const sidecar = findSidecar(slug);
  if (!sidecar) throw new Error(`unknown sidecar "${slug}"`);
  // An adopted process is not in our PID bookkeeping — kill by port owner.
  const owner = resolvePortOwner(sidecar.port);
  await stopSidecar(slug);
  if (owner.pid) killTree(owner.pid);
  for (let i = 0; i < 20 && (await isPortOpen(sidecar.port)); i++) await new Promise((r) => setTimeout(r, 250));
  state(slug).restarts += 1;
  return ensureSidecar(slug);
}

export async function listSidecars(): Promise<SidecarRuntime[]> {
  const config = loadSidecarsConfig();
  const out: SidecarRuntime[] = [];
  for (const sidecar of config.sidecars) {
    const s = state(sidecar.slug);
    // Report what IS: a sidecar started by an earlier dashboard process is
    // healthy even though this process never spawned it.
    const health = await probe(sidecar);
    if (health) {
      if (s.status !== "ready") {
        s.status = "ready";
        s.adopted = s.child === undefined;
        s.error = undefined;
      }
      s.health = health;
    } else if (s.status === "ready") {
      s.status = "error";
      s.error = `${sidecar.slug} stopped answering /health`;
    }
    out.push(runtime(sidecar));
  }
  return out;
}

export function sidecarStatus(slug: string): SidecarStatus {
  return state(slug).status;
}

/** Boot: start every autostart sidecar, then watch them. */
export function startSidecars(): void {
  const config = loadSidecarsConfig();
  for (const sidecar of config.sidecars.filter((s) => s.autostart)) {
    ensureSidecar(sidecar.slug).catch((err) => logger.error(`${sidecar.slug}: ${(err as Error).message}`));
  }
  if (!watchdog) {
    watchdog = setInterval(() => {
      for (const sidecar of loadSidecarsConfig().sidecars.filter((s) => s.autostart)) {
        const s = state(sidecar.slug);
        if (s.stoppedByUser || s.startPromise || Date.now() < s.nextAttemptAt) continue;
        probe(sidecar).then((health) => {
          if (health) {
            s.health = health;
            s.failures = 0;
            return;
          }
          if (s.status === "ready" || s.status === "error") {
            logger.warn(`${sidecar.slug}: not answering — restarting (attempt ${s.failures + 1})`);
            s.restarts += 1;
            s.status = "stopped";
            ensureSidecar(sidecar.slug)
              .then((r) => {
                if (r.status === "ready") {
                  s.failures = 0;
                } else {
                  s.failures += 1;
                  s.nextAttemptAt = Date.now() + Math.min(WATCHDOG_MS * 2 ** s.failures, 10 * 60_000);
                }
              })
              .catch((err) => logger.error(`${sidecar.slug}: ${(err as Error).message}`));
          }
        });
      }
    }, WATCHDOG_MS);
    watchdog.unref();
  }
}

/** Graceful dashboard shutdown: stop what this dashboard runs. */
export async function stopAllSidecars(): Promise<void> {
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
  for (const sidecar of loadSidecarsConfig().sidecars) {
    const s = state(sidecar.slug);
    if (s.status === "ready" || s.status === "starting" || s.pid) {
      logger.log(`stopping ${sidecar.slug}`);
      await stopSidecar(sidecar.slug);
    }
  }
}
