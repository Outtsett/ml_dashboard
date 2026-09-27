/**
 * Python Runner — Spawns Python training scripts as child processes.
 *
 * Uses the parser registry (OCP) to dispatch stdout parsing per model type.
 * New models add a parser file in ./parsers/ — no modification here needed.
 */

import { Logger } from "@nestjs/common";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import type { HyperparameterDef, ResolvedTrainingConfig, TrainingSession, TrainingDiagnostics } from "@shared/trainingTypes";
import type { CycleControl } from "@shared/cycle/schema";
import { CYCLE_RUNNER_SUFFIX } from "@shared/cycle/models";
import { createSession, emitSessionEvent } from "./types";
import type { ITrainerRunner } from "./types";
import { getTrainingConfig } from "../registry";
import { getParser } from "./parsers/index";
import * as trainingStorage from "../../infrastructure/storage/trainingStorage";
import * as provenance from "../provenance";

const logger = new Logger("PythonRunner");

/**
 * Cap on retained `session.stdout` (used only for the `__JSON_OUTPUT__`
 * diagnostics marker lookup on a clean exit, and as a fallback log tail on a
 * non-zero exit). Model Cycle's `cycle_bars` lines run up to ~200 KB each at
 * up to 20 Hz, so an unbounded buffer is unbounded memory over a 12-hour
 * paced replay. 2 MB keeps many minutes of recent output — comfortably more
 * than the marker or a diagnostic tail ever needs — without growing forever.
 */
export const STDOUT_RETENTION_BYTES = 2 * 1024 * 1024;

/** Append `text` to `buffer`, then trim to the retained tail. Exported for tests. */
export function appendCapped(buffer: string, text: string): string {
  const next = buffer + text;
  return next.length > STDOUT_RETENTION_BYTES ? next.slice(-STDOUT_RETENTION_BYTES) : next;
}

/**
 * Line-buffer a stdout chunk against a carried-over partial line from the
 * previous chunk. Node's `'data'` event does not respect line boundaries — a
 * `cycle_bars` line carries up to ~2000 bars (~200 KB), easily spanning two
 * or more chunks, and splitting on `text.split("\n")` alone (the pre-Model-
 * Cycle behaviour) turned one long line into several garbage lines, each
 * failing to parse as JSON.
 *
 * Pure and exported so the chunking behaviour is testable without spawning a
 * real child process. `carry` is the previous call's trailing partial line
 * (`""` on the first call); the returned `carry` feeds the next call, and is
 * parsed as a final line on stream `'close'` in case the process exits
 * mid-line.
 */
export function splitBufferedLines(carry: string, chunk: string): { lines: string[]; carry: string } {
  const combined = carry + chunk;
  const parts = combined.split("\n");
  const nextCarry = parts.pop() ?? "";
  const lines = parts.map((l) => l.trim()).filter((l) => l.length > 0);
  return { lines, carry: nextCarry };
}

/**
 * The CLI arguments for a run's hyperparameters, in their given order.
 *
 * A bool is a presence flag: true passes `--flag`, false passes nothing — so a
 * bool whose default is true could never be switched off. For a Model Cycle
 * runner (`<key>+walk_forward_cycle`), whose `main.py` declares every model
 * bool with `argparse.BooleanOptionalAction`, a default-true bool set to false
 * passes `--no-flag`. Other runners keep the presence rule: their scripts do
 * not accept `--no-…` (the TFT's `--loss-surface` is a `store_false` flag), and
 * argparse would reject the run. Unmapped keys are skipped (the caller warns).
 */
export function hyperparameterArgs(
  hyperparameters: Record<string, unknown>,
  defaults: Record<string, HyperparameterDef>,
  flags: Record<string, string>,
  modelType: string,
): string[] {
  const optionalBooleans = modelType.endsWith(CYCLE_RUNNER_SUFFIX);
  const args: string[] = [];
  for (const [key, val] of Object.entries(hyperparameters)) {
    const flag = flags[key];
    if (!flag) continue;

    const def = defaults[key];
    if (def?.type === 'bool') {
      if (val) args.push(flag);
      else if (optionalBooleans && def.default === true) args.push(`--no-${flag.replace(/^--/, "")}`);
    } else {
      args.push(flag, String(val));
    }
  }
  return args;
}

