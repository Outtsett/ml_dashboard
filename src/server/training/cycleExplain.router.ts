/**
 * "Inside the model" routes — HTTP layer over a run's `explain/` artifacts and
 * the explainer pool (`cycleExplainer.ts`).
 *
 * Routes (contract: `@shared/cycle/explain`):
 *   GET /training/cycle/:modelId/explain
 *     -> CycleExplainManifest — read by Node from disk: `explain/manifest.json`
 *        plus each fold's readiness from `fold_<k>/model.json` and
 *        `fold_<k>/price_model/model.json`, and whether the run is live.
 *   GET /training/cycle/:modelId/explain/structure?fold=&role=
 *   GET /training/cycle/:modelId/explain/tree?fold=&role=&tree=
 *   GET /training/cycle/:modelId/explain/bar?timestamp=&role=[&fold=]
 *     -> through the pool; `fold` for a bar defaults to the manifest fold whose
 *        test span holds the timestamp. `role` defaults to "direction".
 *
 * Status codes: 400 bad parameters; 404 unknown run, no fold for the
 * timestamp, or no price model; 409 the fold's model is still training, or
 * the request was superseded by a newer one; 422 the explainer declined
 * (its sentence); 502 the reply failed its schema (the zod message) or the
 * process stopped mid-request; 503 the explainer is unavailable (crash loop,
 * with the stderr tail) or could not start; 504 no ready line or no reply in
 * time.
 *
 * `modelId` is validated with the pattern `anatomy.router.ts` uses, and the
 * resolved directory must be a direct child of `data/models`.
 *
 * Handlers are exported as `{ status, body }` functions so tests can call
 * them without HTTP. The architect mounts `createCycleExplainRouter()` under
 * `/api`, before `training.router`.
 *
 * Design: `docs/plans/2026-09-26-cycle-catalog-inside-view.md` (WP7).
 */

import { Router, type Request, type Response } from "express";
import { readFile, stat } from "fs/promises";
import path from "path";
import { z } from "zod";
import { Logger } from "@nestjs/common";
import {
  cycleExplainManifestSchema,
  cycleExplainRoleSchema,
  type CycleExplainManifest,
  type CycleExplainRole,
} from "@shared/cycle/explain";
import { cycleDirectionModeSchema, cycleExplainKindSchema } from "@shared/cycle/schema";
import {
  CycleExplainerError,
  getCycleExplainer,
  modelFileFor,
  type CycleExplainerOperation,
  type CycleExplainerOutcome,
} from "./cycleExplainer";
import { getCycleSnapshot } from "./cycle";

const logger = new Logger("CycleExplainRoutes");

export interface HandlerResult {
  status: number;
  body: unknown;
}

/** The part of the pool the routes use — the real one or a test double. */
export interface CycleExplainerClient {
  request(operation: CycleExplainerOperation): Promise<CycleExplainerOutcome>;
}

export interface CycleExplainRouterOptions {
  /** Default: `<cwd>/data/models`. */
  modelsRoot?: string;
  /** Default: the server's shared pool. */
  explainer?: () => CycleExplainerClient;
  /** Whether a run is still going (its planned-but-absent models are "training", not "missing"). Default: the Model Cycle snapshot store. */
  isRunLive?: (modelId: string) => boolean;
}

interface ResolvedOptions {
  modelsRoot: string;
  explainer: () => CycleExplainerClient;
  isRunLive: (modelId: string) => boolean;
}

