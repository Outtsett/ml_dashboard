/**
 * Python Runner — Spawns Python training scripts as child processes.
 *
 * Generalized from regime.ts:534-596. The same spawn + stdout parsing pattern,
 * but configurable per model type. HDP-HMM's parseLine is the first parser;
 * new models can register their own or use a standardized output protocol.
 */

import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import type { ResolvedTrainingConfig, TrainingSession } from "@shared/trainingTypes";
import { createSession, emitSessionEvent } from "./types";
import type { ITrainerRunner } from "./types";
import { getTrainingConfig } from "../registry";

// ─── HDP-HMM stdout parser (extracted from regime.ts:63-186) ────────────────

function parseHdpHmmLine(session: TrainingSession, trimmed: string, modelsDir: string) {
  if (trimmed.startsWith("__JSON_OUTPUT__")) return;

  // Binary sidecar files for live regime snapshots
  if (trimmed.startsWith("__REGIME_META__")) {
    try {
      const meta = JSON.parse(trimmed.slice("__REGIME_META__".length));
      const tsFile = path.join(modelsDir, session.modelId, "live_timestamps.bin");
      if (fs.existsSync(tsFile)) {
        const buf = fs.readFileSync(tsFile);
        const int64View = new BigInt64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
        const timestamps = Array.from(int64View, (v) => Number(v));
        emitSessionEvent(session, "overlay", {
          overlayType: "regime_timestamps",
          timestamps,
          count: meta.count,
        });
      }
    } catch { /* skip malformed */ }
    return;
  }
  if (trimmed.startsWith("__REGIME_SNAP__")) {
    try {
      const snap = JSON.parse(trimmed.slice("__REGIME_SNAP__".length));
      const snapFile = path.join(modelsDir, session.modelId, "live_snapshot.bin");
      if (fs.existsSync(snapFile)) {
        const buf = fs.readFileSync(snapFile);
        const assignments = Array.from(new Uint8Array(buf));
        emitSessionEvent(session, "overlay", {
          overlayType: "regime_colors",
          assignments,
          iteration: snap.iter,
        });
      }
    } catch { /* skip malformed */ }
    return;
  }

  // Skip raw JSON objects/arrays but NOT step markers like [1/9]
  if (trimmed.startsWith("{")) return;
  if (trimmed.startsWith("[") && !/^\[\d+\/\d+\]/.test(trimmed)) return;
  if (/^=+$/.test(trimmed) || trimmed === "") return;

  // Step progress: [1/9] Loading data...
  const stepMatch = trimmed.match(/^\[(\d+)\/(\d+)\]\s+(.*)/);
  // Gibbs iteration: iter 50/100: Regimes=5 Fit=-3.45/bar LL=-12345 Δ=0.12 ...
  const gibbsMatch = trimmed.match(
    /iter\s+(\d+)\/(\d+):\s+Regimes=(\d+)\s+Fit=([-\d.]+)\/bar\s+LL=\s*([-\d,. ]+)\s+Δ=\s*([-\d,.]+)\s+Entropy=([\d.]+)\s+Switch=([\d.]+)\s+SelfTr=([\d.]+)\s+MaxReg=([\d.]+)%\s+Dwell=([\d.]+)/
  );
  const gibbsMatchOld = !gibbsMatch ? trimmed.match(/iter\s+(\d+)\/(\d+):\s+LL=\s*([-\d,. ]+)\s+active_states=(\d+)\s+delta=([\d.]+)/) : null;
  const discoveredMatch = trimmed.match(/Discovered\s+(\d+)\s+regimes/i) || trimmed.match(/Regimes Discovered:\s+(\d+)/);
  const stabMatch = trimmed.match(/Walk-Forward Stability:\s+([\d.]+)/);
  const simMatch = trimmed.match(/Distribution Similarity:\s+([\d.]+)/);
  const corrMatch = trimmed.match(/Profile Correlation:\s+([\d.]+)/);
  const qualMatch = trimmed.match(/Quality Score:\s+([\d.]+)/);
  const featureMatrixMatch = trimmed.match(/Feature matrix:\s+([\d,]+)\s+bars/);

  if (gibbsMatch) {
    emitSessionEvent(session, "metric", {
      iteration: parseInt(gibbsMatch[1]),
      totalIterations: parseInt(gibbsMatch[2]),
      metrics: {
        activeStates: parseInt(gibbsMatch[3]),
        fitPerBar: parseFloat(gibbsMatch[4]),
        logLikelihood: parseFloat(gibbsMatch[5].replace(/[, ]/g, "")),
        delta: parseFloat(gibbsMatch[6].replace(/[, ]/g, "")),
        entropy: parseFloat(gibbsMatch[7]),
        switchRate: parseFloat(gibbsMatch[8]),
        selfTransition: parseFloat(gibbsMatch[9]),
        maxRegimePct: parseFloat(gibbsMatch[10]),
        avgDwell: parseFloat(gibbsMatch[11]),
      },
      message: trimmed,
    });
  } else if (gibbsMatchOld) {
    emitSessionEvent(session, "metric", {
      iteration: parseInt(gibbsMatchOld[1]),
      totalIterations: parseInt(gibbsMatchOld[2]),
      metrics: {
        logLikelihood: parseFloat(gibbsMatchOld[3].replace(/[, ]/g, "")),
        activeStates: parseInt(gibbsMatchOld[4]),
        delta: parseFloat(gibbsMatchOld[5]),
      },
      message: trimmed,
    });
  } else if (stepMatch) {
    const step = parseInt(stepMatch[1]);
    const total = parseInt(stepMatch[2]);
    const msg = stepMatch[3];
    emitSessionEvent(session, "progress", {
      step,
      totalSteps: total,
      phase: msg.toLowerCase().includes("load") ? "loading"
        : msg.toLowerCase().includes("feature") ? "features"
        : msg.toLowerCase().includes("split") ? "splitting"
        : msg.toLowerCase().includes("standard") ? "scaling"
        : msg.toLowerCase().includes("gibbs") || msg.toLowerCase().includes("hdp") ? "gibbs_sampling"
        : msg.toLowerCase().includes("walk") ? "walk_forward"
        : msg.toLowerCase().includes("out-of-sample") ? "oos_evaluation"
        : msg.toLowerCase().includes("analyz") ? "analyzing"
        : "saving",
      message: trimmed,
      pct: Math.round((step / total) * 100),
    });
  } else if (discoveredMatch) {
    emitSessionEvent(session, "metric", { type: "regimes_discovered", value: parseInt(discoveredMatch[1]) });
  } else if (stabMatch) {
    emitSessionEvent(session, "metric", { type: "stability", value: parseFloat(stabMatch[1]) });
  } else if (simMatch) {
    emitSessionEvent(session, "metric", { type: "oos_similarity", value: parseFloat(simMatch[1]) });
  } else if (corrMatch) {
    emitSessionEvent(session, "metric", { type: "oos_correlation", value: parseFloat(corrMatch[1]) });
  } else if (qualMatch) {
    emitSessionEvent(session, "metric", { type: "quality_score", value: parseFloat(qualMatch[1]) });
  } else if (featureMatrixMatch) {
    emitSessionEvent(session, "metric", { type: "data_size", value: parseInt(featureMatrixMatch[1].replace(/,/g, "")) });
  } else if (trimmed.includes("Training complete")) {
    emitSessionEvent(session, "progress", { phase: "complete", message: trimmed, pct: 100 });
  } else {
    emitSessionEvent(session, "log", { message: trimmed });
  }
}

