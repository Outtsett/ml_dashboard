/**
 * Model Lens Routes — HTTP layer for the /lens surface.
 *
 * SRP: parse + validate via Zod, dispatch to build.ts (Python spawn) /
 *      store.ts (parquet -> LensSeries) / packages/shared/src/lens (pure compute),
 *      format the response. No business logic inline.
 * DIP: handlers are exported as `{ status, body }` functions (mirrors
 *      apps/api/ml/anatomy.router.ts) so tests call them directly without
 *      supertest.
 *
 * Routes (contract: packages/shared/src/lens/types.ts, consumed by apps/web/src/lens/api.ts):
 *   GET  /api/lens/models                        -> LensModelList
 *   GET  /api/lens/models/:id/manifest            -> LensManifest (404 when unbuilt)
 *   POST /api/lens/models/:id/build               -> { manifest } (409 refused/in-flight)
 *   GET  /api/lens/models/:id/evaluation?<params> -> LensEvaluation
 *   GET  /api/lens/models/:id/bars?<params>       -> LensBarWindow
 *
 * Errors: { error: string, details?: unknown }, never a stack trace.
 * modelId regex ^[A-Za-z0-9_+.\-]{1,128}$, '.'/'..' rejected, resolved dir
 * must be a direct child of data/models (path-traversal guard, mirrors
 * anatomy.router.ts).
 *
 * The build endpoint can run for up to 10 minutes (BUILD_TIMEOUT_MS in
 * build.ts); apps/api/main.ts exempts `/api/lens/models/:id/build` from its
 * 30 s request timeout (the isLongRunning check), so a build is bounded by
 * BUILD_TIMEOUT_MS alone.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { readFile } from "fs/promises";
import path from "path";
import { LRUCache } from "lru-cache";
import { Logger } from "@nestjs/common";
import { queryRateLimiter } from "../infrastructure/lib/rateLimiter";
import {
  buildBarWindow,
  clampLensParams,
  evaluateLens,
  LENS_MAX_WINDOW_BARS,
  type LensBarWindow,
  type LensEvaluation,
  type LensEvaluationParams,
  type LensFeatureFamilyKey,
  type LensManifest,
  type LensModelEntry,
  type LensModelList,
} from "@shared/lens";
import { evictLensModel, loadLensModel, LensStoreError } from "./store";
import { LensBuildError, LensBuildRefusedError, runBuild, runInspectAll } from "./build";

const router = Router();
const logger = new Logger("LensRoutes");

// ─── Validation ──────────────────────────────────────────────────────────────

export const MODEL_ID_RE = /^[A-Za-z0-9_+.\-]{1,128}$/;

/** '.'/'..' pass the char-class regex but are path traversal — reject them
 *  explicitly, mirroring anatomy.router.ts's isValidModelId. */
export function isValidModelId(id: unknown): id is string {
  return typeof id === "string" && MODEL_ID_RE.test(id) && id !== "." && id !== "..";
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

function badModelId(): HandlerResult {
  return { status: 400, body: { error: "Invalid modelId (expected ^[A-Za-z0-9_+.\\-]{1,128}$, no traversal)" } };
}

function formatZodErrors(error: z.ZodError): { error: string; details: unknown } {
  return {
    error: "Invalid query parameters",
    details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message, code: issue.code })),
  };
}

// ─── data/models/<id>/lens/ resolution (path-traversal guarded) ─────────────

export interface LensDirInfo {
  modelId: string;
  modelDir: string;
  lensDir: string;
  manifestPath: string;
}

function dataModelsRoot(): string {
  return path.resolve(process.cwd(), "data", "models");
}

export function resolveLensDir(modelId: string): LensDirInfo | null {
  const root = dataModelsRoot();
  const modelDir = path.resolve(root, modelId);
  // Resolved path must be a DIRECT child of data/models — second traversal layer.
  if (path.dirname(modelDir) !== root) return null;
  const lensDir = path.join(modelDir, "lens");
  return { modelId, modelDir, lensDir, manifestPath: path.join(lensDir, "manifest.json") };
}

// ─── Manifest schema (light structural validation of builder output) ───────

const FAMILY_KEYS = ["momentum", "volatility", "volume", "price_structure", "macro"] as const satisfies ReadonlyArray<LensFeatureFamilyKey>;

const LensFeatureFamilySchema = z.object({
  family: z.enum(FAMILY_KEYS),
  label: z.string(),
  features: z.array(z.string()),
  sourceCategories: z.array(z.string()),
});

const LensVerificationCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  measured: z.string(),
  expected: z.string(),
});

const LensManifestSchema = z
  .object({
    modelId: z.string(),
    builderVersion: z.number(),
    builtAtIso: z.string(),
    sourceSchema: z.enum(["probability_parquet", "ohlc_probability_npz", "class_confidence_parquet", "cycle_run"]),
    sourceFiles: z.array(
      z.object({ path: z.string(), sha256: z.string(), bytes: z.number(), modifiedAtIso: z.string() }),
    ),
    symbol: z.string(),
    timeframe: z.string(),
    barSeconds: z.number(),
    horizonBars: z.number().int().positive(),
    horizonSource: z.string(),
    labelDefinition: z.string(),
    defaultThreshold: z.number(),
    cost: z.object({
      roundTripPoints: z.number(),
      pointValueUsd: z.number(),
      tickSize: z.number(),
      source: z.string(),
    }),
    barCount: z.number().int().nonnegative(),
    firstTimestampSeconds: z.number(),
    lastTimestampSeconds: z.number(),
    interval: z.object({
      method: z.string(),
      binCount: z.number(),
      recalibrationStepBars: z.number(),
      historyBars: z.number(),
      minimumBinObservations: z.number(),
      quantiles: z.array(z.number()),
      coveredBarCount: z.number(),
    }),
    attribution: z.object({
      available: z.boolean(),
      reason: z.string().optional(),
      method: z.string().optional(),
      featureCount: z.number().optional(),
      families: z.array(LensFeatureFamilySchema).optional(),
    }),
    reference: z.object({
      tradeCount: z.number().nullable(),
      cumulativeNetUsd: z.number().nullable(),
      longCount: z.number().nullable(),
      shortCount: z.number().nullable(),
      hitRateAtHalf: z.number().nullable(),
      areaUnderCurve: z.number().nullable(),
    }),
    verification: z.array(LensVerificationCheckSchema),
    notes: z.array(z.string()),
  })
  .passthrough();

export class LensManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LensManifestError";
  }
}

interface LoadedManifest {
  info: LensDirInfo;
  manifest: LensManifest;
}

/** Reads and validates data/models/<id>/lens/manifest.json fresh every call —
 *  it is a few KB, so there is no benefit to caching it separately from the
 *  parquet-backed series cache in store.ts. Returns null on ENOENT (unbuilt). */
