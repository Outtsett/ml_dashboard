/**
 * The Lens training environment's data source.
 *
 * A training run in the quant workspace writes an append-only `stream.jsonl`
 * plus parquet snapshots to `model/data/training_runs/<run>/`. This serves that
 * directory: the event stream as JSON, and any snapshot as rows read through
 * DuckDB.
 *
 * Why a file directory and not the SSE training bus
 * -------------------------------------------------
 * `/api/training/stream/:modelId` carries a live session and drops it when the
 * process ends. The pipeline view has to answer questions about a run that
 * finished yesterday — what did layer 3 look like at epoch 7 — so it reads the
 * artefacts the run left behind. Live and historical then use one code path, and
 * a page opened mid-run and a page opened afterwards render identically.
 *
 * Parquet, not numpy, because the consumer is this server: DuckDB reads parquet
 * natively and reading an .npz would mean spawning Python per request.
 */
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { queryQuestDB } from "../infrastructure/database/questdb";
import { logInfo } from "../infrastructure/lib/log";

const router = Router();

/** Where the quant workspace's training runs land. */
const RUNS_ROOT = process.env.TRAINING_RUNS_ROOT
  ?? "E:/source/repos/ml_dashboard/Trading/quant/model/data/training_runs";
const QUANT_ROOT = process.env.QUANT_ROOT ?? "E:/source/repos/ml_dashboard/Trading/quant";
const QUANT_PYTHON = path.join(QUANT_ROOT, ".venv", "Scripts", "python.exe");
const TRAINER = path.join("scripts", "train_multimodal_direction.py");

/**
 * A run name reaches the filesystem, so it is restricted to the shape the writer
 * produces rather than sanitised. Anything with a separator or a dot segment is
 * rejected outright — there is no legitimate run name containing one, so a value
 * that does is a traversal attempt.
 */
const RUN_NAME = /^[A-Za-z0-9_\-]+$/;
const SNAPSHOT_NAME = /^[A-Za-z0-9_\-]+\.parquet$/;

function runDirectory(run: string): string | null {
  if (!RUN_NAME.test(run)) return null;
  const directory = path.join(RUNS_ROOT, run);
  if (!fs.existsSync(path.join(directory, "stream.jsonl"))) return null;
  return directory;
}

interface StreamEvent { type: string; [key: string]: unknown }

/** Every complete line. A half-written final line is the writer mid-flush. */
function readStream(directory: string): StreamEvent[] {
  const raw = fs.readFileSync(path.join(directory, "stream.jsonl"), "utf-8");
  const events: StreamEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as StreamEvent);
    } catch {
      break; // partial tail; everything before it is complete
    }
  }
  return events;
}

