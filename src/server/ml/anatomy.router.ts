/**
 * Anatomy Routes — HTTP layer for tree-ensemble model introspection.
 *
 * SRP: parse + validate via Zod, dispatch to the Python dump script, format
 *      response. No business logic inline — tree parsing / summarisation
 *      lives in `scripts/dump_model_trees.py`.
 * DIP: all three endpoints go through `runDumpScript()` (spawn abstraction)
 *      and `findArtifact()` (filesystem abstraction); handlers are exported
 *      as pure-ish `{ status, body }` functions for direct unit testing.
 *
 * Routes (CONTRACT-API — client consumes exactly these shapes):
 *   GET /api/anatomy/models
 *     -> { models: Array<{ modelId, learner, nTrees, nFeatures, features,
 *                          sizeBytes, modifiedAt }> }
 *        (200 with models: [] when none found)
 *   GET /api/anatomy/trees/:modelId?start=0&count=4
 *     -> { modelId, nTrees, features, start, count, trees: XgbTreeNode[] }
 *   GET /api/anatomy/forest/:modelId
 *     -> { modelId, nTrees, features, maxDepth, avgLeaves, featureUsage,
 *          depthHistogram, leafValues }
 *
 * Errors: 404 { error } for unknown modelId; 400 { error } for invalid
 * params. modelId regex ^[A-Za-z0-9_+.\-]{1,128}$ + must resolve to a direct
 * subdir of data/models (path-traversal guarded — '.'/'..' rejected at
 * validation, resolved-path direct-child check as second layer).
 *
 * Caching: model artifacts are immutable in practice; every cache key folds
 * in the artifact's (mtimeMs, size) so a retrained/replaced artifact is
 * correct anyway without manual invalidation.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { spawn } from 'child_process';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { LRUCache } from 'lru-cache';
import { Logger } from '@nestjs/common';
import { queryRateLimiter } from '../infrastructure/lib/rateLimiter';

const router = Router();
const logger = new Logger('AnatomyRoutes');

// ─── Contract types ──────────────────────────────────────────────────────────

/** Raw xgboost JSON dump node (get_dump(dump_format='json', with_stats=True)).
 *  sklearn ensembles are re-emitted in this same schema by the Python side. */
export interface XgbTreeNode {
  nodeid: number;
  depth?: number;
  split?: string;
  split_condition?: number;
  yes?: number;
  no?: number;
  missing?: number;
  gain?: number;
  cover: number;
  leaf?: number;
  children?: XgbTreeNode[];
}

export type AnatomyLearner = 'xgboost' | 'sklearn';

export interface AnatomyModelSummary {
  modelId: string;
  learner: AnatomyLearner;
  nTrees: number;
  nFeatures: number;
  features: string[];
  sizeBytes: number;
  modifiedAt: string;
}

export interface AnatomyModelsResponse {
  models: AnatomyModelSummary[];
}

export interface AnatomyTreesResponse {
  modelId: string;
  nTrees: number;
  features: string[];
  start: number;
  count: number;
  trees: XgbTreeNode[];
}

export interface AnatomyForestResponse {
  modelId: string;
  nTrees: number;
  features: string[];
  maxDepth: number;
  avgLeaves: number;
  featureUsage: Array<{ feature: string; nSplits: number; totalGain: number; totalCover: number }>;
  depthHistogram: Array<{ depth: number; count: number }>;
  leafValues: {
    min: number;
    max: number;
    mean: number;
    histogram: Array<{ x0: number; x1: number; count: number }>;
  };
}

/** Generic handler outcome so route bodies stay one-liners and tests can
 *  assert HTTP semantics without supertest. */
export interface HandlerResult {
  status: number;
  body: unknown;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export const MODEL_ID_RE = /^[A-Za-z0-9_+.\-]{1,128}$/;

/** '.'/'..' pass the char-class regex but are path traversal — reject them
 *  explicitly. Path separators are already excluded by the regex. */
export function isValidModelId(id: unknown): id is string {
  return typeof id === 'string' && MODEL_ID_RE.test(id) && id !== '.' && id !== '..';
}

const TreesQuery = z.object({
  start: z.coerce.number().int().min(0).default(0),
  count: z.coerce.number().int().min(1).max(12).default(4),
});
export type TreesQueryInput = z.infer<typeof TreesQuery>;

function formatZodErrors(error: z.ZodError): { error: string; details: unknown } {
  return {
    error: 'Invalid query parameters',
    details: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    })),
  };
}

