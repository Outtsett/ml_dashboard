/**
 * Training Routes
 *
 * Model-agnostic training API. Works with any model type registered in config/models.json.
 * Uses NestJS services via bridge pattern (getNestApp()).
 *
 * Routes:
 *   GET  /api/training/config           — Model registry + feature pipelines for UI
 *   POST /api/training/start            — Start training (any model type)
 *   GET  /api/training/stream/:modelId  — SSE stream (standardized events, reconnectable)
 *   GET  /api/training/status           — List active training jobs
 *   POST /api/training/stop/:modelId    — Stop a training job
 *   POST /api/training/control/:modelId — Model Cycle pause/resume/pace/stop (stdin)
 *   GET  /api/training/cycle            — Recently tracked Model Cycle runs
 *   GET  /api/training/cycle/:modelId   — Model Cycle snapshot (panel/chart rebuild)
 *
 * Model CRUD:
 *   GET    /api/training/models                    — List all trained models
 *   GET    /api/training/models/:id/diagnostics    — Diagnostics JSON
 *   GET    /api/training/models/:id/convergence    — Convergence JSON
 *   GET    /api/training/models/:id/assignments    — Per-bar regime assignments + OHLCV
 *   GET    /api/training/models/:id/benchmarks     — Buy-and-hold + SMA crossover benchmarks
 *   DELETE /api/training/models/:id                — Delete a model
 *   GET    /api/training/history                   — Quality score history (degradation tracking)
 */

import { Router, Request, Response } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { db } from "../infrastructure/database/sqlite";
import { trainingTelemetry, insertTrainingTelemetrySchema } from "@shared/schema";
import { eq } from "drizzle-orm";
import { CACHE_SEMI } from "../infrastructure/cache/headers";
import { getNestApp } from "../infrastructure/lib/nest-context";
import { mlRateLimiter } from "../infrastructure/lib/rateLimiter";
import { TrainingService } from "./training.service";
import { RegistryService } from "./registry.service";
import { ensureCycleAccumulator, getCycleSnapshot, listCycleRuns } from "./cycle";
import { listArchivedCycleRuns, loadArchivedCycleSnapshot } from "./cycleArchive";
import { loadCycleReport } from "./cycleReport";
import { cycleControlSchema } from "@shared/cycle/schema";
import type { TrainingRequest, TrainingEvent } from "@shared/trainingTypes";
import { lakeHttpQuery } from "../infrastructure/database/lake/httpQuery";
import { validateSymbol } from "@shared/pg_schema";
import {
  sanitizeModelId,
  listTrainedModels,
  getModelDiagnostics,
  getModelConvergence,
  getModelAssignments,
  getModelShap,
  getModelBenchmarks,
  deleteModel,
} from "../infrastructure/lib/modelResults";
import * as trainingStorage from "../infrastructure/storage/trainingStorage";
import { logInfo } from "../infrastructure/lib/log";

// Parser -> storage wiring. Every parsed training event is republished on the
// domain event bus by `emitSessionEvent`; the recorder subscribes there and
// persists metrics to `run_metrics` / `training_metrics` / `loss_history` and
// rolls progress into the `training_sessions` row. Attaching it at module load
// means persistence is live before the first `POST /training/start` can run,
// and the call is idempotent.
trainingStorage.ensureTrainingMetricRecorder();

// Model Cycle accumulator — the second, independent subscriber to the same
// domain event bus, folding `cycle_*` (and log/done/error) events into a
// per-run `CycleSnapshot`. Same idempotent, attach-at-module-load pattern.
ensureCycleAccumulator();

// ─── Zod schema for request validation (DIP — route depends on schema, not manual field copying) ──

/** ISO date: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS */
const isoDatePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/;

const VALID_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;

