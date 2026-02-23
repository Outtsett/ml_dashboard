/**
 * HDP-HMM Regime Detection Routes
 *
 * Training runs as a decoupled child process — survives browser disconnects.
 * Events are buffered in memory. Clients connect via SSE to stream live logs.
 *
 * Routes:
 *   POST /api/regime/train             — start training (returns 202 + modelId)
 *   GET  /api/regime/train/stream/:id  — SSE stream of training events (reconnectable)
 *   GET  /api/regime/train/status      — list active training jobs
 *   POST /api/regime/train/stop        — stop a training job
 *   GET  /api/regime/models            — list trained regime models
 *   GET  /api/regime/diagnostics/:id   — diagnostics JSON for a model
 *   GET  /api/regime/convergence/:id   — convergence JSON for a model
 *   GET  /api/regime/assignments/:id   — per-bar regime assignments (parquet)
 *   DELETE /api/regime/models/:id      — delete a trained model
 */

import { Router, Request, Response } from "express";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

const router = Router();

// Paths
const PYTHON_EXE = path.join(process.cwd(), ".venv", "Scripts", "python.exe");
const TRAIN_SCRIPT = path.join(process.cwd(), "scripts", "train-hdp-hmm.py");
const MODELS_DIR = path.join(process.cwd(), "data", "models", "hdp-hmm");

// ─── Training Job Manager ───────────────────────────────────────────────────
// Decoupled from HTTP — training survives browser disconnects / refreshes

interface TrainingEvent {
  event: string;
  data: Record<string, unknown>;
  ts: number;
}

