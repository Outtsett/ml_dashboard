/**
 * Notebook group process lifecycle — one `marimo run` (or, for the editor
 * pseudo-group, `marimo edit`) child process per group, spawned lazily,
 * health-polled through its own proxied /health, and tree-killed on
 * dashboard shutdown.
 *
 * Windows-specific: this repo's dev server runs under `tsx --watch`, which
 * restarts the Node process on every server-file save but does NOT kill
 * child processes it spawned — they're orphaned, still listening on their
 * pinned port. So `start()` always probes the port's health BEFORE spawning;
 * a healthy response there is adopted rather than treated as a fresh start,
 * and a port that answers but isn't ours is a loud, named failure rather
 * than a silent port hop (ports are pinned, never chosen).
 */

import { spawn, execFileSync, type ChildProcess } from "child_process";
import net from "net";
import { Logger } from "@nestjs/common";
import { findGroup, loadNotebooksConfig, type NotebookGroup } from "./config";
import { findNotebookByPath, getGroupNotebookPaths } from "./catalog";

const logger = new Logger("MarimoServers");

export type GroupStatus = "stopped" | "starting" | "ready" | "error";

export interface GroupRuntime {
  slug: string;
  status: GroupStatus;
  error?: string;
  /** true when this state was inherited from a process this session did not
   *  spawn (adopted after a tsx --watch restart orphaned it). */
  adopted: boolean;
  /** The file currently open, for the editor pseudo-group only. */
  currentFile?: string;
}

interface InternalState {
  status: GroupStatus;
  error?: string;
  child?: ChildProcess;
  pid?: number;
  adopted: boolean;
  stderrTail: string;
  currentFile?: string;
  /** Guards against two concurrent start() calls racing to spawn twice. */
  startPromise?: Promise<InternalState>;
}

const STATE = new Map<string, InternalState>();
const STDERR_TAIL_LIMIT = 4000;
const READY_POLL_INTERVAL_MS = 250;
const READY_TIMEOUT_MS = 60_000;
const HEALTH_PROBE_TIMEOUT_MS = 1_500;

function baseUrlFor(slug: string): string {
  return `/marimo/${slug}`;
}

function ensureState(slug: string): InternalState {
  let state = STATE.get(slug);
  if (!state) {
    state = { status: "stopped", adopted: false, stderrTail: "" };
    STATE.set(slug, state);
  }
  return state;
}

function toRuntime(slug: string, state: InternalState): GroupRuntime {
  return {
    slug,
    status: state.status,
    error: state.error,
    adopted: state.adopted,
    currentFile: state.currentFile,
  };
}

async function probeHealth(port: number, baseUrl: string, timeoutMs = HEALTH_PROBE_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${baseUrl}/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as { status?: string } | null;
    return body?.status === "healthy" || body?.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function isPortOpen(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/** Best-effort PID + process name for a LISTENING port, via netstat/tasklist.
 *  Used both to name the offender in an error message and, on adoption, to
 *  record a PID we can later tree-kill on shutdown even though we didn't
 *  spawn the process ourselves. */
function resolvePortOwner(port: number): { pid: number | null; description: string } {
  try {
    const netstatOut = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", windowsHide: true });
    const line = netstatOut
      .split(/\r?\n/)
      .find((l) => new RegExp(`[:.]${port}\\s+.*LISTENING`).test(l));
    if (!line) return { pid: null, description: `port ${port}: no LISTENING owner found via netstat` };
    const pidToken = line.trim().split(/\s+/).pop();
    const pid = pidToken ? Number.parseInt(pidToken, 10) : NaN;
    if (!Number.isFinite(pid)) return { pid: null, description: `port ${port}: netstat row had no parseable PID (${line.trim()})` };

    let name = "unknown process";
    try {
      const tasklistOut = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        windowsHide: true,
      });
      const firstField = tasklistOut.split(/\r?\n/)[0]?.split('","')[0]?.replace(/^"/, "");
      if (firstField) name = firstField;
    } catch {
      // best effort — PID alone is still actionable
    }
    return { pid, description: `port ${port} is held by PID ${pid} (${name})` };
  } catch (err) {
    return { pid: null, description: `port ${port}: could not inspect owner via netstat (${(err as Error).message})` };
  }
}

function killPid(pid: number): void {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } catch (err) {
    logger.warn(`taskkill /PID ${pid} failed (process may already be gone): ${(err as Error).message}`);
  }
}