// ─── Python Runner ───────────────────────────────────────────────────────────

export class PythonRunner implements ITrainerRunner {
  private sessions = new Map<
    string,
    TrainingSession & { child: ChildProcess; stdout: string; stderr: string; stdoutCarry: string }
  >();

  async start(config: ResolvedTrainingConfig, existingSession?: TrainingSession): Promise<TrainingSession> {
    const trainingCfg = getTrainingConfig();
    const pythonExe = path.isAbsolute(trainingCfg.paths.pythonExe)
      ? trainingCfg.paths.pythonExe
      : path.join(process.cwd(), trainingCfg.paths.pythonExe);
    const scriptPath = config.registry.script!;
    const script = path.isAbsolute(scriptPath)
      ? scriptPath
      : path.join(process.cwd(), scriptPath);
    const modelsDir = path.isAbsolute(config.registry.outputDir)
      ? config.registry.outputDir
      : path.join(process.cwd(), config.registry.outputDir);

    const session = (existingSession ?? createSession(config.modelId, config)) as TrainingSession & {
      child: ChildProcess;
      stdout: string;
      stderr: string;
      stdoutCarry: string;
    };
    session.stdout = "";
    session.stderr = "";
    session.stdoutCarry = "";

    // Build CLI args from resolved hyperparameters. `scriptArgs` (e.g. Model
    // Cycle's `["--model-family", "xgboost"]`) is pushed right after the
    // script path, before the standard flags.
    const args = [script, ...(config.registry.scriptArgs ?? []), "--symbol", config.symbol, "--timeframe", config.timeframe, "--model-id", config.modelId, "--json"];

    // Pass max bars limit (0 = all data → omit flag so Python uses everything)
    const maxBars = config.maxBars ?? trainingCfg.limits.maxBarsDefault ?? 100000;
    if (maxBars > 0) {
      args.push("--max-bars", String(maxBars));
    }

    // Pass date range if specified
    if (config.dateRange?.start) {
      args.push("--date-start", config.dateRange.start);
    }
    if (config.dateRange?.end) {
      args.push("--date-end", config.dateRange.end);
    }

    // Map hyperparameters to CLI flags (OCP: prefer registry cliFlags, fall back to built-in defaults)
    const defaultFlags: Record<string, string> = {
      gibbsIter: "--gibbs-iter",
      burnIn: "--burn-in",
      testSplit: "--test-split",
      wfWindows: "--wf-windows",
      alpha: "--alpha",
      gamma: "--gamma",
      kappa: "--kappa",
      trainWindowWeeks: "--train-window-weeks",
      stepWeeks: "--step-weeks",
      wfGibbsIter: "--wf-gibbs-iter",
      overlayInterval: "--overlay-interval",
    };
    const hypMap = { ...defaultFlags, ...config.registry.cliFlags };

    // Warn about unmapped hyperparameters — catches models.json drift from main.py
    const unmapped = Object.keys(config.hyperparameters).filter(k => !hypMap[k]);
    if (unmapped.length > 0) {
      const msg = `Unmapped hyperparameters for ${config.modelType}: [${unmapped.join(", ")}]. Add cliFlags entries in models.json.`;
      logger.warn(msg);
      emitSessionEvent(session, "log", { message: msg, level: "warning" });
    }

    args.push(...hyperparameterArgs(config.hyperparameters, config.registry.defaultHyperparameters, hypMap, config.modelType));

    if (config.featureCategories?.length) {
      args.push("--feature-categories", config.featureCategories.join(","));
    }

    if (config.includeIndicators) {
      args.push("--include-indicators");
      if (config.indicatorGroups) {
        args.push("--indicator-groups", config.indicatorGroups);
      }
    }

    if (config.allFeatures) {
      args.push("--all-features");
    }

    // A persisted label set: the run trains on the rows a person previewed and
    // saved, not on a recomputation of them. Resolved here, not on the client,
    // so the client never has to know where in the lake a set lives.
    if (config.labelSetId) {
      const { getLabelSetById } = await import("../../infrastructure/lib/labels/labelRepository");
      const labelSet = await getLabelSetById(config.labelSetId);
      if (!labelSet) throw new Error(`Label set ${config.labelSetId} does not exist`);
      if (!labelSet.parquetPath) {
        throw new Error(
          `Label set ${config.labelSetId} ('${labelSet.name}') has no persisted rows — ` +
          "it was generated before rows were written to the lake. Generate it again.",
        );
      }
      if (labelSet.symbol !== config.symbol) {
        throw new Error(
          `Label set ${config.labelSetId} is for ${labelSet.symbol}, this run is ${config.symbol}`,
        );
      }
      args.push("--label-set-parquet", labelSet.parquetPath);
      // The set's longest horizon is the smallest purge a split may use; the
      // template takes the larger of this and the configured purge.
      if (labelSet.purgeBars !== null && labelSet.purgeBars !== undefined) {
        args.push("--label-purge-bars", String(labelSet.purgeBars));
      }
    }

    // Provenance identity, minted by the orchestrator BEFORE this spawn.
    // `protocol.py` reads these variables at import and stamps every stdout
    // event with them, which is what makes a raw log line self-identifying.
    // Absent (headless / legacy caller) → the child simply emits nulls and the
    // parser synthesizes the fields from the spawn record.
    const runCtx = provenance.getRunContext(config.modelId);
    const provenanceEnv = runCtx ? provenance.runContextEnv(runCtx) : {};

    logger.log(`Spawning: ${pythonExe} ${args.join(" ")}`);

    const child = spawn(pythonExe, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: "1", ...provenanceEnv },
    });
    session.child = child;

    // A write to stdin after the child (or just its read end) has exited
    // raises EPIPE asynchronously as a stream 'error', not synchronously from
    // .write() — without this listener that is an uncaught exception.
    child.stdin.on("error", (err) => {
      logger.warn(`stdin error for session ${session.sessionId}: ${(err as Error).message}`);
    });

    // Persist PID to SQLite for recovery/cleanup (DIP — storage abstraction)
    const dbSessId = (session as { dbSessionId?: number | null }).dbSessionId;
    if (dbSessId != null && child.pid) {
      trainingStorage.updateSessionPid(dbSessId, child.pid);
    }
    if (runCtx) {
      provenance.detach(
        provenance.markRunSpawned(runCtx.runId, child.pid ?? null),
        `markRunSpawned(${runCtx.runId})`,
      );
    }

    // Training timeout: SIGTERM then SIGKILL after grace period. A runner
    // entry's `maxDurationSeconds` (e.g. Model Cycle's 43200s — a paced
    // bar-by-bar replay can legitimately run long) replaces the config default.
    const maxDurationSec = config.registry.maxDurationSeconds ?? trainingCfg.limits.maxTrainingDurationSec ?? 7200;
    const timeoutHandle = setTimeout(() => {
      if (!session.finished) {
        logger.warn(`Session ${session.sessionId} exceeded ${maxDurationSec}s timeout, sending SIGTERM`);
        child.kill("SIGTERM");
        // If still alive after 30s, force kill
        setTimeout(() => {
          if (!session.finished) {
            logger.warn(`Session ${session.sessionId} did not exit after SIGTERM, sending SIGKILL`);
            child.kill("SIGKILL");
          }
        }, 30_000);
      }
    }, maxDurationSec * 1000);

    const parser = getParser(config.modelType);
    const parserCtx = { modelsDir, modelId: config.modelId };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      session.stdout = appendCapped(session.stdout, text);

      const { lines, carry } = splitBufferedLines(session.stdoutCarry, text);
      session.stdoutCarry = carry;
      for (const line of lines) {
        parser.parseLine(session, line, parserCtx);
      }
      // Liveness signal for the boot sweeper. Throttled inside `provenance` —
      // one SQLite UPDATE per stdout chunk would sit on the hot metric path.
      if (runCtx && lines.length > 0) {
        provenance.detach(
          provenance.touchRunHeartbeat(runCtx.runId),
          `touchRunHeartbeat(${runCtx.runId})`,
        );
      }
    });

    // OCP: Suppress patterns come from config/training.json — add new entries without modifying this file
    const suppressPatterns = trainingCfg.stderrSuppressPatterns ?? [];

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      session.stderr += text;
      const trimmed = text.trim();
      if (trimmed && !suppressPatterns.some((p: string) => trimmed.includes(p))) {
        emitSessionEvent(session, "log", { message: trimmed.slice(0, 500), level: "warning" });
      }
    });

    child.on("close", (code) => {
      clearTimeout(timeoutHandle);

      // Flush a trailing partial line — the process can exit mid-line (no
      // final "\n") and that line still carries a real event.
      const remainder = session.stdoutCarry.trim();
      session.stdoutCarry = "";
      if (remainder) {
        parser.parseLine(session, remainder, parserCtx);
      }

      session.finished = true;
      session.exitCode = code;

      // Terminal provenance state is owned here, by the parent process.
      //   exit 0                       → completed (a `done` event always
      //                                  exists: the parser's, or the
      //                                  synthetic one emitted below)
      //   exit != 0 + `error` envelope → failed  (Python reported it)
      //   exit != 0, nothing reported  → crashed (died without a word — the
      //                                  case this design exists for)
      if (runCtx) {
        const sawError = (session as TrainingSession & { parserHandledError?: boolean }).parserHandledError === true;
        const status = code === 0 ? "completed" : sawError ? "failed" : "crashed";
        provenance.detach(
          provenance.finishRun(runCtx.runId, {
            status,
            exitCode: code,
            errorMessage: code === 0 ? null : `Training process exited with code ${code}`,
          }),
          `finishRun(${runCtx.runId})`,
        );
        provenance.clearRunContext(runCtx.legacyModelId);
      }

      if (code !== 0) {
        const details = (session.stderr || session.stdout).slice(-2000);
        logger.error(`Python process exited with code ${code} for ${session.sessionId}`);
        if (details) logger.error(`Last output: ${details.slice(0, 500)}`);
        emitSessionEvent(session, "error", {
          message: `Training failed (exit code ${code})`,
          details,
        });

        // Finalize failed session in SQLite
        const dbSessId = session.dbSessionId;
        if (dbSessId != null) {
          trainingStorage.finalizeSession(dbSessId, {
            status: "failed",
            elapsedSec: parseFloat(((Date.now() - session.startedAt) / 1000).toFixed(1)),
            errorMessage: `Training failed (exit code ${code})`,
          });
        }
      } else {
        logger.log(`Python process completed successfully for ${session.sessionId}`);
        let diagnostics: TrainingDiagnostics | null = null;
        const jsonMarker = "__JSON_OUTPUT__";
        const jsonIdx = session.stdout.indexOf(jsonMarker);
        if (jsonIdx >= 0) {
          try { diagnostics = JSON.parse(session.stdout.slice(jsonIdx + jsonMarker.length).trim()); } catch { /* */ }
        }
        if (!diagnostics) {
          const diagPath = path.join(modelsDir, config.modelId, "diagnostics.json");
          if (fs.existsSync(diagPath)) {
            try { diagnostics = JSON.parse(fs.readFileSync(diagPath, "utf-8")); } catch { /* */ }
          }
        }
        // Only emit done if the parser didn't already handle it (prevents double-done)
        if (!session.parserHandledDone) {
          emitSessionEvent(session, "done", {
            modelId: config.modelId,
            elapsedSec: parseFloat(((Date.now() - session.startedAt) / 1000).toFixed(1)),
            diagnostics,
          });
        }

        // Finalize completed session in SQLite (DIP — storage abstraction)
        const dbSessId = session.dbSessionId;
        if (dbSessId != null) {
          trainingStorage.finalizeSession(dbSessId, {
            status: "completed",
            diagnostics: diagnostics ?? undefined,
            qualityScore: diagnostics?.quality_score ?? undefined,
            evaluationGrade: diagnostics?.evaluation?.grade ?? undefined,
            modelPath: `${config.outputDir}/${config.modelId}`,
            elapsedSec: parseFloat(((Date.now() - session.startedAt) / 1000).toFixed(1)),
          });
        }
      }

      // Keep session around for reconnecting clients
      const retentionMs = (getTrainingConfig().limits.jobRetentionSec ?? 120) * 1000;
      setTimeout(() => this.sessions.delete(session.sessionId), retentionMs);
    });

    this.sessions.set(session.sessionId, session);
    return session;
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.child && !session.finished) {
      // `child.kill()` on Windows is TerminateProcess on the direct child
      // ONLY — a Python process that has spawned its own workers (or a
      // dashboard-launched grandchild) survives orphaned. `taskkill /T`
      // walks the whole process tree; `/F` force-kills without waiting on a
      // graceful shutdown, so there is no SIGKILL-fallback timer to manage.
      if (process.platform === "win32" && session.child.pid) {
        try {
          const killer = spawn("taskkill", ["/PID", String(session.child.pid), "/T", "/F"], {
            detached: true,
            stdio: "ignore",
          });
          killer.unref();
        } catch (err) {
          logger.warn(`taskkill failed for session ${sessionId}: ${(err as Error).message}; falling back to SIGTERM`);
          session.child.kill("SIGTERM");
        }
      } else {
        session.child.kill("SIGTERM");

        // SIGKILL fallback if process doesn't exit within 30s
        const killTimeout = setTimeout(() => {
          try {
            if (session.child?.exitCode === null) {
              session.child.kill("SIGKILL");
              logger.warn(`Force-killed session ${sessionId} after SIGTERM timeout`);
            }
          } catch {
            // Process may already be dead
          }
        }, 30_000);
        killTimeout.unref();
      }

      emitSessionEvent(session, "error", { message: "Training stopped by user" });
      session.finished = true;
      session.exitCode = -1;

      // Claim the terminal state now so the child's later `close` (which will
      // report a non-zero code and no `error` envelope) cannot relabel a
      // deliberate stop as a crash.
      const stoppedCtx = provenance.getRunContext(session.modelId);
      if (stoppedCtx) {
        provenance.detach(
          provenance.finishRun(stoppedCtx.runId, {
            status: "stopped",
            exitCode: null,
            errorMessage: "Training stopped by user",
          }),
          `finishRun(${stoppedCtx.runId})`,
        );
      }

      const dbSessId = session.dbSessionId;
      if (dbSessId != null) {
        trainingStorage.finalizeSession(dbSessId, {
          status: "stopped",
          elapsedSec: parseFloat(((Date.now() - session.startedAt) / 1000).toFixed(1)),
          errorMessage: "Training stopped by user",
        });
      }

      setTimeout(() => this.sessions.delete(sessionId), 10000);
    }
  }

  isActive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && !session.finished;
  }

  /**
   * Write one Model Cycle control command to the running process's stdin, one
   * JSON object per line (`{"command":"pause"}` etc. — `cycleControlSchema`).
   * Returns `false` — never throws — when there is no live child or its
   * stdin is not writable; an EPIPE on the write itself is caught here, and a
   * write that races a just-exited process (EPIPE raised asynchronously as a
   * stream 'error') is swallowed by the `stdin.on("error", ...)` listener
   * attached at spawn time.
   */
  sendControl(sessionId: string, command: CycleControl): boolean {
    const session = this.sessions.get(sessionId);
    const stdin = session?.child?.stdin;
    if (!session || session.finished || !stdin || stdin.destroyed || !stdin.writable) {
      return false;
    }
    try {
      stdin.write(`${JSON.stringify(command)}\n`);
      return true;
    } catch (err) {
      logger.warn(`sendControl(${sessionId}, ${command.command}) failed: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Terminate every live training child. Called on server shutdown: a detached
   * Python process outlives the Node parent on Windows, so without this a restart
   * left the previous run's process writing to the same checkpoint directory as
   * the new one, and nothing in the dashboard knew it existed.
   *
   * Reuses stop(), so each session gets the same kill path (taskkill tree-kill
   * on Windows, SIGTERM then a 30s SIGKILL fallback elsewhere) and the same
   * terminal-state bookkeeping as a stop from the UI.
   */
  stopAll(): number {
    const live = [...this.sessions.values()].filter((s) => !s.finished);
    for (const session of live) {
      try {
        this.stop(session.sessionId);
      } catch (err) {
        logger.warn(`Failed to stop session ${session.sessionId}: ${(err as Error).message}`);
      }
    }
    return live.length;
  }

  getSession(sessionId: string): TrainingSession | undefined {
    return this.sessions.get(sessionId);
  }
}
