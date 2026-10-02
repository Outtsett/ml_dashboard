/**
 * apps/api/tests/anatomy.test.ts
 *
 * Coverage for apps/api/ml/anatomy.router.ts:
 *   - valid trees request spawns dump_model_trees.py with expected args and
 *     parses the JSON result line
 *   - cache hit (same modelId + mtime/size + start/count) does not respawn
 *   - invalid modelId (traversal '..', bad chars, over-length) -> 400
 *   - unknown modelId -> 404 (no spawn)
 *   - malformed python stdout -> 500 with stderr surfaced
 *   - models listing: empty data/models dir (and missing dir) -> { models: [] }
 *   - models listing: dirs with artifacts produce meta rows; artifact-less
 *     dirs are skipped
 *
 * Strategy (mirrors apps/api/tests/eval.test.ts): mock `child_process.spawn`
 * with an EventEmitter shim + steerable handler so no real Python runs, and
 * mock `fs/promises` so no real data/models fixture is needed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import path from 'path';

// ── Mock child_process BEFORE importing the route module ────────────────────
type SpawnMockHandler = (args: string[]) => {
  stdout: string;
  stderr?: string;
  exitCode?: number | null;
  error?: Error;
};

let spawnHandler: SpawnMockHandler = () => ({ stdout: '', exitCode: 0 });
const spawnCalls: Array<{ command: string; args: string[] }> = [];

vi.mock('child_process', () => {
  return {
    spawn: vi.fn((command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { write: (data: string) => void; end: () => void };
        kill: (sig?: string) => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        write: () => { /* dump CLI reads nothing from stdin */ },
        end: () => {
          // Flush after end() so the route module has had time to attach
          // its 'data' / 'close' listeners.
          queueMicrotask(() => {
            spawnCalls.push({ command, args });
            const result = spawnHandler(args);
            if (result.error) {
              child.emit('error', result.error);
              return;
            }
            if (result.stdout) child.stdout.emit('data', Buffer.from(result.stdout, 'utf8'));
            if (result.stderr) child.stderr.emit('data', Buffer.from(result.stderr, 'utf8'));
            child.emit('close', result.exitCode ?? 0);
          });
        },
      };
      child.kill = () => { /* no-op for tests */ };
      return child;
    }),
  };
});

// ── Mock fs/promises so artifact resolution is steerable without fixtures ───
interface FakeStat { mtimeMs: number; size: number }
const fakeFiles = new Map<string, FakeStat>();
let readdirImpl: () => Array<{ name: string; isDirectory: () => boolean }> = () => [];
let readdirThrows: Error | null = null;