const trainingRequestSchema = z.object({
  modelType: z.string().min(1, "modelType is required").max(64),
  symbol: z.string().min(1, "symbol is required").max(20)
    .regex(/^[A-Z][A-Z0-9_\-\/]{0,19}$/, "Invalid symbol format"),
  timeframe: z.enum(VALID_TIMEFRAMES).optional(),
  dateRange: z.object({
    start: z.string().regex(isoDatePattern, "dateRange.start must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS"),
    end: z.string().regex(isoDatePattern, "dateRange.end must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS"),
  }).optional(),
  // Allow string values for backward compat, but restrict to safe characters.
  // Empty and comma-separated values are allowed: the Model Cycle sends
  // `tuning_pinned_parameters` as "" or "max_depth,learning_rate", and the
  // runner spawns with an argument array, never a shell.
  hyperparameters: z.record(z.union([
    z.number(),
    z.string().max(100).regex(/^[a-zA-Z0-9_.,\-]*$/, "Unsafe hyperparameter value"),
    z.boolean(),
  ])).optional(),
  maxBars: z.number().int().min(0).max(10000000).optional(),
  featureCategories: z.array(z.string().max(50).regex(/^[a-z_]+$/, "Invalid category name")).optional(),
  includeIndicators: z.boolean().optional(),
  allFeatures: z.boolean().optional(),
  indicatorGroups: z.string().max(200).regex(/^[a-zA-Z0-9_,]+$/, "Invalid indicator group format").optional(),
  walkForward: z.object({
    trainMonths: z.number().int().min(1).max(120),
    testMonths: z.number().int().min(1).max(60),
    stepMonths: z.number().int().min(1).max(120).optional(),
  }).optional(),
  labelSetId: z.number().int().positive().optional(),
}) satisfies z.ZodType<TrainingRequest>;

const router = Router();

// ─── Config (for client UI) ─────────────────────────────────────────────────

