/**
 * `GET /training/cycle/:modelId/explain[/structure|/tree|/bar]`
 * (`src/server/training/cycleExplain.router.ts`) over a temporary
 * `data/models` folder, with the pool driven by the fake explainer
 * (`tests/fixtures/fake_cycle_explainer.py`) or, for the superseded case, a
 * one-line test double.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { CycleExplainer, type CycleExplainerOptions } from '../../src/server/training/cycleExplainer';
import {
  createCycleExplainRouter,
  handleManifest,
  type CycleExplainerClient,
} from '../../src/server/training/cycleExplain.router';
import {
  cycleExplainBarSchema,
  cycleExplainManifestSchema,
  cycleExplainStructureSchema,
  cycleExplainTreeSchema,
} from '../../src/shared/cycle/explain';

const REPO = process.cwd();
const PYTHON =
  process.platform === 'win32'
    ? path.join(REPO, '.venv', 'Scripts', 'python.exe')
    : path.join(REPO, '.venv', 'bin', 'python');
const FAKE = path.join(REPO, 'tests', 'fixtures', 'fake_cycle_explainer.py');

/** Fold 0 tests 2025-10-01 00:00 → 2025-10-03 23:55 UTC, fold 1 the following three days. */
const FOLD_0 = { foldIndex: 0, testStart: 1_759_276_800, testEnd: 1_759_535_700 };
const FOLD_1 = { foldIndex: 1, testStart: 1_759_536_000, testEnd: 1_759_794_900 };

let workDirectory: string;
let modelsRoot: string;
const liveRuns = new Set<string>();
const pools: CycleExplainer[] = [];
let explainer: CycleExplainerClient;

function manifestFile(modelId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    modelId,
    modelKey: 'xgboost',
    displayName: 'XGBoost',
    explainKind: 'trees',
    directionMode: 'classifier',
    hasPriceModel: true,
    featureNames: ['return_1', 'volatility_20'],
    featureDisplayNames: ['One-bar return', 'Twenty-bar volatility'],
    sequenceLength: 1,
    labelHorizonBars: 6,
    symbol: 'MNQ',
    timeframe: '5m',
    folds: [FOLD_0, FOLD_1],
    ...overrides,
  };
}

/** A run whose fold 0 models are saved and fold 1's are not. */
function makeRun(
  modelId: string,
  options: { manifest?: Record<string, unknown> | string | null; features?: boolean; savedFolds?: number[] } = {},
): string {
  const directory = path.join(modelsRoot, modelId);
  fs.mkdirSync(path.join(directory, 'explain'), { recursive: true });
  const manifest = options.manifest === undefined ? manifestFile(modelId) : options.manifest;
  if (manifest !== null) {
    fs.writeFileSync(
      path.join(directory, 'explain', 'manifest.json'),
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    );
  }
  if (options.features !== false) fs.writeFileSync(path.join(directory, 'explain', 'features.npy'), '');
  for (const fold of options.savedFolds ?? [0]) {
    fs.mkdirSync(path.join(directory, `fold_${fold}`, 'price_model'), { recursive: true });
    fs.writeFileSync(path.join(directory, `fold_${fold}`, 'model.json'), '{}');
    fs.writeFileSync(path.join(directory, `fold_${fold}`, 'price_model', 'model.json'), '{}');
  }
  return directory;
}