function resolveOptions(options: CycleExplainRouterOptions): ResolvedOptions {
  return {
    modelsRoot: path.resolve(options.modelsRoot ?? path.join(process.cwd(), "data", "models")),
    explainer: options.explainer ?? getCycleExplainer,
    isRunLive: options.isRunLive ?? ((modelId) => getCycleSnapshot(modelId)?.status === "running"),
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Same pattern as `anatomy.router.ts`. */
const MODEL_ID_PATTERN = /^[A-Za-z0-9_+.-]{1,128}$/;

function isValidModelId(id: unknown): id is string {
  return typeof id === "string" && MODEL_ID_PATTERN.test(id) && id !== "." && id !== "..";
}

const foldParameter = z.coerce.number().int().min(0);
const roleParameter = cycleExplainRoleSchema.default("direction");

const structureQuery = z.object({ fold: foldParameter, role: roleParameter });
const treeQuery = z.object({ fold: foldParameter, role: roleParameter, tree: z.coerce.number().int().min(0) });
const barQuery = z.object({ timestamp: z.coerce.number().int().min(0), role: roleParameter, fold: foldParameter.optional() });

function badQuery(error: z.ZodError): HandlerResult {
  return {
    status: 400,
    body: {
      error: "Invalid query parameters",
      details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    },
  };
}

/** The run's directory, or null when the id is malformed or escapes `data/models`. */
function runDirectoryFor(modelsRoot: string, modelId: unknown): string | null {
  if (!isValidModelId(modelId)) return null;
  const directory = path.resolve(modelsRoot, modelId);
  // Second traversal layer: the resolved path must be a DIRECT child of data/models.
  if (path.dirname(directory) !== modelsRoot) return null;
  return directory;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

// ─── Manifest ────────────────────────────────────────────────────────────────

/** `explain/manifest.json` as the engine writes it (the brief's artifact layout). */
const manifestFileSchema = z.object({
  version: z.number().int().positive(),
  modelId: z.string(),
  modelKey: z.string(),
  displayName: z.string(),
  explainKind: cycleExplainKindSchema.nullable(),
  directionMode: cycleDirectionModeSchema,
  hasPriceModel: z.boolean(),
  featureNames: z.array(z.string()),
  featureDisplayNames: z.array(z.string()),
  sequenceLength: z.number().int().positive(),
  labelHorizonBars: z.number().int().positive(),
  symbol: z.string(),
  timeframe: z.string(),
  folds: z.array(
    z.object({
      foldIndex: z.number().int().nonnegative(),
      testStart: z.number().int().nonnegative(),
      testEnd: z.number().int().nonnegative(),
    }),
  ),
});
type ManifestFile = z.infer<typeof manifestFileSchema>;

function unavailableManifest(modelId: string, reason: string): CycleExplainManifest {
  return {
    modelId,
    available: false,
    reason,
    modelKey: null,
    displayName: null,
    explainKind: null,
    directionMode: null,
    hasPriceModel: false,
    featureNames: [],
    featureDisplayNames: [],
    sequenceLength: 1,
    labelHorizonBars: 1,
    folds: [],
  };
}

type ManifestRead = { ok: true; file: ManifestFile } | { ok: false; reason: string };

async function readManifestFile(runDirectory: string): Promise<ManifestRead> {
  const manifestPath = path.join(runDirectory, "explain", "manifest.json");
  let text: string;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch {
    return { ok: false, reason: "This run was made before Inside the model existed, so it has no explain/manifest.json." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `The run's explain/manifest.json is not valid JSON: ${(err as Error).message}` };
  }
  const result = manifestFileSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: `The run's explain/manifest.json does not match the contract: ${result.error.message}` };
  }
  return { ok: true, file: result.data };
}

async function foldStatus(
  runDirectory: string,
  fold: number,
  role: CycleExplainRole,
  live: boolean,
): Promise<"ready" | "training" | "missing"> {
  if (await isFile(modelFileFor(runDirectory, fold, role))) return "ready";
  return live ? "training" : "missing";
}

async function buildManifest(options: ResolvedOptions, modelId: string, runDirectory: string): Promise<CycleExplainManifest> {
  const read = await readManifestFile(runDirectory);
  if (!read.ok) return unavailableManifest(modelId, read.reason);
  const file = read.file;
  if (!(await isFile(path.join(runDirectory, "explain", "features.npy")))) {
    return unavailableManifest(modelId, "The run's model inputs (explain/features.npy) were not written, so its bars cannot be explained.");
  }
  const live = options.isRunLive(modelId);
  const folds = await Promise.all(
    file.folds.map(async (fold) => ({
      foldIndex: fold.foldIndex,
      testStart: fold.testStart,
      testEnd: fold.testEnd,
      direction: await foldStatus(runDirectory, fold.foldIndex, "direction", live),
      price: file.hasPriceModel ? await foldStatus(runDirectory, fold.foldIndex, "price", live) : ("none" as const),
    })),
  );
  return cycleExplainManifestSchema.parse({
    modelId,
    available: true,
    reason: null,
    modelKey: file.modelKey,
    displayName: file.displayName,
    explainKind: file.explainKind,
    directionMode: file.directionMode,
    hasPriceModel: file.hasPriceModel,
    featureNames: file.featureNames,
    featureDisplayNames: file.featureDisplayNames,
    sequenceLength: file.sequenceLength,
    labelHorizonBars: file.labelHorizonBars,
    folds,
  });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

function notFound(modelId: unknown): HandlerResult {
  return { status: 404, body: { error: `There is no saved run called ${JSON.stringify(String(modelId))}.` } };
}

async function locateRun(options: ResolvedOptions, modelId: unknown): Promise<{ modelId: string; runDirectory: string } | HandlerResult> {
  const runDirectory = runDirectoryFor(options.modelsRoot, modelId);
  if (runDirectory === null || !(await isDirectory(runDirectory))) return notFound(modelId);
  return { modelId: modelId as string, runDirectory };
}

function isHandlerResult(value: unknown): value is HandlerResult {
  return typeof value === "object" && value !== null && "status" in value && "body" in value;
}

export async function handleManifest(options: CycleExplainRouterOptions, modelId: unknown): Promise<HandlerResult> {
  const resolved = resolveOptions(options);
  const run = await locateRun(resolved, modelId);
  if (isHandlerResult(run)) return run;
  return { status: 200, body: await buildManifest(resolved, run.modelId, run.runDirectory) };
}

/**
 * The checks every model question shares: the run has explain artifacts, the
 * fold is one the manifest planned, and the role's model file is on disk.
 */
async function checkFoldModel(
  options: ResolvedOptions,
  modelId: string,
  runDirectory: string,
  fold: number,
  role: CycleExplainRole,
): Promise<HandlerResult | null> {
  const manifest = await buildManifest(options, modelId, runDirectory);
  if (!manifest.available) return { status: 404, body: { error: manifest.reason } };
  const planned = manifest.folds.find((entry) => entry.foldIndex === fold);
  if (!planned) {
    return { status: 404, body: { error: `This run has no fold ${fold}; its folds are ${manifest.folds.map((entry) => entry.foldIndex).join(", ") || "none"}.` } };
  }
  const status = role === "price" ? planned.price : planned.direction;
  if (status === "none") return { status: 404, body: { error: "This model has no price model, so there is nothing to explain for the price role." } };
  if (status === "training") return { status: 409, body: { error: `Fold ${fold}'s ${role} model is still training; it can be explained once it is saved.` } };
  if (status === "missing") return { status: 404, body: { error: `Fold ${fold}'s ${role} model was never saved; the run ended before it was fitted.` } };
  return null;
}

async function askExplainer(options: ResolvedOptions, operation: CycleExplainerOperation): Promise<HandlerResult> {
  let outcome: CycleExplainerOutcome;
  try {
    outcome = await options.explainer().request(operation);
  } catch (err) {
    if (err instanceof CycleExplainerError) {
      const status =
        err.failure === "timeout" || err.failure === "ready_timeout"
          ? 504
          : err.failure === "crashed"
            ? 502
            : 503;
      return { status, body: { error: err.message, failure: err.failure, stderrTail: err.stderrTail } };
    }
    logger.error(`Explainer request failed: ${(err as Error).message}`);
    return { status: 500, body: { error: (err as Error).message } };
  }
  switch (outcome.status) {
    case "ok":
      return { status: 200, body: outcome.result };
    case "error":
      return { status: 422, body: { error: outcome.error, details: outcome.details ?? null } };
    case "invalid":
      return { status: 502, body: { error: `The explainer's reply does not match the contract: ${outcome.error}` } };
    case "superseded":
      return { status: 409, body: { error: "A newer request for this fold and role replaced this one.", superseded: true } };
  }
}

export async function handleStructure(options: CycleExplainRouterOptions, modelId: unknown, query: unknown): Promise<HandlerResult> {
  const resolved = resolveOptions(options);
  const parsed = structureQuery.safeParse(query);
  if (!parsed.success) return badQuery(parsed.error);
  const run = await locateRun(resolved, modelId);
  if (isHandlerResult(run)) return run;
  const { fold, role } = parsed.data;
  const blocked = await checkFoldModel(resolved, run.modelId, run.runDirectory, fold, role);
  if (blocked) return blocked;
  return askExplainer(resolved, { op: "structure", runDirectory: run.runDirectory, fold, role });
}

export async function handleTree(options: CycleExplainRouterOptions, modelId: unknown, query: unknown): Promise<HandlerResult> {
  const resolved = resolveOptions(options);
  const parsed = treeQuery.safeParse(query);
  if (!parsed.success) return badQuery(parsed.error);
  const run = await locateRun(resolved, modelId);
  if (isHandlerResult(run)) return run;
  const { fold, role, tree } = parsed.data;
  const blocked = await checkFoldModel(resolved, run.modelId, run.runDirectory, fold, role);
  if (blocked) return blocked;
  return askExplainer(resolved, { op: "tree", runDirectory: run.runDirectory, fold, role, tree });
}

export async function handleBar(options: CycleExplainRouterOptions, modelId: unknown, query: unknown): Promise<HandlerResult> {
  const resolved = resolveOptions(options);
  const parsed = barQuery.safeParse(query);
  if (!parsed.success) return badQuery(parsed.error);
  const run = await locateRun(resolved, modelId);
  if (isHandlerResult(run)) return run;
  const { timestamp, role } = parsed.data;
  let fold = parsed.data.fold;
  if (fold === undefined) {
    const manifest = await buildManifest(resolved, run.modelId, run.runDirectory);
    if (!manifest.available) return { status: 404, body: { error: manifest.reason } };
    const testedBy = manifest.folds.find((entry) => entry.testStart <= timestamp && timestamp <= entry.testEnd);
    if (!testedBy) {
      return {
        status: 404,
        body: { error: `No fold of this run tested the bar at ${new Date(timestamp * 1000).toISOString()}; pick a bar inside a test span or name the fold.` },
      };
    }
    fold = testedBy.foldIndex;
  }
  const blocked = await checkFoldModel(resolved, run.modelId, run.runDirectory, fold, role);
  if (blocked) return blocked;
  return askExplainer(resolved, { op: "explain", runDirectory: run.runDirectory, fold, role, timestamp });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export function createCycleExplainRouter(options: CycleExplainRouterOptions = {}): Router {
  const router = Router();
  const send = (res: Response, result: HandlerResult): void => {
    res.status(result.status).json(result.body);
  };

  router.get("/training/cycle/:modelId/explain", async (req: Request, res: Response) => {
    send(res, await handleManifest(options, req.params.modelId));
  });
  router.get("/training/cycle/:modelId/explain/structure", async (req: Request, res: Response) => {
    send(res, await handleStructure(options, req.params.modelId, req.query));
  });
  router.get("/training/cycle/:modelId/explain/tree", async (req: Request, res: Response) => {
    send(res, await handleTree(options, req.params.modelId, req.query));
  });
  router.get("/training/cycle/:modelId/explain/bar", async (req: Request, res: Response) => {
    send(res, await handleBar(options, req.params.modelId, req.query));
  });

  return router;
}