router.get("/training/config", CACHE_SEMI, (_req: Request, res: Response) => {
  try {
    const registry = getNestApp().get(RegistryService);
    res.json(registry.getClientConfig());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/training/config/reload", (_req: Request, res: Response) => {
  try {
    const registry = getNestApp().get(RegistryService);
    registry.reload();
    res.json(registry.getClientConfig());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Data Preview (P4 — ML Studio Stage 1) ─────────────────────────────────

/**
 * Map a UI timeframe to its lake source table.
 * 1m..30m + 4h..1w → ohlcv_<tf> mat view.
 * 1h → ohlcv_1h_v (the 1h view; ohlcv_1h is a crypto-only legacy table).
 */
const TF_TO_TABLE: Record<string, string> = {
  "1m": "ohlcv_1m",
  "5m": "ohlcv_5m",
  "15m": "ohlcv_15m",
  "30m": "ohlcv_30m",
  "1h": "ohlcv_1h_v",
  "4h": "ohlcv_4h",
  "1d": "ohlcv_1d",
  "1w": "ohlcv_1w",
};

const dataPreviewQuerySchema = z.object({
  symbol: z.string().min(1).max(20).regex(/^[A-Z][A-Z0-9_\-\/]{0,19}$/, "Invalid symbol format"),
  timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]),
  start: z.string().regex(isoDatePattern, "start must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS").optional(),
  end: z.string().regex(isoDatePattern, "end must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS").optional(),
});

interface DataPreviewResponse {
  symbol: string;
  timeframe: string;
  table: string;
  totalBars: number;
  firstTs: string | null;
  lastTs: string | null;
  spanDays: number | null;
  nullCount: number;
  ohlcAnyNullCount: number;
  zeroVolumeCount: number;
  expectedBars: number | null;
  coverageRatio: number | null;
  dateRange: { start: string; end: string } | null;
}

/**
 * GET /api/training/data-preview?symbol=MNQ&timeframe=1m[&start=YYYY-MM-DD&end=YYYY-MM-DD]
 *
 * Returns total bars, span, null counts, and an "expected vs actual" coverage ratio
 * for the (symbol, timeframe, dateRange) tuple. ML Studio Stage 1 calls this so
 * the user knows exactly what they're feeding the trainer before launching.
 *
 * For futures roots (MNQ, ES, etc.) this reports rows across all expirations the
 * mat view has aggregated. Front-month stitching for ML training happens in the
 * Python data loader — this endpoint is data-availability summary, not bar
 * selection.
 */
router.get("/training/data-preview", CACHE_SEMI, async (req: Request, res: Response) => {
  try {
    const parsed = dataPreviewQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message).join(", ");
      return res.status(400).json({ error: errors });
    }
    const { symbol, timeframe, start, end } = parsed.data;
    const safeSymbol = validateSymbol(symbol);
    const table = TF_TO_TABLE[timeframe];
    if (!table) {
      return res.status(400).json({ error: `Unsupported timeframe: ${timeframe}` });
    }

    const whereParts: string[] = [`root = '${safeSymbol.replace(/'/g, "''")}'`];
    if (start) whereParts.push(`timestamp >= '${start}'`);
    if (end) whereParts.push(`timestamp <= '${end}'`);
    const whereClause = `WHERE ${whereParts.join(" AND ")}`;

    // Single round-trip aggregate. The per-timeframe views may have null OHLC
    // where the base ohlcv had a gap inside the bucket (rare but possible after
    // data backfills); count those distinctly from "missing close" alone.
    // count() was lake's spelling; DuckDB requires the argument.
    const sql = `
      SELECT
        count(*) AS totalBars,
        min(timestamp) AS firstTs,
        max(timestamp) AS lastTs,
        sum(CASE WHEN close IS NULL THEN 1 ELSE 0 END) AS nullCount,
        sum(CASE WHEN open IS NULL OR high IS NULL OR low IS NULL OR close IS NULL THEN 1 ELSE 0 END) AS ohlcAnyNullCount,
        sum(CASE WHEN volume = 0 THEN 1 ELSE 0 END) AS zeroVolumeCount
      FROM ${table}
      ${whereClause}
    `;

    type AggRow = {
      totalBars: number;
      firstTs: string | null;
      lastTs: string | null;
      nullCount: number;
      ohlcAnyNullCount: number;
      zeroVolumeCount: number;
    };
    const rows = await lakeHttpQuery<AggRow>(sql);
    const agg = rows[0];

    if (!agg || Number(agg.totalBars) === 0) {
      const empty: DataPreviewResponse = {
        symbol: safeSymbol,
        timeframe,
        table,
        totalBars: 0,
        firstTs: null,
        lastTs: null,
        spanDays: null,
        nullCount: 0,
        ohlcAnyNullCount: 0,
        zeroVolumeCount: 0,
        expectedBars: null,
        coverageRatio: null,
        dateRange: start && end ? { start, end } : null,
      };
      return res.json(empty);
    }

    const totalBars = Number(agg.totalBars);
    const firstTsMs = agg.firstTs ? Date.parse(agg.firstTs as string) : null;
    const lastTsMs = agg.lastTs ? Date.parse(agg.lastTs as string) : null;
    const spanDays =
      firstTsMs != null && lastTsMs != null
        ? Math.max(0, Math.round((lastTsMs - firstTsMs) / 86400000))
        : null;

    // Compute "expected" bars to sense-check coverage. For 24/5 markets a 1m bar
    // every minute over `spanDays` business days would yield ≈ spanDays*5*24*60/7
    // bars, but accuracy varies by asset and session — we approximate with
    // `spanSeconds / tfSeconds`. Anything > 0.9 ratio is "looks fine".
    const tfSeconds: Record<string, number> = {
      "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
      "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800,
    };
    let expectedBars: number | null = null;
    let coverageRatio: number | null = null;
    if (firstTsMs != null && lastTsMs != null) {
      const spanSeconds = (lastTsMs - firstTsMs) / 1000;
      // Adjust expected for futures / forex weekend gaps: ≈ 5/7 trading days at sub-daily TFs.
      const isSubDaily = tfSeconds[timeframe] != null && tfSeconds[timeframe]! < 86400;
      const sessionFactor = isSubDaily ? (5 / 7) : 1;
      expectedBars = Math.max(1, Math.round((spanSeconds * sessionFactor) / tfSeconds[timeframe]!));
      coverageRatio = Math.min(1, totalBars / expectedBars);
    }

    const out: DataPreviewResponse = {
      symbol: safeSymbol,
      timeframe,
      table,
      totalBars,
      firstTs: agg.firstTs as string | null,
      lastTs: agg.lastTs as string | null,
      spanDays,
      nullCount: Number(agg.nullCount ?? 0),
      ohlcAnyNullCount: Number(agg.ohlcAnyNullCount ?? 0),
      zeroVolumeCount: Number(agg.zeroVolumeCount ?? 0),
      expectedBars,
      coverageRatio,
      dateRange: start && end ? { start, end } : null,
    };

    res.json(out);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Features Preview (P4 — ML Studio Stage 2) ────────────────────────────

const featurePreviewBodySchema = z.object({
  symbol: z.string().min(1).max(20).regex(/^[A-Z][A-Z0-9_\-\/]{0,19}$/, "Invalid symbol format"),
  timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]),
  // Pipeline ids come from packages/config/features.json `pipelines` section.
  // Restrict charset to lowercase + hyphen + underscore so we can pass it
  // through to the spawned Python without escaping concerns.
  pipelineId: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_\-]*$/, "Invalid pipelineId format"),
  // Default 50k bars — enough for stable correlation estimates without
  // saturating the loader on 1m timeframes (1.7M+ rows on MNQ).
  sampleBars: z.number().int().min(500).max(500_000).optional(),
  start: z.string().regex(isoDatePattern).optional(),
  end: z.string().regex(isoDatePattern).optional(),
  redundancyThreshold: z.number().min(0.5).max(0.9999).optional(),
});