function makePool(fakeArguments: string[] = [], options: CycleExplainerOptions = {}): CycleExplainer {
  const pool = new CycleExplainer({ command: [PYTHON, FAKE, '--serve', ...fakeArguments], cwd: REPO, ...options });
  pools.push(pool);
  return pool;
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-explain-route-'));
  modelsRoot = path.join(workDirectory, 'data', 'models');
  fs.mkdirSync(modelsRoot, { recursive: true });
  const app = express();
  app.use(
    '/api',
    createCycleExplainRouter({ modelsRoot, explainer: () => explainer, isRunLive: (modelId) => liveRuns.has(modelId) }),
  );
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/training/cycle`;
});

beforeEach(() => {
  explainer = makePool();
  liveRuns.clear();
});

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.stop()));
});

afterAll(() => {
  server.close();
  fs.rmSync(workDirectory, { recursive: true, force: true });
});

async function get(pathAndQuery: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/${pathAndQuery}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('manifest', () => {
  it('reads the manifest and each fold’s readiness from disk', async () => {
    makeRun('manifest_finished');
    const { status, body } = await get('manifest_finished/explain');
    expect(status).toBe(200);
    const manifest = cycleExplainManifestSchema.parse(body);
    expect(manifest).toMatchObject({ modelId: 'manifest_finished', available: true, reason: null, modelKey: 'xgboost', labelHorizonBars: 6 });
    expect(manifest.featureDisplayNames).toEqual(['One-bar return', 'Twenty-bar volatility']);
    expect(manifest.folds).toEqual([
      { ...FOLD_0, direction: 'ready', price: 'ready' },
      { ...FOLD_1, direction: 'missing', price: 'missing' },
    ]);
  });

  it('marks absent models of a live run as training', async () => {
    makeRun('manifest_live');
    liveRuns.add('manifest_live');
    const { body } = await get('manifest_live/explain');
    expect((body.folds as unknown[])[1]).toMatchObject({ direction: 'training', price: 'training' });
  });

  it('marks the price role "none" for a model with no price model', async () => {
    makeRun('manifest_no_price', { manifest: manifestFile('manifest_no_price', { hasPriceModel: false }) });
    const { body } = await get('manifest_no_price/explain');
    expect((body.folds as Array<{ price: string }>).map((fold) => fold.price)).toEqual(['none', 'none']);
  });

  it('says a run made before Inside the model existed is not available', async () => {
    makeRun('manifest_old', { manifest: null, features: false, savedFolds: [] });
    const { status, body } = await get('manifest_old/explain');
    expect(status).toBe(200);
    expect(cycleExplainManifestSchema.parse(body)).toMatchObject({ available: false, folds: [] });
    expect(body.reason).toMatch(/before Inside the model existed/);
  });

  it('says why when the inputs were not written or the manifest breaks the contract', async () => {
    makeRun('manifest_no_inputs', { features: false });
    expect((await get('manifest_no_inputs/explain')).body.reason).toMatch(/features\.npy/);
    makeRun('manifest_bad', { manifest: manifestFile('manifest_bad', { explainKind: 'crystal_ball' }) });
    expect((await get('manifest_bad/explain')).body.reason).toMatch(/does not match the contract/);
    makeRun('manifest_not_json', { manifest: '{ not json' });
    expect((await get('manifest_not_json/explain')).body.reason).toMatch(/not valid JSON/);
  });
});

describe('path guard', () => {
  it('404s an unknown run', async () => {
    expect((await get('no_such_run/explain')).status).toBe(404);
  });

  it('rejects ids that are not a plain name or that escape data/models', async () => {
    fs.mkdirSync(path.join(workDirectory, 'data', 'outside'), { recursive: true });
    for (const modelId of ['..', '.', '../outside', '..\\outside', 'a/b', '', 'x'.repeat(129), 'name with space']) {
      expect((await handleManifest({ modelsRoot }, modelId)).status).toBe(404);
    }
    expect((await get('..%2Foutside/explain')).status).toBe(404);
    expect((await get('..%5Coutside/explain/structure?fold=0')).status).not.toBe(200);
  });
});

describe('structure and tree', () => {
  it('answers a saved fold through the explainer, validated against the contract', async () => {
    makeRun('model_trees');
    const structure = await get('model_trees/explain/structure?fold=0&role=direction');
    expect(structure.status).toBe(200);
    expect(cycleExplainStructureSchema.parse(structure.body)).toMatchObject({ modelId: 'model_trees', foldIndex: 0, link: 'logistic' });

    const tree = await get('model_trees/explain/tree?fold=0&role=price&tree=1');
    expect(tree.status).toBe(200);
    expect(cycleExplainTreeSchema.parse(tree.body)).toMatchObject({ treeIndex: 1, role: 'price' });
  });

  it('defaults the role to direction', async () => {
    makeRun('model_default_role');
    expect((await get('model_default_role/explain/structure?fold=0')).body.role).toBe('direction');
  });

  it('400s bad parameters', async () => {
    makeRun('model_bad_query');
    expect((await get('model_bad_query/explain/structure')).status).toBe(400);
    expect((await get('model_bad_query/explain/structure?fold=-1')).status).toBe(400);
    expect((await get('model_bad_query/explain/structure?fold=0&role=volume')).status).toBe(400);
    expect((await get('model_bad_query/explain/tree?fold=0')).status).toBe(400);
  });

  it('says when a fold is unplanned, still training, never saved, or has no price model', async () => {
    makeRun('model_folds');
    const unplanned = await get('model_folds/explain/structure?fold=7');
    expect(unplanned.status).toBe(404);
    expect(unplanned.body.error).toMatch(/no fold 7; its folds are 0, 1/);

    const missing = await get('model_folds/explain/structure?fold=1');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatch(/never saved/);

    liveRuns.add('model_folds');
    const training = await get('model_folds/explain/structure?fold=1');
    expect(training.status).toBe(409);
    expect(training.body.error).toMatch(/still training/);

    makeRun('model_folds_no_price', { manifest: manifestFile('model_folds_no_price', { hasPriceModel: false }) });
    const noPrice = await get('model_folds_no_price/explain/structure?fold=0&role=price');
    expect(noPrice.status).toBe(404);
    expect(noPrice.body.error).toMatch(/no price model/);
  });

  it('404s a question about a run with no explain artifacts', async () => {
    makeRun('model_old', { manifest: null, features: false });
    const result = await get('model_old/explain/structure?fold=0');
    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/before Inside the model existed/);
  });
});

describe('bar', () => {
  it('uses the fold whose test span holds the timestamp', async () => {
    makeRun('bar_default_fold', { savedFolds: [0, 1] });
    const inFoldOne = FOLD_1.testStart + 300;
    const { status, body } = await get(`bar_default_fold/explain/bar?timestamp=${inFoldOne}`);
    expect(status).toBe(200);
    expect(cycleExplainBarSchema.parse(body)).toMatchObject({ foldIndex: 1, timestamp: inFoldOne, role: 'direction' });

    const onFoldZeroEnd = await get(`bar_default_fold/explain/bar?timestamp=${FOLD_0.testEnd}`);
    expect(onFoldZeroEnd.body.foldIndex).toBe(0);
  });

  it('honours an explicit fold', async () => {
    makeRun('bar_explicit_fold', { savedFolds: [0, 1] });
    const { body } = await get(`bar_explicit_fold/explain/bar?timestamp=${FOLD_1.testStart}&fold=0`);
    expect(body.foldIndex).toBe(0);
  });

  it('404s with a sentence when no fold tested the bar', async () => {
    makeRun('bar_outside');
    const { status, body } = await get(`bar_outside/explain/bar?timestamp=${FOLD_0.testStart - 300}`);
    expect(status).toBe(404);
    expect(body.error).toMatch(/No fold of this run tested the bar at 2025-09-30T23:55:00\.000Z/);
  });

  it('400s a missing timestamp', async () => {
    makeRun('bar_no_timestamp');
    expect((await get('bar_no_timestamp/explain/bar')).status).toBe(400);
  });
});

describe('explainer failures', () => {
  it('502s a reply that fails its schema, with the zod message', async () => {
    makeRun('fail_invalid');
    explainer = makePool(['--invalid']);
    const { status, body } = await get('fail_invalid/explain/structure?fold=0');
    expect(status).toBe(502);
    expect(body.error).toMatch(/does not match the contract/);
    expect(body.error).toMatch(/link|foldIndex/);
  });

  it("422s the explainer's own refusal", async () => {
    makeRun('fail_refused');
    explainer = makePool(['--error-on', 'explain']);
    const { status, body } = await get(`fail_refused/explain/bar?timestamp=${FOLD_0.testStart}`);
    expect(status).toBe(422);
    expect(body).toMatchObject({ error: 'The fake explainer refuses explain.', details: 'asked to by --error-on' });
  });

  it('502s a crash, then 503s with the stderr tail once it crash-loops', async () => {
    makeRun('fail_crash');
    explainer = makePool(['--exit-at-start', '4'], { crashLimit: 1 });
    const crashed = await get('fail_crash/explain/structure?fold=0');
    expect(crashed.status).toBe(502);
    expect(crashed.body.failure).toBe('crashed');

    const unavailable = await get('fail_crash/explain/structure?fold=0');
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.failure).toBe('unavailable');
    expect(unavailable.body.stderrTail).toMatch(/failing on purpose at start/);
  });

  it('504s a request that times out', async () => {
    makeRun('fail_timeout');
    explainer = makePool(['--reply-delay', '5'], { requestTimeoutMs: 400 });
    const { status, body } = await get('fail_timeout/explain/structure?fold=0');
    expect(status).toBe(504);
    expect(body.failure).toBe('timeout');
  });

  it('409s a request a newer one superseded', async () => {
    makeRun('fail_superseded');
    explainer = { request: async () => ({ status: 'superseded' }) };
    const { status, body } = await get(`fail_superseded/explain/bar?timestamp=${FOLD_0.testStart}`);
    expect(status).toBe(409);
    expect(body.superseded).toBe(true);
  });
});
