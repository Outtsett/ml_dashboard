/**
 * Code Generator — TS wrapper that spawns `scripts/generate_model.py`.
 *
 * SRP: this module owns ONLY the spawn handshake + output parsing + LRU cache.
 *      It does NOT write `runners.json` directly — that responsibility lives
 *      in the Python script (`generate_model.py --register`) which already
 *      has the file open and the schema mirrored.
 *
 * DIP: routes/codegen.ts depends on the two exported functions; the spawn
 *      mechanics + cache are private.
 *
 * Two functions exposed:
 *   - generatePreview(payload): spawn with --dry-run, parse JSON, cache result
 *   - saveAndRegister(payload): spawn with --register, write files + patch
 *                               runners.json (Python-side), then invalidate
 *                               registry + bridge caches.
 *
 * Cache key: sha256 of (catalogId, hyperparameters, labelStrategy, labelParams,
 * walkForward, featurePipeline, featureCategories, symbol, timeframe). The
 * `template_version` is part of the value, not the key — first call for a given
 * input tuple is always a miss; the response carries `templateUsed`/`hash` so
 * the frontend can re-key as templates evolve.
 */

import { spawn } from 'child_process';
import path from 'path';
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Logger } from '@nestjs/common';
import { reloadConfigs } from '../../training/registry';
import { refreshBridge } from './catalogBridge';

const logger = new Logger('CodeGenerator');

// ─── Public types (mirrored by frontend via `z.infer`) ──────────────────────

/** Walk-forward block; null when single-fold training is intended. */
export interface WalkForwardConfig {
  trainMonths: number;
  testMonths: number;
  stepMonths: number;
  purgeBars: number;
}

export type LabelStrategy =
  | 'triple_barrier'
  | 'next_close_direction'
  | 'range_bucket'
  | 'structural'
  | 'none';

/**
 * Common payload shape for both preview + save.  The frontend Zod schemas
 * defined in `routes/codegen.ts` produce values matching this interface.
 */
export interface GeneratorPayload {
  catalogId: string;
  modelId?: string;
  hyperparameters: Record<string, number | string | boolean>;
  walkForward: WalkForwardConfig | null;
  labelStrategy: LabelStrategy;
  labelParams: Record<string, number | string | boolean>;
  featurePipeline: string;
  featureCategories: string[];
  symbol: string;
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';
}

export interface SavePayload extends GeneratorPayload {
  modelId: string;
  /** If user edited files in Monaco, send them back to round-trip to disk. */
  files?: Record<string, string>;
  /** Whether to patch `config/runners.json`. Default true. */
  registerInRunners?: boolean;
}

/** Stdout JSON shape from `scripts/generate_model.py --dry-run`. */
export interface GeneratorResult {
  files: Record<string, string>;
  templateUsed: string;
  warnings: string[];
  /** Content-hash of the inputs (sha256, hex). */
  hash: string;
}

/** Stdout JSON shape from `scripts/generate_model.py --register`. */
export interface SaveResult {
  savedPaths: string[];
  runnerKey: string;
  templateUsed: string;
  warnings: string[];
}

/** Raised when the generator script cannot be invoked or returns non-zero. */
export class CodeGeneratorError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'CodeGeneratorError';
  }
}

// ─── Cache (in-memory LRU; 200 entries, 1hr TTL) ────────────────────────────

const previewCache = new LRUCache<string, GeneratorResult>({
  max: 200,
  ttl: 60 * 60 * 1000,
});

