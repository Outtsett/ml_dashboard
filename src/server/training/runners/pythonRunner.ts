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
import type { ResolvedTrainingConfig, TrainingSession, TrainingDiagnostics } from "@shared/trainingTypes";
import { createSession, emitSessionEvent } from "./types";
import type { ITrainerRunner } from "./types";
import { getTrainingConfig } from "../registry";
import { getParser } from "./parsers/index";
import * as trainingStorage from "../../storage/trainingStorage";

const logger = new Logger("PythonRunner");

// ─── Python Runner ───────────────────────────────────────────────────────────

export class PythonRunner implements ITrainerRunner {
  private sessions = new Map<string, TrainingSession & { child: ChildProcess; stdout: string; stderr: string }>();

  async start(config: ResolvedTrainingConfig, existingSession?: TrainingSession): Promise<TrainingSession> {
    const trainingCfg = getTrainingConfig();
    const pythonExe = path.isAbsolute(trainingCfg.paths.pythonExe)
      ? trainingCfg.paths.pythonExe
      : path.join(process.cwd(), trainingCfg.paths.pythonExe);
    const script = path.join(process.cwd(), config.registry.script!);
    const modelsDir = path.join(process.cwd(), config.registry.outputDir);

    const session = (existingSession ?? createSession(config.modelId, config)) as TrainingSession & { child: ChildProcess; stdout: string; stderr: string };
    session.stdout = "";
    session.stderr = "";

    // Build CLI args from resolved hyperparameters
    const args = [script, "--symbol", config.symbol, "--timeframe", config.timeframe, "--model-id", config.modelId, "--json"];

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

    for (const [key, val] of Object.entries(config.hyperparameters)) {
      const flag = hypMap[key];
      if (flag) {
        args.push(flag, String(val));
      }
    }

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

    logger.log(`Spawning: ${pythonExe} ${args.join(" ")}`);

    const child = spawn(pythonExe, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    session.child = child;

    // Persist PID to SQLite for recovery/cleanup (DIP — storage abstraction)
    const dbSessId = (session as any).dbSessionId;
    if (dbSessId != null && child.pid) {
      trainingStorage.updateSessionPid(dbSessId, child.pid);
    }

    // Training timeout: SIGTERM then SIGKILL after grace period
    const maxDurationSec = trainingCfg.limits.maxTrainingDurationSec ?? 7200;
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
      session.stdout += text;
      const lines = text.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        parser.parseLine(session, line.trim(), parserCtx);
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
      session.finished = true;
      session.exitCode = code;

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
        emitSessionEvent(session, "done", {
          modelId: config.modelId,
          elapsedSec: parseFloat(((Date.now() - session.startedAt) / 1000).toFixed(1)),
          diagnostics,
        });

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
      session.child.kill("SIGTERM");

      // SIGKILL fallback if process doesn't exit within 30s
      const killTimeout = setTimeout(() => {
        try {
          if (session.child?.exitCode === null) {
            session.child.kill("SIGKILL");
            logger.warn(`Force-killed session ${sessionId} after SIGTERM timeout`);
          }
        } catch (e) {
          // Process may already be dead
        }
      }, 30_000);
      killTimeout.unref();

      emitSessionEvent(session, "error", { message: "Training stopped by user" });
      session.finished = true;
      session.exitCode = -1;

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

  getSession(sessionId: string): TrainingSession | undefined {
    return this.sessions.get(sessionId);
  }
}
