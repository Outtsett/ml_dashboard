/**
 * The run API: the four calls a client needs to launch a model and read how it
 * is doing. The `/training` page uses them, and so does a Claude session with
 * nothing but curl:
 *
 *   GET  /api/runs/models     every model that can be launched
 *   POST /api/runs            launch one; answers with the run id and its page
 *   GET  /api/runs            live and recorded runs, newest first
 *   GET  /api/runs/:id        the run's view: progress, metrics, verdicts, terminal
 *   POST /api/runs/:id/stop   stop it
 *
 * A thin layer over what already runs a Model Cycle (`TrainingService`, the
 * live accumulator in `cycle.ts`, the lake record in `cycleArchive.ts`); the
 * view itself is built by `@shared/runs/view`.
 */
import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";

import { getNestApp } from "../infrastructure/lib/nest-context";
import { mlRateLimiter } from "../infrastructure/lib/rateLimiter";
import { TrainingService } from "./training.service";
import { ensureCycleAccumulator, getCycleSnapshot, listCycleRuns } from "./cycle";
import { listArchivedCycleRuns, loadArchivedCycleSnapshot } from "./cycleArchive";
import { loadCycleReport } from "./cycleReport";
import { loadCycleRegistry } from "./cycleModels";
import { buildCycleModelsResponse, readCatalogSnapshot } from "./cycleModels.router";
import { buildRunView, type LogCursor, type RunReportTables } from "@shared/runs/view";
import type { RunListItem, RunnableModel, RunView, StartRunResponse } from "@shared/runs/types";
import { runName, runPurpose, runVersions } from "@shared/runs/naming";
import type { CycleLogLine, CycleLossSurface, CycleRunSummary, CycleSnapshot } from "@shared/cycle/schema";
import type { TrainingRequest } from "@shared/trainingTypes";

const router = Router();

const MODELS_DIR = path.join(process.cwd(), "data", "models");
const TERMINAL_FILE = "terminal.jsonl";

// The data window the Model Cycle form opens with; a launch that names none gets the same one.
const DEFAULT_SYMBOL = "MNQ";
const DEFAULT_TIMEFRAME = "5m";
const DEFAULT_DATE_START = "2025-08-01";
const DEFAULT_DATE_END = "2025-12-30";

const RUN_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates are YYYY-MM-DD");

const startRunSchema = z.object({
  model: z.string().min(1, "model is required").max(120),
  symbol: z.string().regex(/^[A-Z][A-Z0-9_\-/]{0,19}$/, "Invalid symbol format").optional(),
  timeframe: z.enum(RUN_TIMEFRAMES).optional(),
  dateStart: isoDate.optional(),
  dateEnd: isoDate.optional(),
  // keys are constrained like values; downstream, `resolveHyperparameters` keeps only the names the model declares
  parameters: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "Unsafe parameter name"),
      z.union([z.number(), z.string().max(100).regex(/^[a-zA-Z0-9_.,-]*$/, "Unsafe parameter value"), z.boolean()]),
    )
    .optional(),
});

// ─── launchable models ──────────────────────────────────────────────────────

