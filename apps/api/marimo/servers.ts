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

import { spawn, execFile, type ChildProcess } from "child_process";
import { promisify } from "util";
import net from "net";
import { Logger } from "@nestjs/common";
import { findGroup, loadNotebooksConfig, type NotebookGroup } from "./config";
import { findNotebookByPath, getCatalog, getGroupNotebookPaths } from "./catalog";
import { activityOf, resetActivity } from "./activity";
import { reapOrphanedChecks, stopAllHealthChecks } from "./health";
import { isPinned, lastStartupSeconds, recordStartupSeconds } from "./store";

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
  /** While starting: when the spawn happened, and the last line marimo printed. */
  startingSinceIso?: string;
  lastOutputLine?: string;
  /** When the idle sweep last stopped this group, so the list can say why it is not running. */
  stoppedForIdleAtIso?: string;
  pid?: number;
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
  startedAtMs?: number;
  lastOutputLine?: string;
  stoppedForIdleAtIso?: string;
}

const STATE = new Map<string, InternalState>();
const execFileAsync = promisify(execFile);

/** Set when the dashboard begins to shut down: nothing spawns after it, so no
 *  marimo is started after stopAllGroups has already walked the list. */
let shuttingDown = false;
const STDERR_TAIL_LIMIT = 4000;
const EDITOR_SLUG = "editor";
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
    startingSinceIso: state.status === "starting" && state.startedAtMs ? new Date(state.startedAtMs).toISOString() : undefined,
    lastOutputLine: state.status === "starting" ? state.lastOutputLine : undefined,
    stoppedForIdleAtIso: state.status === "stopped" ? state.stoppedForIdleAtIso : undefined,
    pid: state.pid,
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
 *  Used both to name the offender in an error message and to find the process
 *  to stop for a group this session did not spawn. Asynchronous: netstat and
 *  tasklist take about a second between them, which a synchronous call spent
 *  blocking every request the dashboard was serving. */
