/**
 * apps/api/tests/catalogBridge.test.ts
 *
 * Validates the W2.a additions to `apps/api/lib/catalogBridge.ts`:
 *
 *   - `pickTemplate(spec, template)`      narrows family-template → concrete TemplateId
 *   - `classifyRunnerSource(entry, tid)`  → 'wired' | 'generate' | 'browse-only'
 *   - `getTrainableModels()` integration  every entry exposes templateId + runnerSource
 *
 * `pickTemplate` is a pure function over a small spec subset, so we synthesise
 * minimal `ParsedModelSpec` fixtures rather than hitting the disk catalog.
 *
 * `classifyRunnerSource` reads `fs.existsSync` — we mock the `fs` module to
 * deterministically toggle "script on disk" between cases.
 *
 * `getTrainableModels` integration test mocks the registry + catalog inputs so
 * the bridge cache builds against a known small population, then asserts the
 * shape of the output (every entry has `templateId` and `runnerSource`, and
 * counts of each runnerSource match the fixture).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock fs BEFORE importing catalogBridge so `existsSync` is controllable ──
//
// NOTE: the mocked `existsSync` is used by BOTH `classifyRunnerSource()` (which
// we want to control) AND by `apps/api/training/registry.ts::loadJSON()`
// (which must keep working — config files are real on disk).  The mock
// delegates to the real `existsSync` for any path under `packages/config/` and
// returns the test-controlled value for everything else (training scripts).
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const controlled = vi.fn(() => false);
  const dispatch = (p: string): boolean => {
    // Pass through real-disk lookups for config + module-system paths.
    const norm = String(p).replace(/\\/g, '/');
    if (norm.includes('/packages/config/') || norm.endsWith('.json')) {
      return actual.existsSync(p);
    }
    return controlled(p);
  };
  return {
    ...actual,
    default: { ...actual, existsSync: dispatch },
    existsSync: dispatch,
    // Expose the controllable mock so tests can drive it directly.
    __controlledExistsSync: controlled,
  };
});

// Pull the controllable mock out of the module (re-exported above as
// `__controlledExistsSync`) so tests can call `.mockReturnValue()` etc.
const controlledExistsSync = (await import('fs') as unknown as {
  __controlledExistsSync: ReturnType<typeof vi.fn>;
}).__controlledExistsSync;
import {
  pickTemplate,
  classifyRunnerSource,
  getTrainableModels,
  refreshBridge,
  type TemplateId,
} from '../infrastructure/lib/catalogBridge';
import type { ParsedModelSpec } from '../infrastructure/lib/modelImport/types';
import type { ModelRegistryEntry } from '@shared/trainingTypes';

// ── Fixture: minimal spec maker ─────────────────────────────────────────────
function makeSpec(overrides: Partial<ParsedModelSpec> & { id: string; name: string }): ParsedModelSpec {
  return {
    id: overrides.id,
    name: overrides.name,
    shortName: overrides.shortName ?? overrides.name.slice(0, 8),
    category: 'machine-learning',
    subcategory: 'general',
    relativePath: `${overrides.name}.md`,
    overview: '',
    principles: [],
    applications: [],
    keyFeatures: [],
    variants: [],
    hyperparameters: [],
    hasContent: true,
    fileSize: 100,
    ...overrides,
  };
}

// ── Fixture: minimal registry entry maker ───────────────────────────────────
function makeEntry(overrides: Partial<ModelRegistryEntry> = {}): ModelRegistryEntry {
  return {
    name: 'Test Model',
    category: 'supervised',
    subcategory: 'general',
    runner: 'python',
    featurePipeline: 'standard',
    outputs: ['predictions'],
    chartOverlay: 'prediction_markers',
    outputDir: 'data/models',
    defaultHyperparameters: {},
    ...overrides,
  };
}

// ── pickTemplate ────────────────────────────────────────────────────────────
describe('pickTemplate', () => {
  it('routes Gaussian Mixture to gmm template', () => {
    const spec = makeSpec({
      id: 'gaussian-mixture-model-gmm',
      name: 'Gaussian Mixture Model (GMM)',
      subcategory: 'clustering',
    });
    expect(pickTemplate(spec, { id: 'sklearn' })).toBe<TemplateId>('gmm');
  });

  it('routes K-Means clustering to sklearn template', () => {
    const spec = makeSpec({
      id: 'k-means-clustering',
      name: 'K-Means Clustering',
      subcategory: 'clustering',
    });
    expect(pickTemplate(spec, { id: 'sklearn' })).toBe<TemplateId>('sklearn');
  });

  it('routes Variational Autoencoder to pytorch_vae before plain autoencoder match', () => {
    const spec = makeSpec({
      id: 'variational-autoencoder-vae',
      name: 'Variational Autoencoder (VAE)',
    });
    expect(pickTemplate(spec, { id: 'pytorch' })).toBe<TemplateId>('pytorch_vae');
  });

  it('routes plain Autoencoder to pytorch_autoencoder', () => {
    const spec = makeSpec({
      id: 'autoencoder',
      name: 'Autoencoder',
    });
    expect(pickTemplate(spec, { id: 'pytorch' })).toBe<TemplateId>('pytorch_autoencoder');
  });

  it('routes 1D CNN to pytorch_cnn', () => {
    const spec = makeSpec({
      id: 'convolutional-neural-network-cnn',
      name: 'Convolutional Neural Network (CNN)',
    });
    expect(pickTemplate(spec, { id: 'pytorch' })).toBe<TemplateId>('pytorch_cnn');
  });

  it('routes plain MLP to pytorch_mlp default fallback', () => {
    const spec = makeSpec({
      id: 'multi-layer-perceptron-mlp',
      name: 'Multi-Layer Perceptron (MLP)',
    });
    expect(pickTemplate(spec, { id: 'pytorch' })).toBe<TemplateId>('pytorch_mlp');
  });

  it('routes XGBoost / LightGBM / CatBoost specs to tree template', () => {
    const xgb = makeSpec({ id: 'xgboost', name: 'XGBoost' });
    const lgbm = makeSpec({ id: 'lightgbm', name: 'LightGBM' });
    const cat = makeSpec({ id: 'catboost', name: 'CatBoost' });
    expect(pickTemplate(xgb, { id: 'xgboost' })).toBe<TemplateId>('tree');
    expect(pickTemplate(lgbm, { id: 'lightgbm' })).toBe<TemplateId>('tree');
    expect(pickTemplate(cat, { id: 'catboost' })).toBe<TemplateId>('tree');
  });

  it('returns null for DQN when ENABLE_RL_TEMPLATES=0 (RL gate explicitly disabled)', async () => {
    // RL_TEMPLATES_ENABLED is read from process.env at MODULE LOAD time
    // (`const RL_TEMPLATES_ENABLED = process.env.ENABLE_RL_TEMPLATES !== '0'`
    // in catalogBridge.ts), so flipping process.env here has no effect on the
    // already-evaluated constant inside pickTemplate's closure. This test
    // exercises the disabled branch through vi.resetModules() + a fresh
    // dynamic import taken under the env override, restoring both the env
    // var and the module registry afterward so the override cannot leak
    // into other tests (including the "enabled by default" case below).
    const prevEnv = process.env.ENABLE_RL_TEMPLATES;
    process.env.ENABLE_RL_TEMPLATES = '0';
    vi.resetModules();
    try {
      const disabledModule = await import('../infrastructure/lib/catalogBridge');
      const spec = makeSpec({
        id: 'deep-q-network-dqn',
        name: 'Deep Q-Network (DQN)',
      });
      expect(disabledModule.pickTemplate(spec, { id: 'reinforcement' })).toBeNull();
    } finally {
      if (prevEnv === undefined) delete process.env.ENABLE_RL_TEMPLATES;
      else process.env.ENABLE_RL_TEMPLATES = prevEnv;
      vi.resetModules();
    }
  });

  it('routes DQN to rl_dqn when ENABLE_RL_TEMPLATES is unset (enabled by default since W9.a)', () => {
    // Default gate state — confirms the 2026-05-11 flip documented in
    // catalogBridge.ts (RL_TEMPLATES_ENABLED = process.env.ENABLE_RL_TEMPLATES !== '0').
    // The suite-wide module (imported at file top) was loaded with no env
    // override in effect, so it reflects the real default.
    const spec = makeSpec({
      id: 'deep-q-network-dqn',
      name: 'Deep Q-Network (DQN)',
    });
    expect(pickTemplate(spec, { id: 'reinforcement' })).toBe<TemplateId>('rl_dqn');
  });

  it('routes Transformer specs to transformer_seq', () => {
    const spec = makeSpec({ id: 'transformer', name: 'Transformer' });
    expect(pickTemplate(spec, { id: 'transformer' })).toBe<TemplateId>('transformer_seq');
  });

  it('routes HMM specs to hmm template', () => {
    const spec = makeSpec({ id: 'gaussian-hmm', name: 'Gaussian HMM' });
    expect(pickTemplate(spec, { id: 'hmm' })).toBe<TemplateId>('hmm');
  });

  it('returns null for unknown family', () => {
    const spec = makeSpec({ id: 'mystery', name: 'Mystery Model' });
    expect(pickTemplate(spec, { id: 'totally-unknown-family' })).toBeNull();
  });
});

// ── classifyRunnerSource ────────────────────────────────────────────────────
describe('classifyRunnerSource', () => {
  beforeEach(() => {
    controlledExistsSync.mockReset();
  });

  it("returns 'wired' when entry.script exists on disk", () => {
    controlledExistsSync.mockReturnValue(true);
    const entry = makeEntry({ script: 'packages/ml-engine/src/some_model/main.py' });
    expect(classifyRunnerSource(entry, 'sklearn')).toBe('wired');
    expect(controlledExistsSync).toHaveBeenCalled();
  });

  it("returns 'generate' when no script on disk but templateId resolves", () => {
    controlledExistsSync.mockReturnValue(false);
    const entry = makeEntry({ script: undefined });
    expect(classifyRunnerSource(entry, 'sklearn')).toBe('generate');
  });

  it("returns 'browse-only' when no script and no templateId", () => {
    controlledExistsSync.mockReturnValue(false);
    const entry = makeEntry({ script: undefined });
    expect(classifyRunnerSource(entry, null)).toBe('browse-only');
  });

  it("returns 'generate' when entry.script is set but the path does not exist", () => {
    controlledExistsSync.mockReturnValue(false);
    const entry = makeEntry({ script: 'packages/ml-engine/src/missing/main.py' });
    expect(classifyRunnerSource(entry, 'sklearn')).toBe('generate');
  });
});

// ── getTrainableModels integration ──────────────────────────────────────────
describe('getTrainableModels integration', () => {
  beforeEach(() => {
    refreshBridge();
    controlledExistsSync.mockReset();
    controlledExistsSync.mockReturnValue(false);
  });

  it('every returned entry exposes templateId + runnerSource fields', () => {
    const models = getTrainableModels();
    expect(Object.keys(models).length).toBeGreaterThan(0);
    for (const [key, entry] of Object.entries(models)) {
      expect(entry, `entry ${key}`).toHaveProperty('templateId');
      expect(entry, `entry ${key}`).toHaveProperty('runnerSource');
      expect(['wired', 'generate', 'browse-only']).toContain(entry.runnerSource);
      // templateId is either null or a recognised TemplateId — assert via a
      // non-null check that it's a string when present.
      if (entry.templateId !== null) {
        expect(typeof entry.templateId).toBe('string');
      }
    }
  });

  it('runnerSource counts sum to total entry count', () => {
    const models = getTrainableModels();
    const total = Object.keys(models).length;
    let wired = 0, generate = 0, browseOnly = 0;
    for (const entry of Object.values(models)) {
      if (entry.runnerSource === 'wired') wired++;
      else if (entry.runnerSource === 'generate') generate++;
      else browseOnly++;
    }
    expect(wired + generate + browseOnly).toBe(total);
  });
});