interface TrainingJob {
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

const activeJobs = new Map<string, TrainingJob>();

function emitEvent(job: TrainingJob, event: string, data: Record<string, unknown>) {
  const evt: TrainingEvent = { event, data, ts: Date.now() };
  job.events.push(evt);
  for (const listener of job.listeners) {
    try { listener(evt); } catch { /* dead listener */ }
  }
}

function parseLine(job: TrainingJob, trimmed: string) {
  if (trimmed.startsWith("__JSON_OUTPUT__")) return;

  // ── Live regime snapshot markers (binary sidecar file approach) ──
  // Python writes binary files (live_timestamps.bin, live_snapshot.bin) to avoid
  // stdout chunking issues with large arrays (258KB+ for 22K bars).
  if (trimmed.startsWith("__REGIME_META__")) {
    try {
      const meta = JSON.parse(trimmed.slice("__REGIME_META__".length));
      // Read the binary timestamps file and convert to number[]
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
      // Read the binary snapshot file and convert to number[]
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
  // Updated: new format includes Regimes=, Fit=, Entropy=, Switch=, SelfTr=, MaxReg=, Dwell=
  const gibbsMatch = trimmed.match(
    /iter\s+(\d+)\/(\d+):\s+Regimes=(\d+)\s+Fit=([-\d.]+)\/bar\s+LL=\s*([-\d,. ]+)\s+Δ=\s*([-\d,.]+)\s+Entropy=([\d.]+)\s+Switch=([\d.]+)\s+SelfTr=([\d.]+)\s+MaxReg=([\d.]+)%\s+Dwell=([\d.]+)/
  );
  // Fallback for old format (active_states instead of Regimes=)
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
      iteration: parseInt(gibbsMatch[1]),
      totalIterations: parseInt(gibbsMatch[2]),
      activeStates: parseInt(gibbsMatch[3]),
      fitPerBar: parseFloat(gibbsMatch[4]),
      logLikelihood: parseFloat(gibbsMatch[5].replace(/[, ]/g, '')),
      delta: parseFloat(gibbsMatch[6].replace(/[, ]/g, '')),
      entropy: parseFloat(gibbsMatch[7]),
      switchRate: parseFloat(gibbsMatch[8]),
      selfTransition: parseFloat(gibbsMatch[9]),
      maxRegimePct: parseFloat(gibbsMatch[10]),
      avgDwell: parseFloat(gibbsMatch[11]),
      message: trimmed,
    });
  } else if (gibbsMatchOld) {
    // Legacy format fallback
    emitEvent(job, "gibbs_progress", {
      iteration: parseInt(gibbsMatchOld[1]),
      totalIterations: parseInt(gibbsMatchOld[2]),
      logLikelihood: parseFloat(gibbsMatchOld[3].replace(/[, ]/g, '')),
      activeStates: parseInt(gibbsMatchOld[4]),
      delta: parseFloat(gibbsMatchOld[5]),
      fitPerBar: 0, entropy: 0, switchRate: 0, selfTransition: 0, maxRegimePct: 0, avgDwell: 0,
      message: trimmed,
    });
  } else if (stepMatch) {
    const step = parseInt(stepMatch[1]);
    const total = parseInt(stepMatch[2]);
    const msg = stepMatch[3];
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
    emitEvent(job, "metric", { type: "regimes_discovered", value: parseInt(discoveredMatch[1]), message: trimmed });
  } else if (regDiscMatch) {
    emitEvent(job, "metric", { type: "regimes_discovered", value: parseInt(regDiscMatch[1]), message: trimmed });
  } else if (stabMatch) {
    emitEvent(job, "metric", { type: "stability", value: parseFloat(stabMatch[1]), message: trimmed });
  } else if (simMatch) {
    emitEvent(job, "metric", { type: "oos_similarity", value: parseFloat(simMatch[1]), message: trimmed });
  } else if (corrMatch) {
    emitEvent(job, "metric", { type: "oos_correlation", value: parseFloat(corrMatch[1]), message: trimmed });
  } else if (qualMatch) {
    emitEvent(job, "metric", { type: "quality_score", value: parseFloat(qualMatch[1]), message: trimmed });
  } else if (featureMatrixMatch) {
    emitEvent(job, "metric", { type: "data_size", value: parseInt(featureMatrixMatch[1].replace(/,/g, '')), message: trimmed });
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

    const { questdbMarketQuery: marketQuery } = await import("../lib/questdbMarketQuery");
    const forwardPath = parquetPath.replace(/\\/g, "/");

    const limit = Math.min(Number(req.query.limit) || 50000, 100000);
    const offset = Number(req.query.offset) || 0;

    // Read diagnostics to get symbol + timeframe for OHLCV join
    const diagPath = path.join(MODELS_DIR, id, "diagnostics.json");
    let symbol: string | null = null;
    let timeframe: string | null = null;
    if (fs.existsSync(diagPath)) {
      try {
        const diag = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
        symbol = diag.symbol || null;
        timeframe = diag.timeframe || null;
      } catch { /* ignore */ }
    }

    // Map timeframe string to DuckDB interval
    const tfMap: Record<string, string> = {
      "1m": "1 MINUTE", "5m": "5 MINUTES", "15m": "15 MINUTES",
      "30m": "30 MINUTES", "1H": "1 HOUR", "4H": "4 HOURS",
      "1D": "1 DAY", "1W": "7 DAYS",
    };
    const interval = timeframe ? tfMap[timeframe] || "30 MINUTES" : "30 MINUTES";

    let rows: Record<string, unknown>[];
    if (symbol) {
      // Detect root vs specific contract symbol
      const isRoot = symbol.length <= 3 && /^[A-Za-z]+$/.test(symbol);

      // Build the OHLCV source CTE — root symbols query all matching contracts
      const symbolFilter = isRoot
        ? `symbol ~ '^${symbol}[FGHJKMNQUVXZ][0-9]{1,2}$'`
        : `symbol = '${symbol}'`;

      const ohlcvCte = `agg AS (
             SELECT time_bucket(INTERVAL '${interval}', ts) AS bucket_ts,
                    FIRST(open ORDER BY ts) AS open, MAX(high) AS high,
                    MIN(low) AS low, LAST(close ORDER BY ts) AS close,
                    CAST(SUM(volume) AS DOUBLE) AS volume
             FROM ohlcv
             WHERE ${symbolFilter}
             GROUP BY bucket_ts
           )`;

      rows = await marketQuery<Record<string, unknown>>(
        `WITH ${ohlcvCte}
         SELECT r.ts,
                CAST(COALESCE(a.open,  r.close) AS DOUBLE) as open,
                CAST(COALESCE(a.high,  r.close) AS DOUBLE) as high,
                CAST(COALESCE(a.low,   r.close) AS DOUBLE) as low,
                CAST(r.close AS DOUBLE) as close,
                CAST(COALESCE(a.volume, 0) AS DOUBLE) as volume,
                CAST(r.regime AS INTEGER) as regime,
                r.regime_label,
                r.split
         FROM read_parquet('${forwardPath}') r
         LEFT JOIN agg a ON a.bucket_ts = r.ts
         ORDER BY r.ts ASC LIMIT ${limit} OFFSET ${offset}`
      );
    } else {
      rows = await marketQuery<Record<string, unknown>>(
        `SELECT ts, CAST(close AS DOUBLE) as close, CAST(regime AS INTEGER) as regime, regime_label, split
         FROM read_parquet('${forwardPath}') ORDER BY ts ASC LIMIT ${limit} OFFSET ${offset}`
      );
    }

    const total = await marketQuery<{ cnt: number }>(
      `SELECT CAST(COUNT(*) AS DOUBLE) as cnt FROM read_parquet('${forwardPath}')`
    );

    res.json({ rows, total: total[0]?.cnt || rows.length, limit, offset });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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

    // Export OHLCV to temp parquet (Node holds DuckDB write lock)
    const TIMEFRAME_SECONDS: Record<string, number> = {
      "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
      "1h": 3600, "1H": 3600, "4h": 14400, "4H": 14400,
      "1d": 86400, "1D": 86400, "1w": 604800, "1W": 604800,
    };
    const tfSeconds = TIMEFRAME_SECONDS[timeframe] || 60;
    const isRootSymbol = sym.length <= 3 && /^[A-Z]+$/.test(sym);

    let timeFilter = "";
    if (start) timeFilter += ` AND o.ts >= '${start}'`;
    if (end) timeFilter += ` AND o.ts <= '${end}'`;

    // For root symbols, match all contracts via regex; for specific symbols, exact match
    const symbolFilter = isRootSymbol
      ? `symbol ~ '^${sym}[FGHJKMNQUVXZ][0-9]{1,2}$'`
      : `symbol = '${sym}'`;

    let selectSql: string;
    {
      let where = `WHERE ${symbolFilter}`;
      if (start) where += ` AND ts >= '${start}'`;
      if (end) where += ` AND ts <= '${end}'`;
      if (tfSeconds <= 60) {
        selectSql = `SELECT ts, open, high, low, close, CAST(volume AS DOUBLE) as volume FROM ohlcv ${where} ORDER BY ts ASC`;
      } else {
        const interval = `${tfSeconds} seconds`;
        selectSql = `SELECT time_bucket(INTERVAL '${interval}', ts) as ts, FIRST(open) as open, MAX(high) as high, MIN(low) as low, LAST(close) as close, CAST(SUM(volume) AS DOUBLE) as volume FROM ohlcv ${where} GROUP BY time_bucket(INTERVAL '${interval}', ts) ORDER BY 1 ASC`;
      }
    }

    const tmpDir = path.join(os.tmpdir(), "ml_dashboard_regime");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const dataFile = path.join(tmpDir, `${modelId}_${Date.now()}.parquet`).replace(/\\/g, "/");

    emitEvent(job, "status", { phase: "exporting", message: `Exporting ${sym} @ ${timeframe} OHLCV data...` });

    try {
      const { questdbMarketQuery: marketQuery } = await import("../lib/questdbMarketQuery");
      await marketQuery(`COPY (${selectSql}) TO '${dataFile}' (FORMAT PARQUET)`);
    } catch (exportErr: any) {
      emitEvent(job, "error", { message: `Failed to export data: ${exportErr.message}` });
      job.finished = true;
      job.exitCode = -1;
      setTimeout(() => activeJobs.delete(modelId), 60000);
      return res.status(500).json({ error: `Data export failed: ${exportErr.message}` });
    }

    emitEvent(job, "status", { phase: "exported", message: `Data exported. Launching Python training process...` });

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

    // Return immediately — client connects via GET /stream/:modelId
    res.status(202).json({ modelId, message: `Training started for ${modelId}` });
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
      // Default: all futures
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

    // Export data for each symbol to temp parquets (DuckDB file lock prevents Python read_only access)
    const tmpDir = path.join(os.tmpdir(), "ml_dashboard_regime", `universal_${Date.now()}`);
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const { questdbMarketQuery: marketQuery } = await import("../lib/questdbMarketQuery");
    const TIMEFRAME_MAP: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "1H": 3600, "4h": 14400, "4H": 14400, "1d": 86400, "1D": 86400, "1w": 604800, "1W": 604800 };
    const tfSeconds = TIMEFRAME_MAP[timeframe] || 1800;

