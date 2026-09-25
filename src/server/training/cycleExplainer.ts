/**
 * "Inside the model" explainer pool — one warm Python process for the whole
 * server, spoken to over the JSON-lines protocol in `@shared/cycle/explain`.
 *
 * The process (`<repo>/.venv/Scripts/python.exe src/ml/cycle/explain_main.py
 * --serve`, overridable with `CYCLE_EXPLAINER_COMMAND` or the constructor's
 * `command`) is CPU-only (`CUDA_VISIBLE_DEVICES=""`) so it never competes with
 * a training run for the GPU, and keeps fitted fold models loaded between
 * requests, which is the whole point of keeping it warm.
 *
 * Lifecycle:
 *   - spawned lazily by the first request; it must print its ready line within
 *     60 s, or it is killed and counted as a crash;
 *   - one request in flight at a time, the rest queued; a request times out
 *     30 s after it is sent, and the process is then killed (a computation
 *     cannot be cancelled any other way) and respawned for the next request;
 *   - a newer `explain` for the same (run, fold, role) supersedes one still
 *     queued: the older resolves as "superseded" and is never sent;
 *   - a crash rejects every pending request; the next request respawns it,
 *     unless it crashed 3 times in 60 s, which makes requests fail as
 *     "unavailable" (503) with the tail of its stderr until the window passes;
 *   - it is asked to exit after 10 minutes idle; `stopCycleExplainer()` stops
 *     it on shutdown; `releaseRun(dir)` makes it drop a run's models (Windows
 *     locks mapped files, so this comes before a run's files are deleted).
 *
 * Replies are cached in an LRU of 256 keyed by the request and the mtimes of
 * the model files it reads, so a replaced model is never served stale.
 * Results are validated against the explain.ts schema for their operation; a
 * result the schema rejects is reported as "invalid" and never cached.
 *
 * Design: `docs/plans/2026-09-26-cycle-catalog-inside-view.md` (WP7).
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "child_process";
import { stat } from "fs/promises";
import path from "path";
import { createInterface } from "readline";
import { Logger } from "@nestjs/common";
import { LRUCache } from "lru-cache";
import type { ZodTypeAny } from "zod";
import {
  cycleExplainBarSchema,
  cycleExplainStructureSchema,
  cycleExplainTreeSchema,
  cycleExplainerReadySchema,
  cycleExplainerReplySchema,
  type CycleExplainRole,
  type CycleExplainerRequest,
} from "@shared/cycle/explain";

const logger = new Logger("CycleExplainer");

// ─── Public types ────────────────────────────────────────────────────────────

/** The model questions a caller can ask; `id` is assigned by the pool. */
export type CycleExplainerOperation =
  | { op: "structure"; runDirectory: string; fold: number; role: CycleExplainRole }
  | { op: "tree"; runDirectory: string; fold: number; role: CycleExplainRole; tree: number }
  | { op: "explain"; runDirectory: string; fold: number; role: CycleExplainRole; timestamp: number };

export type CycleExplainerOutcome =
  /** The explainer answered and the result passed its schema. */
  | { status: "ok"; result: unknown; cached: boolean }
  /** The explainer answered `ok: false` — its sentence and optional details. */
  | { status: "error"; error: string; details?: string }
  /** The explainer answered, but the result failed its explain.ts schema. */
  | { status: "invalid"; error: string }
  /** A newer `explain` for the same run, fold and role replaced this one before it was sent. */
  | { status: "superseded" };

/** Why a request could not be answered at all. */
export type CycleExplainerFailure =
  | "unavailable" // crashed too often recently; not restarted until the window passes
  | "ready_timeout" // spawned but never printed its ready line
  | "timeout" // sent, but no reply in time
  | "crashed" // the process exited while the request was pending
  | "stopped" // stop() was called while the request was pending
  | "spawn_failed"; // the command could not be started