function runnableModels(): RunnableModel[] {
  const load = loadCycleRegistry();
  if (!load.registry) throw new Error(`The Model Cycle registry is invalid: ${load.problems.join("; ")}`);
  const response = buildCycleModelsResponse(load.registry, readCatalogSnapshot());
  const models: RunnableModel[] = [];
  for (const category of response.categories) {
    for (const subcategory of category.subcategories) {
      for (const model of subcategory.models) {
        if (!model.runnable || !model.key || !model.runnerKey) continue;
        models.push({
          key: model.key,
          runnerKey: model.runnerKey,
          displayName: model.displayName,
          kind: model.kind ?? "",
          category: category.label,
          speed: model.speed ?? null,
          estimatedTrainingTime: model.estimatedTrainingTime ?? null,
        });
      }
    }
  }
  return models.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Find the model a caller named: its key, its runner key or its display name,
 * ignoring case and punctuation. An ambiguous or unknown name is an error that
 * lists what it could have meant, never a guess.
 */
export function resolveRunnableModel(name: string, models: readonly RunnableModel[]): RunnableModel {
  const wanted = normalise(name.replace(/\+walk_forward_cycle$/, ""));
  const exact = models.filter((model) => normalise(model.key) === wanted || normalise(model.displayName) === wanted);
  if (exact.length === 1) return exact[0]!;
  const partial = exact.length > 1 ? exact : models.filter((model) => normalise(model.key).includes(wanted) || normalise(model.displayName).includes(wanted));
  if (partial.length === 1) return partial[0]!;
  if (partial.length === 0) throw new Error(`Unknown model "${name}". GET /api/runs/models lists every launchable model.`);
  const listed = partial.slice(0, 8).map((model) => model.key).join(", ");
  throw new Error(`"${name}" matches ${partial.length} models: ${listed}${partial.length > 8 ? ", ..." : ""}. Name one key.`);
}

router.get("/runs/models", (_req: Request, res: Response) => {
  try {
    res.json({ models: runnableModels() });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ─── launch ─────────────────────────────────────────────────────────────────

router.post("/runs", mlRateLimiter, async (req: Request, res: Response) => {
  const parsed = startRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
  }
  let model: RunnableModel;
  try {
    model = resolveRunnableModel(parsed.data.model, runnableModels());
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
  const request: TrainingRequest = {
    modelType: model.runnerKey,
    symbol: parsed.data.symbol ?? DEFAULT_SYMBOL,
    timeframe: parsed.data.timeframe ?? DEFAULT_TIMEFRAME,
    dateRange: { start: parsed.data.dateStart ?? DEFAULT_DATE_START, end: parsed.data.dateEnd ?? DEFAULT_DATE_END },
    // A launch from the API walks the test bars as fast as the model answers; the paced replay is the Model Cycle page's.
    hyperparameters: { bars_per_second: 0, ...parsed.data.parameters },
    maxBars: 0,
  };
  try {
    ensureCycleAccumulator();
    const started = await getNestApp().get(TrainingService).start(request);
    listCache = null;
    const body: StartRunResponse = {
      runId: started.modelId,
      name: runName(started.modelId),
      modelType: model.runnerKey,
      url: `${req.protocol}://${req.get("host")}/training?run=${encodeURIComponent(started.modelId)}`,
    };
    res.status(202).json(body);
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes("Already training") ? 409 : message.includes("Maximum concurrent") ? 429 : 500;
    res.status(status).json({ error: message });
  }
});

// ─── preflight ──────────────────────────────────────────────────────────────

const PYTHON = path.join(process.cwd(), ".venv", "Scripts", "python.exe");
const ENVIRONMENT_CACHE_MILLISECONDS = 5 * 60_000;
let environmentCache: { at: number; result: PreflightCheck } | null = null;

/** The Python side, probed once every five minutes: the interpreter, torch and the GPU it sees. */
async function environmentCheck(): Promise<PreflightCheck> {
  if (environmentCache && Date.now() - environmentCache.at < ENVIRONMENT_CACHE_MILLISECONDS) return environmentCache.result;
  const { execFile } = await import("child_process");
  const script =
    "import json,sys\n" +
    "try:\n import torch; cuda=torch.cuda.is_available(); name=torch.cuda.get_device_name(0) if cuda else None; v=torch.__version__\n" +
    "except Exception as e: cuda=False; name=None; v='torch missing: '+str(e)\n" +
    "print(json.dumps({'python':sys.version.split()[0],'torch':v,'cuda':cuda,'device':name}))";
  const result = await new Promise<PreflightCheck>((resolve) => {
    execFile(PYTHON, ["-c", script], { timeout: 60_000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve({ name: "environment", ok: false, detail: `${PYTHON} did not answer: ${error.message.split("\n")[0]}` });
        return;
      }
      try {
        const info = JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as { python: string; torch: string; cuda: boolean; device: string | null };
        resolve({
          name: "environment",
          ok: !info.torch.startsWith("torch missing"),
          detail: `Python ${info.python}, torch ${info.torch}, ${info.cuda ? `CUDA on ${info.device}` : "CPU only (no CUDA device)"}`,
        });
      } catch {
        resolve({ name: "environment", ok: false, detail: `unreadable answer from ${PYTHON}` });
      }
    });
  });
  environmentCache = { at: Date.now(), result };
  return result;
}

interface PreflightCheck {
  name: "model" | "costs" | "bars" | "environment" | "disk" | "busy";
  ok: boolean;
  detail: string;
}

const preflightSchema = startRunSchema.pick({ model: true, symbol: true, timeframe: true, dateStart: true, dateEnd: true });

/**
 * Everything a launch needs, checked before the Run button is pressed: the
 * model resolves, its root is priced, the lake has bars across the window,
 * the Python side answers with torch, the models directory has room, and
 * the dashboard is not already running something.
 */
router.get("/runs/preflight", async (req: Request, res: Response) => {
  const parsed = preflightSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
  }
  const symbol = (parsed.data.symbol ?? DEFAULT_SYMBOL).toUpperCase();
  const timeframe = parsed.data.timeframe ?? DEFAULT_TIMEFRAME;
  const dateStart = parsed.data.dateStart ?? DEFAULT_DATE_START;
  const dateEnd = parsed.data.dateEnd ?? DEFAULT_DATE_END;
  const checks: PreflightCheck[] = [];

  let model: RunnableModel | null = null;
  try {
    model = resolveRunnableModel(parsed.data.model, runnableModels());
    checks.push({ name: "model", ok: true, detail: `${model.displayName} (${model.key}), ${model.kind}` });
  } catch (error) {
    checks.push({ name: "model", ok: false, detail: (error as Error).message });
  }

  try {
    const costModel = JSON.parse(await fs.promises.readFile(path.join(process.cwd(), "packages", "config", "cost_model.json"), "utf-8")) as Record<string, unknown>;
    const priced = Object.prototype.hasOwnProperty.call(costModel, symbol);
    checks.push({
      name: "costs",
      ok: priced,
      detail: priced ? `${symbol} is priced in cost_model.json` : `${symbol} has no entry in packages/config/cost_model.json; the Model Cycle trades priced roots only`,
    });
  } catch (error) {
    checks.push({ name: "costs", ok: false, detail: `cost_model.json unreadable: ${(error as Error).message}` });
  }

  try {
    const { queryLake } = await import("../infrastructure/database/lake/connection");
    const root = symbol.replace(/'/g, "''");
    // the same table the engine reads (`lake.serving`), scoped to the root so it answers in seconds;
    // the lake holds 1m bars and the engine resamples every launchable timeframe from the minutes
    const source = "1m";
    const rows = await queryLake<{ bar_count: number | bigint; first_bar: unknown; last_bar: unknown }>(
      `SELECT count(*) AS bar_count, min(ts) AS first_bar, max(ts) AS last_bar FROM bars
       WHERE timeframe = '${source}' AND root = '${root}' AND volume > 0
         AND ts >= TIMESTAMP '${dateStart} 00:00:00' AND ts <= TIMESTAMP '${dateEnd} 23:59:59'`,
      60_000,
    );
    const count = Number(rows[0]?.bar_count ?? 0);
    const stamp = (value: unknown) => {
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(date.getTime()) ? "?" : date.toISOString().slice(0, 10);
    };
    checks.push({
      name: "bars",
      ok: count > 0,
      detail:
        count > 0
          ? `${count.toLocaleString("en-US")} ${symbol} ${source} bars in the lake, ${stamp(rows[0]?.first_bar)} to ${stamp(rows[0]?.last_bar)}${source === timeframe ? "" : `, resampled to ${timeframe} by the engine`}`
          : `the lake has no ${symbol} ${source} bars between ${dateStart} and ${dateEnd}`,
    });
  } catch (error) {
    checks.push({ name: "bars", ok: false, detail: `the lake did not answer: ${(error as Error).message}` });
  }

  checks.push(await environmentCheck());

  try {
    const stats = await fs.promises.statfs(MODELS_DIR);
    const freeGb = (stats.bavail * stats.bsize) / 1e9;
    checks.push({ name: "disk", ok: freeGb > 5, detail: `${freeGb.toFixed(1)} GB free for data/models` });
  } catch (error) {
    checks.push({ name: "disk", ok: false, detail: `data/models unreadable: ${(error as Error).message}` });
  }

  ensureCycleAccumulator();
  const running = listCycleRuns().filter((run) => run.status === "running");
  checks.push({
    name: "busy",
    ok: running.length === 0,
    detail: running.length === 0 ? "nothing is running" : `${running.length} run${running.length === 1 ? "" : "s"} already running: ${running.map((run) => runName(run.modelId)).join(", ")}`,
  });

  res.json({ ready: checks.every((check) => check.ok), checks });
});

// ─── saved comparisons (the Analytics tab) ──────────────────────────────────

const COMPARISONS_FILE = path.join(process.cwd(), "data", "analytics", "comparisons.json");

interface SavedComparison {
  id: string;
  name: string;
  runIds: string[];
  savedAt: number;
}

async function readComparisons(): Promise<SavedComparison[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.promises.readFile(COMPARISONS_FILE, "utf-8"));
    return Array.isArray(parsed) ? (parsed as SavedComparison[]) : [];
  } catch {
    return [];
  }
}

async function writeComparisons(rows: SavedComparison[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(COMPARISONS_FILE), { recursive: true });
  const tmp = `${COMPARISONS_FILE}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(rows, null, 2), "utf-8");
  await fs.promises.rename(tmp, COMPARISONS_FILE);
}

const comparisonSchema = z.object({
  name: z.string().trim().min(1).max(80),
  runIds: z.array(z.string().regex(/^[A-Za-z0-9_+\-.]{1,160}$/)).min(1).max(12),
});

/** Comparisons live on disk beside the data, so a clone of the repo sees the same ones as this machine. */
router.get("/runs/comparisons", async (_req: Request, res: Response) => {
  res.json({ comparisons: (await readComparisons()).sort((a, b) => b.savedAt - a.savedAt) });
});

router.post("/runs/comparisons", async (req: Request, res: Response) => {
  const parsed = comparisonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
  const rows = await readComparisons();
  const existing = rows.find((row) => row.name.toLowerCase() === parsed.data.name.toLowerCase());
  const saved: SavedComparison = { id: existing?.id ?? `cmp_${Date.now().toString(36)}`, name: parsed.data.name, runIds: parsed.data.runIds, savedAt: Date.now() };
  await writeComparisons([...rows.filter((row) => row.id !== saved.id), saved]);
  res.status(existing ? 200 : 201).json(saved);
});

router.delete("/runs/comparisons/:id", async (req: Request, res: Response) => {
  const rows = await readComparisons();
  const id = String(req.params.id);
  if (!rows.some((row) => row.id === id)) return res.status(404).json({ error: `No comparison ${id}` });
  await writeComparisons(rows.filter((row) => row.id !== id));
  res.status(204).end();
});

// ─── the list ───────────────────────────────────────────────────────────────

const LIST_CACHE_MILLISECONDS = 30_000;
let listCache: { at: number; rows: CycleRunSummary[] } | null = null;
let listRefresh: Promise<void> | null = null;

/** The lake's runs take seconds to list, so they are served from a short cache and refreshed behind it. */
async function archivedRuns(): Promise<CycleRunSummary[]> {
  const refresh = (): Promise<void> => {
    listRefresh ??= listArchivedCycleRuns(200)
      .then((rows) => {
        listCache = { at: Date.now(), rows };
      })
      .catch((error) => {
        console.warn(`[runs] recorded runs unavailable: ${String(error)}`);
      })
      .finally(() => {
        listRefresh = null;
      });
    return listRefresh;
  };
  if (!listCache) await refresh();
  else if (Date.now() - listCache.at > LIST_CACHE_MILLISECONDS) void refresh();
  return listCache?.rows ?? [];
}

/** Live runs first, then the lake's, deduped by id, newest first. */
async function allRuns(): Promise<CycleRunSummary[]> {
  ensureCycleAccumulator();
  const live = listCycleRuns();
  const seen = new Set(live.map((run) => run.modelId));
  const archived = await archivedRuns();
  return [...live, ...archived.filter((run) => !seen.has(run.modelId))].sort((a, b) => b.startedAt - a.startedAt);
}

function versionsOf(runs: readonly CycleRunSummary[]): Map<string, number> {
  return runVersions(runs.map((run) => ({ id: run.modelId, modelType: run.modelType, symbol: run.symbol, timeframe: run.timeframe, startedAt: run.startedAt })));
}

let labelCache: Map<string, string> | null = null;

/** The registry's display name per model key (`xgboost` -> `XGBoost`), read once. */
function modelLabelOf(key: string): string {
  if (!labelCache) {
    try {
      labelCache = new Map(runnableModels().map((model) => [model.key, model.displayName]));
    } catch {
      return key;
    }
  }
  return labelCache.get(key) ?? key;
}

function toListItem(run: CycleRunSummary, version: number): RunListItem {
  // a run that has not sent its plan yet still says what it is in its id: `<SYMBOL>_<timeframe>_<runner>_<stamp>`
  const named = /^([A-Z0-9]+)_([0-9]+[a-z]+)_/.exec(run.modelId);
  const modelLabel = modelLabelOf(run.modelFamily ?? run.modelType.replace(/\+walk_forward_cycle$/, ""));
  return {
    id: run.modelId,
    name: runName(run.modelId),
    version,
    purpose: run.labelHorizonBars
      ? runPurpose({
          modelLabel,
          symbol: run.symbol ?? named?.[1] ?? null,
          timeframe: run.timeframe ?? named?.[2] ?? null,
          directionMode: run.directionMode,
          hasPriceModel: run.hasPriceModel,
          labelHorizonBars: run.labelHorizonBars,
          tuningObjective: run.tuningObjective,
          tuningTrialCount: run.tuningTrialCount,
        })
      : "",
    modelType: run.modelType,
    modelFamily: run.modelFamily,
    symbol: run.symbol ?? named?.[1] ?? null,
    timeframe: run.timeframe ?? named?.[2] ?? null,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    sharpeRatio: run.sharpeRatio ?? null,
    tradeCount: run.tradeCount,
  };
}

router.get("/runs", async (_req: Request, res: Response) => {
  const rows = await allRuns();
  const versions = versionsOf(rows);
  res.json({ runs: rows.map((run) => toListItem(run, versions.get(run.modelId) ?? 1)) });
});

// ─── one run ────────────────────────────────────────────────────────────────

function terminalPath(modelId: string): string | null {
  const directory = path.join(MODELS_DIR, modelId);
  // the id comes from the URL: it has to stay a direct child of the models directory
  if (path.dirname(directory) !== MODELS_DIR) return null;
  return path.join(directory, TERMINAL_FILE);
}

const savedTerminals = new Set<string>();

/** Keep a finished run's terminal beside its artifacts: the lake record does not carry the lines. */
async function saveTerminal(snapshot: CycleSnapshot): Promise<void> {
  if (savedTerminals.has(snapshot.modelId) || snapshot.logs.length === 0) return;
  const file = terminalPath(snapshot.modelId);
  if (!file || !fs.existsSync(path.dirname(file))) return;
  savedTerminals.add(snapshot.modelId);
  try {
    await fs.promises.writeFile(file, snapshot.logs.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf-8");
  } catch (error) {
    savedTerminals.delete(snapshot.modelId);
    console.warn(`[runs] could not save the terminal of ${snapshot.modelId}: ${String(error)}`);
  }
}

async function readTerminal(modelId: string): Promise<CycleLogLine[] | null> {
  const file = terminalPath(modelId);
  if (!file) return null;
  try {
    const text = await fs.promises.readFile(file, "utf-8");
    const lines: CycleLogLine[] = [];
    for (const row of text.split("\n")) {
      if (!row) continue;
      try {
        lines.push(JSON.parse(row) as CycleLogLine);
      } catch {
        // a torn last line from an interrupted write: the rest of the file still reads
      }
    }
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

const LOSS_SURFACES_FILE = "loss_surfaces.json";

/** The surfaces the engine wrote beside the run's artifacts (`engine.write_loss_surfaces`); the lake record does not carry them. */
async function readLossSurfaces(modelId: string): Promise<CycleLossSurface[]> {
  const terminal = terminalPath(modelId);
  if (!terminal) return [];
  try {
    const text = await fs.promises.readFile(path.join(path.dirname(terminal), LOSS_SURFACES_FILE), "utf-8");
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as CycleLossSurface[]) : [];
  } catch {
    return [];
  }
}

const REPORT_REFRESH_MILLISECONDS = 20_000;
const reportCache = new Map<string, { at: number; report: RunReportTables | null }>();
const reportRefresh = new Map<string, Promise<void>>();

/** A live run's report tables land fold by fold; they are re-read behind the response, never in front of it. */
function liveReport(modelId: string): RunReportTables | null {
  const cached = reportCache.get(modelId);
  if ((!cached || Date.now() - cached.at > REPORT_REFRESH_MILLISECONDS) && !reportRefresh.has(modelId)) {
    reportRefresh.set(
      modelId,
      loadCycleReport(modelId)
        .then((report) => {
          reportCache.set(modelId, { at: Date.now(), report });
        })
        .catch(() => {
          reportCache.set(modelId, { at: Date.now(), report: cached?.report ?? null });
        })
        .finally(() => {
          reportRefresh.delete(modelId);
        }),
    );
  }
  return cached?.report ?? null;
}

const ARCHIVE_CACHE_SIZE = 24;
const archiveCache = new Map<string, { snapshot: CycleSnapshot; report: RunReportTables | null }>();

async function archivedRun(modelId: string): Promise<{ snapshot: CycleSnapshot; report: RunReportTables | null } | null> {
  const cached = archiveCache.get(modelId);
  if (cached) return cached;
  const [snapshot, report, terminal, lossSurfaces] = await Promise.all([
    loadArchivedCycleSnapshot(modelId),
    loadCycleReport(modelId).catch(() => null),
    readTerminal(modelId),
    readLossSurfaces(modelId),
  ]);
  if (!snapshot) return null;
  const entry = { snapshot: { ...snapshot, logs: terminal ?? snapshot.logs, lossSurfaces }, report };
  archiveCache.set(modelId, entry);
  if (archiveCache.size > ARCHIVE_CACHE_SIZE) archiveCache.delete(archiveCache.keys().next().value as string);
  return entry;
}

function cursorOf(req: Request): LogCursor | null {
  const receivedAt = Number(req.query.logAt);
  if (!Number.isFinite(receivedAt) || req.query.logAt === undefined) return null;
  const seq = req.query.logSeq === undefined || req.query.logSeq === "" ? null : Number(req.query.logSeq);
  return { receivedAt, seq: seq !== null && Number.isFinite(seq) ? seq : null };
}

router.get("/runs/:id", async (req: Request, res: Response) => {
  const modelId = String(req.params.id);
  const cursor = cursorOf(req);
  ensureCycleAccumulator();
  const version = versionsOf(await allRuns()).get(modelId) ?? null;
  const live = getCycleSnapshot(modelId);
  if (live) {
    if (live.status !== "running") void saveTerminal(live);
    const view: RunView = buildRunView(live, liveReport(modelId), cursor, version);
    return res.json(view);
  }
  try {
    const archived = await archivedRun(modelId);
    if (archived) return res.json(buildRunView(archived.snapshot, archived.report, cursor, version));
  } catch (error) {
    return res.status(500).json({ error: `The record of ${modelId} could not be read: ${String(error)}` });
  }
  return res.status(404).json({ error: `No run tracked or recorded for ${modelId}` });
});

// ─── the bars the model walked ──────────────────────────────────────────────

/** One bar as the terminal view's chart draws it: the candle, the model's call on it and the equity after it. */
interface RunBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  foldIndex: number | null;
  role: string;
  probabilityUp: number | null;
  position: number | null;
  equityUsd: number | null;
  correct: boolean | null;
}

function barsAfter(snapshot: CycleSnapshot, after: number): RunBar[] {
  const columns = snapshot.bars;
  const out: RunBar[] = [];
  for (let index = 0; index < columns.timestamps.length; index += 1) {
    const time = columns.timestamps[index]!;
    if (time <= after) continue;
    out.push({
      time,
      open: columns.open[index]!,
      high: columns.high[index]!,
      low: columns.low[index]!,
      close: columns.close[index]!,
      foldIndex: columns.foldIndex[index] ?? null,
      role: columns.role[index]!,
      probabilityUp: columns.probabilityUp[index] ?? null,
      position: columns.positionHeld[index] ?? null,
      equityUsd: columns.equityUsd[index] ?? null,
      correct: columns.correct[index] ?? null,
    });
  }
  return out;
}

/**
 * `GET /api/runs/:id/bars?after=<epoch seconds>`: every bar the run has drawn after
 * the given time, plus the trades. A live page asks with its last bar's time and
 * receives only what is new.
 */
router.get("/runs/:id/bars", async (req: Request, res: Response) => {
  const modelId = String(req.params.id);
  const after = Number(req.query.after);
  const since = Number.isFinite(after) ? after : -Infinity;
  ensureCycleAccumulator();
  let snapshot: CycleSnapshot | null = getCycleSnapshot(modelId);
  if (!snapshot) {
    try {
      snapshot = (await archivedRun(modelId))?.snapshot ?? null;
    } catch (error) {
      return res.status(500).json({ error: `The bars of ${modelId} could not be read: ${String(error)}` });
    }
  }
  if (!snapshot) return res.status(404).json({ error: `No run tracked or recorded for ${modelId}` });
  res.json({ status: snapshot.status, bars: barsAfter(snapshot, since), trades: snapshot.trades });
});

// ─── stop ───────────────────────────────────────────────────────────────────

const HARD_STOP_AFTER_MILLISECONDS = 10_000;

router.post("/runs/:id/stop", (req: Request, res: Response) => {
  const modelId = String(req.params.id);
  const training = getNestApp().get(TrainingService);
  // The graceful path first: the engine closes the open trade, lands the record and exits on its own.
  const outcome = training.control(modelId, { command: "stop" });
  if (outcome === "no_session") {
    return res.status(404).json({ error: `No active run for ${modelId}` });
  }
  if (outcome === "not_supported") {
    training.stop(modelId);
    return res.json({ stopped: true, graceful: false });
  }
  setTimeout(() => {
    if (getCycleSnapshot(modelId)?.status === "running") training.stop(modelId);
  }, HARD_STOP_AFTER_MILLISECONDS);
  res.status(202).json({ stopped: true, graceful: true });
});

export default router;
