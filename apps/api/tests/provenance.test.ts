/**
 * Unit tests for `src/server/training/provenance.ts`.
 *
 * Scope: identity minting, canonical hashing, the manifest skeleton, and the
 * in-memory spawn record. The database write paths (`beginRun`, `finishRun`,
 * …) are deliberately NOT exercised here — they load `infrastructure/database/db`,
 * which opens the live SQLite file as an import side effect. That module is
 * loaded lazily precisely so this suite (and the parser suite) stay hermetic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ulid,
  mintExperimentId,
  mintRunId,
  canonicalJson,
  sha256Hex,
  shortHash,
  stripVolatileKeys,
  computeConfigHash,
  computeCodeTreeHash,
  hashFileIfPresent,
  readGitIdentity,
  runsRoot,
  runDir,
  buildRunManifest,
  computeManifestHash,
  writeRunManifest,
  registerRunContext,
  getRunContext,
  clearRunContext,
  resetRunContexts,
  runContextEnv,
  MANIFEST_VERSION,
  type RunContext,
} from '../training/provenance';

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{26}$/;

let tmpRoot: string;

beforeEach(() => {
  resetRunContexts();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-test-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  resetRunContexts();
});

describe('ulid', () => {
  it('produces 26 Crockford base32 characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(ulid()).toMatch(CROCKFORD);
    }
  });

  it('excludes the ambiguous letters I, L, O, U', () => {
    const sample = Array.from({ length: 500 }, () => ulid()).join('');
    expect(sample).not.toMatch(/[ILOU]/);
  });

  it('sorts lexicographically in timestamp order', () => {
    const early = ulid(1_700_000_000_000);
    const late = ulid(1_700_000_001_000);
    expect(early < late).toBe(true);
  });

  it('encodes the millisecond timestamp in the first 10 characters', () => {
    const ms = 1_700_000_000_000;
    const a = ulid(ms);
    const b = ulid(ms);
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
    // ...and the 16 random characters differ, which is what defeats the
    // second-resolution collision in generateVersionedModelId.
    expect(a.slice(10)).not.toBe(b.slice(10));
  });

  it('does not collide across 20k same-millisecond mints', () => {
    const ms = 1_700_000_000_000;
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(ulid(ms));
    expect(seen.size).toBe(20_000);
  });
});

describe('identifier prefixes', () => {
  it('mints exp_ and run_ prefixed identifiers', () => {
    expect(mintExperimentId()).toMatch(/^exp_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(mintRunId()).toMatch(/^run_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('canonicalJson', () => {
  it('sorts object keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('makes key order irrelevant to the hash', () => {
    const left = { symbol: 'MNQ', hyperparameters: { lr: 0.1, depth: 4 } };
    const right = { hyperparameters: { depth: 4, lr: 0.1 }, symbol: 'MNQ' };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
  });

  it('preserves array order — array order is data, key order is not', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson(['a', 'b'])).not.toBe(canonicalJson(['b', 'a']));
  });

  it('normalizes non-finite numbers to null so the hash never sees a JS-only token', () => {
    expect(canonicalJson({ x: NaN })).toBe('{"x":null}');
    expect(canonicalJson({ x: Infinity })).toBe('{"x":null}');
  });

  it('drops undefined values rather than emitting a hole', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('hashing', () => {
  it('sha256Hex returns 64 hex characters', () => {
    const digest = sha256Hex('hello');
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('shortHash is the 16-character prefix declared by the envelope', () => {
    expect(shortHash('hello')).toBe(sha256Hex('hello').slice(0, 16));
    expect(shortHash('hello')).toHaveLength(16);
  });
});

describe('stripVolatileKeys / computeConfigHash', () => {
  it('removes the named volatile keys at every depth', () => {
    const stripped = stripVolatileKeys({
      symbol: 'MNQ',
      run_id: 'run_x',
      nested: { experiment_id: 'exp_x', keep: 1 },
    });
    expect(stripped).toEqual({ symbol: 'MNQ', nested: { keep: 1 } });
  });

  it('removes any key ending in _path or Path', () => {
    const stripped = stripVolatileKeys({ model_path: '/a', outputPath: '/b', keep: 1 });
    expect(stripped).toEqual({ keep: 1 });
  });

  it('hashes two runs of the same configuration identically', () => {
    const base = { symbol: 'MNQ', hyperparameters: { lr: 0.1 } };
    const a = { ...base, run_id: 'run_A', trained_at: '2026-07-28T00:00:00Z' };
    const b = { ...base, run_id: 'run_B', trained_at: '2026-07-29T00:00:00Z' };
    expect(computeConfigHash(a)).toBe(computeConfigHash(b));
  });

  it('hashes a genuine configuration change differently', () => {
    const a = { symbol: 'MNQ', hyperparameters: { lr: 0.1 } };
    const b = { symbol: 'MNQ', hyperparameters: { lr: 0.2 } };
    expect(computeConfigHash(a)).not.toBe(computeConfigHash(b));
  });

  it('honours an extra volatile key so a seed sweep hashes as one configuration', () => {
    const a = { symbol: 'MNQ', seed: 1 };
    const b = { symbol: 'MNQ', seed: 2 };
    expect(computeConfigHash(a)).not.toBe(computeConfigHash(b));
    expect(computeConfigHash(a, ['seed'])).toBe(computeConfigHash(b, ['seed']));
  });

  it('returns a 16-character hash', () => {
    expect(computeConfigHash({ a: 1 })).toHaveLength(16);
  });
});

describe('code identity', () => {
  it('computeCodeTreeHash is stable across calls on the same tree', () => {
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'ml-engine', 'src', 'pkg'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'packages', 'ml-engine', 'src', 'pkg', 'main.py'), 'print(1)\n');
    fs.writeFileSync(path.join(tmpRoot, 'packages', 'config', 'features.json'), '{"a":1}');

    const first = computeCodeTreeHash(tmpRoot);
    expect(first).toBe(computeCodeTreeHash(tmpRoot));

    fs.writeFileSync(path.join(tmpRoot, 'packages', 'ml-engine', 'src', 'pkg', 'main.py'), 'print(2)\n');
    expect(computeCodeTreeHash(tmpRoot)).not.toBe(first);
  });

  it('ignores __pycache__ so stale bytecode cannot change the code identity', () => {
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'ml-engine', 'src', 'pkg', '__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'packages', 'ml-engine', 'src', 'pkg', 'main.py'), 'print(1)\n');
    const before = computeCodeTreeHash(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, 'packages', 'ml-engine', 'src', 'pkg', '__pycache__', 'main.pyc'), 'junk');
    expect(computeCodeTreeHash(tmpRoot)).toBe(before);
  });

  it('computes over the real repository without throwing', () => {
    expect(computeCodeTreeHash(process.cwd())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashFileIfPresent returns null for a missing file instead of a placeholder', () => {
    expect(hashFileIfPresent(path.join(tmpRoot, 'nope.json'))).toBeNull();
    const real = path.join(tmpRoot, 'yes.json');
    fs.writeFileSync(real, '{}');
    expect(hashFileIfPresent(real)).toBe(sha256Hex('{}'));
  });

  it('readGitIdentity degrades with a stated reason outside a repository', () => {
    const identity = readGitIdentity(tmpRoot);
    if (identity.commit_sha === null) {
      expect(identity.error).toBeTruthy();
      expect(identity.dirty).toBeNull();
    } else {
      // A temp dir inside a git worktree would still resolve — accept either,
      // but never a silent null with no explanation.
      expect(identity.commit_sha).toMatch(/^[0-9a-f]{7,40}$/);
    }
  });

  it('readGitIdentity resolves this repository', () => {
    const identity = readGitIdentity(process.cwd());
    expect(identity.commit_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof identity.dirty).toBe('boolean');
  });
});

describe('run directory layout', () => {
  it('nests runs under data/runs/<experiment_id>/<run_id>', () => {
    expect(runsRoot('/repo')).toBe(path.join('/repo', 'data', 'runs'));
    expect(runDir('exp_1', 'run_1', '/repo')).toBe(path.join('/repo', 'data', 'runs', 'exp_1', 'run_1'));
  });
});

function makeManifestInput(overrides: Partial<Parameters<typeof buildRunManifest>[0]> = {}) {
  return {
    experimentId: 'exp_TEST',
    runId: 'run_TEST',
    catalogId: 'xgboost',
    runnerKey: 'xgboost+direction_classifier',
    legacyModelId: 'MNQ_1d_xgboost+direction_classifier_20260728T120000',
    artifactDir: 'data/models/MNQ_1d_xgboost+direction_classifier_20260728T120000',
    config: { symbol: 'MNQ', hyperparameters: { lr: 0.1 } },
    expectedArtifacts: ['model.ubj', 'diagnostics.json'],
    repoRoot: tmpRoot,
    ...overrides,
  };
}

describe('buildRunManifest', () => {
  it('records the identity block verbatim', () => {
    const manifest = buildRunManifest(makeManifestInput({ foldIdx: 2, trialIdx: 17 }));
    expect(manifest.identity).toMatchObject({
      manifest_version: MANIFEST_VERSION,
      catalog_id: 'xgboost',
      experiment_id: 'exp_TEST',
      run_id: 'run_TEST',
      trial_idx: 17,
      fold_idx: 2,
      runner_key: 'xgboost+direction_classifier',
    });
  });

  it('keeps artifacts at data/models/<legacy_model_id> — the manifest is the indirection', () => {
    const manifest = buildRunManifest(makeManifestInput());
    expect(manifest.identity.artifact_dir).toBe(
      'data/models/MNQ_1d_xgboost+direction_classifier_20260728T120000',
    );
    expect(manifest.identity.artifact_dir.startsWith('data/runs')).toBe(false);
  });

  it('defaults absent coordinates to null rather than omitting them', () => {
    const manifest = buildRunManifest(makeManifestInput());
    expect(manifest.identity.trial_idx).toBeNull();
    expect(manifest.identity.fold_idx).toBeNull();
  });

  it('carries the config and its hash', () => {
    const manifest = buildRunManifest(makeManifestInput());
    expect(manifest.config).toEqual({ symbol: 'MNQ', hyperparameters: { lr: 0.1 } });
    expect(manifest.config_hash).toBe(computeConfigHash({ symbol: 'MNQ', hyperparameters: { lr: 0.1 } }));
  });

  it('hashes the runner source so a codegen overwrite is detectable after the fact', () => {
    const scriptRel = path.join('packages', 'ml-engine', 'src', 'pkg', 'main.py');
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'ml-engine', 'src', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, scriptRel), 'print(1)\n');

    const manifest = buildRunManifest(makeManifestInput({ scriptPath: scriptRel }));
    expect(manifest.code.runner_source_hash).toBe(sha256Hex('print(1)\n'));
    expect(manifest.code.runner_source_path).toBe('packages/ml-engine/src/pkg/main.py');
  });

  it('reports a null runner source hash when the script is absent', () => {
    const manifest = buildRunManifest(makeManifestInput({ scriptPath: 'packages/ml-engine/src/missing/main.py' }));
    expect(manifest.code.runner_source_hash).toBeNull();
  });

  it('hashes features.json content, not its mtime', () => {
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'packages', 'config', 'features.json'), '{"f":1}');
    const manifest = buildRunManifest(makeManifestInput());
    expect(manifest.features.features_config_hash).toBe(sha256Hex('{"f":1}'));

    // Touching the file without changing its bytes must not change the hash.
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(tmpRoot, 'packages', 'config', 'features.json'), future, future);
    expect(buildRunManifest(makeManifestInput()).features.features_config_hash).toBe(sha256Hex('{"f":1}'));
  });

  it('hashes cost_model.json when present', () => {
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'packages', 'config', 'cost_model.json'), '{"c":2}');
    expect(buildRunManifest(makeManifestInput()).costs.cost_model_hash).toBe(sha256Hex('{"c":2}'));
  });

  it('records the declared expected artifacts', () => {
    const manifest = buildRunManifest(makeManifestInput());
    expect(manifest.expected_artifacts).toEqual(['model.ubj', 'diagnostics.json']);
  });
});

describe('computeManifestHash', () => {
  it('is stable and excludes the manifest_hash field itself', () => {
    const manifest = buildRunManifest(makeManifestInput());
    const hash = computeManifestHash(manifest);
    expect(hash).toHaveLength(16);
    expect(computeManifestHash({ ...manifest, manifest_hash: hash })).toBe(hash);
  });

  it('changes when the config changes', () => {
    const a = buildRunManifest(makeManifestInput());
    const b = buildRunManifest(makeManifestInput({ config: { symbol: 'ES' } }));
    expect(computeManifestHash(a)).not.toBe(computeManifestHash(b));
  });
});

describe('writeRunManifest', () => {
  it('writes data/runs/<experiment_id>/<run_id>/manifest.json with the hash embedded', () => {
    const manifest = buildRunManifest(makeManifestInput());
    const { manifestHash, manifestPath } = writeRunManifest(manifest, tmpRoot);

    expect(manifestPath).toBe(path.join(tmpRoot, 'data', 'runs', 'exp_TEST', 'run_TEST', 'manifest.json'));
    const written = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(written.manifest_hash).toBe(manifestHash);
    expect(written.identity.run_id).toBe('run_TEST');
    expect(written.config).toEqual({ symbol: 'MNQ', hyperparameters: { lr: 0.1 } });
  });

  it('refuses to overwrite an existing manifest — provenance is append-only', () => {
    const manifest = buildRunManifest(makeManifestInput());
    writeRunManifest(manifest, tmpRoot);
    expect(() => writeRunManifest(manifest, tmpRoot)).toThrow(/Refusing to overwrite/);
  });

  it('does not write anything under data/models', () => {
    writeRunManifest(buildRunManifest(makeManifestInput()), tmpRoot);
    expect(fs.existsSync(path.join(tmpRoot, 'data', 'models'))).toBe(false);
  });
});

describe('run context registry', () => {
  const ctx: RunContext = {
    experimentId: 'exp_1',
    runId: 'run_1',
    catalogId: 'xgboost',
    runnerKey: 'xgboost+direction_classifier',
    legacyModelId: 'MNQ_1d_xgb_20260728T120000',
    configHash: '9f3c1a2e5b70d4c8',
    manifestHash: '7ad04ef1c9b3220a',
    manifestPath: 'data/runs/exp_1/run_1/manifest.json',
    artifactDir: 'data/models/MNQ_1d_xgb_20260728T120000',
    trialIdx: null,
    foldIdx: null,
  };

  it('registers and resolves by legacy model id', () => {
    registerRunContext(ctx.legacyModelId, ctx);
    expect(getRunContext(ctx.legacyModelId)).toEqual(ctx);
  });

  it('returns undefined for an unknown, empty, or nullish model id', () => {
    expect(getRunContext('nope')).toBeUndefined();
    expect(getRunContext(undefined)).toBeUndefined();
    expect(getRunContext(null)).toBeUndefined();
    expect(getRunContext('')).toBeUndefined();
  });

  it('clears a single context without touching the others', () => {
    registerRunContext('a', { ...ctx, legacyModelId: 'a' });
    registerRunContext('b', { ...ctx, legacyModelId: 'b' });
    clearRunContext('a');
    expect(getRunContext('a')).toBeUndefined();
    expect(getRunContext('b')).toBeDefined();
  });

  it('maps to exactly the five ML_* variables protocol.py reads', () => {
    expect(runContextEnv(ctx)).toEqual({
      ML_RUN_ID: 'run_1',
      ML_EXPERIMENT_ID: 'exp_1',
      ML_CATALOG_ID: 'xgboost',
      ML_CONFIG_HASH: '9f3c1a2e5b70d4c8',
      ML_MANIFEST_HASH: '7ad04ef1c9b3220a',
    });
  });
});