// ─── Python Runner ───────────────────────────────────────────────────────────

export class PythonRunner implements ITrainerRunner {
  private sessions = new Map<string, TrainingSession & { child: ChildProcess; stdout: string; stderr: string }>();

  async start(config: ResolvedTrainingConfig): Promise<TrainingSession> {
    const trainingCfg = getTrainingConfig();
    const pythonExe = path.join(process.cwd(), config.registry.script ? "" : "", trainingCfg.paths.pythonExe);
    const script = path.join(process.cwd(), config.registry.script!);
    const modelsDir = path.join(process.cwd(), config.registry.outputDir);

    const session = createSession(config.modelId, config) as TrainingSession & { child: ChildProcess; stdout: string; stderr: string };
    session.stdout = "";
    session.stderr = "";

    // Build CLI args from resolved hyperparameters
    const args = [script, "--symbol", config.symbol, "--timeframe", config.timeframe, "--json"];

    if (config.dataFile) {
      args.push("--data-file", config.dataFile);
    }

    // Map hyperparameters to CLI flags
    const hypMap: Record<string, string> = {
      gibbsIter: "--gibbs-iter",
      burnIn: "--burn-in",
      testSplit: "--test-split",
      wfWindows: "--wf-windows",
      alpha: "--alpha",
      gamma: "--gamma",
      kappa: "--kappa",
    };

    for (const [key, val] of Object.entries(config.hyperparameters)) {
      const flag = hypMap[key];
      if (flag) {
        args.push(flag, String(val));
      }
    }

    if (config.includeIndicators) {
      args.push("--include-indicators");
      if (config.indicatorGroups) {
        args.push("--indicator-groups", config.indicatorGroups);
      }
    }

    console.log(`[training] Spawning: ${pythonExe} ${args.join(" ")}`);

    const child = spawn(pythonExe, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    session.child = child;

    // Training timeout: SIGTERM then SIGKILL after grace period
    const maxDurationSec = trainingCfg.limits.maxTrainingDurationSec ?? 7200;
    const timeoutHandle = setTimeout(() => {
      if (!session.finished) {
        console.warn(`[training] Session ${session.sessionId} exceeded ${maxDurationSec}s timeout, sending SIGTERM`);
        child.kill("SIGTERM");
        // If still alive after 30s, force kill
        setTimeout(() => {
          if (!session.finished) {
            console.warn(`[training] Session ${session.sessionId} did not exit after SIGTERM, sending SIGKILL`);
            child.kill("SIGKILL");
          }
        }, 30_000);
      }
    }, maxDurationSec * 1000);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      session.stdout += text;
      const lines = text.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        parseHdpHmmLine(session, line.trim(), modelsDir);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      session.stderr += text;
      const trimmed = text.trim();
      if (trimmed && !trimmed.includes("ConvergenceWarning") && !trimmed.includes("DeprecationWarning")
          && !trimmed.includes("UserWarning") && !trimmed.includes("FutureWarning")
          && !trimmed.includes("loky") && !trimmed.includes("resource_tracker")) {
        emitSessionEvent(session, "log", { message: trimmed.slice(0, 500), level: "warning" });
      }
    });

    child.on("close", (code) => {
      clearTimeout(timeoutHandle);
      session.finished = true;
      session.exitCode = code;

      if (code !== 0) {
        emitSessionEvent(session, "error", {
          message: `Training failed (exit code ${code})`,
          details: (session.stderr || session.stdout).slice(-2000),
        });
      } else {
        let diagnostics = null;
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
      emitSessionEvent(session, "error", { message: "Training stopped by user" });
      session.finished = true;
      session.exitCode = -1;
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