export class CycleExplainerError extends Error {
  constructor(
    message: string,
    public readonly failure: CycleExplainerFailure,
    /** The last few kilobytes the process wrote to stderr, for the 503 body and the log. */
    public readonly stderrTail: string,
  ) {
    super(message);
    this.name = "CycleExplainerError";
  }
}

export interface CycleExplainerOptions {
  /** Executable plus arguments. Default: `CYCLE_EXPLAINER_COMMAND`, else the repo venv's Python on `explain_main.py --serve`. */
  command?: string[];
  /** Working directory. Default: the repo root (`process.cwd()`). */
  cwd?: string;
  /** Extra environment on top of `process.env` and the fixed CPU-only settings. */
  env?: Record<string, string>;
  readyTimeoutMs?: number;
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
  crashLimit?: number;
  crashWindowMs?: number;
  cacheSize?: number;
}

export interface CycleExplainerStatus {
  running: boolean;
  ready: boolean;
  pid: number | null;
  queued: number;
  inFlight: boolean;
  /** Processes started over this pool's life. */
  spawnCount: number;
  /** Crashes inside the current crash window. */
  recentCrashes: number;
  cachedReplies: number;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const READY_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 10 * 60_000;
const CRASH_LIMIT = 3;
const CRASH_WINDOW_MS = 60_000;
const CACHE_SIZE = 256;
/** How long a graceful exit (`op: exit`) gets before the tree is killed. */
const EXIT_GRACE_MS = 2_000;
const STDERR_TAIL_CHARACTERS = 4_000;

/** Fixed for every explainer process: CPU only, bounded threads, unbuffered stdout. */
export const CYCLE_EXPLAINER_ENVIRONMENT: Readonly<Record<string, string>> = {
  CUDA_VISIBLE_DEVICES: "",
  OMP_NUM_THREADS: "4",
  PYTHONUNBUFFERED: "1",
};

/**
 * `CYCLE_EXPLAINER_COMMAND` is either a JSON array (`["C:/py.exe", "x.py"]`,
 * needed when a path holds a space) or a whitespace-separated command line.
 */
export function parseExplainerCommand(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((part) => typeof part === "string")) {
      throw new Error("CYCLE_EXPLAINER_COMMAND must be a non-empty JSON array of strings");
    }
    return parsed as string[];
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new Error("CYCLE_EXPLAINER_COMMAND is empty");
  return parts;
}

export function defaultExplainerCommand(repoRoot: string = process.cwd()): string[] {
  const fromEnvironment = process.env.CYCLE_EXPLAINER_COMMAND;
  if (fromEnvironment && fromEnvironment.trim()) return parseExplainerCommand(fromEnvironment);
  const python =
    process.platform === "win32"
      ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
      : path.join(repoRoot, ".venv", "bin", "python");
  return [python, path.join("src", "ml", "cycle", "explain_main.py"), "--serve"];
}

/** Where the engine saves a fold's model for a role (see the brief's artifact layout). */
export function modelFileFor(runDirectory: string, fold: number, role: CycleExplainRole): string {
  const foldDirectory = path.join(runDirectory, `fold_${fold}`);
  return role === "price" ? path.join(foldDirectory, "price_model", "model.json") : path.join(foldDirectory, "model.json");
}

const RESULT_SCHEMAS: Record<CycleExplainerOperation["op"], ZodTypeAny> = {
  structure: cycleExplainStructureSchema,
  tree: cycleExplainTreeSchema,
  explain: cycleExplainBarSchema,
};

// ─── Internals ───────────────────────────────────────────────────────────────

type InternalReply = { ok: true; result: unknown } | { ok: false; error: string; details?: string };

interface PendingRequest {
  id: string;
  message: CycleExplainerRequest;
  /** `explain` only: run + fold + role, for superseding. */
  supersedeKey: string | null;
  resolve: (reply: InternalReply | "superseded") => void;
  reject: (error: CycleExplainerError) => void;
  timer: NodeJS.Timeout | null;
  /** The process the request was written to (null while queued). */
  sentTo: RunningProcess | null;
}

