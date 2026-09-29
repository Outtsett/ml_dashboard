/**
 * Notebook health — does every cell of a notebook still run?
 *
 * The check is the gate the whole machine already uses for a notebook:
 * `python -m marimo export html <notebook>` in the notebook's own environment
 * and working directory, which executes every cell. Measured 2026-09-28 with
 * marimo 0.24: a failing cell still writes the HTML but the command exits 1 and
 * prints "Export was successful, but some cells failed to execute", with each
 * exception on its own line before it; a clean notebook exits 0. So the exit
 * code is the verdict and the exception lines are the reason.
 *
 * Checks run only when asked (a notebook can read the lake for a minute), two at
 * a time, and each is killed after CHECK_TIMEOUT_MS. The exported page is kept
 * under data/.cache/notebook_health/ and never served: it exists so a check
 * leaves no file beside the notebook other than marimo's own __marimo__ cache.
 */

import { spawn, execFile, execFileSync, type ChildProcess } from "child_process";
import { mkdirSync, rmSync, statSync } from "fs";
import path from "path";
import { Logger } from "@nestjs/common";
import { findGroup, loadNotebooksConfig } from "./config";
import { findNotebookByPath, getCatalog, notebookId } from "./catalog";
import { currentHealthOf, recordHealth, type HealthRecord } from "./store";

const logger = new Logger("MarimoHealth");

const OUTPUT_DIRECTORY = path.join(process.cwd(), "data", ".cache", "notebook_health");
const CONCURRENT_CHECKS = 2;
const CHECK_TIMEOUT_MS = 15 * 60_000;
const OUTPUT_TAIL_LIMIT = 6_000;

interface QueuedCheck {
  notebookPath: string;
  sourceModifiedAtIso: string;
}

const queue: QueuedCheck[] = [];
const running = new Map<string, ChildProcess>();