type FeaturePreviewBody = z.infer<typeof featurePreviewBodySchema>;

interface FeaturePreviewResponse {
  success: boolean;
  symbol?: string;
  timeframe?: string;
  pipelineId?: string;
  rawBars?: number;
  sampleSize?: number;
  finiteRows?: number;
  featureCount?: number;
  featureNames?: string[];
  stats?: Array<{
    name: string;
    mean: number | null;
    std: number | null;
    skew: number | null;
    kurt: number | null;
    finiteRatio: number;
    p1: number | null;
    p99: number | null;
  }>;
  meanAbsCorr?: number;
  maxAbsCorr?: number;
  correlationMatrix?: number[][];
  redundantPairs?: Array<{ a: string; b: string; corr: number }>;
  redundancyThreshold?: number;
  timings?: { loadSec: number; computeSec: number; totalSec: number };
  error?: string;
}

/**
 * Resolve the Python interpreter for the script. Order:
 *   1. PYTHON_BIN env var (explicit override)
 *   2. ML_PYTHON env var (alternate name some scripts use)
 *   3. `python` on PATH (works under conda `ml` env auto-activation)
 */
function resolvePythonExecutable(): string {
  return process.env.PYTHON_BIN || process.env.ML_PYTHON || "python";
}

/**
 * Spawn the Python preview script and return the parsed JSON result.
 *
 * The script writes protocol JSONL events (logs / progress) to stdout
 * BEFORE the final result line; we scan all lines for the one carrying a
 * `"success"` key. stderr is captured for error diagnosis.
 */
async function runFeaturesPreview(
  body: FeaturePreviewBody,
): Promise<FeaturePreviewResponse> {
  const repoRoot = process.cwd();
  const scriptPath = path.resolve(repoRoot, "scripts", "preview_features.py");
  const sampleBars = body.sampleBars ?? 50_000;
  const args = [
    scriptPath,
    "--symbol", body.symbol,
    "--timeframe", body.timeframe,
    "--pipeline-id", body.pipelineId,
    "--max-bars", String(sampleBars),
  ];
  if (body.start && body.end) {
    args.push("--start", body.start, "--end", body.end);
  }
  if (typeof body.redundancyThreshold === "number") {
    args.push("--redundancy-threshold", String(body.redundancyThreshold));
  }

  return new Promise<FeaturePreviewResponse>((resolve) => {
    const py = spawn(resolvePythonExecutable(), args, {
      cwd: repoRoot,
      env: process.env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;

    // Numba cold-start + 50k bars is ~6-8s; cap generously at 90s to absorb
    // lake query latency on cold cache.
    const timer = setTimeout(() => {
      killedByTimeout = true;
      py.kill("SIGKILL");
    }, 90_000);

    py.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    py.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });

    py.on("close", (code) => {
      clearTimeout(timer);

      if (killedByTimeout) {
        return resolve({
          success: false,
          error: "Features preview timed out (>90s). Lower sampleBars or narrow the date range.",
        });
      }

      // The result line is the last stdout line that parses as JSON and has a
      // `success` key. Prior lines are protocol JSONL events from the loader.
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!;
        if (!line.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed.success === "boolean") {
            return resolve(parsed as FeaturePreviewResponse);
          }
        } catch {
          // not JSON — keep scanning earlier lines
        }
      }

      // Fall through — script crashed before emitting a result line.
      resolve({
        success: false,
        error: `Features preview process exited (code=${code}) without a result. stderr: ${stderr.slice(0, 500)}`,
      });
    });

    py.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        error: `Failed to spawn Python: ${err.message}`,
      });
    });
  });
}