interface RunningProcess {
  child: ChildProcessWithoutNullStreams;
  ready: boolean;
  /** Set before any exit the pool asked for, so its `close` is not counted as a crash. */
  exitExpected: boolean;
  exited: boolean;
  stderrTail: string;
  readyTimer: NodeJS.Timeout | null;
  exitPromise: Promise<void>;
}

function killTree(child: ChildProcessWithoutNullStreams, synchronous: boolean): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    // `child.kill()` on Windows is TerminateProcess on the direct child only;
    // `taskkill /T` walks the tree (the same path pythonRunner.ts uses).
    try {
      const args = ["/PID", String(child.pid), "/T", "/F"];
      if (synchronous) {
        spawnSync("taskkill", args, { windowsHide: true, stdio: "ignore" });
      } else {
        spawn("taskkill", args, { windowsHide: true, stdio: "ignore", detached: true }).unref();
      }
      return;
    } catch (err) {
      logger.warn(`taskkill failed for explainer ${child.pid}: ${(err as Error).message}; falling back to kill()`);
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // already gone
  }
}

// ─── The pool ────────────────────────────────────────────────────────────────

export class CycleExplainer {
  private readonly command: string[];
  private readonly cwd: string;
  private readonly env: Record<string, string>;
  private readonly readyTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly crashLimit: number;
  private readonly crashWindowMs: number;
  private readonly cache: LRUCache<string, { result: unknown }>;

  private process: RunningProcess | null = null;
  private queue: PendingRequest[] = [];
  private inFlight: PendingRequest | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private crashTimes: number[] = [];
  private lastStderrTail = "";
  private nextId = 1;
  private spawnCount = 0;

  constructor(options: CycleExplainerOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.command = options.command ?? defaultExplainerCommand(this.cwd);
    this.env = { ...(options.env ?? {}) };
    this.readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.crashLimit = options.crashLimit ?? CRASH_LIMIT;
    this.crashWindowMs = options.crashWindowMs ?? CRASH_WINDOW_MS;
    this.cache = new LRUCache({ max: options.cacheSize ?? CACHE_SIZE });
  }

  /** Ask the explainer one model question. Rejects with `CycleExplainerError` when it cannot be answered at all. */
  async request(operation: CycleExplainerOperation): Promise<CycleExplainerOutcome> {
    const cacheKey = await this.cacheKeyFor(operation);
    if (cacheKey !== null) {
      const hit = this.cache.get(cacheKey);
      if (hit) return { status: "ok", result: hit.result, cached: true };
    }

    const supersedeKey =
      operation.op === "explain" ? JSON.stringify([operation.runDirectory, operation.fold, operation.role]) : null;
    const reply = await this.enqueue({ ...operation } as Omit<CycleExplainerRequest, "id">, supersedeKey);
    if (reply === "superseded") return { status: "superseded" };
    if (!reply.ok) return { status: "error", error: reply.error, details: reply.details };

    const parsed = RESULT_SCHEMAS[operation.op].safeParse(reply.result);
    if (!parsed.success) {
      logger.warn(`Explainer ${operation.op} reply failed its schema: ${parsed.error.message}`);
      return { status: "invalid", error: parsed.error.message };
    }
    if (cacheKey !== null) this.cache.set(cacheKey, { result: parsed.data });
    return { status: "ok", result: parsed.data, cached: false };
  }

  /** Round trip to the process (spawning it if needed); resolves with its ping result. */
  async ping(): Promise<unknown> {
    const reply = await this.enqueue({ op: "ping" } as Omit<CycleExplainerRequest, "id">, null);
    if (reply === "superseded" || !reply.ok) {
      throw new CycleExplainerError("The explainer did not answer ping", "crashed", this.stderrTail());
    }
    return reply.result;
  }