// ─── Python payload schemas (light shape checks on script output) ───────────

const LearnerSchema = z.enum(['xgboost', 'sklearn']);

const MetaPayload = z.object({
  learner: LearnerSchema,
  nTrees: z.number().int().nonnegative(),
  nFeatures: z.number().int().nonnegative(),
  features: z.array(z.string()),
});

const TreesPayload = z.object({
  learner: LearnerSchema,
  nTrees: z.number().int().nonnegative(),
  features: z.array(z.string()),
  start: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  trees: z.array(z.unknown()),
});

const ForestPayload = z.object({
  learner: LearnerSchema,
  nTrees: z.number().int().nonnegative(),
  features: z.array(z.string()),
  maxDepth: z.number(),
  avgLeaves: z.number(),
  featureUsage: z.array(z.object({
    feature: z.string(),
    nSplits: z.number(),
    totalGain: z.number(),
    totalCover: z.number(),
  })),
  depthHistogram: z.array(z.object({ depth: z.number(), count: z.number() })),
  leafValues: z.object({
    min: z.number(),
    max: z.number(),
    mean: z.number(),
    histogram: z.array(z.object({ x0: z.number(), x1: z.number(), count: z.number() })),
  }),
});

// ─── Errors ──────────────────────────────────────────────────────────────────

export class AnatomyError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'AnatomyError';
  }
}

// ─── Artifact resolution ─────────────────────────────────────────────────────

const ARTIFACT_FILES = ['model.ubj', 'model.pkl', 'model.joblib'] as const;

export interface ArtifactInfo {
  modelId: string;
  dir: string;
  artifactPath: string;
  mtimeMs: number;
  size: number;
}

function dataModelsRoot(): string {
  return path.resolve(process.cwd(), 'data', 'models');
}

/**
 * Resolve a modelId to its model directory + first supported artifact file.
 * Returns null when the id escapes data/models, the dir doesn't exist, or no
 * supported artifact is present. Never passes user input to a shell — the
 * resolved dir only ever rides in a spawn() argument array.
 */
export async function findArtifact(modelId: string): Promise<ArtifactInfo | null> {
  const root = dataModelsRoot();
  const dir = path.resolve(root, modelId);
  // Second traversal layer: resolved path must be a DIRECT child of data/models.
  if (path.dirname(dir) !== root) return null;
  for (const file of ARTIFACT_FILES) {
    const candidate = path.join(dir, file);
    try {
      const st = await stat(candidate);
      if (st.isFile()) {
        return { modelId, dir, artifactPath: candidate, mtimeMs: st.mtimeMs, size: st.size };
      }
    } catch {
      // candidate missing — keep scanning
    }
  }
  return null;
}

// ─── Spawn plumbing (mirrors eval.router.ts conventions) ────────────────────

function resolvePythonExecutable(): string {
  return process.env.PYTHON_BIN || process.env.ML_PYTHON || 'python';
}

const DUMP_TIMEOUT_MS = 60_000;

interface SpawnOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  killedByTimeout: boolean;
}

function spawnDump(args: string[]): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const py = resolvePythonExecutable();
    const repoRoot = process.cwd();
    const scriptPath = path.resolve(repoRoot, 'scripts', 'dump_model_trees.py');

    logger.log(`Spawning dump_model_trees: ${py} ${scriptPath} ${args.join(' ')}`);

    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;

    let child;
    try {
      child = spawn(py, [scriptPath, ...args], {
        cwd: repoRoot,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        windowsHide: true,
      });
    } catch (err) {
      return reject(new AnatomyError(
        `Failed to spawn Python: ${(err as Error).message}`,
        '',
        null,
      ));
    }

    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }, DUMP_TIMEOUT_MS);

    // The dump CLI does not read stdin — everything rides on argv.
    // Close stdin immediately so the child doesn't block on EOF.
    try { child.stdin.end(); } catch { /* ignore */ }

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(new AnatomyError(`Failed to spawn Python: ${err.message}`, stderr, null));
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, killedByTimeout });
    });
  });
}

/**
 * Reverse-scan stdout for the last JSON object line. The uv venv may emit
 * noise lines (warnings, numba JIT chatter) before the single result line.
 */