export async function loadManifest(modelId: string): Promise<LoadedManifest | null> {
  const info = resolveLensDir(modelId);
  if (!info) return null;

  let raw: string;
  try {
    raw = await readFile(info.manifestPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new LensManifestError(`failed to read lens manifest for '${modelId}': ${(err as Error).message}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    throw new LensManifestError(`manifest.json for '${modelId}' is not valid JSON: ${(err as Error).message}`);
  }

  const parsed = LensManifestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new LensManifestError(`manifest.json for '${modelId}' does not match the LensManifest contract: ${detail}`);
  }

  return { info, manifest: parsed.data as unknown as LensManifest };
}

// ─── Errors -> HTTP ───────────────────────────────────────────────────────────

function errorResult(err: unknown): HandlerResult {
  if (err instanceof LensBuildRefusedError) {
    return { status: 409, body: { error: err.reason } };
  }
  if (err instanceof LensBuildError) {
    return { status: 500, body: { error: err.message, details: { stderr: err.stderr, exitCode: err.exitCode } } };
  }
  if (err instanceof LensStoreError || err instanceof LensManifestError) {
    return { status: 500, body: { error: err.message } };
  }
  return { status: 500, body: { error: (err as Error)?.message ?? String(err) } };
}

// ─── Evaluation cache (LRU max 64, keyed by model identity + clamped params) ─

const evaluationCache = new LRUCache<string, LensEvaluation>({ max: 64 });

function invalidateEvaluationCacheFor(modelId: string): void {
  const prefix = `${modelId}|`;
  for (const key of Array.from(evaluationCache.keys())) {
    if (key.startsWith(prefix)) evaluationCache.delete(key);
  }
}

/** Exposed for tests. */
export function clearLensRouteCaches(): void {
  evaluationCache.clear();
  modelsListCache = null;
}

async function getEvaluation(
  modelId: string,
  info: LensDirInfo,
  manifest: LensManifest,
  params: LensEvaluationParams,
): Promise<LensEvaluation> {
  const loaded = await loadLensModel(modelId, info.lensDir, manifest);
  const key = `${loaded.identityKey}|${JSON.stringify(params)}`;
  const cached = evaluationCache.get(key);
  if (cached) return cached;
  const evaluation = evaluateLens(loaded.series, loaded.attribution, manifest, params);
  evaluationCache.set(key, evaluation);
  return evaluation;
}

// ─── GET /lens/models ─────────────────────────────────────────────────────────

let modelsListCache: { at: number; value: LensModelList } | null = null;
const MODELS_LIST_TTL_MS = 30_000;

export async function handleModelsRequest(): Promise<HandlerResult> {
  const now = Date.now();
  if (modelsListCache && now - modelsListCache.at < MODELS_LIST_TTL_MS) {
    return { status: 200, body: modelsListCache.value };
  }

  let raw: LensModelList;
  try {
    raw = await runInspectAll();
  } catch (err) {
    logger.error(`lens inspect-all failed: ${(err as Error).message}`);
    return errorResult(err);
  }

  const models: LensModelEntry[] = [];
  for (const entry of raw.models) {
    if (entry.status !== "ready" && entry.status !== "stale") {
      models.push({ ...entry, headline: null });
      continue;
    }
    try {
      const loaded = await loadManifest(entry.modelId);
      if (!loaded) {
        models.push({ ...entry, headline: null });
        continue;
      }
      const params = clampLensParams({}, loaded.manifest);
      const evaluation = await getEvaluation(entry.modelId, loaded.info, loaded.manifest, params);
      models.push({ ...entry, headline: evaluation.headline });
    } catch (err) {
      logger.warn(`lens headline failed for '${entry.modelId}': ${(err as Error).message}`);
      models.push({ ...entry, headline: null });
    }
  }

  const body: LensModelList = { models };
  modelsListCache = { at: now, value: body };
  return { status: 200, body };
}

// ─── GET /lens/models/:id/manifest ───────────────────────────────────────────

export async function handleManifestRequest(modelIdRaw: unknown): Promise<HandlerResult> {
  if (!isValidModelId(modelIdRaw)) return badModelId();
  try {
    const loaded = await loadManifest(modelIdRaw);
    if (!loaded) return { status: 404, body: { error: `No lens manifest for '${modelIdRaw}' — build it first` } };
    return { status: 200, body: loaded.manifest };
  } catch (err) {
    logger.error(`lens manifest read failed for '${modelIdRaw}': ${(err as Error).message}`);
    return errorResult(err);
  }
}

// ─── POST /lens/models/:id/build ─────────────────────────────────────────────

const buildsInFlight = new Set<string>();

export async function handleBuildRequest(modelIdRaw: unknown): Promise<HandlerResult> {
  if (!isValidModelId(modelIdRaw)) return badModelId();
  const modelId = modelIdRaw;
  if (!resolveLensDir(modelId)) return badModelId();

  if (buildsInFlight.has(modelId)) {
    return { status: 409, body: { error: `build already running for '${modelId}'` } };
  }
  buildsInFlight.add(modelId);
  try {
    const manifest = await runBuild(modelId);
    evictLensModel(modelId);
    invalidateEvaluationCacheFor(modelId);
    modelsListCache = null; // next /models read reflects the rebuild
    return { status: 200, body: { manifest } };
  } catch (err) {
    if (!(err instanceof LensBuildRefusedError)) {
      logger.error(`lens build failed for '${modelId}': ${(err as Error).message}`);
    }
    return errorResult(err);
  } finally {
    buildsInFlight.delete(modelId);
  }
}

/** Exposed for tests. */
export function clearLensBuildsInFlight(): void {
  buildsInFlight.clear();
}

// ─── GET /lens/models/:id/evaluation ─────────────────────────────────────────

const IntervalCoverageSchema = z.coerce
  .number()
  .refine((v): v is 0.5 | 0.8 | 0.9 => v === 0.5 || v === 0.8 || v === 0.9, {
    message: "intervalCoverage must be 0.5, 0.8, or 0.9",
  });

const EvaluationParamsQuerySchema = z.object({
  threshold: z.coerce.number().finite().optional(),
  costMultiplier: z.coerce.number().finite().optional(),
  rollingWindowBars: z.coerce.number().int().finite().optional(),
  rollingWindowTrades: z.coerce.number().int().finite().optional(),
  regimeLookbackBars: z.coerce.number().int().finite().optional(),
  regimeThreshold: z.coerce.number().finite().optional(),
  intervalCoverage: IntervalCoverageSchema.optional(),
  startTimestampSeconds: z.coerce.number().int().finite().optional(),
  endTimestampSeconds: z.coerce.number().int().finite().optional(),
});

export async function handleEvaluationRequest(modelIdRaw: unknown, query: unknown): Promise<HandlerResult> {
  if (!isValidModelId(modelIdRaw)) return badModelId();
  const modelId = modelIdRaw;

  const parsedQuery = EvaluationParamsQuerySchema.safeParse(query ?? {});
  if (!parsedQuery.success) return { status: 400, body: formatZodErrors(parsedQuery.error) };

  let loaded: LoadedManifest | null;
  try {
    loaded = await loadManifest(modelId);
  } catch (err) {
    logger.error(`lens evaluation manifest load failed for '${modelId}': ${(err as Error).message}`);
    return errorResult(err);
  }
  if (!loaded) return { status: 404, body: { error: `No lens manifest for '${modelId}' — build it first` } };

  const params = clampLensParams(parsedQuery.data as Partial<LensEvaluationParams>, loaded.manifest);
  try {
    const evaluation = await getEvaluation(modelId, loaded.info, loaded.manifest, params);
    return { status: 200, body: evaluation };
  } catch (err) {
    logger.error(`lens evaluation failed for '${modelId}': ${(err as Error).message}`);
    return errorResult(err);
  }
}

// ─── GET /lens/models/:id/bars ────────────────────────────────────────────────

const BarsQuerySchema = EvaluationParamsQuerySchema.extend({
  startRowIndex: z.coerce.number().int().min(0),
  endRowIndex: z.coerce.number().int().min(0),
  maxBars: z.coerce.number().int().min(1).max(LENS_MAX_WINDOW_BARS).optional(),
});

export async function handleBarsRequest(modelIdRaw: unknown, query: unknown): Promise<HandlerResult> {
  if (!isValidModelId(modelIdRaw)) return badModelId();
  const modelId = modelIdRaw;

  const parsedQuery = BarsQuerySchema.safeParse(query ?? {});
  if (!parsedQuery.success) return { status: 400, body: formatZodErrors(parsedQuery.error) };

  let loaded: LoadedManifest | null;
  try {
    loaded = await loadManifest(modelId);
  } catch (err) {
    logger.error(`lens bars manifest load failed for '${modelId}': ${(err as Error).message}`);
    return errorResult(err);
  }
  if (!loaded) return { status: 404, body: { error: `No lens manifest for '${modelId}' — build it first` } };

  const { startRowIndex, endRowIndex, maxBars } = parsedQuery.data;
  const barCount = loaded.manifest.barCount;
  if (!(startRowIndex <= endRowIndex && endRowIndex < barCount)) {
    return {
      status: 400,
      body: {
        error: `row window out of range: expected 0 <= startRowIndex <= endRowIndex < barCount (${barCount})`,
        details: { startRowIndex, endRowIndex, barCount },
      },
    };
  }

  const params = clampLensParams(parsedQuery.data as Partial<LensEvaluationParams>, loaded.manifest);
  try {
    const model = await loadLensModel(modelId, loaded.info.lensDir, loaded.manifest);
    const window: LensBarWindow = buildBarWindow(
      model.series,
      model.attribution,
      loaded.manifest,
      params,
      { startRowIndex, endRowIndex },
      maxBars ?? LENS_MAX_WINDOW_BARS,
    );
    return { status: 200, body: window };
  } catch (err) {
    logger.error(`lens bars failed for '${modelId}': ${(err as Error).message}`);
    return errorResult(err);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get("/lens/models", queryRateLimiter, async (_req: Request, res: Response) => {
  const result = await handleModelsRequest();
  res.status(result.status).json(result.body);
});

router.get("/lens/models/:modelId/manifest", queryRateLimiter, async (req: Request, res: Response) => {
  const result = await handleManifestRequest(req.params.modelId);
  res.status(result.status).json(result.body);
});

router.post("/lens/models/:modelId/build", queryRateLimiter, async (req: Request, res: Response) => {
  const result = await handleBuildRequest(req.params.modelId);
  res.status(result.status).json(result.body);
});

router.get("/lens/models/:modelId/evaluation", queryRateLimiter, async (req: Request, res: Response) => {
  const result = await handleEvaluationRequest(req.params.modelId, req.query);
  res.status(result.status).json(result.body);
});

router.get("/lens/models/:modelId/bars", queryRateLimiter, async (req: Request, res: Response) => {
  const result = await handleBarsRequest(req.params.modelId, req.query);
  res.status(result.status).json(result.body);
});

export default router;