  /**
   * Drop every cached reply and every model the process holds for a run. A
   * pool with no process running holds nothing, so only the cache is cleared.
   */
  async releaseRun(runDirectory: string): Promise<void> {
    const prefix = JSON.stringify([runDirectory]).slice(0, -1) + ",";
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
    if (!this.process || this.process.exited) return;
    await this.enqueue({ op: "releaseRun", runDirectory } as Omit<CycleExplainerRequest, "id">, null);
  }

  /** Reject everything pending and end the process (gracefully, then its whole tree). */
  async stop(): Promise<void> {
    this.clearIdleTimer();
    const pending = [...(this.inFlight ? [this.inFlight] : []), ...this.queue];
    this.inFlight = null;
    this.queue = [];
    for (const entry of pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new CycleExplainerError("The explainer was stopped", "stopped", this.stderrTail()));
    }
    const running = this.process;
    if (!running || running.exited) return;
    running.exitExpected = true;
    this.sendExit(running);
    killTree(running.child, true);
    await Promise.race([running.exitPromise, new Promise<void>((resolve) => setTimeout(resolve, EXIT_GRACE_MS).unref())]);
  }

  status(): CycleExplainerStatus {
    const running = this.process && !this.process.exited ? this.process : null;
    return {
      running: running !== null,
      ready: running?.ready ?? false,
      pid: running?.child.pid ?? null,
      queued: this.queue.length,
      inFlight: this.inFlight !== null,
      spawnCount: this.spawnCount,
      recentCrashes: this.recentCrashCount(),
      cachedReplies: this.cache.size,
    };
  }

  // ── cache ──

  private async cacheKeyFor(operation: CycleExplainerOperation): Promise<string | null> {
    const modelMtime = await mtimeOf(modelFileFor(operation.runDirectory, operation.fold, operation.role));
    // A fold with no saved model cannot be cached (it is still training or never finished).
    if (modelMtime === null) return null;
    const extra = operation.op === "tree" ? operation.tree : operation.op === "explain" ? operation.timestamp : null;
    // `streamed` in a bar reply comes from predictions.parquet, which grows while the run is live.
    const predictionsMtime =
      operation.op === "explain" ? await mtimeOf(path.join(operation.runDirectory, "predictions.parquet")) : null;
    return JSON.stringify([operation.runDirectory, operation.op, operation.fold, operation.role, extra, modelMtime, predictionsMtime]);
  }

  // ── queue ──

  private enqueue(message: Omit<CycleExplainerRequest, "id">, supersedeKey: string | null): Promise<InternalReply | "superseded"> {
    if (this.crashLoopTripped() && (!this.process || this.process.exited)) {
      return Promise.reject(this.unavailableError());
    }
    this.clearIdleTimer();
    if (supersedeKey !== null) {
      const superseded = this.queue.filter((entry) => entry.supersedeKey === supersedeKey);
      if (superseded.length > 0) {
        this.queue = this.queue.filter((entry) => entry.supersedeKey !== supersedeKey);
        for (const entry of superseded) entry.resolve("superseded");
      }
    }
    return new Promise((resolve, reject) => {
      const id = `r${this.nextId++}`;
      this.queue.push({ id, message: { ...message, id } as CycleExplainerRequest, supersedeKey, resolve, reject, timer: null, sentTo: null });
      this.pump();
    });
  }

  private pump(): void {
    if (this.inFlight || this.queue.length === 0) return;
    if (!this.process || this.process.exited) {
      this.startProcess();
      return;
    }
    if (!this.process.ready) return;

    const entry = this.queue.shift()!;
    this.inFlight = entry;
    entry.sentTo = this.process;
    entry.timer = setTimeout(() => this.onRequestTimeout(entry), this.requestTimeoutMs);
    try {
      this.process.child.stdin.write(`${JSON.stringify(entry.message)}\n`);
    } catch (err) {
      logger.warn(`Writing to the explainer failed: ${(err as Error).message}`);
      // The close handler rejects it as a crash.
    }
  }

  private onRequestTimeout(entry: PendingRequest): void {
    if (this.inFlight !== entry) return;
    this.inFlight = null;
    const seconds = Math.round(this.requestTimeoutMs / 100) / 10;
    entry.reject(
      new CycleExplainerError(`The explainer did not answer ${entry.message.op} within ${seconds} s`, "timeout", this.stderrTail()),
    );
    // A running computation cannot be cancelled; end the process so the queue moves.
    const running = this.process;
    if (running && !running.exited) {
      running.exitExpected = true;
      killTree(running.child, false);
    }
    this.process = null;
    this.pump();
  }

  private scheduleIdleExit(): void {
    this.clearIdleTimer();
    if (this.inFlight || this.queue.length > 0 || !this.process || this.process.exited) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const running = this.process;
      if (!running || running.exited || this.inFlight || this.queue.length > 0) return;
      logger.log(`Explainer idle for ${Math.round(this.idleTimeoutMs / 1000)} s; asking it to exit`);
      running.exitExpected = true;
      // Detach it now: a request arriving while it winds down spawns a fresh process
      // instead of being written to a closing stdin.
      if (this.process === running) this.process = null;
      this.sendExit(running);
      setTimeout(() => killTree(running.child, false), EXIT_GRACE_MS).unref();
    }, this.idleTimeoutMs);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  // ── process ──

  private startProcess(): void {
    if (this.crashLoopTripped()) {
      this.rejectAll(this.unavailableError());
      return;
    }
    const [executable, ...args] = this.command;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(executable!, args, {
        cwd: this.cwd,
        env: { ...process.env, ...this.env, ...CYCLE_EXPLAINER_ENVIRONMENT },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      this.recordCrash();
      this.rejectAll(new CycleExplainerError(`Could not start the explainer: ${(err as Error).message}`, "spawn_failed", ""));
      return;
    }
    this.spawnCount += 1;
    logger.log(`Starting explainer: ${this.command.join(" ")} (pid ${child.pid ?? "?"})`);

    let markExited: () => void = () => {};
    const running: RunningProcess = {
      child,
      ready: false,
      exitExpected: false,
      exited: false,
      stderrTail: "",
      readyTimer: null,
      exitPromise: new Promise<void>((resolve) => {
        markExited = resolve;
      }),
    };
    this.process = running;

    running.readyTimer = setTimeout(() => {
      if (running.ready || running.exited) return;
      const seconds = Math.round(this.readyTimeoutMs / 100) / 10;
      logger.warn(`Explainer printed no ready line within ${seconds} s; killing it`);
      running.exitExpected = true;
      this.recordCrash();
      this.lastStderrTail = running.stderrTail;
      killTree(child, false);
      if (this.process === running) this.process = null;
      this.rejectAll(
        new CycleExplainerError(`The explainer did not become ready within ${seconds} s`, "ready_timeout", running.stderrTail),
      );
    }, this.readyTimeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      running.stderrTail = (running.stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_CHARACTERS);
    });
    // Replies are written by the child; a closed stdin surfaces as a close event.
    child.stdin.on("error", () => {});

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.onLine(running, line));

    let spawnError: Error | null = null;
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (running.exited) return;
      running.exited = true;
      if (running.readyTimer) clearTimeout(running.readyTimer);
      markExited();
      if (spawnError) running.stderrTail = `${running.stderrTail}${spawnError.message}\n`.slice(-STDERR_TAIL_CHARACTERS);
      this.lastStderrTail = running.stderrTail || this.lastStderrTail;
      if (this.process === running) this.process = null;
      if (running.exitExpected) {
        // A request written to this process as it was told to exit gets no reply: send it again.
        const orphan = this.inFlight;
        if (orphan && orphan.sentTo === running) {
          if (orphan.timer) clearTimeout(orphan.timer);
          orphan.timer = null;
          orphan.sentTo = null;
          this.inFlight = null;
          this.queue.unshift(orphan);
        }
        this.pump();
        return;
      }
      this.recordCrash();
      const how = signal ? `signal ${signal}` : `exit code ${code}`;
      logger.warn(`Explainer exited unexpectedly (${how}); stderr tail: ${running.stderrTail.slice(-500)}`);
      this.rejectAll(
        new CycleExplainerError(
          spawnError ? `Could not start the explainer: ${spawnError.message}` : `The explainer process stopped (${how})`,
          spawnError ? "spawn_failed" : "crashed",
          running.stderrTail,
        ),
      );
    };
    child.on("error", (err) => {
      spawnError = err;
      // A command that never started (ENOENT) has no pid and may never emit "close".
      if (child.pid === undefined) finish(null, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  }

  private onLine(running: RunningProcess, line: string): void {
    const text = line.trim();
    if (!text) return;
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      logger.debug(`Explainer wrote a non-JSON line: ${text.slice(0, 200)}`);
      return;
    }
    if (!running.ready) {
      if (cycleExplainerReadySchema.safeParse(payload).success) {
        running.ready = true;
        if (running.readyTimer) clearTimeout(running.readyTimer);
        running.readyTimer = null;
        this.pump();
        this.scheduleIdleExit();
      }
      return;
    }
    const reply = cycleExplainerReplySchema.safeParse(payload);
    if (!reply.success) {
      logger.warn(`Explainer wrote a line that is not a reply: ${text.slice(0, 200)}`);
      return;
    }
    const entry = this.inFlight;
    if (!entry || entry.id !== reply.data.id) return; // a late answer to a request already given up on
    if (entry.timer) clearTimeout(entry.timer);
    this.inFlight = null;
    entry.resolve(
      reply.data.ok
        ? { ok: true, result: reply.data.result }
        : { ok: false, error: reply.data.error, details: reply.data.details },
    );
    this.pump();
    this.scheduleIdleExit();
  }

  private sendExit(running: RunningProcess): void {
    try {
      running.child.stdin.write(`${JSON.stringify({ id: `r${this.nextId++}`, op: "exit" })}\n`);
      running.child.stdin.end();
    } catch {
      // stdin already closed
    }
  }

  private rejectAll(error: CycleExplainerError): void {
    const pending = [...(this.inFlight ? [this.inFlight] : []), ...this.queue];
    this.inFlight = null;
    this.queue = [];
    for (const entry of pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  // ── crash window ──

  private recordCrash(): void {
    this.crashTimes.push(Date.now());
    this.recentCrashCount();
  }

  private recentCrashCount(): number {
    const since = Date.now() - this.crashWindowMs;
    this.crashTimes = this.crashTimes.filter((time) => time >= since);
    return this.crashTimes.length;
  }

  private crashLoopTripped(): boolean {
    return this.recentCrashCount() >= this.crashLimit;
  }

  private unavailableError(): CycleExplainerError {
    const seconds = Math.round(this.crashWindowMs / 1000);
    return new CycleExplainerError(
      `The explainer crashed ${this.crashTimes.length} times in the last ${seconds} s and is not being restarted for now`,
      "unavailable",
      this.stderrTail(),
    );
  }

  private stderrTail(): string {
    return this.process?.stderrTail || this.lastStderrTail;
  }
}

async function mtimeOf(file: string): Promise<number | null> {
  try {
    const info = await stat(file);
    return info.isFile() ? info.mtimeMs : null;
  } catch {
    return null;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let shared: CycleExplainer | null = null;

/** The server's one explainer pool, created on first use (the process itself is spawned by the first request). */
export function getCycleExplainer(): CycleExplainer {
  if (!shared) shared = new CycleExplainer();
  return shared;
}

/** Shutdown hook: stop the process and forget the pool. */
export async function stopCycleExplainer(): Promise<void> {
  const pool = shared;
  shared = null;
  if (pool) await pool.stop();
}