function extractJsonLine(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // not JSON — keep scanning
    }
  }
  return null;
}

/** Spawn the dump script and return its parsed JSON result. Exposed for tests. */
export async function runDumpScript(args: string[]): Promise<Record<string, unknown>> {
  const outcome = await spawnDump(args);

  if (outcome.killedByTimeout) {
    throw new AnatomyError(
      `dump_model_trees timed out (>${DUMP_TIMEOUT_MS / 1000}s)`,
      outcome.stderr.slice(-2000),
      null,
    );
  }

  const parsed = extractJsonLine(outcome.stdout);

  if (outcome.exitCode !== 0) {
    const scriptError = parsed && typeof parsed.error === 'string' ? `: ${parsed.error}` : '';
    throw new AnatomyError(
      `dump_model_trees exited with code ${outcome.exitCode}${scriptError}`,
      outcome.stderr.slice(-2000),
      outcome.exitCode,
    );
  }

  if (!parsed) {
    throw new AnatomyError(
      'dump_model_trees exited 0 but produced no parseable JSON result line',
      outcome.stderr.slice(-2000),
      outcome.exitCode,
    );
  }

  if (typeof parsed.error === 'string') {
    throw new AnatomyError(
      `dump_model_trees reported: ${parsed.error}`,
      outcome.stderr.slice(-2000),
      outcome.exitCode,
    );
  }

  return parsed;
}

// ─── Caches (keyed by artifact identity — mtime + size — so retrains bust) ──

interface CachedMeta {
  learner: AnatomyLearner;
  nTrees: number;
  nFeatures: number;
  features: string[];
}

const metaCache = new LRUCache<string, CachedMeta>({ max: 100, ttl: 60 * 60 * 1000 });
const treesCache = new LRUCache<string, AnatomyTreesResponse>({ max: 200, ttl: 60 * 60 * 1000 });
const forestCache = new LRUCache<string, AnatomyForestResponse>({ max: 100, ttl: 60 * 60 * 1000 });

function artifactKey(artifact: ArtifactInfo): string {
  return `${artifact.artifactPath}|${artifact.mtimeMs}|${artifact.size}`;
}

/** Clear all anatomy LRU caches. Exposed for tests + admin tools. */
export function clearAnatomyCaches(): void {
  metaCache.clear();
  treesCache.clear();
  forestCache.clear();
}

// ─── Data access (cached spawn wrappers) ─────────────────────────────────────

async function getModelMeta(artifact: ArtifactInfo): Promise<CachedMeta> {
  const key = artifactKey(artifact);
  const cached = metaCache.get(key);
  if (cached) return cached;

  const raw = await runDumpScript(['--model-dir', artifact.dir, '--list-meta']);
  const parsed = MetaPayload.safeParse(raw);
  if (!parsed.success) {
    throw new AnatomyError('dump_model_trees emitted a malformed --list-meta payload', '', 0);
  }
  metaCache.set(key, parsed.data);
  return parsed.data;
}

async function getTrees(artifact: ArtifactInfo, start: number, count: number): Promise<AnatomyTreesResponse> {
  const key = `${artifactKey(artifact)}|${start}|${count}`;
  const cached = treesCache.get(key);
  if (cached) return cached;

  const raw = await runDumpScript([
    '--model-dir', artifact.dir,
    '--trees',
    '--start', String(start),
    '--count', String(count),
  ]);
  const parsed = TreesPayload.safeParse(raw);
  if (!parsed.success) {
    throw new AnatomyError('dump_model_trees emitted a malformed --trees payload', '', 0);
  }
  const body: AnatomyTreesResponse = {
    modelId: artifact.modelId,
    nTrees: parsed.data.nTrees,
    features: parsed.data.features,
    start: parsed.data.start,
    count: parsed.data.count,
    trees: parsed.data.trees as XgbTreeNode[],
  };
  treesCache.set(key, body);
  return body;
}