vi.mock('fs/promises', () => ({
  readdir: vi.fn(async () => {
    if (readdirThrows) throw readdirThrows;
    return readdirImpl();
  }),
  stat: vi.fn(async (p: string) => {
    const entry = fakeFiles.get(path.normalize(p));
    if (!entry) {
      const err = new Error(`ENOENT: no such file or directory, stat '${p}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return {
      isFile: () => true,
      isDirectory: () => false,
      mtimeMs: entry.mtimeMs,
      size: entry.size,
    };
  }),
}));

// ── Now import the route module (after mocks are registered) ────────────────
import {
  handleModelsRequest,
  handleTreesRequest,
  handleForestRequest,
  clearAnatomyCaches,
  isValidModelId,
  type AnatomyTreesResponse,
  type AnatomyForestResponse,
  type AnatomyModelsResponse,
} from '../ml/anatomy.router';

const ROOT = path.resolve(process.cwd(), 'data', 'models');

function registerArtifact(
  modelId: string,
  file = 'model.ubj',
  mtimeMs = 1_700_000_000_000,
  size = 4096,
): void {
  fakeFiles.set(path.normalize(path.join(ROOT, modelId, file)), { mtimeMs, size });
}

const VALID_TREES_STDOUT = JSON.stringify({
  learner: 'xgboost',
  nTrees: 69,
  features: ['return_1', 'return_5', 'volatility_10'],
  start: 0,
  count: 2,
  trees: [
    {
      nodeid: 0,
      depth: 0,
      split: 'return_1',
      split_condition: 0.001,
      yes: 1,
      no: 2,
      missing: 1,
      gain: 31.3,
      cover: 2065.5,
      children: [
        { nodeid: 1, leaf: -0.01, cover: 1000 },
        { nodeid: 2, leaf: 0.02, cover: 1065.5 },
      ],
    },
    { nodeid: 0, leaf: 0.0, cover: 50 },
  ],
}) + '\n';

const VALID_META_STDOUT = JSON.stringify({
  learner: 'xgboost',
  nTrees: 69,
  nFeatures: 3,
  features: ['return_1', 'return_5', 'volatility_10'],
}) + '\n';

const VALID_FOREST_STDOUT = JSON.stringify({
  learner: 'xgboost',
  nTrees: 69,
  features: ['return_1', 'return_5', 'volatility_10'],
  maxDepth: 6,
  avgLeaves: 48.7,
  featureUsage: [
    { feature: 'return_1', nSplits: 211, totalGain: 1496.7, totalCover: 61037.7 },
  ],
  depthHistogram: [{ depth: 6, count: 2846 }],
  leafValues: {
    min: -0.0856,
    max: 0.0887,
    mean: -0.0006,
    histogram: [{ x0: -0.0856, x1: -0.071, count: 68 }],
  },
}) + '\n';

beforeEach(() => {
  clearAnatomyCaches();
  spawnCalls.length = 0;
  fakeFiles.clear();
  readdirImpl = () => [];
  readdirThrows = null;
  spawnHandler = () => ({ stdout: VALID_TREES_STDOUT, exitCode: 0 });
});

// ── modelId validation ───────────────────────────────────────────────────────
describe('isValidModelId', () => {
  it('accepts contract-conformant ids', () => {
    expect(isValidModelId('xgb_baseline_post')).toBe(true);
    expect(isValidModelId('xgboost+direction_classifier')).toBe(true);
    expect(isValidModelId('MNQ_1m_cnn-transformer_20260328T064526')).toBe(true);
    expect(isValidModelId('a.b-c_d+e')).toBe(true);
  });

  it('rejects traversal and bad characters', () => {
    expect(isValidModelId('..')).toBe(false);
    expect(isValidModelId('.')).toBe(false);
    expect(isValidModelId('../xgb_baseline_post')).toBe(false);
    expect(isValidModelId('foo/bar')).toBe(false);
    expect(isValidModelId('foo\\bar')).toBe(false);
    expect(isValidModelId('has space')).toBe(false);
    expect(isValidModelId('')).toBe(false);
    expect(isValidModelId('x'.repeat(129))).toBe(false);
    expect(isValidModelId(undefined)).toBe(false);
    expect(isValidModelId(42)).toBe(false);
  });
});

// ── GET /anatomy/trees/:modelId ──────────────────────────────────────────────
describe('handleTreesRequest', () => {
  it('spawns dump_model_trees.py with expected args and parses the JSON result', async () => {
    registerArtifact('xgb_test');
    const result = await handleTreesRequest('xgb_test', { start: '0', count: '2' });
    expect(result.status).toBe(200);

    const body = result.body as AnatomyTreesResponse;
    expect(body.modelId).toBe('xgb_test');
    expect(body.nTrees).toBe(69);
    expect(body.features).toHaveLength(3);
    expect(body.start).toBe(0);
    expect(body.count).toBe(2);
    expect(body.trees).toHaveLength(2);
    expect(body.trees[0]!.split).toBe('return_1');
    expect(body.trees[0]!.split_condition).toBeCloseTo(0.001);
    expect(body.trees[0]!.children).toHaveLength(2);
    expect(body.trees[0]!.cover).toBeCloseTo(2065.5);

    expect(spawnCalls.length).toBe(1);
    const call = spawnCalls[0]!;
    // spawn(py, [scriptPath, ...args])
    expect(call.args[0]!.replace(/\\/g, '/')).toMatch(/scripts\/dump_model_trees\.py$/);
    const dirIdx = call.args.indexOf('--model-dir');
    expect(dirIdx).toBeGreaterThanOrEqual(0);
    expect(path.normalize(call.args[dirIdx + 1]!)).toBe(path.normalize(path.join(ROOT, 'xgb_test')));
    expect(call.args).toContain('--trees');
    const startIdx = call.args.indexOf('--start');
    expect(call.args[startIdx + 1]).toBe('0');
    const countIdx = call.args.indexOf('--count');
    expect(call.args[countIdx + 1]).toBe('2');
    // User input never reaches a shell — spawn arg array only, no --list-meta/--summary.
    expect(call.args).not.toContain('--list-meta');
    expect(call.args).not.toContain('--summary');
  });

  it('applies start=0 count=4 defaults when query params are absent', async () => {
    registerArtifact('xgb_test');
    const result = await handleTreesRequest('xgb_test', {});
    expect(result.status).toBe(200);
    const call = spawnCalls[0]!;
    expect(call.args[call.args.indexOf('--start') + 1]).toBe('0');
    expect(call.args[call.args.indexOf('--count') + 1]).toBe('4');
  });

  it('cache hit does not respawn (same modelId + params)', async () => {
    registerArtifact('xgb_test');
    await handleTreesRequest('xgb_test', { start: '0', count: '2' });
    expect(spawnCalls.length).toBe(1);
    const second = await handleTreesRequest('xgb_test', { start: '0', count: '2' });
    expect(second.status).toBe(200);
    expect(spawnCalls.length).toBe(1); // still 1 — cached
  });

  it('different start invalidates the cache key (respawns)', async () => {
    registerArtifact('xgb_test');
    await handleTreesRequest('xgb_test', { start: '0', count: '2' });
    await handleTreesRequest('xgb_test', { start: '2', count: '2' });
    expect(spawnCalls.length).toBe(2);
  });

  it("rejects traversal modelId '..' with 400 (no spawn, no fs probe)", async () => {
    const result = await handleTreesRequest('..', {});
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toMatch(/modelId/i);
    expect(spawnCalls.length).toBe(0);
  });

  it('rejects bad-character modelIds with 400', async () => {
    for (const bad of ['../xgb', 'a/b', 'a\\b', 'a b', 'x'.repeat(129), '']) {
      const result = await handleTreesRequest(bad, {});
      expect(result.status).toBe(400);
    }
    expect(spawnCalls.length).toBe(0);
  });

  it('rejects invalid query params with 400 (count out of 1..12, negative start)', async () => {
    registerArtifact('xgb_test');
    expect((await handleTreesRequest('xgb_test', { count: '0' })).status).toBe(400);
    expect((await handleTreesRequest('xgb_test', { count: '13' })).status).toBe(400);
    expect((await handleTreesRequest('xgb_test', { start: '-1' })).status).toBe(400);
    expect((await handleTreesRequest('xgb_test', { start: 'abc' })).status).toBe(400);
    expect(spawnCalls.length).toBe(0);
  });

  it('returns 404 for a well-formed but unknown modelId (no spawn)', async () => {
    const result = await handleTreesRequest('does_not_exist', {});
    expect(result.status).toBe(404);
    expect((result.body as { error: string }).error).toContain('does_not_exist');
    expect(spawnCalls.length).toBe(0);
  });

  it('returns 500 with stderr surfaced when python stdout is malformed', async () => {
    registerArtifact('xgb_test');
    spawnHandler = () => ({
      stdout: 'numba jit warning noise\nnot json at all\n',
      stderr: 'Traceback: something exploded',
      exitCode: 0,
    });
    const result = await handleTreesRequest('xgb_test', {});
    expect(result.status).toBe(500);
    const body = result.body as { error: string; details: { stderr: string; exitCode: number | null } };
    expect(body.error).toContain('no parseable JSON result line');
    expect(body.details.stderr).toContain('Traceback: something exploded');
  });

  it('returns 500 with exit code + script error message on non-zero exit', async () => {
    registerArtifact('xgb_test');
    spawnHandler = () => ({
      stdout: JSON.stringify({ error: 'failed to load xgboost model: bad magic' }) + '\n',
      stderr: 'ImportError-ish noise',
      exitCode: 2,
    });
    const result = await handleTreesRequest('xgb_test', {});
    expect(result.status).toBe(500);
    const body = result.body as { error: string; details: { stderr: string; exitCode: number | null } };
    expect(body.error).toContain('exited with code 2');
    expect(body.error).toContain('failed to load xgboost model');
    expect(body.details.exitCode).toBe(2);
    expect(body.details.stderr).toContain('ImportError-ish noise');
  });

  it('skips venv noise lines and parses the last JSON line (reverse scan)', async () => {
    registerArtifact('xgb_test');
    spawnHandler = () => ({
      stdout: 'uv warning: something\nplain log line\n' + VALID_TREES_STDOUT,
      exitCode: 0,
    });
    const result = await handleTreesRequest('xgb_test', {});
    expect(result.status).toBe(200);
    expect((result.body as AnatomyTreesResponse).nTrees).toBe(69);
  });
});

// ── GET /anatomy/forest/:modelId ─────────────────────────────────────────────
describe('handleForestRequest', () => {
  it('spawns --summary and returns the forest aggregate body', async () => {
    registerArtifact('xgb_test');
    spawnHandler = () => ({ stdout: VALID_FOREST_STDOUT, exitCode: 0 });
    const result = await handleForestRequest('xgb_test');
    expect(result.status).toBe(200);

    const body = result.body as AnatomyForestResponse;
    expect(body.modelId).toBe('xgb_test');
    expect(body.nTrees).toBe(69);
    expect(body.maxDepth).toBe(6);
    expect(body.avgLeaves).toBeCloseTo(48.7);
    expect(body.featureUsage[0]!.feature).toBe('return_1');
    expect(body.depthHistogram[0]).toEqual({ depth: 6, count: 2846 });
    expect(body.leafValues.min).toBeCloseTo(-0.0856);
    expect(body.leafValues.histogram).toHaveLength(1);

    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0]!.args).toContain('--summary');
  });

  it('caches by (modelId, mtime, size) — second call does not respawn', async () => {
    registerArtifact('xgb_test');
    spawnHandler = () => ({ stdout: VALID_FOREST_STDOUT, exitCode: 0 });
    await handleForestRequest('xgb_test');
    await handleForestRequest('xgb_test');
    expect(spawnCalls.length).toBe(1);
  });

  it('changed artifact mtime busts the forest cache', async () => {
    registerArtifact('xgb_test', 'model.ubj', 1_000);
    spawnHandler = () => ({ stdout: VALID_FOREST_STDOUT, exitCode: 0 });
    await handleForestRequest('xgb_test');
    registerArtifact('xgb_test', 'model.ubj', 2_000); // retrained artifact
    await handleForestRequest('xgb_test');
    expect(spawnCalls.length).toBe(2);
  });

  it('rejects traversal modelId with 400 and unknown modelId with 404', async () => {
    expect((await handleForestRequest('..')).status).toBe(400);
    expect((await handleForestRequest('a/b')).status).toBe(400);
    expect((await handleForestRequest('missing_model')).status).toBe(404);
    expect(spawnCalls.length).toBe(0);
  });
});

// ── GET /anatomy/models ──────────────────────────────────────────────────────
describe('handleModelsRequest', () => {
  it('returns { models: [] } for an empty data/models dir', async () => {
    readdirImpl = () => [];
    const result = await handleModelsRequest();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ models: [] });
    expect(spawnCalls.length).toBe(0);
  });

  it('returns { models: [] } when data/models does not exist at all', async () => {
    const err = new Error('ENOENT: no such directory') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    readdirThrows = err;
    const result = await handleModelsRequest();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ models: [] });
  });

  it('lists dirs with artifacts (meta via --list-meta) and skips artifact-less dirs', async () => {
    readdirImpl = () => [
      { name: 'xgb_baseline_post', isDirectory: () => true },
      { name: 'ghmm_smoke', isDirectory: () => true },       // no artifact — skipped
      { name: 'stray_file.txt', isDirectory: () => false },  // not a dir — skipped
    ];
    registerArtifact('xgb_baseline_post', 'model.ubj', 1_700_000_000_000, 123_456);
    spawnHandler = () => ({ stdout: VALID_META_STDOUT, exitCode: 0 });

    const result = await handleModelsRequest();
    expect(result.status).toBe(200);
    const body = result.body as AnatomyModelsResponse;
    expect(body.models).toHaveLength(1);

    const model = body.models[0]!;
    expect(model.modelId).toBe('xgb_baseline_post');
    expect(model.learner).toBe('xgboost');
    expect(model.nTrees).toBe(69);
    expect(model.nFeatures).toBe(3);
    expect(model.features).toEqual(['return_1', 'return_5', 'volatility_10']);
    expect(model.sizeBytes).toBe(123_456);
    expect(model.modifiedAt).toBe(new Date(1_700_000_000_000).toISOString());

    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0]!.args).toContain('--list-meta');
  });

  it('one broken artifact does not take down the listing (skipped with others kept)', async () => {
    readdirImpl = () => [
      { name: 'good_model', isDirectory: () => true },
      { name: 'broken_model', isDirectory: () => true },
    ];
    registerArtifact('good_model');
    registerArtifact('broken_model');
    spawnHandler = (args) => {
      const dir = args[args.indexOf('--model-dir') + 1] ?? '';
      if (dir.includes('broken_model')) {
        return { stdout: JSON.stringify({ error: 'corrupt artifact' }) + '\n', exitCode: 2 };
      }
      return { stdout: VALID_META_STDOUT, exitCode: 0 };
    };
    const result = await handleModelsRequest();
    expect(result.status).toBe(200);
    const body = result.body as AnatomyModelsResponse;
    expect(body.models).toHaveLength(1);
    expect(body.models[0]!.modelId).toBe('good_model');
  });

  it('meta is cached per artifact identity across listings', async () => {
    readdirImpl = () => [{ name: 'xgb_baseline_post', isDirectory: () => true }];
    registerArtifact('xgb_baseline_post');
    spawnHandler = () => ({ stdout: VALID_META_STDOUT, exitCode: 0 });
    await handleModelsRequest();
    await handleModelsRequest();
    expect(spawnCalls.length).toBe(1); // second listing served from metaCache
  });
});
