/**
 * HDP-HMM Regime Detection — Shared Job Manager
 *
 * Manages training jobs that run as decoupled child processes.
 * Events are buffered in memory for SSE reconnection.
 */

import { ChildProcess } from "child_process";
import path from "path";
import fs from "fs";

// Paths
export const PYTHON_EXE = path.join(process.cwd(), ".venv", "Scripts", "python.exe");
export const TRAIN_SCRIPT = path.join(process.cwd(), "scripts", "train-hdp-hmm.py");
export const MODELS_DIR = path.join(process.cwd(), "data", "models", "hdp-hmm");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrainingEvent {
  event: string;
  data: Record<string, unknown>;
  ts: number;
}

export interface TrainingJob {
  child: ChildProcess;
  modelId: string;
  startedAt: number;
  events: TrainingEvent[];
  listeners: Set<(event: TrainingEvent) => void>;
  finished: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

// ─── Active Jobs Registry ───────────────────────────────────────────────────

export const activeJobs = new Map<string, TrainingJob>();

// ─── Event Helpers ──────────────────────────────────────────────────────────

export function emitEvent(job: TrainingJob, event: string, data: Record<string, unknown>) {
  const evt: TrainingEvent = { event, data, ts: Date.now() };
  job.events.push(evt);
  for (const listener of job.listeners) {
    try { listener(evt); } catch { /* dead listener */ }
  }
}

// ─── Stdout Parser ──────────────────────────────────────────────────────────

export function parseLine(job: TrainingJob, trimmed: string) {
  if (trimmed.startsWith("__JSON_OUTPUT__")) return;

  // ── Live regime snapshot markers (binary sidecar file approach) ──
  if (trimmed.startsWith("__REGIME_META__")) {
    try {
      const meta = JSON.parse(trimmed.slice("__REGIME_META__".length));
      const tsFile = path.join(MODELS_DIR, job.modelId, "live_timestamps.bin");
      if (fs.existsSync(tsFile)) {
        const buf = fs.readFileSync(tsFile);
        const int64View = new BigInt64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
        const timestamps = Array.from(int64View, (v) => Number(v));
        emitEvent(job, "regime_timestamps", { timestamps, count: meta.count });
      } else {
        emitEvent(job, "regime_meta", meta);
      }
    } catch { /* skip malformed */ }
    return;
  }
  if (trimmed.startsWith("__REGIME_SNAP__")) {
    try {
      const snap = JSON.parse(trimmed.slice("__REGIME_SNAP__".length));
      const snapFile = path.join(MODELS_DIR, job.modelId, "live_snapshot.bin");
      if (fs.existsSync(snapFile)) {
        const buf = fs.readFileSync(snapFile);
        const assignments = Array.from(new Uint8Array(buf));
        emitEvent(job, "regime_snapshot", { assignments, iteration: snap.iter });
      }
    } catch { /* skip malformed */ }
    return;
  }

  // Skip raw JSON objects/arrays but NOT step markers like [1/9]
  if (trimmed.startsWith("{")) return;
  if (trimmed.startsWith("[") && !/^\[\d+\/\d+\]/.test(trimmed)) return;
  if (/^=+$/.test(trimmed) || trimmed === '') return;

  const stepMatch = trimmed.match(/^\[(\d+)\/(\d+)\]\s+(.*)/);
  const gibbsMatch = trimmed.match(
    /iter\s+(\d+)\/(\d+):\s+Regimes=(\d+)\s+Fit=([-\d.]+)\/bar\s+LL=\s*([-\d,. ]+)\s+Δ=\s*([-\d,.]+)\s+Entropy=([\d.]+)\s+Switch=([\d.]+)\s+SelfTr=([\d.]+)\s+MaxReg=([\d.]+)%\s+Dwell=([\d.]+)/
  );
  const gibbsMatchOld = !gibbsMatch ? trimmed.match(/iter\s+(\d+)\/(\d+):\s+LL=\s*([-\d,. ]+)\s+active_states=(\d+)\s+delta=([\d.]+)/) : null;
  const discoveredMatch = trimmed.match(/Discovered\s+(\d+)\s+regimes/i);
  const simMatch = trimmed.match(/Distribution Similarity:\s+([\d.]+)/);
  const corrMatch = trimmed.match(/Profile Correlation:\s+([\d.]+)/);
  const qualMatch = trimmed.match(/Quality Score:\s+([\d.]+)/);
  const stabMatch = trimmed.match(/Walk-Forward Stability:\s+([\d.]+)/);
  const regDiscMatch = trimmed.match(/Regimes Discovered:\s+(\d+)/);
  const featureMatrixMatch = trimmed.match(/Feature matrix:\s+([\d,]+)\s+bars/);

  if (gibbsMatch) {
    emitEvent(job, "gibbs_progress", {
      iteration: parseInt(gibbsMatch[1]!),
      totalIterations: parseInt(gibbsMatch[2]!),
      activeStates: parseInt(gibbsMatch[3]!),
      fitPerBar: parseFloat(gibbsMatch[4]!),
      logLikelihood: parseFloat(gibbsMatch[5]!.replace(/[, ]/g, '')),
      delta: parseFloat(gibbsMatch[6]!.replace(/[, ]/g, '')),
      entropy: parseFloat(gibbsMatch[7]!),
      switchRate: parseFloat(gibbsMatch[8]!),
      selfTransition: parseFloat(gibbsMatch[9]!),
      maxRegimePct: parseFloat(gibbsMatch[10]!),
      avgDwell: parseFloat(gibbsMatch[11]!),
      message: trimmed,
    });
  } else if (gibbsMatchOld) {
    emitEvent(job, "gibbs_progress", {
      iteration: parseInt(gibbsMatchOld[1]!),
      totalIterations: parseInt(gibbsMatchOld[2]!),
      logLikelihood: parseFloat(gibbsMatchOld[3]!.replace(/[, ]/g, '')),
      activeStates: parseInt(gibbsMatchOld[4]!),
      delta: parseFloat(gibbsMatchOld[5]!),
      fitPerBar: 0, entropy: 0, switchRate: 0, selfTransition: 0, maxRegimePct: 0, avgDwell: 0,
      message: trimmed,
    });
  } else if (stepMatch) {
    const step = parseInt(stepMatch[1]!);
    const total = parseInt(stepMatch[2]!);
    const msg = stepMatch[3]!;
    emitEvent(job, "progress", {
      step, totalSteps: total,
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
    emitEvent(job, "metric", { type: "regimes_discovered", value: parseInt(discoveredMatch[1]!), message: trimmed });
  } else if (regDiscMatch) {
    emitEvent(job, "metric", { type: "regimes_discovered", value: parseInt(regDiscMatch[1]!), message: trimmed });
  } else if (stabMatch) {
    emitEvent(job, "metric", { type: "stability", value: parseFloat(stabMatch[1]!), message: trimmed });
  } else if (simMatch) {
    emitEvent(job, "metric", { type: "oos_similarity", value: parseFloat(simMatch[1]!), message: trimmed });
  } else if (corrMatch) {
    emitEvent(job, "metric", { type: "oos_correlation", value: parseFloat(corrMatch[1]!), message: trimmed });
  } else if (qualMatch) {
    emitEvent(job, "metric", { type: "quality_score", value: parseFloat(qualMatch[1]!), message: trimmed });
  } else if (featureMatrixMatch) {
    emitEvent(job, "metric", { type: "data_size", value: parseInt(featureMatrixMatch[1]!.replace(/,/g, '')), message: trimmed });
  } else if (trimmed.startsWith("Regime Summary:")) {
    emitEvent(job, "status", { phase: "summary", message: trimmed });
  } else if (/^\d+\s+/.test(trimmed)) {
    emitEvent(job, "regime_line", { text: trimmed });
  } else if (trimmed.includes("Training complete")) {
    emitEvent(job, "status", { phase: "complete", message: trimmed });
  } else {
    emitEvent(job, "log", { message: trimmed });
  }
}