async function getForest(artifact: ArtifactInfo): Promise<AnatomyForestResponse> {
  const key = artifactKey(artifact);
  const cached = forestCache.get(key);
  if (cached) return cached;

  const raw = await runDumpScript(['--model-dir', artifact.dir, '--summary']);
  const parsed = ForestPayload.safeParse(raw);
  if (!parsed.success) {
    throw new AnatomyError('dump_model_trees emitted a malformed --summary payload', '', 0);
  }
  const body: AnatomyForestResponse = {
    modelId: artifact.modelId,
    nTrees: parsed.data.nTrees,
    features: parsed.data.features,
    maxDepth: parsed.data.maxDepth,
    avgLeaves: parsed.data.avgLeaves,
    featureUsage: parsed.data.featureUsage,
    depthHistogram: parsed.data.depthHistogram,
    leafValues: parsed.data.leafValues,
  };
  forestCache.set(key, body);
  return body;
}

// ─── Handlers (exported for direct unit testing without supertest) ──────────

function errorResult(err: unknown): HandlerResult {
  if (err instanceof AnatomyError) {
    return {
      status: 500,
      body: { error: err.message, details: { stderr: err.stderr, exitCode: err.exitCode } },
    };
  }
  return { status: 500, body: { error: (err as Error)?.message ?? String(err) } };
}

export async function handleModelsRequest(): Promise<HandlerResult> {
  const root = dataModelsRoot();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    // data/models missing entirely → contract says 200 with models: [].
    return { status: 200, body: { models: [] } satisfies AnatomyModelsResponse };
  }

  const models: AnatomyModelSummary[] = [];
  // Sequential scan: ~16 dirs, only a couple with artifacts (spawn only for
  // those) — no concurrency machinery needed.
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidModelId(entry.name)) continue;
    const artifact = await findArtifact(entry.name);
    if (!artifact) continue;
    try {
      const meta = await getModelMeta(artifact);
      models.push({
        modelId: entry.name,
        learner: meta.learner,
        nTrees: meta.nTrees,
        nFeatures: meta.nFeatures,
        features: meta.features,
        sizeBytes: artifact.size,
        modifiedAt: new Date(artifact.mtimeMs).toISOString(),
      });
    } catch (err) {
      // One broken artifact must not take down the whole listing.
      logger.warn(`anatomy meta failed for '${entry.name}': ${(err as Error).message}`);
    }
  }
  return { status: 200, body: { models } satisfies AnatomyModelsResponse };
}

export async function handleTreesRequest(modelIdRaw: unknown, query: unknown): Promise<HandlerResult> {
  if (!isValidModelId(modelIdRaw)) {
    return { status: 400, body: { error: 'Invalid modelId (expected ^[A-Za-z0-9_+.\\-]{1,128}$, no traversal)' } };
  }
  const parsed = TreesQuery.safeParse(query ?? {});
  if (!parsed.success) {
    return { status: 400, body: formatZodErrors(parsed.error) };
  }
  const artifact = await findArtifact(modelIdRaw);
  if (!artifact) {
    return { status: 404, body: { error: `Unknown modelId: ${modelIdRaw}` } };
  }
  try {
    const body = await getTrees(artifact, parsed.data.start, parsed.data.count);
    return { status: 200, body };
  } catch (err) {
    logger.error(`anatomy trees failed for '${modelIdRaw}': ${(err as Error).message}`);
    return errorResult(err);
  }
}

export async function handleForestRequest(modelIdRaw: unknown): Promise<HandlerResult> {
  if (!isValidModelId(modelIdRaw)) {
    return { status: 400, body: { error: 'Invalid modelId (expected ^[A-Za-z0-9_+.\\-]{1,128}$, no traversal)' } };
  }
  const artifact = await findArtifact(modelIdRaw);
  if (!artifact) {
    return { status: 404, body: { error: `Unknown modelId: ${modelIdRaw}` } };
  }
  try {
    const body = await getForest(artifact);
    return { status: 200, body };
  } catch (err) {
    logger.error(`anatomy forest failed for '${modelIdRaw}': ${(err as Error).message}`);
    return errorResult(err);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/anatomy/models', queryRateLimiter, async (_req: Request, res: Response) => {
  const result = await handleModelsRequest();
  res.status(result.status).json(result.body);
});

router.get('/anatomy/trees/:modelId', queryRateLimiter, async (req: Request, res: Response) => {
  const result = await handleTreesRequest(req.params.modelId, req.query);
  res.status(result.status).json(result.body);
});

router.get('/anatomy/forest/:modelId', queryRateLimiter, async (req: Request, res: Response) => {
  const result = await handleForestRequest(req.params.modelId);
  res.status(result.status).json(result.body);
});

export default router;