async function resolvePortOwner(port: number, withName = true): Promise<{ pid: number | null; description: string }> {
  try {
    const { stdout: netstatOut } = await execFileAsync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    const line = netstatOut
      .split(/\r?\n/)
      .find((l) => new RegExp(`[:.]${port}\\s+.*LISTENING`).test(l));
    if (!line) return { pid: null, description: `port ${port}: no LISTENING owner found via netstat` };
    const pidToken = line.trim().split(/\s+/).pop();
    const pid = pidToken ? Number.parseInt(pidToken, 10) : NaN;
    if (!Number.isFinite(pid)) return { pid: null, description: `port ${port}: netstat row had no parseable PID (${line.trim()})` };
    if (!withName) return { pid, description: `port ${port} is held by PID ${pid}` };

    let name = "unknown process";
    try {
      const { stdout: tasklistOut } = await execFileAsync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
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

async function killPid(pid: number): Promise<void> {
  try {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 });
  } catch (err) {
    logger.warn(`taskkill /PID ${pid} failed (process may already be gone): ${(err as Error).message}`);
  }
}

/** The port a group (or the editor) listens on. */
function portFor(slug: string): number | undefined {
  const config = loadNotebooksConfig();
  return slug === EDITOR_SLUG ? config.editor.port : findGroup(config, slug)?.port;
}

/** Stops whatever serves a state: the process tree this session spawned, or,
 *  for a group it adopted, the process that owns the port NOW and answers as
 *  marimo. An adopted PID is never killed from memory: if that marimo died,
 *  Windows may have given its PID to something else. */
async function terminate(slug: string, state: InternalState): Promise<void> {
  const child = state.child;
  if (child?.pid) {
    await killPid(child.pid);
    return;
  }
  const port = portFor(slug);
  if (port === undefined) return;
  if (!(await probeHealth(port, baseUrlFor(slug)))) return;
  const owner = await resolvePortOwner(port, false);
  if (owner.pid) await killPid(owner.pid);
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
  state.startedAtMs = Date.now();
  state.lastOutputLine = undefined;
  state.stoppedForIdleAtIso = undefined;

  const child = spawn(python, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  state.child = child;
  state.pid = child.pid;

  const appendTail = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    state.stderrTail = (state.stderrTail + text).slice(-STDERR_TAIL_LIMIT);
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0) state.lastOutputLine = lines[lines.length - 1]!.slice(0, 200);
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

  // Say "starting" from the first moment: the port probes below take a second
  // or more, and a list read in between would otherwise show the group as not
  // running while it is being started.
  if (state.status !== "starting") {
    state.status = "starting";
    state.error = undefined;
    state.startedAtMs = Date.now();
    state.lastOutputLine = "checking whether it is already running";
  }

  // A previous tsx --watch cycle may have orphaned a still-healthy process.
  if (await probeHealth(group.port, baseUrl)) {
    const owner = await resolvePortOwner(group.port);
    state.status = "ready";
    state.error = undefined;
    state.adopted = true;
    state.pid = owner.pid ?? undefined;
    resetActivity(group.slug);
    logger.log(`group "${group.slug}" adopted an already-healthy marimo on port ${group.port} (${owner.description})`);
    return state;
  }

  if (await isPortOpen(group.port)) {
    const owner = await resolvePortOwner(group.port);
    state.status = "error";
    state.error =
      `Port ${group.port} for group "${group.slug}" is already in use by something that is not this dashboard's ` +
      `marimo (it did not answer ${baseUrl}/health) — ${owner.description}. Free the port or change it in ` +
      `packages/config/notebooks.json; this dashboard never picks a different port.`;
    logger.error(state.error);
    return state;
  }

  if (shuttingDown) {
    state.status = "stopped";
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
    if (state.startedAtMs) recordStartupSeconds(group.slug, (Date.now() - state.startedAtMs) / 1000);
    resetActivity(group.slug);
  } else if ((state.status as GroupStatus) !== "error") {
    // (The exit handler may have set "error" while we waited; TypeScript cannot see that.)
    state.status = "error";
    state.error = `marimo run for group "${group.slug}" did not answer healthy within ${READY_TIMEOUT_MS / 1000}s. stderr tail:\n${state.stderrTail.slice(-800)}`;
    if (state.pid) await killPid(state.pid);
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
  await terminate(slug, state);
  state.status = "stopped";
  state.error = undefined;
  state.child = undefined;
  state.pid = undefined;
  state.adopted = false;
  return toRuntime(slug, state);
}

// ─── Editor pseudo-group ──────────────────────────────────────────────────

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
      // Switching files (or recovering from a dead editor) — stop whatever is
      // there first: our own child, or an orphaned editor still answering.
      await terminate(EDITOR_SLUG, state);
      state.child = undefined;
      state.pid = undefined;
      if (shuttingDown) return state;

      if (await isPortOpen(config.editor.port)) {
        const owner = await resolvePortOwner(config.editor.port);
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
        if (state.pid) await killPid(state.pid);
        state.child = undefined;
        state.pid = undefined;
      }
      return state;
    })().finally(() => {
      state.startPromise = undefined;
    });
  }

  const result = await state.startPromise;
  // The start we waited on may have been for another file (two opens in quick
  // succession): then open this one now rather than report the other as ready.
  if (result.currentFile !== notebook.path && !shuttingDown) return startEditor(absolutePath);
  return toRuntime(EDITOR_SLUG, result);
}

export function getEditorStatus(): GroupRuntime {
  return toRuntime(EDITOR_SLUG, ensureState(EDITOR_SLUG));
}

// ─── Shutdown ───────────────────────────────────────────────────────────────

/** Tree-kills every marimo process this session spawned or adopted a PID
 *  for. Called from the dashboard's own graceful-shutdown handler. */
export async function stopAllGroups(): Promise<void> {
  shuttingDown = true;
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = undefined;
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = undefined;
  stopAllHealthChecks();
  for (const [slug, state] of STATE) {
    if (state.status !== "stopped" || state.child) {
      logger.log(`stopping marimo group "${slug}"`);
      await terminate(slug, state);
    }
    state.status = "stopped";
    state.child = undefined;
    state.pid = undefined;
  }
}

// ─── Resources, idle stop, warm start ─────────────────────────────────────────

const MEMORY_CACHE_MS = 10_000;