async function waitForReady(port: number, baseUrl: string, state: InternalState): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.status === "error") return false; // child exited already — stop polling a dead process
    if (await probeHealth(port, baseUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  return false;
}

function spawnMarimo(
  state: InternalState,
  python: string,
  cwd: string,
  port: number,
  baseUrl: string,
  args: string[],
  label: string,
): ChildProcess {
  state.status = "starting";
  state.error = undefined;
  state.adopted = false;
  state.stderrTail = "";

  const child = spawn(python, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  state.child = child;
  state.pid = child.pid;

  const appendTail = (chunk: Buffer) => {
    state.stderrTail = (state.stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_LIMIT);
  };
  child.stdout?.on("data", appendTail);
  child.stderr?.on("data", appendTail);

  child.on("exit", (code, signal) => {
    if (state.child !== child) return; // superseded by a later start() — not this exit's concern
    state.child = undefined;
    state.pid = undefined;
    if (state.status !== "stopped") {
      state.status = "error";
      state.error = `${label} exited (code ${code ?? "null"}, signal ${signal ?? "null"}). stderr tail:\n${state.stderrTail.slice(-800)}`;
      logger.error(`group "${label}" process exited unexpectedly on port ${port}: ${state.error}`);
    }
  });
  child.on("error", (err) => {
    state.status = "error";
    state.error = `failed to spawn ${label}: ${err.message}`;
    logger.error(state.error);
  });

  return child;
}

async function startGroupInternal(group: NotebookGroup): Promise<InternalState> {
  const state = ensureState(group.slug);
  const baseUrl = baseUrlFor(group.slug);

  if (state.status === "ready" && (await probeHealth(group.port, baseUrl))) {
    return state;
  }

  // A previous tsx --watch cycle may have orphaned a still-healthy process.
  if (await probeHealth(group.port, baseUrl)) {
    const owner = resolvePortOwner(group.port);
    state.status = "ready";
    state.error = undefined;
    state.adopted = true;
    state.pid = owner.pid ?? undefined;
    logger.log(`group "${group.slug}" adopted an already-healthy marimo on port ${group.port} (${owner.description})`);
    return state;
  }

  if (await isPortOpen(group.port)) {
    const owner = resolvePortOwner(group.port);
    state.status = "error";
    state.error =
      `Port ${group.port} for group "${group.slug}" is already in use by something that is not this dashboard's ` +
      `marimo (it did not answer ${baseUrl}/health) — ${owner.description}. Free the port or change it in ` +
      `src/config/notebooks.json; this dashboard never picks a different port.`;
    logger.error(state.error);
    return state;
  }

  const files = getGroupNotebookPaths(group.slug);
  if (files.length === 0) {
    state.status = "error";
    state.error = `group "${group.slug}" has no notebooks under its configured roots`;
    return state;
  }

  const args = [
    "-m",
    "marimo",
    "run",
    ...files,
    "--host",
    "127.0.0.1",
    "--port",
    String(group.port),
    "--headless",
    "--base-url",
    baseUrl,
    "--watch",
    "--session-ttl",
    "86400",
    "--no-token",
  ];

  spawnMarimo(state, group.python, group.cwd, group.port, baseUrl, args, `group "${group.slug}"`);

  const ready = await waitForReady(group.port, baseUrl, state);
  if (ready) {
    state.status = "ready";
  } else if (state.status !== "error") {
    state.status = "error";
    state.error = `marimo run for group "${group.slug}" did not answer healthy within ${READY_TIMEOUT_MS / 1000}s. stderr tail:\n${state.stderrTail.slice(-800)}`;
    if (state.pid) killPid(state.pid);
    state.child = undefined;
    state.pid = undefined;
  }
  return state;
}

/** Starts (or adopts, or returns already-ready) the named group. Concurrent
 *  callers share one in-flight start rather than racing to spawn twice. */
export async function startGroup(slug: string): Promise<GroupRuntime> {
  const config = loadNotebooksConfig();
  const group = findGroup(config, slug);
  if (!group) throw new Error(`unknown notebook group "${slug}"`);

  const state = ensureState(slug);
  if (!state.startPromise) {
    state.startPromise = startGroupInternal(group).finally(() => {
      state.startPromise = undefined;
    });
  }
  const result = await state.startPromise;
  return toRuntime(slug, result);
}

export function getGroupStatus(slug: string): GroupRuntime {
  return toRuntime(slug, ensureState(slug));
}

export function listGroupStatuses(): GroupRuntime[] {
  const config = loadNotebooksConfig();
  return config.groups.map((g) => getGroupStatus(g.slug));
}

export async function stopGroup(slug: string): Promise<GroupRuntime> {
  const state = ensureState(slug);
  if (state.pid) {
    killPid(state.pid);
  } else if (state.child) {
    try {
      state.child.kill();
    } catch {
      // already gone
    }
  }
  state.status = "stopped";
  state.error = undefined;
  state.child = undefined;
  state.pid = undefined;
  state.adopted = false;
  return toRuntime(slug, state);
}

// ─── Editor pseudo-group ──────────────────────────────────────────────────

const EDITOR_SLUG = "editor";

/** Opens `absolutePath` in the single on-demand editor process, restarting
 *  it (in the notebook's own group's interpreter + cwd) if a different file
 *  is currently open. */
export async function startEditor(absolutePath: string): Promise<GroupRuntime> {
  const config = loadNotebooksConfig();
  const notebook = findNotebookByPath(absolutePath);
  if (!notebook) throw new Error(`"${absolutePath}" is not a catalog notebook`);
  const group = findGroup(config, notebook.groupSlug);
  if (!group) throw new Error(`notebook "${absolutePath}" has no owning group`);

  const state = ensureState(EDITOR_SLUG);
  const baseUrl = baseUrlFor(EDITOR_SLUG);

  if (state.currentFile === notebook.path && state.status === "ready" && (await probeHealth(config.editor.port, baseUrl))) {
    return toRuntime(EDITOR_SLUG, state);
  }

  if (!state.startPromise) {
    state.startPromise = (async () => {
      // Switching files (or recovering from a dead editor) — stop whatever is there first.
      if (state.pid || state.child) {
        if (state.pid) killPid(state.pid);
        state.child = undefined;
        state.pid = undefined;
      } else if (await probeHealth(config.editor.port, baseUrl)) {
        // Orphaned editor from a prior process — adopt its PID so we can replace it.
        const owner = resolvePortOwner(config.editor.port);
        if (owner.pid) killPid(owner.pid);
      }

      if (await isPortOpen(config.editor.port)) {
        const owner = resolvePortOwner(config.editor.port);
        state.status = "error";
        state.error = `Editor port ${config.editor.port} is held by something else — ${owner.description}.`;
        return state;
      }

      const args = [
        "-m",
        "marimo",
        "edit",
        notebook.path,
        "--host",
        "127.0.0.1",
        "--port",
        String(config.editor.port),
        "--headless",
        "--base-url",
        baseUrl,
        "--no-token",
      ];
      spawnMarimo(state, group.python, group.cwd, config.editor.port, baseUrl, args, `editor (${notebook.path})`);
      state.currentFile = notebook.path;

      const ready = await waitForReady(config.editor.port, baseUrl, state);
      if (ready) {
        state.status = "ready";
      } else if (state.status !== "error") {
        state.status = "error";
        state.error = `marimo edit did not answer healthy within ${READY_TIMEOUT_MS / 1000}s. stderr tail:\n${state.stderrTail.slice(-800)}`;
        if (state.pid) killPid(state.pid);
        state.child = undefined;
        state.pid = undefined;
      }
      return state;
    })().finally(() => {
      state.startPromise = undefined;
    });
  }

  const result = await state.startPromise;
  return toRuntime(EDITOR_SLUG, result);
}

export function getEditorStatus(): GroupRuntime {
  return toRuntime(EDITOR_SLUG, ensureState(EDITOR_SLUG));
}

// ─── Shutdown ───────────────────────────────────────────────────────────────

/** Tree-kills every marimo process this session spawned or adopted a PID
 *  for. Called from the dashboard's own graceful-shutdown handler. */
export async function stopAllGroups(): Promise<void> {
  for (const [slug, state] of STATE) {
    if (state.pid) {
      logger.log(`stopping marimo group "${slug}" (PID ${state.pid})`);
      killPid(state.pid);
    } else if (state.child) {
      try {
        state.child.kill();
      } catch {
        // already gone
      }
    }
    state.status = "stopped";
    state.child = undefined;
    state.pid = undefined;
  }
}