    const exportedSymbols: string[] = [];
    for (const sym of symbolList) {
      try {
        emitEvent(job, "status", { phase: "exporting", message: `Exporting ${sym} data...` });
        const isRoot = sym.length <= 3 && /^[A-Z]+$/.test(sym);
        const symFilter = isRoot
          ? `symbol ~ '^${sym}[FGHJKMNQUVXZ][0-9]{1,2}$'`
          : `symbol = '${sym}'`;
        let selectSql: string;

        {
          let where = `WHERE ${symFilter}`;
          if (start) where += ` AND ts >= '${start}'`;
          if (end) where += ` AND ts <= '${end}'`;
          if (tfSeconds <= 60) {
            selectSql = `SELECT ts, open, high, low, close, CAST(volume AS DOUBLE) as volume FROM ohlcv ${where} ORDER BY ts ASC`;
          } else {
            const interval = `${tfSeconds} seconds`;
            selectSql = `SELECT time_bucket(INTERVAL '${interval}', ts) as ts, FIRST(open) as open, MAX(high) as high, MIN(low) as low, LAST(close) as close, CAST(SUM(volume) AS DOUBLE) as volume FROM ohlcv ${where} GROUP BY time_bucket(INTERVAL '${interval}', ts) ORDER BY 1 ASC`;
          }
        }

        const dataFile = path.join(tmpDir, `${sym}.parquet`).replace(/\\/g, "/");
        await marketQuery(`COPY (${selectSql}) TO '${dataFile}' (FORMAT PARQUET)`);
        exportedSymbols.push(sym);
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

// ─── SSE Stream (GET — reconnectable, replays buffered events) ──────────────

router.get("/regime/train/stream/:modelId", (req: Request, res: Response) => {
  const modelId = String(req.params.modelId);
  const job = activeJobs.get(modelId);

  if (!job) {
    return res.status(404).json({ error: `No training job for ${modelId}` });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (evt: TrainingEvent) => {
    try { res.write(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`); } catch { /* dead */ }
  };

  // Replay all buffered events so client catches up
  const fromIdx = parseInt(req.query.from as string) || 0;
  for (let i = fromIdx; i < job.events.length; i++) {
    send(job.events[i]);
  }
  res.write(`event: caught_up\ndata: ${JSON.stringify({ eventCount: job.events.length })}\n\n`);

  if (job.finished) {
    res.end();
    return;
  }

  // Subscribe to live events — close stream on terminal events so client can exit
  const listener = (evt: TrainingEvent) => {
    send(evt);
    if (evt.event === 'done' || evt.event === 'error') {
      job.listeners.delete(listener);
      try { res.end(); } catch { /* already closed */ }
    }
  };
  job.listeners.add(listener);

  // On disconnect: remove listener but DON'T kill the training
  req.on("close", () => {
    job.listeners.delete(listener);
    console.log(`[regime] SSE client disconnected from ${modelId} (training continues, ${job.listeners.size} listeners remain)`);
  });
});

// ─── Stop training ───────────────────────────────────────────────────────────

router.post("/regime/train/stop", async (req: Request, res: Response) => {
  try {
    const { symbol, timeframe } = req.body;
    const modelId = `${(symbol || "ES").toUpperCase()}_${timeframe || "30m"}`;

    const job = activeJobs.get(modelId);
    if (!job) {
      return res.status(404).json({ error: `No active training for ${modelId}` });
    }

    job.child.kill("SIGTERM");
    emitEvent(job, "error", { message: "Training stopped by user" });
    job.finished = true;
    job.exitCode = -1;
    setTimeout(() => activeJobs.delete(modelId), 10000);

    res.json({ message: `Stopped training ${modelId}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Training status ─────────────────────────────────────────────────────────

router.get("/regime/train/status", async (_req: Request, res: Response) => {
  const active: Array<{ modelId: string; elapsed: number; finished: boolean; eventCount: number }> = [];
  activeJobs.forEach((job, id) => {
    active.push({
      modelId: id,
      elapsed: (Date.now() - job.startedAt) / 1000,
      finished: job.finished,
      eventCount: job.events.length,
    });
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