interface ProcessRow {
  parentPid: number;
  workingSetBytes: number;
  /** Image name, e.g. "python.exe" (empty when the query did not return it). */
  name: string;
}

let memoryCache: { atMs: number; processes: Map<number, ProcessRow> } | null = null;
let memoryRefresh: Promise<void> | null = null;
/** When the process query last failed: a failing query is not re-awaited on every poll. */
let memoryFailedAtMs = 0;

/** Parses `Win32_Process | Select ProcessId,ParentProcessId,WorkingSetSize,Name |
 *  ConvertTo-Csv` into PID -> (parent, working set, name). Exported for the unit test. */
export function parseProcessTable(output: string): Map<number, ProcessRow> {
  const processes = new Map<number, ProcessRow>();
  for (const line of output.split(/\r?\n/)) {
    const fields = line.match(/"([^"]*)"/g)?.map((field) => field.slice(1, -1));
    if (!fields || fields.length < 3) continue;
    const pid = Number.parseInt(fields[0]!, 10);
    const parentPid = Number.parseInt(fields[1]!, 10);
    const workingSetBytes = Number.parseInt(fields[2]!, 10);
    if (Number.isFinite(pid) && Number.isFinite(parentPid) && Number.isFinite(workingSetBytes)) {
      processes.set(pid, { parentPid, workingSetBytes, name: (fields[3] ?? "").toLowerCase() });
    }
  }
  return processes;
}

/** Working set of a process and every process below it. A venv's python.exe on
 *  Windows is a launcher that runs the real interpreter as its child, so the
 *  launcher's own few megabytes are not the notebook's memory; the tree is. */
export function treeWorkingSetBytes(rootPid: number, processes: Map<number, ProcessRow>): number | null {
  if (!processes.has(rootPid)) return null;
  const children = new Map<number, number[]>();
  for (const [pid, row] of processes) {
    if (pid === row.parentPid) continue;
    const list = children.get(row.parentPid) ?? [];
    list.push(pid);
    children.set(row.parentPid, list);
  }
  let total = 0;
  const seen = new Set<number>();
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += processes.get(pid)?.workingSetBytes ?? 0;
    stack.push(...(children.get(pid) ?? []));
  }
  return total;
}

const PROCESS_QUERY = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,Name | ConvertTo-Csv -NoTypeInformation";

const PYTHON_IMAGES = new Set(["python.exe", "pythonw.exe"]);

/** The topmost python process above `pid`. An ADOPTED group's PID is the port
 *  owner — the real interpreter — while a spawned group's is the venv launcher
 *  above it; starting from the topmost python counts the launcher in both cases,
 *  so the same group reports the same memory however it was started. */
export function topmostPython(pid: number, processes: Map<number, ProcessRow>): number {
  let current = pid;
  const seen = new Set<number>([current]);
  for (;;) {
    const parent = processes.get(current)?.parentPid;
    if (parent === undefined || seen.has(parent)) return current;
    const row = processes.get(parent);
    if (!row || !PYTHON_IMAGES.has(row.name)) return current;
    seen.add(parent);
    current = parent;
  }
}

function refreshMemory(): Promise<void> {
  memoryRefresh ??= new Promise<void>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", PROCESS_QUERY],
      { windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (!err) memoryCache = { atMs: Date.now(), processes: parseProcessTable(stdout) };
        else memoryFailedAtMs = Date.now();
        memoryRefresh = null;
        resolve();
      },
    );
  });
  return memoryRefresh;
}

/** Working-set bytes of each running group's process tree. Every browser
 *  session of `marimo run` is a thread in that one interpreter, so the tree is
 *  the group's memory. Read from a cache at most ten seconds old (the query
 *  takes about 1.4 s); only the first call waits for it. */
