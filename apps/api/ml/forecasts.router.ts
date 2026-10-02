import { Router, Request, Response } from "express";
import { mlRateLimiter } from "../infrastructure/lib/rateLimiter";
import { getString } from "../infrastructure/lib/routeHelpers";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { logInfo } from "../infrastructure/lib/log";

const router = Router();

// ============================================================
// PRE-TRAINED MODEL FORECASTING (Chronos)
// ============================================================

const FORECASTS_DIR = path.join(process.cwd(), "data", "forecasts");
const PYTHON_EXE = path.join(process.cwd(), ".venv", "Scripts", "python.exe");
const FORECAST_SCRIPT = path.join(process.cwd(), "scripts", "pretrained-forecast.py");

/** GET /api/ml/forecasts — list all saved forecast files */
router.get("/ml/forecasts", async (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(FORECASTS_DIR)) {
      return res.json([]);
    }
    const files = fs.readdirSync(FORECASTS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        const filePath = path.join(FORECASTS_DIR, f);
        const stat = fs.statSync(filePath);
        // Read just the metadata from each forecast
        try {
          const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          return {
            filename: f,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            metadata: raw.metadata,
            metrics: raw.metrics,
          };
        } catch {
          return { filename: f, size: stat.size, modified: stat.mtime.toISOString() };
        }
      });
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/** GET /api/ml/forecasts/:filename — get a specific forecast result */
router.get("/ml/forecasts/:filename", async (req: Request, res: Response) => {
  try {
    const filename = getString(req.params.filename);
    if (!filename || !filename.endsWith(".json")) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    // Prevent path traversal
    const safeName = path.basename(filename);
    const filePath = path.join(FORECASTS_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Forecast not found" });
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/** POST /api/ml/forecast — run a new Chronos forecast */
router.post("/ml/forecast", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const { symbol, timeframe = 3600, context = 500, horizon = 24, modelSize = "small", samples = 20 } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: "symbol is required" });
    }

    const validSizes = ["tiny", "mini", "small", "base", "large"];
    if (!validSizes.includes(modelSize)) {
      return res.status(400).json({ error: `modelSize must be one of: ${validSizes.join(", ")}` });
    }

    // Validate numeric params
    const ctx = Math.min(Math.max(50, Number(context)), 2000);
    const hz = Math.min(Math.max(5, Number(horizon)), 100);
    const smp = Math.min(Math.max(5, Number(samples)), 100);
    const tf = Number(timeframe);

    logInfo(`[forecast] Starting Chronos ${modelSize} forecast: ${symbol} @ ${tf}s, ctx=${ctx}, hz=${hz}`);

    // Run the Python script as a child process
    const args = [
      FORECAST_SCRIPT,
      "--symbol", symbol,
      "--timeframe", String(tf),
      "--context", String(ctx),
      "--horizon", String(hz),
      "--model-size", modelSize,
      "--samples", String(smp),
    ];

    const child = spawn(PYTHON_EXE, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 1));
    });

    if (exitCode !== 0) {
      console.error(`[forecast] Script failed (exit ${exitCode}):`, stderr || stdout);
      return res.status(500).json({
        error: "Forecast script failed",
        details: (stderr || stdout).slice(-1000),
      });
    }

    // Read the output file
    const tfLabels: Record<number, string> = { 60: "1m", 300: "5m", 900: "15m", 1800: "30m", 3600: "1h", 14400: "4h", 86400: "1d" };
    const tfLabel = tfLabels[tf] || `${tf}s`;
    const outFile = path.join(FORECASTS_DIR, `chronos_${symbol}_${tfLabel}_${modelSize}.json`);

    if (!fs.existsSync(outFile)) {
      return res.status(500).json({ error: "Forecast completed but output file not found" });
    }

    const result = JSON.parse(fs.readFileSync(outFile, "utf-8"));
    logInfo(`[forecast] Done: MAE=${result.metrics?.mae}, Dir=${result.metrics?.direction_accuracy}%`);
    res.json(result);
  } catch (error) {
    console.error("[forecast] Error:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