function cacheKey(payload: GeneratorPayload): string {
  // Stable key: sort hp + labelParams + featureCategories so JSON.stringify
  // is order-independent.
  const sortObj = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = obj[k];
    return out;
  };
  const canonical = {
    catalogId: payload.catalogId,
    hyperparameters: sortObj(payload.hyperparameters),
    labelStrategy: payload.labelStrategy,
    labelParams: sortObj(payload.labelParams),
    walkForward: payload.walkForward,
    featurePipeline: payload.featurePipeline,
    featureCategories: [...payload.featureCategories].sort(),
    symbol: payload.symbol,
    timeframe: payload.timeframe,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// ─── Python interpreter resolution ──────────────────────────────────────────

/**
 * Resolve the Python interpreter for the generator script. Mirrors the
 * order used by `routes/training.ts::resolvePythonExecutable()`:
 *   1. PYTHON_BIN env var (explicit override)
 *   2. ML_PYTHON env var (alternate name some scripts use)
 *   3. `python` on PATH (works under conda `ml` env auto-activation per
 *      project CLAUDE.md — `~/.bashrc` activates `ml` for every Git Bash
 *      shell, including the one Claude Code's Bash tool spawns).
 */
function resolvePythonExecutable(): string {
  return process.env.PYTHON_BIN || process.env.ML_PYTHON || 'python';
}

// ─── Spawn helpers ──────────────────────────────────────────────────────────

interface SpawnArgs {
  payload: GeneratorPayload | SavePayload;
  /** When true, generator emits files to stdout instead of writing them. */
  dryRun: boolean;
  /** When true (save path), generator patches `config/runners.json`. */
  register: boolean;
  /** Pre-edited files to round-trip to disk during save. */
  filesOverride?: Record<string, string>;
}

function buildArgs({ payload, dryRun, register, filesOverride }: SpawnArgs): string[] {
  const repoRoot = process.cwd();
  const scriptPath = path.resolve(repoRoot, 'scripts', 'generate_model.py');

  // The script requires --model-id and --output-dir on every invocation, even
  // for --dry-run (where neither value is consulted). Provide preview defaults
  // when the caller didn't supply real ones.
  const modelId = payload.modelId
    ?? (dryRun ? `__preview__${payload.catalogId.replace(/-/g, '_')}` : payload.catalogId.replace(/-/g, '_'));
  const outputDir = dryRun
    ? path.resolve(repoRoot, 'src', 'ml', '__preview__')
    : path.resolve(repoRoot, 'src', 'ml', modelId);

  const args: string[] = [
    scriptPath,
    '--catalog-id', payload.catalogId,
    '--model-id', modelId,
    '--hyperparameters-json', JSON.stringify(payload.hyperparameters),
    '--label-strategy', payload.labelStrategy,
    '--label-params-json', JSON.stringify(payload.labelParams),
    '--feature-pipeline', payload.featurePipeline,
    '--feature-categories-json', JSON.stringify(payload.featureCategories),
    '--symbol', payload.symbol,
    '--timeframe', payload.timeframe,
    '--template-dir', path.resolve(repoRoot, 'src', 'templates', 'architectures'),
    '--output-dir', outputDir,
  ];

  if (payload.walkForward) {
    args.push('--walk-forward-json', JSON.stringify(payload.walkForward));
  }

  if (dryRun) {
    args.push('--dry-run');
  }

  if (register) {
    args.push('--register');
  }

  if (filesOverride && Object.keys(filesOverride).length > 0) {
    // Pass edited files via JSON blob; generator will write these verbatim
    // instead of re-rendering the templates. NOTE: this CLI flag is part
    // of the W1.d ↔ W1.a contract and must be honored by generate_model.py.
    args.push('--files-override-json', JSON.stringify(filesOverride));
  }

  return args;
}

interface SpawnOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  killedByTimeout: boolean;
}

const SPAWN_TIMEOUT_MS = 90_000;

function spawnGenerator(args: string[]): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const py = resolvePythonExecutable();
    logger.log(`Spawning: ${py} ${args.join(' ')}`);

    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;

    let child;
    try {
      child = spawn(py, args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        windowsHide: true,
      });
    } catch (err) {
      return reject(new CodeGeneratorError(
        `Failed to spawn Python: ${(err as Error).message}`,
        '',
        null,
      ));
    }

    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }, SPAWN_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(new CodeGeneratorError(
        `Failed to spawn Python: ${err.message}`,
        stderr,
        null,
      ));
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, killedByTimeout });
    });
  });
}

/**
 * Reverse-scan stdout for the last line that parses as JSON and contains the
 * required key. Mirrors the pattern in `runFeaturesPreview` (training.ts).
 * The script may emit protocol JSONL events (logs/progress) BEFORE the final
 * result line.
 */
function extractResultJson<T>(stdout: string, requiredKey: string): T | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && requiredKey in parsed) {
        return parsed as T;
      }
    } catch {
      // not JSON — keep scanning earlier lines
    }
  }
  return null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate code WITHOUT writing to disk. Result is cached in-memory keyed by
 * a content-hash of the payload. Subsequent calls with identical inputs are
 * served from cache.
 *
 * The cache is intentionally keyed by INPUT only (not template version) — the
 * response carries `templateUsed` so the frontend can detect drift; if a
 * template is updated server-side, restart or call `clearPreviewCache()`.
 */