export async function groupMemoryBytes(): Promise<Map<string, number>> {
  const anyReady = [...STATE.values()].some((state) => state.status === "ready" && state.pid);
  if (!anyReady) return new Map();
  const recentlyFailed = Date.now() - memoryFailedAtMs < MEMORY_CACHE_MS;
  if (!memoryCache && !recentlyFailed) await refreshMemory();
  else if (!memoryCache || Date.now() - memoryCache.atMs > MEMORY_CACHE_MS) void refreshMemory();
  const bySlug = new Map<string, number>();
  for (const [slug, state] of STATE) {
    if (state.status !== "ready" || !state.pid || !memoryCache) continue;
    const bytes = treeWorkingSetBytes(topmostPython(state.pid, memoryCache.processes), memoryCache.processes);
    if (bytes !== null) bySlug.set(slug, bytes);
  }
  return bySlug;
}

/** True when the group holds a pinned notebook: those are kept warm. */
export function groupHasPinnedNotebook(slug: string): boolean {
  return getCatalog().notebooks.some((notebook) => notebook.groupSlug === slug && isPinned(notebook.path));
}

export function expectedStartupSeconds(slug: string): number | null {
  return lastStartupSeconds(slug);
}

const IDLE_SWEEP_INTERVAL_MS = 60_000;
let idleTimer: ReturnType<typeof setInterval> | undefined;
let warmTimer: ReturnType<typeof setTimeout> | undefined;

/** One pass of the idle rule: a ready group with no open notebook page, no
 *  request for `idleStopMinutes`, and no pinned notebook is stopped. */
export async function sweepIdleGroups(nowMs = Date.now()): Promise<string[]> {
  const config = loadNotebooksConfig();
  if (config.idleStopMinutes <= 0) return [];
  const stopped: string[] = [];
  for (const group of config.groups) {
    const state = STATE.get(group.slug);
    if (state?.status !== "ready") continue;
    // An adopted marimo that died has no exit listener here: find out by asking
    // it, and mark it stopped without killing anything by a remembered PID.
    if (!state.child && !(await probeHealth(group.port, baseUrlFor(group.slug)))) {
      state.status = "stopped";
      state.pid = undefined;
      state.adopted = false;
      continue;
    }
    const { openConnections, lastActivityMs } = activityOf(group.slug);
    if (openConnections > 0) continue;
    if (nowMs - lastActivityMs < config.idleStopMinutes * 60_000) continue;
    if (groupHasPinnedNotebook(group.slug)) continue;
    await stopGroup(group.slug);
    ensureState(group.slug).stoppedForIdleAtIso = new Date(nowMs).toISOString();
    logger.log(`stopped idle group "${group.slug}" (no open notebook for ${config.idleStopMinutes} minutes)`);
    stopped.push(group.slug);
  }
  return stopped;
}

/** After the dashboard is listening: start (or adopt) every group holding a
 *  pinned notebook so it opens at once, then run the idle sweep every minute. */
export function startMarimoBackground(): void {
  if (idleTimer) return;
  reapOrphanedChecks();
  idleTimer = setInterval(() => {
    sweepIdleGroups().catch((err) => logger.warn(`idle sweep failed: ${(err as Error).message}`));
  }, IDLE_SWEEP_INTERVAL_MS);
  idleTimer.unref?.();

  // A tsx --watch restart forgets every group but leaves its marimo running and
  // still serving open tabs, so a group already answering on its port is adopted
  // here too; otherwise the list says "not running" over a notebook in use.
  const warm = async () => {
    const config = loadNotebooksConfig();
    for (const group of config.groups) {
      const pinned = groupHasPinnedNotebook(group.slug);
      const answering = await probeHealth(group.port, baseUrlFor(group.slug));
      if (!pinned && !answering) continue;
      const runtime = await startGroup(group.slug).catch((err: Error) => ({ status: "error", error: err.message }));
      logger.log(`${answering ? "adopted" : "warm start of"} "${group.slug}"${pinned ? " (holds a pinned notebook)" : ""}: ${runtime.status}`);
    }
  };
  warmTimer = setTimeout(() => {
    warmTimer = undefined;
    warm().catch((err) => logger.warn(`warm start failed: ${(err as Error).message}`));
  }, 3_000);
  warmTimer.unref?.();
}

/** Starts a group in the background, e.g. right after one of its notebooks is pinned. */
export function warmGroup(slug: string): void {
  if (getGroupStatus(slug).status === "ready") return;
  startGroup(slug).catch((err) => logger.warn(`warm start of "${slug}" failed: ${(err as Error).message}`));
}
