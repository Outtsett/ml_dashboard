/**
 * HDP-HMM Regime Detection Routes
 *
 * Exposes endpoints to train, list, and query regime models.
 * The heavy lifting is done by the Python script `scripts/train-hdp-hmm.py`,
 * spawned as a child process so Node stays non-blocking.
 *
 * Routes:
 *   POST /api/regime/train           — kick off HDP-HMM training (returns SSE stream)
 *   GET  /api/regime/models          — list trained regime models
 *   GET  /api/regime/diagnostics/:id — get diagnostics JSON for a model
 *   GET  /api/regime/assignments/:id — get per-bar regime assignments (from parquet)
 *   DELETE /api/regime/models/:id    — delete a trained model
 */

import { Router, Request, Response } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const router = Router();

// Paths
const PYTHON_EXE = path.join(process.cwd(), ".venv", "Scripts", "python.exe");
const TRAIN_SCRIPT = path.join(process.cwd(), "scripts", "train-hdp-hmm.py");
const MODELS_DIR = path.join(process.cwd(), "data", "models", "hdp-hmm");

// Track active training processes
const activeTraining = new Map<string, { child: ReturnType<typeof spawn>; startedAt: number }>();

// ─── List trained regime models ──────────────────────────────────────────────

router.get("/regime/models", async (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(MODELS_DIR)) {
      return res.json({ models: [] });
    }

    const dirs = fs.readdirSync(MODELS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    const models = [];
    for (const dir of dirs) {
      const diagPath = path.join(MODELS_DIR, dir, "diagnostics.json");
      if (fs.existsSync(diagPath)) {
        try {
          const diag = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
          models.push({
            id: dir,
            symbol: diag.symbol,
            timeframe: diag.timeframe,
            n_regimes: diag.n_regimes,
            n_bars: diag.n_bars || diag.n_bars_total,
            n_bars_total: diag.n_bars_total,
            n_bars_train_val: diag.n_bars_train_val,
            n_bars_test: diag.n_bars_test,
            quality_score: diag.quality_score,
            date_range: diag.date_range,
            training_config: diag.training_config,
            training_time_sec: diag.training_time_sec,
            trained_at: diag.trained_at,
          });
        } catch {
          // Skip corrupted diagnostics
        }
      }
    }

    // Sort by trained_at descending
    models.sort((a, b) => (b.trained_at || "").localeCompare(a.trained_at || ""));
    res.json({ models });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Get diagnostics for a model ─────────────────────────────────────────────

router.get("/regime/diagnostics/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const diagPath = path.join(MODELS_DIR, id, "diagnostics.json");

    if (!fs.existsSync(diagPath)) {
      return res.status(404).json({ error: `Model '${id}' not found` });
    }

    const diag = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
    res.json(diag);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Get convergence data for a model ────────────────────────────────────────

router.get("/regime/convergence/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const convPath = path.join(MODELS_DIR, id, "convergence.json");

    if (!fs.existsSync(convPath)) {
      return res.status(404).json({ error: `Convergence data for '${id}' not found` });
    }

    const conv = JSON.parse(fs.readFileSync(convPath, "utf-8"));
    res.json(conv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Get per-bar regime assignments ──────────────────────────────────────────

router.get("/regime/assignments/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const parquetPath = path.join(MODELS_DIR, id, "regimes.parquet");

    if (!fs.existsSync(parquetPath)) {
      return res.status(404).json({ error: `Regime assignments not found for '${id}'` });
    }

    // Use DuckDB to read the parquet file
    const { marketQuery } = await import("../duckdb/market");
    const forwardPath = parquetPath.replace(/\\/g, "/");

    // Optional limit/offset for pagination
    const limit = Math.min(Number(req.query.limit) || 50000, 100000);
    const offset = Number(req.query.offset) || 0;

    // Cast regime to INTEGER and close to DOUBLE to avoid BigInt serialization
    // Dynamically select prob_regime_* columns
    const rows = await marketQuery<Record<string, unknown>>(
      `SELECT ts, CAST(close AS DOUBLE) as close, CAST(regime AS INTEGER) as regime, regime_label
       FROM read_parquet('${forwardPath}') ORDER BY ts ASC LIMIT ${limit} OFFSET ${offset}`
    );

    const total = await marketQuery<{ cnt: number }>(
      `SELECT CAST(COUNT(*) AS DOUBLE) as cnt FROM read_parquet('${forwardPath}')`
    );

    res.json({
      rows,
      total: total[0]?.cnt || rows.length,
      limit,
      offset,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Train HDP-HMM (SSE stream) ─────────────────────────────────────────────

router.post("/regime/train", async (req: Request, res: Response) => {
  try {
    const {
      symbol = "ES",
      timeframe = "30m",
      minRegimes = 2,
      maxRegimes = 8,
      start,
      end,
      restarts = 5,
      maxIter = 200,
      nFolds = 5,
      testSplit = 0.15,
      wfWindows = 5,
    } = req.body;

    const modelId = `${symbol.toUpperCase()}_${timeframe}`;

    // Check if already training this combo
    if (activeTraining.has(modelId)) {
      return res.status(409).json({ error: `Already training ${modelId}` });
    }

    // Set up SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("status", { phase: "starting", message: `Training HDP-HMM for ${symbol} @ ${timeframe}...` });

    // Build CLI args
    const args = [
      TRAIN_SCRIPT,
      "--symbol", symbol.toUpperCase(),
      "--timeframe", timeframe,
      "--min-regimes", String(minRegimes),
      "--max-regimes", String(maxRegimes),
      "--restarts", String(restarts),
      "--max-iter", String(maxIter),
      "--n-folds", String(nFolds),
      "--test-split", String(testSplit),
      "--wf-windows", String(wfWindows),
      "--json",
    ];
    if (start) args.push("--start", start);
    if (end) args.push("--end", end);

    console.log(`[regime] Spawning: ${PYTHON_EXE} ${args.join(" ")}`);

    const child = spawn(PYTHON_EXE, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    activeTraining.set(modelId, { child, startedAt: Date.now() });

    let stdout = "";
    let stderr = "";

    // Stream progress lines from Python stdout
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;

      // Parse progress lines like "[1/6] Loading OHLCV..." or "  Loaded 50,000 bars"
      const lines = text.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        const trimmed = line.trim();

        // Skip the JSON output marker and raw JSON
        if (trimmed.startsWith("__JSON_OUTPUT__") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
          continue;
        }

        // Detect step headers [N/6]
        const stepMatch = trimmed.match(/^\[(\d+)\/(\d+)\]\s+(.*)/);
        if (stepMatch) {
          const step = parseInt(stepMatch[1]);
          const total = parseInt(stepMatch[2]);
          const message = stepMatch[3];
          send("progress", {
            step,
            totalSteps: total,
            phase: message.toLowerCase().includes("load") ? "loading"
              : message.toLowerCase().includes("feature") ? "features"
              : message.toLowerCase().includes("standard") ? "scaling"
              : message.toLowerCase().includes("fit") ? "fitting"
              : message.toLowerCase().includes("analyz") ? "analyzing"
              : "saving",
            message: trimmed,
            pct: Math.round((step / total) * 100),
          });
        } else if (trimmed.startsWith("Regime Summary:")) {
          send("status", { phase: "summary", message: trimmed });
        } else if (trimmed.match(/^\d+\s+/)) {
          // Regime stat line
          send("regime_line", { text: trimmed });
        } else if (trimmed.includes("Training complete")) {
          send("status", { phase: "complete", message: trimmed });
        } else {
          send("log", { message: trimmed });
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      // Don't send warnings as errors (hmmlearn is noisy)
      const text = chunk.toString().trim();
      if (text && !text.includes("ConvergenceWarning") && !text.includes("DeprecationWarning")) {
        send("warning", { message: text.slice(0, 500) });
      }
    });

    child.on("close", (code) => {
      activeTraining.delete(modelId);

      if (code !== 0) {
        send("error", {
          message: `Training failed (exit code ${code})`,
          details: (stderr || stdout).slice(-1000),
        });
        res.end();
        return;
      }

      // Extract JSON output from stdout
      const jsonMarker = "__JSON_OUTPUT__";
      const jsonIdx = stdout.indexOf(jsonMarker);
      let diagnostics = null;
      if (jsonIdx >= 0) {
        try {
          const jsonStr = stdout.slice(jsonIdx + jsonMarker.length).trim();
          diagnostics = JSON.parse(jsonStr);
        } catch {
          // Fall back to reading from disk
        }
      }

      // If we didn't get JSON from stdout, read diagnostics from disk
      if (!diagnostics) {
        const diagPath = path.join(MODELS_DIR, modelId, "diagnostics.json");
        if (fs.existsSync(diagPath)) {
          try {
            diagnostics = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
          } catch {
            // Will be null
          }
        }
      }

      send("done", {
        modelId,
        diagnostics,
        elapsed: ((Date.now() - (activeTraining.get(modelId)?.startedAt || Date.now())) / 1000).toFixed(1),
      });

      res.end();
    });

    // Handle client disconnect
    req.on("close", () => {
      if (activeTraining.has(modelId)) {
        console.log(`[regime] Client disconnected, killing training for ${modelId}`);
        child.kill("SIGTERM");
        activeTraining.delete(modelId);
      }
    });
  } catch (error: any) {
    console.error("[regime] Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// ─── Stop training ───────────────────────────────────────────────────────────

router.post("/regime/train/stop", async (req: Request, res: Response) => {
  try {
    const { symbol, timeframe } = req.body;
    const modelId = `${(symbol || "ES").toUpperCase()}_${timeframe || "30m"}`;

    const active = activeTraining.get(modelId);
    if (!active) {
      return res.status(404).json({ error: `No active training for ${modelId}` });
    }

    active.child.kill("SIGTERM");
    activeTraining.delete(modelId);

    res.json({ message: `Stopped training ${modelId}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Training status ─────────────────────────────────────────────────────────

router.get("/regime/train/status", async (_req: Request, res: Response) => {
  const active: Array<{ modelId: string; elapsed: number }> = [];
  activeTraining.forEach((v, k) => {
    active.push({ modelId: k, elapsed: (Date.now() - v.startedAt) / 1000 });
  });
  res.json({ active });
});

// ─── Delete a model ──────────────────────────────────────────────────────────

router.delete("/regime/models/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const modelDir = path.join(MODELS_DIR, id);

    if (!fs.existsSync(modelDir)) {
      return res.status(404).json({ error: `Model '${id}' not found` });
    }

    // Remove all files in the directory
    const files = fs.readdirSync(modelDir);
    for (const file of files) {
      fs.unlinkSync(path.join(modelDir, file));
    }
    fs.rmdirSync(modelDir);

    res.json({ message: `Deleted model '${id}'` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
