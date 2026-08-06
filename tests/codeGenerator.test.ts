/**
 * tests/codeGenerator.test.ts
 *
 * Validates the W1.d code-generator wrapper:
 *   - generatePreview hits Python on first call, serves from LRU cache on
 *     identical second call (zero additional spawns)
 *   - cache key is order-independent for hyperparameters / labelParams /
 *     featureCategories (different insertion order → same hash → same cache hit)
 *   - Different inputs miss the cache (one spawn each)
 *   - Non-zero exit codes raise CodeGeneratorError surfacing stderr
 *   - Missing JSON result line raises CodeGeneratorError
 *
 * Spawning is mocked via vi.mock('child_process'); we synthesize a minimal
 * EventEmitter-backed child to drive close/data callbacks deterministically.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// ── Mock child_process.spawn BEFORE importing codeGenerator ──────────────
const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Mock the cache-invalidation downstreams so we don't need real config
// loading in this unit test.
vi.mock('../src/server/training/registry', () => ({
  reloadConfigs: vi.fn(),
}));
vi.mock('../src/server/infrastructure/lib/catalogBridge', () => ({
  refreshBridge: vi.fn(),
}));

// Imported AFTER vi.mock so the mocks bind correctly.
import {
  generatePreview,
  saveAndRegister,
  clearPreviewCache,
  CodeGeneratorError,
  type GeneratorPayload,
  type SavePayload,
} from '../src/server/infrastructure/lib/codeGenerator';

// ── Helper: build a fake child process that emits the given stdout/exit ──
interface FakeChildSetup {
  stdout: string;
  stderr?: string;
  exitCode?: number;
  /** Delay (ms) before emitting close. Default 0 (next-tick). */
  delayMs?: number;
}

function makeFakeChild({ stdout, stderr = '', exitCode = 0, delayMs = 0 }: FakeChildSetup) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (sig: string) => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout, 'utf8'));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr, 'utf8'));
    child.emit('close', exitCode);
  }, delayMs);

  return child;
}

// ── Canonical valid payload ──────────────────────────────────────────────
const basePayload: GeneratorPayload = {
  catalogId: 'random-forest',
  hyperparameters: { n_estimators: 100, max_depth: 8 },
  walkForward: null,
  labelStrategy: 'triple_barrier',
  labelParams: { horizon_bars: 5, threshold_bp: 5.0 },
  featurePipeline: 'default-35',
  featureCategories: ['price_action', 'volatility'],
  symbol: 'MNQ',
  timeframe: '1m',
};

const validPreviewStdout = JSON.stringify({
  files: { 'main.py': '# generated\n' },
  templateUsed: 'sklearn',
  warnings: [],
});

beforeEach(() => {
  spawnMock.mockReset();
  clearPreviewCache();
});

describe('codeGenerator.generatePreview — LRU cache', () => {
  it('spawns Python on first call, serves from cache on second identical call', async () => {
    spawnMock.mockImplementation(() => makeFakeChild({ stdout: validPreviewStdout }));

    const r1 = await generatePreview(basePayload);
    const r2 = await generatePreview(basePayload);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(r1.hash).toBe(r2.hash);
    expect(r1.files['main.py']).toBe('# generated\n');
    expect(r1.templateUsed).toBe('sklearn');
  });

  it('cache key is order-independent for hyperparameters', async () => {
    spawnMock.mockImplementation(() => makeFakeChild({ stdout: validPreviewStdout }));

    await generatePreview(basePayload);
    await generatePreview({
      ...basePayload,
      // Same keys, different insertion order
      hyperparameters: { max_depth: 8, n_estimators: 100 },
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('cache key is order-independent for featureCategories', async () => {
    spawnMock.mockImplementation(() => makeFakeChild({ stdout: validPreviewStdout }));

    await generatePreview(basePayload);
    await generatePreview({
      ...basePayload,
      featureCategories: ['volatility', 'price_action'],
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('different inputs miss the cache and spawn separately', async () => {
    spawnMock.mockImplementation(() => makeFakeChild({ stdout: validPreviewStdout }));

    await generatePreview(basePayload);
    await generatePreview({ ...basePayload, hyperparameters: { n_estimators: 200 } });

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('clearPreviewCache forces re-spawn', async () => {
    spawnMock.mockImplementation(() => makeFakeChild({ stdout: validPreviewStdout }));

    await generatePreview(basePayload);
    clearPreviewCache();
    await generatePreview(basePayload);

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});

describe('codeGenerator.generatePreview — error surfacing', () => {
  it('throws CodeGeneratorError with stderr on non-zero exit', async () => {
    spawnMock.mockImplementation(() => makeFakeChild({
      stdout: '',
      stderr: 'Traceback: catalog spec not found',
      exitCode: 2,
    }));

    await expect(generatePreview(basePayload)).rejects.toMatchObject({
      name: 'CodeGeneratorError',
      stderr: expect.stringContaining('catalog spec not found'),
      exitCode: 2,
    });
  });

  it('throws when stdout has no parseable result line', async () => {
    spawnMock.mockImplementation(() => makeFakeChild({
      stdout: 'plain text, no JSON',
      exitCode: 0,
    }));

    await expect(generatePreview(basePayload)).rejects.toBeInstanceOf(CodeGeneratorError);
  });

  it('skips protocol JSONL events and finds the result line', async () => {
    const stdout = [
      JSON.stringify({ type: 'log', message: 'loading templates' }),
      JSON.stringify({ type: 'progress', pct: 0.5 }),
      validPreviewStdout, // the actual result
    ].join('\n');
    spawnMock.mockImplementation(() => makeFakeChild({ stdout }));

    const result = await generatePreview(basePayload);
    expect(result.templateUsed).toBe('sklearn');
  });
});

describe('codeGenerator.saveAndRegister', () => {
  const validSaveStdout = JSON.stringify({
    savedPaths: ['src/ml/rf_v1/main.py', 'src/ml/rf_v1/manifest.json'],
    runnerKey: 'rf_v1',
    templateUsed: 'sklearn',
    warnings: [],
  });

  const savePayload: SavePayload = {
    ...basePayload,
    modelId: 'rf_v1',
    registerInRunners: true,
  };

  it('returns savedPaths + runnerKey on success', async () => {
    spawnMock.mockImplementation(() => makeFakeChild({ stdout: validSaveStdout }));

    const result = await saveAndRegister(savePayload);

    expect(result.savedPaths).toContain('src/ml/rf_v1/main.py');
    expect(result.runnerKey).toBe('rf_v1');
    expect(result.templateUsed).toBe('sklearn');
  });

  it('save does NOT consult or populate the preview cache', async () => {
    spawnMock.mockImplementation(() => makeFakeChild({ stdout: validSaveStdout }));

    await saveAndRegister(savePayload);
    // A subsequent preview with same inputs should still spawn — saves
    // bypass the cache entirely.
    spawnMock.mockImplementation(() => makeFakeChild({ stdout: validPreviewStdout }));
    await generatePreview(savePayload);

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