export async function generatePreview(
  payload: GeneratorPayload,
): Promise<GeneratorResult> {
  const key = cacheKey(payload);
  const cached = previewCache.get(key);
  if (cached) {
    logger.debug(`Cache hit for ${payload.catalogId} (${key.slice(0, 8)}...)`);
    return cached;
  }

  const args = buildArgs({ payload, dryRun: true, register: false });
  const outcome = await spawnGenerator(args);

  if (outcome.killedByTimeout) {
    throw new CodeGeneratorError(
      `Code generation timed out (>${SPAWN_TIMEOUT_MS / 1000}s)`,
      outcome.stderr.slice(-2000),
      null,
    );
  }

  if (outcome.exitCode !== 0) {
    throw new CodeGeneratorError(
      `Generator exited with code ${outcome.exitCode}`,
      outcome.stderr.slice(-2000),
      outcome.exitCode,
    );
  }

  const parsed = extractResultJson<{
    files: Record<string, string>;
    templateUsed: string;
    warnings?: string[];
  }>(outcome.stdout, 'files');

  if (!parsed) {
    throw new CodeGeneratorError(
      'Generator exited 0 but produced no parseable JSON result line',
      outcome.stderr.slice(-2000),
      outcome.exitCode,
    );
  }

  const result: GeneratorResult = {
    files: parsed.files,
    templateUsed: parsed.templateUsed,
    warnings: parsed.warnings ?? [],
    hash: key,
  };

  previewCache.set(key, result);
  return result;
}

/**
 * Materialize generated code to disk and (optionally) patch `runners.json`.
 *
 * Python (`generate_model.py --register`) owns the `runners.json` write per
 * backend sub-plan §3 — the file is hand-curated + multi-author + read by
 * both Node and Python; centralising the write in Python avoids a second IPC
 * hop and keeps the schema mirror in one place.
 *
 * After spawn returns 0, we invalidate two server-side caches synchronously:
 *   - `reloadConfigs()` (registry) — so the next /api/training/start sees
 *     the new runner key
 *   - `refreshBridge()` (catalogBridge) — so /api/model-catalog/trainable
 *     reflects the new wired runner
 */
export async function saveAndRegister(payload: SavePayload): Promise<SaveResult> {
  const args = buildArgs({
    payload,
    dryRun: false,
    register: payload.registerInRunners ?? true,
    filesOverride: payload.files,
  });
  const outcome = await spawnGenerator(args);

  if (outcome.killedByTimeout) {
    throw new CodeGeneratorError(
      `Code save timed out (>${SPAWN_TIMEOUT_MS / 1000}s)`,
      outcome.stderr.slice(-2000),
      null,
    );
  }

  if (outcome.exitCode !== 0) {
    throw new CodeGeneratorError(
      `Generator exited with code ${outcome.exitCode}`,
      outcome.stderr.slice(-2000),
      outcome.exitCode,
    );
  }

  const parsed = extractResultJson<{
    savedPaths: string[];
    runnerKey: string;
    templateUsed: string;
    warnings?: string[];
  }>(outcome.stdout, 'savedPaths');

  if (!parsed) {
    throw new CodeGeneratorError(
      'Generator exited 0 but produced no parseable JSON result line',
      outcome.stderr.slice(-2000),
      outcome.exitCode,
    );
  }

  // Invalidate downstream caches so the next /api/training/start + the next
  // /api/model-catalog/trainable both see the new runner.
  try {
    reloadConfigs();
    refreshBridge();
  } catch (err) {
    logger.warn(`Cache invalidation after save failed: ${(err as Error).message}`);
  }

  return {
    savedPaths: parsed.savedPaths,
    runnerKey: parsed.runnerKey,
    templateUsed: parsed.templateUsed,
    warnings: parsed.warnings ?? [],
  };
}

/** Clear the preview cache. Exposed for tests + admin tools. */
export function clearPreviewCache(): void {
  previewCache.clear();
}

/** Cache stats for diagnostics. */
export function getPreviewCacheStats(): { size: number; max: number } {
  return { size: previewCache.size, max: previewCache.max };
}
