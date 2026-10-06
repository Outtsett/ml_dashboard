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
import type { CycleLogLine, CycleRunSummary, CycleSnapshot } from "@shared/cycle/schema";
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

function toListItem(run: CycleRunSummary): RunListItem {
  // a run that has not sent its plan yet still says what it is in its id: `<SYMBOL>_<timeframe>_<runner>_<stamp>`
  const named = /^([A-Z0-9]+)_([0-9]+[a-z]+)_/.exec(run.modelId);
  return {
    id: run.modelId,
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
  ensureCycleAccumulator();
  const live = listCycleRuns();
  const seen = new Set(live.map((run) => run.modelId));
  const archived = await archivedRuns();
  const rows = [...live, ...archived.filter((run) => !seen.has(run.modelId))].sort((a, b) => b.startedAt - a.startedAt);
  res.json({ runs: rows.map(toListItem) });
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
  const [snapshot, report, terminal] = await Promise.all([
    loadArchivedCycleSnapshot(modelId),
    loadCycleReport(modelId).catch(() => null),
    readTerminal(modelId),
  ]);
  if (!snapshot) return null;
  // the run page draws no bars; holding them would only pin megabytes per cached run
  const entry = { snapshot: { ...snapshot, logs: terminal ?? snapshot.logs, bars: { ...snapshot.bars, timestamps: [] } }, report };
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
  const live = getCycleSnapshot(modelId);
  if (live) {
    if (live.status !== "running") void saveTerminal(live);
    const view: RunView = buildRunView(live, liveReport(modelId), cursor);
    return res.json(view);
  }
  try {
    const archived = await archivedRun(modelId);
    if (archived) return res.json(buildRunView(archived.snapshot, archived.report, cursor));
  } catch (error) {
    return res.status(500).json({ error: `The record of ${modelId} could not be read: ${String(error)}` });
  }
  return res.status(404).json({ error: `No run tracked or recorded for ${modelId}` });
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