function key(notebookPath: string): string {
  const resolved = path.resolve(notebookPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** The reason a failed check gives: every `SomethingError: message` line marimo
 *  printed, then the last lines of its output. Exported for the unit test. */
export function summarizeFailure(output: string, exitCode: number | null, timedOut: boolean): string {
  if (timedOut) return `Stopped after ${CHECK_TIMEOUT_MS / 60_000} minutes without finishing.`;
  // Python warnings (a line with "Warning:" and the indented source line after
  // it) are left out: the lake prints one per undefined derived view on every
  // connect, and they pushed the real error out of the tail.
  const lines: string[] = [];
  let skipIndented = false;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (/\b\w*Warning: /.test(line)) {
      skipIndented = true;
      continue;
    }
    if (skipIndented && /^\s/.test(line)) continue;
    skipIndented = false;
    lines.push(line);
  }
  const exceptions = lines.filter((line) => /^[A-Za-z_][\w.]*(Error|Exception)\b.*:/.test(line) && !line.startsWith("Error: Export was successful"));
  const unique = [...new Set(exceptions)].slice(0, 8);
  const tail = lines.slice(-12).join("\n");
  const head = unique.length > 0 ? unique.join("\n") : `marimo export exited with code ${exitCode ?? "null"}.`;
  return `${head}\n\n${tail}`.trim();
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } catch {
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
}

function runNext(): void {
  while (running.size < CONCURRENT_CHECKS && queue.length > 0) {
    const next = queue.shift()!;
    startCheck(next);
  }
}

function startCheck(check: QueuedCheck): void {
  const notebook = findNotebookByPath(check.notebookPath);
  const group = notebook ? findGroup(loadNotebooksConfig(), notebook.groupSlug) : undefined;
  if (!notebook || !group) {
    recordHealth(check.notebookPath, {
      status: "failed",
      checkedAtIso: new Date().toISOString(),
      sourceModifiedAtIso: check.sourceModifiedAtIso,
      durationSeconds: null,
      error: "The notebook is no longer in the catalog.",
    });
    return;
  }

  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  const outputPath = path.join(OUTPUT_DIRECTORY, `${notebookId(notebook.path)}.html`);
  // The previous run's page would otherwise be measured as this run's output.
  rmSync(outputPath, { force: true });
  // The file's modified time NOW, not the catalog's (up to 15 s old): the check
  // is about the version it runs, so an edit just before it must not read as stale.
  try {
    check.sourceModifiedAtIso = statSync(notebook.path).mtime.toISOString();
  } catch {
    // keep the catalog's time
  }
  const startedAt = Date.now();
  // Checks that were already running when this one started: its duration is
  // wall time, which two exports at once stretch (measured up to +67%).
  const ranAlongside = running.size;
  recordHealth(notebook.path, {
    status: "running",
    checkedAtIso: new Date(startedAt).toISOString(),
    sourceModifiedAtIso: check.sourceModifiedAtIso,
    durationSeconds: null,
  });

  const child = spawn(group.python, ["-m", "marimo", "export", "html", notebook.path, "-o", outputPath, "-f"], {
    cwd: group.cwd,
    // PYTHONHASHSEED pinned as every marimo launcher here pins it; UTF-8 so a
    // notebook that prints an arrow does not fail on Windows' cp1252 console.
    env: { ...process.env, PYTHONHASHSEED: "0", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  running.set(key(notebook.path), child);

  let output = "";
  const append = (chunk: Buffer) => {
    output = (output + chunk.toString("utf8")).slice(-OUTPUT_TAIL_LIMIT);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, CHECK_TIMEOUT_MS);

  let settled = false;
  const finish = (exitCode: number | null, spawnError?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    running.delete(key(notebook.path));
    const current = currentHealthOf(notebook.path);
    if (current?.status === "cancelled") {
      runNext();
      return;
    }
    const durationSeconds = Math.round((Date.now() - startedAt) / 100) / 10;
    let outputSizeBytes: number | undefined;
    try {
      outputSizeBytes = statSync(outputPath).size;
    } catch {
      outputSizeBytes = undefined;
    }
    const passed = !spawnError && !timedOut && exitCode === 0;
    const record: HealthRecord = {
      status: passed ? "passed" : "failed",
      checkedAtIso: new Date().toISOString(),
      sourceModifiedAtIso: check.sourceModifiedAtIso,
      durationSeconds,
      ranAlongside,
      outputSizeBytes,
      error: passed
        ? undefined
        : spawnError
          ? `Could not start ${group.python}: ${spawnError.message}`
          : summarizeFailure(output, exitCode, timedOut),
    };
    recordHealth(notebook.path, record);
    logger.log(`health check ${record.status}: ${notebook.relativePath} in ${durationSeconds}s`);
    runNext();
  };
  // "close", not "exit": close fires after stdout and stderr have drained, so the
  // last lines — where marimo prints the failing cells — are in the summary.
  child.on("close", (code) => finish(code));
  child.on("error", (err) => finish(null, err));
}

/** Queues a check of each path (every catalogued notebook when `paths` is empty).
 *  A notebook already queued or running is not queued twice. Returns how many were queued. */
export function queueHealthChecks(paths: string[]): number {
  const catalog = getCatalog();
  const targets = paths.length > 0
    ? paths.map((p) => findNotebookByPath(p)).filter((n): n is NonNullable<typeof n> => Boolean(n))
    : catalog.notebooks;
  let queued = 0;
  for (const notebook of targets) {
    const notebookKey = key(notebook.path);
    if (running.has(notebookKey) || queue.some((q) => key(q.notebookPath) === notebookKey)) continue;
    queue.push({ notebookPath: notebook.path, sourceModifiedAtIso: notebook.modifiedAtIso });
    recordHealth(notebook.path, {
      status: "queued",
      checkedAtIso: new Date().toISOString(),
      sourceModifiedAtIso: notebook.modifiedAtIso,
      durationSeconds: null,
    });
    queued++;
  }
  runNext();
  return queued;
}

/** Drops every queued check and stops the running ones. A cancelled notebook
 *  shows its last finished result again (store.ts healthOf), or "not checked"
 *  if it never had one. */
export function cancelHealthChecks(): number {
  const cancelled = queue.length + running.size;
  for (const check of queue.splice(0)) {
    recordHealth(check.notebookPath, {
      status: "cancelled",
      checkedAtIso: new Date().toISOString(),
      sourceModifiedAtIso: check.sourceModifiedAtIso,
      durationSeconds: null,
    });
  }
  for (const [runningKey, child] of running) {
    const notebook = getCatalog().notebooks.find((n) => key(n.path) === runningKey);
    if (notebook) {
      recordHealth(notebook.path, {
        status: "cancelled",
        checkedAtIso: new Date().toISOString(),
        sourceModifiedAtIso: notebook.modifiedAtIso,
        durationSeconds: null,
      });
    }
    killTree(child);
  }
  return cancelled;
}

export function healthQueueSize(): { queued: number; running: number } {
  return { queued: queue.length, running: running.size };
}

/** Called from the dashboard's shutdown so no export outlives it. The checks
 *  it stops are recorded as cancelled first, so the killed exports' exit is not
 *  saved as a failure no notebook produced. */
export function stopAllHealthChecks(): void {
  cancelHealthChecks();
  running.clear();
}

/** Stops exports a previous dashboard process left running (a crash or a hard
 *  kill skips the shutdown above). Only processes whose command line is a
 *  `marimo export` writing into this dashboard's own output folder are touched,
 *  which no other program on the machine can match. */
export function reapOrphanedChecks(): void {
  const marker = OUTPUT_DIRECTORY.replace(/'/g, "''");
  const query =
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*marimo*export*' " +
    `-and $_.CommandLine -like '*${marker}*' } | Select-Object -ExpandProperty ProcessId`;
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query], { windowsHide: true, timeout: 15_000 }, (err, stdout) => {
    if (err) return;
    const ownPids = new Set([...running.values()].map((child) => child.pid));
    for (const token of stdout.split(/\s+/)) {
      const pid = Number.parseInt(token, 10);
      if (!Number.isFinite(pid) || ownPids.has(pid)) continue;
      logger.warn(`stopping a health check left running by a previous dashboard process (PID ${pid})`);
      try {
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } catch {
        // already gone
      }
    }
  });
}
