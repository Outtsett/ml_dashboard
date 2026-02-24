/**
 * HDP-HMM Regime Detection — Training Routes
 *
 * Routes:
 *   POST /api/regime/train             — start training (returns 202 + modelId)
 *   POST /api/regime/train/universal   — universal training (multi-symbol)
 */

import { Router, Request, Response } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { exportTrainingData } from "../../training/dataExporter";
import {
  PYTHON_EXE, TRAIN_SCRIPT, MODELS_DIR,
  activeJobs, emitEvent, parseLine,
  type TrainingJob,
} from "./jobManager";

const router = Router();

// ─── Start Training (POST — returns immediately, runs in background) ────────

router.post("/regime/train", async (req: Request, res: Response) => {
  try {
    const {
      symbol = "ES",
      timeframe = "1m",
      start,
      end,
      gibbsIter = 100,
      burnIn = 30,
      testSplit = 0.15,
      wfWindows = 5,
      alpha = 1.0,
      gamma = 5.0,
      kappa = 50.0,
      includeIndicators = false,
      indicatorGroups,
    } = req.body;

    const sym = symbol.toUpperCase();
    const modelId = `${sym}_${timeframe}`;

    // Check if already training (allow overwriting finished/stopped jobs)
    const existingJob = activeJobs.get(modelId);
    if (existingJob && !existingJob.finished) {
      return res.status(409).json({ error: `Already training ${modelId}` });
    }
    if (existingJob) {
      activeJobs.delete(modelId);
    }

    // Create job (child set after data export)
    const job: TrainingJob = {
      child: null as any,
      modelId,
      startedAt: Date.now(),
      events: [],
      listeners: new Set(),
      finished: false,
      exitCode: null,
      stdout: "",
      stderr: "",
    };

    activeJobs.set(modelId, job);
    emitEvent(job, "status", { phase: "starting", message: `Training HDP-HMM for ${sym} @ ${timeframe}...` });

    // Return immediately — client connects via GET /stream/:modelId for progress
    res.status(202).json({ modelId, message: `Training started for ${modelId}` });

    // Export + spawn in background (errors communicated via SSE events)
    (async () => {
      emitEvent(job, "status", { phase: "exporting", message: `Exporting ${sym} @ ${timeframe} OHLCV data...` });

      let dataFile: string;
      try {
        const dateRange = start || end ? { start: start || '', end: end || '' } : undefined;
        const result = await exportTrainingData(sym, timeframe, dateRange);
        dataFile = result.dataFile;
        emitEvent(job, "status", { phase: "exported", message: `Exported ${result.totalBars} bars (${result.dateRange.start} → ${result.dateRange.end})` });
      } catch (exportErr: any) {
        emitEvent(job, "error", { message: `Failed to export data: ${exportErr.message}` });
        job.finished = true;
        job.exitCode = -1;
        setTimeout(() => activeJobs.delete(modelId), 60000);
        return;
      }

      const args = [
        TRAIN_SCRIPT,
        "--symbol", sym,
        "--timeframe", timeframe,
        "--data-file", dataFile,
        "--gibbs-iter", String(gibbsIter),
        "--burn-in", String(burnIn),
        "--test-split", String(testSplit),
        "--wf-windows", String(wfWindows),
        "--alpha", String(alpha),
        "--gamma", String(gamma),
        "--kappa", String(kappa),
        "--json",
      ];

      if (includeIndicators) {
        args.push("--include-indicators");
        if (indicatorGroups && typeof indicatorGroups === "string") {
          args.push("--indicator-groups", indicatorGroups);
        }
      }

      console.log(`[regime] Spawning: ${PYTHON_EXE} ${args.join(" ")}`);

      const child = spawn(PYTHON_EXE, args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
      job.child = child;

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        job.stdout += text;
        const lines = text.split("\n").filter((l: string) => l.trim());
        for (const line of lines) {
          parseLine(job, line.trim());
        }
      });

      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        job.stderr += text;
        const trimmed = text.trim();
        if (trimmed && !trimmed.includes("ConvergenceWarning") && !trimmed.includes("DeprecationWarning")
            && !trimmed.includes("UserWarning") && !trimmed.includes("FutureWarning")
            && !trimmed.includes("loky") && !trimmed.includes("resource_tracker")) {
          emitEvent(job, "warning", { message: trimmed.slice(0, 500) });
        }
      });

      child.on("error", (err) => {
        console.error(`[regime] Spawn error for ${modelId}:`, err.message);
        emitEvent(job, "error", { message: `Failed to start Python: ${err.message}` });
        job.finished = true;
        job.exitCode = -1;
        try {
          const localPath = dataFile.replace(/\//g, path.sep);
          if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
        } catch { /* ignore */ }
        setTimeout(() => activeJobs.delete(modelId), 60000);
      });

      child.on("close", (code) => {
        job.finished = true;
        job.exitCode = code;

        try {
          const localPath = dataFile.replace(/\//g, path.sep);
          if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
        } catch { /* ignore */ }

        if (code !== 0) {
          emitEvent(job, "error", {
            message: `Training failed (exit code ${code})`,
            details: (job.stderr || job.stdout).slice(-2000),
          });
        } else {
          let diagnostics = null;
          const jsonMarker = "__JSON_OUTPUT__";
          const jsonIdx = job.stdout.indexOf(jsonMarker);
          if (jsonIdx >= 0) {
            try { diagnostics = JSON.parse(job.stdout.slice(jsonIdx + jsonMarker.length).trim()); } catch { /* */ }
          }
          if (!diagnostics) {
            const diagPath = path.join(MODELS_DIR, modelId, "diagnostics.json");
            if (fs.existsSync(diagPath)) {
              try { diagnostics = JSON.parse(fs.readFileSync(diagPath, "utf-8")); } catch { /* */ }
            }
          }
          emitEvent(job, "done", {
            modelId,
            diagnostics,
            elapsed: ((Date.now() - job.startedAt) / 1000).toFixed(1),
          });
        }

        // Keep job around for 2 min so late-connecting clients can see results
        setTimeout(() => activeJobs.delete(modelId), 120000);
      });
    })().catch(err => {
      console.error(`[regime] Background training error for ${modelId}:`, err);
      emitEvent(job, "error", { message: err.message });
      job.finished = true;
      job.exitCode = -1;
      setTimeout(() => activeJobs.delete(modelId), 60000);
    });
  } catch (error: any) {
    console.error("[regime] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Universal Training (POST — trains ONE model on MULTIPLE symbols) ───────

router.post("/regime/train/universal", async (req: Request, res: Response) => {
  try {
    const {
      symbols: rawSymbols,
      timeframe = "30m",
      start,
      end,
      gibbsIter = 100,
      burnIn = 30,
      testSplit = 0.15,
      wfWindows = 5,
      alpha = 1.0,
      gamma = 5.0,
      kappa = 50.0,
      includeIndicators = false,
      indicatorGroups,
    } = req.body;

    // Parse symbols: string[] or comma-separated string
    let symbolList: string[];
    if (Array.isArray(rawSymbols) && rawSymbols.length > 0) {
      symbolList = rawSymbols.map((s: string) => s.toUpperCase());
    } else if (typeof rawSymbols === "string") {
      symbolList = rawSymbols.split(",").map(s => s.trim().toUpperCase());
    } else {
      symbolList = ["ES", "NQ", "MNQ", "YM", "RTY", "CL", "GC", "ZB"];
    }

    const modelId = `universal_${timeframe}`;

    const existingJob = activeJobs.get(modelId);
    if (existingJob && !existingJob.finished) {
      return res.status(409).json({ error: `Already training ${modelId}` });
    }
    if (existingJob) {
      activeJobs.delete(modelId);
    }

    const job: TrainingJob = {
      child: null as any,
      modelId,
      startedAt: Date.now(),
      events: [],
      listeners: new Set(),
      finished: false,
      exitCode: null,
      stdout: "",
      stderr: "",
    };

    activeJobs.set(modelId, job);
    emitEvent(job, "status", {
      phase: "starting",
      message: `Universal training: ${symbolList.length} symbols @ ${timeframe}`,
    });

    // Export data for each symbol to temp parquets
    const tmpDir = path.join(os.tmpdir(), "ml_dashboard_regime", `universal_${Date.now()}`);
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const exportedSymbols: string[] = [];
    for (const sym of symbolList) {
      try {
        emitEvent(job, "status", { phase: "exporting", message: `Exporting ${sym} data...` });
        const dateRange = start || end ? { start: start || '', end: end || '' } : undefined;
        const result = await exportTrainingData(sym, timeframe, dateRange);
        const targetFile = path.join(tmpDir, `${sym}.parquet`).replace(/\\/g, "/");
        fs.renameSync(result.dataFile.replace(/\//g, path.sep), targetFile.replace(/\//g, path.sep));
        exportedSymbols.push(sym);
        emitEvent(job, "status", { phase: "exported", message: `${sym}: ${result.totalBars} bars exported` });
      } catch (err: any) {
        console.error(`[regime] Failed to export ${sym}: ${err.message}`);
        emitEvent(job, "warning", { message: `Failed to export ${sym}: ${err.message}` });
      }
    }

    if (exportedSymbols.length < 2) {
      emitEvent(job, "error", { message: `Only exported ${exportedSymbols.length} symbols — need at least 2` });
      job.finished = true;
      job.exitCode = -1;
      setTimeout(() => activeJobs.delete(modelId), 60000);
      return res.status(400).json({ error: `Only exported ${exportedSymbols.length} symbols` });
    }

    emitEvent(job, "status", { phase: "exported", message: `Exported ${exportedSymbols.length} symbols. Launching Python...` });

    const pyArgs = [
      TRAIN_SCRIPT,
      "--universal",
      "--symbols", exportedSymbols.join(","),
      "--timeframe", timeframe,
      "--data-dir", tmpDir.replace(/\\/g, "/"),
      "--gibbs-iter", String(gibbsIter),
      "--burn-in", String(burnIn),
      "--test-split", String(testSplit),
      "--wf-windows", String(wfWindows),
      "--alpha", String(alpha),
      "--gamma", String(gamma),
      "--kappa", String(kappa),
      "--json",
    ];

    if (start) pyArgs.push("--start", start);
    if (end) pyArgs.push("--end", end);

    if (includeIndicators) {
      pyArgs.push("--include-indicators");
      if (indicatorGroups && typeof indicatorGroups === "string") {
        pyArgs.push("--indicator-groups", indicatorGroups);
      }
    }

    console.log(`[regime] Spawning universal: ${PYTHON_EXE} ${pyArgs.join(" ")}`);

    const child = spawn(PYTHON_EXE, pyArgs, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    job.child = child;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      job.stdout += text;
      const lines = text.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        parseLine(job, line.trim());
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      job.stderr += text;
      const trimmed = text.trim();
      if (trimmed && !trimmed.includes("ConvergenceWarning") && !trimmed.includes("DeprecationWarning")
          && !trimmed.includes("UserWarning") && !trimmed.includes("FutureWarning")
          && !trimmed.includes("loky") && !trimmed.includes("resource_tracker")) {
        emitEvent(job, "warning", { message: trimmed.slice(0, 500) });
      }
    });

    child.on("close", (code) => {
      job.finished = true;
      job.exitCode = code;

      // Clean up temp data directory
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }

      if (code !== 0) {
        emitEvent(job, "error", {
          message: `Universal training failed (exit code ${code})`,
          details: (job.stderr || job.stdout).slice(-2000),
        });
      } else {
        let diagnostics = null;
        const jsonMarker = "__JSON_OUTPUT__";
        const jsonIdx = job.stdout.indexOf(jsonMarker);
        if (jsonIdx >= 0) {
          try { diagnostics = JSON.parse(job.stdout.slice(jsonIdx + jsonMarker.length).trim()); } catch { /* */ }
        }
        if (!diagnostics) {
          const diagPath = path.join(MODELS_DIR, modelId, "diagnostics.json");
          if (fs.existsSync(diagPath)) {
            try { diagnostics = JSON.parse(fs.readFileSync(diagPath, "utf-8")); } catch { /* */ }
          }
        }
        emitEvent(job, "done", {
          modelId,
          diagnostics,
          elapsed: ((Date.now() - job.startedAt) / 1000).toFixed(1),
        });
      }

      setTimeout(() => activeJobs.delete(modelId), 120000);
    });

    res.status(202).json({
      modelId,
      symbols: exportedSymbols,
      message: `Universal training started: ${exportedSymbols.length} symbols @ ${timeframe}`,
    });
  } catch (error: any) {
    console.error("[regime] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