/**
 * POST /api/training/features/preview
 *
 * Body: { symbol, timeframe, pipelineId, sampleBars?, start?, end?, redundancyThreshold? }
 *
 * Spawns the preview script, parses its JSON output, returns full diagnostic
 * shape (per-feature stats + correlation matrix + redundant pairs). Used by
 * ML Studio Stage 2 to surface mean/max-abs corr + collapse warnings before
 * a training run.
 */
router.post("/training/features/preview", mlRateLimiter, async (req: Request, res: Response) => {
  const parsed = featurePreviewBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => i.message).join(", ");
    return res.status(400).json({ success: false, error: errors });
  }
  const body = parsed.data;
  if ((body.start && !body.end) || (body.end && !body.start)) {
    return res.status(400).json({
      success: false,
      error: "Both start and end must be provided together (or neither).",
    });
  }

  try {
    const result = await runFeaturesPreview(body);
    if (!result.success) {
      // Surface the script's error verbatim but with 4xx since most failures
      // are user-input issues (unknown symbol, no data in window, etc.).
      return res.status(422).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error)?.message ?? String(err) });
  }
});

// ─── Metric Descriptions (config-driven metric annotations for UI) ──────────

router.get("/training/metric-descriptions", CACHE_SEMI, async (_req: Request, res: Response) => {
  try {
    const configPath = path.resolve(process.cwd(), "packages", "config", "metric-descriptions.json");
    const raw = await fs.promises.readFile(configPath, "utf-8");
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Start Training ──────────────────────────────────────────────────────────

router.post("/training/start", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    // Validate + parse request body via Zod schema (DIP — single source of truth)
    const parseResult = trainingRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map(i => i.message).join(", ");
      return res.status(400).json({ error: errors });
    }
    const request: TrainingRequest = parseResult.data;

    const training = getNestApp().get(TrainingService);
    const result = await training.start(request);
    res.status(202).json({
      ...result,
      message: `Training started for ${result.modelId} (${request.modelType})`,
    });
  } catch (err) {
    const status = (err as Error).message.includes("Already training") ? 409
      : (err as Error).message.includes("Maximum concurrent") ? 429
      : (err as Error).message.includes("Unknown model") ? 400
      : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// ─── SSE Stream (reconnectable, replays buffered events) ─────────────────────

router.get("/training/stream/:modelId", (req: Request, res: Response) => {
  const modelId = String(req.params.modelId);
  const training = getNestApp().get(TrainingService);
  const session = training.getSession(modelId);

  if (!session) {
    return res.status(404).json({ error: `No training session for ${modelId}` });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (evt: TrainingEvent) => {
    try {
      res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`);
    } catch { /* dead connection */ }
  };

  // Comment-only heartbeat: keeps intermediate proxies/idle-timeout layers
  // from dropping a quiet Model Cycle connection (a paced replay can sit
  // between bars for seconds at a time). Comment lines are invisible to
  // EventSource's `message`/named-event listeners.
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch { /* dead connection */ }
  }, 15_000);

  // Replay buffered events so reconnecting client catches up
  const fromIdx = parseInt(req.query.from as string) || 0;
  for (let i = fromIdx; i < session.events.length; i++) {
    send(session.events[i]!);
  }
  res.write(`event: caught_up\ndata: ${JSON.stringify({ eventCount: session.events.length })}\n\n`);

  // If already finished, close stream
  if (session.finished) {
    clearInterval(heartbeat);
    res.end();
    return;
  }

  // Subscribe to live events
  const listener = (evt: TrainingEvent) => {
    send(evt);
    if (evt.type === "done" || evt.type === "error") {
      session.listeners.delete(listener);
      clearInterval(heartbeat);
      try { res.end(); } catch { /* already closed */ }
    }
  };
  session.listeners.add(listener);

  // On disconnect: remove listener but don't kill training
  req.on("close", () => {
    session.listeners.delete(listener);
    clearInterval(heartbeat);
    logInfo(`[training] SSE client disconnected from ${modelId} (training continues, ${session.listeners.size} listeners remain)`);
  });
});

// ─── Status ──────────────────────────────────────────────────────────────────

router.get("/training/status", (_req: Request, res: Response) => {
  const training = getNestApp().get(TrainingService);
  res.json({ sessions: training.listSessions() });
});

// ─── Stop Training ───────────────────────────────────────────────────────────

router.post("/training/stop/:modelId", (req: Request, res: Response) => {
  const modelId = String(req.params.modelId);
  const training = getNestApp().get(TrainingService);
  const stopped = training.stop(modelId);

  if (stopped) {
    res.json({ message: `Stopped training ${modelId}` });
  } else {
    res.status(404).json({ error: `No active training for ${modelId}` });
  }
});

// ─── Model Cycle control (pause / resume / pace / stop, via stdin) ──────────
//
// The hard stop (`POST /training/stop/:modelId` above) stays as the
// fallback — it kills the process tree. This is the graceful path: the
// engine closes the open trade at the current bar, writes artifacts and
// emits `done` before exiting on its own.

router.post("/training/control/:modelId", (req: Request, res: Response) => {
  const modelId = String(req.params.modelId);
  const parseResult = cycleControlSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues.map((i) => i.message).join(", ") });
  }

  const training = getNestApp().get(TrainingService);
  const outcome = training.control(modelId, parseResult.data);

  if (outcome === "delivered") {
    res.status(202).json({ delivered: true });
  } else if (outcome === "no_session") {
    res.status(404).json({ error: `No active training session for ${modelId}` });
  } else {
    res.status(409).json({ error: `${modelId}'s runner does not accept live control commands` });
  }
});

// ─── Model Cycle runs (panel/chart rebuild source after a reload) ──────────

router.get("/training/cycle", async (_req: Request, res: Response) => {
  // the live accumulator's runs first, then every run the lake holds (deduped by id), newest first
  const live = listCycleRuns();
  const seen = new Set(live.map((run) => run.modelId));
  let archived: Awaited<ReturnType<typeof listArchivedCycleRuns>> = [];
  try {
    archived = await listArchivedCycleRuns(200);
  } catch (error) {
    console.warn(`[cycle] archived runs unavailable: ${String(error)}`);
  }
  res.json([...live, ...archived.filter((run) => !seen.has(run.modelId))].sort((a, b) => b.startedAt - a.startedAt));
});

router.get("/training/cycle/:modelId", async (req: Request, res: Response) => {
  const modelId = String(req.params.modelId);
  const snapshot = getCycleSnapshot(modelId);
  if (snapshot) return res.json(snapshot);
  try {
    const archived = await loadArchivedCycleSnapshot(modelId);
    if (archived) return res.json(archived);
  } catch (error) {
    console.warn(`[cycle] could not rebuild ${modelId} from the lake: ${String(error)}`);
  }
  return res.status(404).json({ error: `No Model Cycle run tracked or archived for ${modelId}` });
});

// The run's in-depth metric tables (cycle/report.py), read from the lake; a live run's
// tables appear fold by fold as each fold's record lands.
router.get("/training/cycle/:modelId/metrics", async (req: Request, res: Response) => {
  const modelId = String(req.params.modelId);
  try {
    const report = await loadCycleReport(modelId);
    if (report) return res.json(report);
  } catch (error) {
    console.warn(`[cycle] could not read the metric tables of ${modelId}: ${String(error)}`);
    return res.status(500).json({ error: `The metric tables of ${modelId} could not be read: ${String(error)}` });
  }
  return res.status(404).json({ error: `No metric tables in the lake for ${modelId} yet` });
});

// ═══════════════════════════════════════════════════════════════════════════
// Model CRUD (replaces legacy /api/regime/models, diagnostics, etc.)
// ═══════════════════════════════════════════════════════════════════════════

const MODELS_DIR = path.join(process.cwd(), "data", "models");

// ─── List trained models ─────────────────────────────────────────────────────

router.get("/training/models", (_req: Request, res: Response) => {
  try {
    res.json({ models: listTrainedModels(MODELS_DIR) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Diagnostics ─────────────────────────────────────────────────────────────

router.get("/training/models/:id/diagnostics", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const diag = getModelDiagnostics(MODELS_DIR, id);
    if (!diag) return res.status(404).json({ error: `Model '${id}' not found` });
    res.json(diag);
  } catch (err) {
    const status = (err as Error).message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// ─── Convergence ─────────────────────────────────────────────────────────────

router.get("/training/models/:id/convergence", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const conv = getModelConvergence(MODELS_DIR, id);
    if (!conv) return res.status(404).json({ error: `Convergence data for '${id}' not found` });
    res.json(conv);
  } catch (err) {
    const status = (err as Error).message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// ─── Assignments (stored in model checkpoint JSON) ──────────────────────────

router.get("/training/models/:id/assignments", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const result = await getModelAssignments(MODELS_DIR, id, {
      limit: Math.min(Number(req.query.limit) || 10000, 10000),
      offset: Number(req.query.offset) || undefined,
    });
    if (!result) return res.status(404).json({ error: `Assignments not found for '${id}'` });
    res.json(result);
  } catch (err) {
    const status = (err as Error).message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// ─── SHAP values (per-bar feature importance) ───────────────────────────────

router.get("/training/models/:id/shap", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const result = await getModelShap(MODELS_DIR, id, {
      regime: req.query.regime !== undefined ? Number(req.query.regime) : undefined,
      limit: Math.min(Number(req.query.limit) || 10000, 10000),
      offset: Number(req.query.offset) || undefined,
    });
    if (!result) return res.status(404).json({ error: `SHAP data not found for '${id}'` });
    res.json(result);
  } catch (err) {
    const status = (err as Error).message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// ─── Benchmarks (buy-and-hold + SMA crossover comparison) ────────────────────

router.get("/training/models/:id/benchmarks", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const result = await getModelBenchmarks(MODELS_DIR, id);
    if (!result) return res.status(404).json({ error: "Benchmark data unavailable" });
    res.json(result);
  } catch (err) {
    const status = (err as Error).message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// ─── Model State Snapshots (live model introspection) ────────────────────────

router.get("/training/models/:id/model-state", (req: Request, res: Response) => {
  try {
    const id = sanitizeModelId(String(req.params.id));

    // Look up the training session for this model
    const session = trainingStorage.getSessionByVersionedId(id);
    if (!session) {
      return res.status(404).json({ error: `No training session found for model '${id}'` });
    }

    const snapshot = trainingStorage.getLatestModelStateSnapshot(session.id);
    if (!snapshot) {
      return res.status(404).json({ error: `No model state snapshot found for '${id}'` });
    }

    res.json({
      sessionId: session.id,
      iteration: snapshot.iteration,
      snapshot: JSON.parse(snapshot.snapshot),
    });
  } catch (err) {
    const status = (err as Error).message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// ─── Delete model ────────────────────────────────────────────────────────────

router.delete("/training/models/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const deleted = await deleteModel(MODELS_DIR, id);
    if (!deleted) return res.status(404).json({ error: `Model '${id}' not found` });
    res.json({ message: `Deleted model '${id}'` });
  } catch (err) {
    const status = (err as Error).message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Persisted Sessions + Metrics + Evaluation (Phase 1 Analytics)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Persisted Sessions ──────────────────────────────────────────────────────

router.get("/training/sessions", (_req: Request, res: Response) => {
  try {
    const { symbol, modelType, status, limit } = _req.query;
    const sessions = trainingStorage.listSessions({
      symbol: symbol as string | undefined,
      modelType: modelType as string | undefined,
      status: status as string | undefined,
      limit: limit ? Math.min(Number(limit), 10000) : 50,
    });
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/training/sessions/:id", (req: Request, res: Response) => {
  try {
    const session = trainingStorage.getSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Quality History (degradation tracking) ─────────────────────────────────

router.get("/training/history", (req: Request, res: Response) => {
  try {
    const { symbol, modelType } = req.query;
    if (!symbol || !modelType) {
      return res.status(400).json({ error: "symbol and modelType query params required" });
    }
    const sessions = trainingStorage.getQualityHistory(
      String(symbol),
      String(modelType),
    );
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Per-Iteration Metrics ───────────────────────────────────────────────────

router.get("/training/sessions/:id/metrics", (req: Request, res: Response) => {
  try {
    const { metricName } = req.query;
    const metrics = trainingStorage.getMetrics(
      Number(req.params.id),
      metricName as string | undefined,
    );
    res.json({ metrics });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/training/sessions/:id/metrics/names", (req: Request, res: Response) => {
  try {
    const names = trainingStorage.getMetricNames(Number(req.params.id));
    res.json({ names });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Evaluation Results ──────────────────────────────────────────────────────

router.get("/training/sessions/:id/evaluation", (req: Request, res: Response) => {
  try {
    const { stage } = req.query;
    const results = trainingStorage.getEvaluations(
      Number(req.params.id),
      stage as string | undefined,
    );
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/training/sessions/:id/evaluation/summary", (req: Request, res: Response) => {
  try {
    const summary = trainingStorage.getEvaluationSummary(Number(req.params.id));
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Walk-Forward Group ──────────────────────────────────────────────────────

router.get("/training/walk-forward/:groupId", (req: Request, res: Response) => {
  try {
    const windows = trainingStorage.getWalkForwardGroup(String(req.params.groupId));
    if (windows.length === 0) {
      return res.status(404).json({ error: "Walk-forward group not found" });
    }
    res.json({
      groupId: req.params.groupId,
      windows,
      totalWindows: windows.length,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Visualization Registry (config-driven component resolution — OCP)
// ═══════════════════════════════════════════════════════════════════════════

router.get("/training/visualizations", CACHE_SEMI, (_req: Request, res: Response) => {
  try {
    const configPath = path.join(process.cwd(), "packages", "config", "visualizations.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/training/visualizations/:category", CACHE_SEMI, (req: Request, res: Response) => {
  try {
    const configPath = path.join(process.cwd(), "packages", "config", "visualizations.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { category } = req.params;

    const universal: string[] = config.universal || [];
    let groupComponents: string[] = [];
    let conditional: Record<string, string[]> = {};

    for (const [, groupDef] of Object.entries(config.groups)) {
      const def = groupDef as { subcategories?: string[]; components?: string[]; conditional?: Record<string, string[]> };
      if (typeof category === "string" && def.subcategories?.includes(category)) {
        groupComponents = def.components || [];
        conditional = def.conditional || {};
        break;
      }
    }

    res.json({ universal, components: groupComponents, conditional });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});


// ─── Telemetry routes ──────────────────────────────────────────────────────────

router.post("/training/telemetry", async (req: Request, res: Response) => {
  try {
    const parseResult = insertTrainingTelemetrySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.issues.map(i => i.message).join(", ") });
    }
    await db.insert(trainingTelemetry).values(parseResult.data);
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/training/telemetry/:run_id", async (req: Request, res: Response) => {
  try {
    const runId = String(req.params.run_id);
    const telemetry = await db.select().from(trainingTelemetry).where(eq(trainingTelemetry.runId, runId)).orderBy(trainingTelemetry.epoch);
    res.json(telemetry);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;