/** GET /api/lens/training/runs — every run that has written a stream. */
router.get("/lens/training/runs", (_req: Request, res: Response) => {
  if (!fs.existsSync(RUNS_ROOT)) return res.json({ runs: [], root: RUNS_ROOT });

  const runs = fs.readdirSync(RUNS_ROOT)
    .filter(name => RUN_NAME.test(name)
      && fs.existsSync(path.join(RUNS_ROOT, name, "stream.jsonl")))
    .map(name => {
      const streamPath = path.join(RUNS_ROOT, name, "stream.jsonl");
      const events = readStream(path.join(RUNS_ROOT, name));
      const started = events.find(e => e.type === "run_started");
      const finished = events.find(e => e.type === "run_finished");
      const epochs = events.filter(e => e.type === "epoch");
      const last = epochs[epochs.length - 1] as
        { epoch?: number; epochs?: number; metrics?: Record<string, number> } | undefined;
      return {
        run: name,
        modifiedAt: fs.statSync(streamPath).mtime.toISOString(),
        status: finished ? "finished" : epochs.length > 0 ? "running" : "starting",
        config: (started?.config ?? {}) as Record<string, unknown>,
        epoch: last?.epoch ?? 0,
        epochs: last?.epochs ?? 0,
        metrics: last?.metrics ?? {},
        finalMetrics: (finished?.metrics ?? null) as Record<string, number> | null,
        eventCount: events.length,
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  res.json({ runs, root: RUNS_ROOT });
});

/**
 * GET /api/lens/training/runs/:run — the whole event stream.
 *
 * `?after=N` returns only events past index N, which is what a polling client
 * wants: a run at epoch 40 has a few hundred events and re-sending all of them
 * every two seconds is wasteful when three are new.
 */
router.get("/lens/training/runs/:run", (req: Request, res: Response) => {
  const directory = runDirectory(String(req.params.run));
  if (!directory) return res.status(404).json({ error: `No run '${req.params.run}'` });

  const events = readStream(directory);
  const after = Number(req.query.after);
  const from = Number.isFinite(after) && after >= 0 ? Math.floor(after) : 0;
  res.json({
    run: req.params.run,
    total: events.length,
    from,
    events: events.slice(from),
  });
});

/**
 * GET /api/lens/training/runs/:run/snapshot/:file — one parquet snapshot.
 *
 * Long format (`array_name`, `row_index`, `column_index`, `value`) whatever the
 * a 5-feature block and a 64-unit layer come back through the same reader. A
 * row cap is applied because a layer snapshot is 35 layers x 32 x 32 and the
 * browser does not need all of it to draw a heatmap.
 */
router.get("/lens/training/runs/:run/snapshot/:file", async (req: Request, res: Response) => {
  const directory = runDirectory(String(req.params.run));
  if (!directory) return res.status(404).json({ error: `No run '${req.params.run}'` });

  const file = String(req.params.file);
  if (!SNAPSHOT_NAME.test(file)) {
    return res.status(400).json({ error: `Invalid snapshot name '${file}'` });
  }
  const target = path.join(directory, file);
  if (!fs.existsSync(target)) {
    return res.status(404).json({ error: `No snapshot '${file}' in run '${req.params.run}'` });
  }

  const array = typeof req.query.array === "string" && /^[A-Za-z0-9_]+$/.test(req.query.array)
    ? req.query.array : null;
  const limit = Math.min(Number(req.query.limit) || 60_000, 200_000);
  const escaped = target.replace(/\\/g, "/").replace(/'/g, "''");

  try {
    const columns = await queryQuestDB<{ column_name: string }>(
      `DESCRIBE SELECT * FROM read_parquet('${escaped}') LIMIT 1`);
    const names = columns.map(c => String((c as unknown as { column_name: string }).column_name));
    const isLong = names.includes("array_name") && names.includes("row_index")
      && names.includes("value");

    const where = isLong && array ? `WHERE array_name = '${array}'` : "";
    const rows = await queryQuestDB(
      `SELECT * FROM read_parquet('${escaped}') ${where} LIMIT ${limit}`);
    res.json({ file, format: isLong ? "long" : "wide", columns: names, rowCount: rows.length, rows });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/lens/training/start — the run button.
 *
 * Spawns the trainer detached from this request: an HTTP handler that waits for
 * a training run is a handler that times out. The response carries the run name,
 * and the client then polls the stream that run is writing — the same path it
 * uses for a run started from a terminal, so there is one way to watch a run
 * rather than two.
 */
router.post("/lens/training/start", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const symbol = String(body.symbol ?? "MNQ");
  const timeframe = String(body.timeframe ?? "1h");
  if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(symbol)) {
    return res.status(400).json({ error: `Invalid symbol '${symbol}'` });
  }
  if (!/^[0-9]+[smhdw]$/.test(timeframe)) {
    return res.status(400).json({ error: `Invalid timeframe '${timeframe}'` });
  }

  // Every numeric knob is bounded. These become process arguments, so an
  // unbounded epoch count is a request that pins a GPU until someone notices.
  const numeric = (name: string, fallback: number, low: number, high: number): number => {
    const value = Number(body[name]);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.floor(value), low), high);
  };
  const epochs = numeric("epochs", 15, 1, 500);
  const maxBars = numeric("maxBars", 40_000, 1_000, 2_000_000);
  const horizon = numeric("horizon", 12, 1, 500);
  const window = numeric("window", 32, 4, 256);
  const barrierPoints = Math.min(Math.max(Number(body.barrierPoints) || 25, 0.25), 500);

  const args = [
    TRAINER,
    "--symbol", symbol,
    "--timeframe", timeframe,
    "--max-bars", String(maxBars),
    "--epochs", String(epochs),
    "--horizon", String(horizon),
    "--window", String(window),
    "--barrier-points", String(barrierPoints),
  ];

  const child = spawn(QUANT_PYTHON, args, {
    cwd: path.join(QUANT_ROOT, "model"),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  child.unref();

  const run = `multimodal_${symbol}_${timeframe}`;
  logInfo(`[lens] training started: ${run} (pid ${child.pid}) — ${args.join(" ")}`);
  res.status(202).json({
    run, pid: child.pid ?? null,
    command: `${QUANT_PYTHON} ${args.join(" ")}`,
    arguments: { symbol, timeframe, maxBars, epochs, horizon, window, barrierPoints },
  });
});

export default router;
