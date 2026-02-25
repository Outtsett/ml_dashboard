import { Router, Request, Response } from "express";
import { spawn, ChildProcess } from "child_process";
import { mlRateLimiter } from "../../lib/rateLimiter";
import { metaCache, clearCachedCatalog, INDICATOR_DIR } from "./helpers";
import * as path from "path";
import * as fs from "fs";

const router = Router();

let activeComputeProcess: ChildProcess | null = null;

// POST /api/indicators/compute-batch — trigger indicator recomputation
router.post("/indicators/compute-batch", mlRateLimiter, (req: Request, res: Response) => {
  if (activeComputeProcess) {
    return res.status(409).json({ error: "Indicator computation already in progress" });
  }

  const { symbols, timeframes, force } = req.body as {
    symbols?: string[];
    timeframes?: string[];
    force?: boolean;
  };

  // Build CLI args
  const trainingJsonPath = path.join(process.cwd(), "src", "config", "training.json");
  let pythonExe = ".venv/Scripts/python.exe";
  try {
    const trainingCfg = JSON.parse(fs.readFileSync(trainingJsonPath, "utf-8"));
    pythonExe = trainingCfg.paths?.pythonExe || pythonExe;
  } catch {}

  const script = path.join(process.cwd(), "scripts", "compute-indicators.py");
  const args = [script];

  if (symbols && symbols.length > 0) {
    args.push("--symbols", symbols.join(","));
  }
  if (timeframes && timeframes.length > 0) {
    args.push("--timeframes", timeframes.join(","));
  }
  if (force) {
    args.push("--force");
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent("started", {
    message: "Indicator computation started",
    symbols: symbols || "all",
    timeframes: timeframes || "all (except 1m)",
    force: !!force,
  });

  const fullPythonExe = path.join(process.cwd(), pythonExe);
  console.log(`[indicators] Spawning: ${fullPythonExe} ${args.join(" ")}`);

  const child = spawn(fullPythonExe, args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  activeComputeProcess = child;

  child.stdout.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter((l: string) => l.trim());
    for (const line of lines) {
      const trimmed = line.trim();

      // Parse progress markers like [indicators] ES done (7 computed, 0 skipped, 0 errors) [7/112]
      const progressMatch = trimmed.match(/\[(\d+)\/(\d+)\]$/);
      if (progressMatch) {
        sendEvent("progress", {
          done: parseInt(progressMatch[1]),
          total: parseInt(progressMatch[2]),
          message: trimmed,
        });
      } else {
        sendEvent("log", { message: trimmed });
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text && !text.includes("Warning") && !text.includes("FutureWarning")) {
      sendEvent("warning", { message: text.slice(0, 500) });
    }
  });

  child.on("close", (code) => {
    activeComputeProcess = null;
    // Clear meta cache so new data is picked up
    metaCache.clear();
    clearCachedCatalog();

    if (code === 0) {
      sendEvent("done", { message: "Indicator computation complete", exitCode: 0 });
    } else {
      sendEvent("error", { message: `Computation failed (exit code ${code})`, exitCode: code });
    }
    res.end();
  });

  // Client disconnect — kill process
  req.on("close", () => {
    if (activeComputeProcess && activeComputeProcess === child) {
      console.log("[indicators] Client disconnected, killing compute process");
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
      activeComputeProcess = null;
    }
  });
});

// GET /api/indicators/status — which symbol/timeframe combos have indicators
router.get("/indicators/status", (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(INDICATOR_DIR)) {
      return res.json({ computed: [], totalSymbols: 0, totalCombinations: 0 });
    }

    const computed: Array<{
      symbol: string;
      timeframe: string;
      rowCount: number;
      totalColumns: number;
      computedAt: string;
      categories: string[];
      totalSizeMb: number;
    }> = [];

    // Walk data/indicators/{timeframe}/{symbol}/_meta.json
    for (const tf of fs.readdirSync(INDICATOR_DIR)) {
      const tfDir = path.join(INDICATOR_DIR, tf);
      if (!fs.statSync(tfDir).isDirectory()) continue;

      for (const sym of fs.readdirSync(tfDir)) {
        const metaPath = path.join(tfDir, sym, "_meta.json");
        if (!fs.existsSync(metaPath)) continue;

        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          const totalSizeBytes = Object.values(meta.categories || {}).reduce(
            (sum: number, c: any) => sum + (c.file_size_bytes || 0), 0
          );
          computed.push({
            symbol: meta.symbol || sym,
            timeframe: meta.timeframe || tf,
            rowCount: meta.row_count || 0,
            totalColumns: meta.total_columns || 0,
            computedAt: meta.computed_at || "",
            categories: Object.keys(meta.categories || {}),
            totalSizeMb: Math.round((totalSizeBytes as number) / (1024 * 1024) * 10) / 10,
          });
        } catch { /* skip malformed */ }
      }
    }

    const symbols = new Set(computed.map(c => c.symbol));
    res.json({
      computed,
      totalSymbols: symbols.size,
      totalCombinations: computed.length,
      computing: !!activeComputeProcess,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to read indicator status" });
  }
});

export default router;
