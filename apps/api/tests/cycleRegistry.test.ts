/**
 * The Model Cycle's `<key>+walk_forward_cycle` runners, composed from the
 * Cycle registry (`packages/config/cycle_models/`) by `training/cycleRunners.ts`
 * and merged by `training/registry.ts`, resolve exactly like every other
 * composite runner, carry `scriptArgs`/`maxDurationSeconds` onto the composed
 * `ModelRegistryEntry`, and declare a `cliFlags` entry for every
 * hyperparameter key (pythonRunner warns — but still trains with the flag
 * silently dropped — for any that don't).
 *
 * Also pinned here: a Cycle runner never "covers" a catalog spec in the
 * catalog bridge, and the catalog lifecycle join counts Cycle sessions toward
 * their spec without deep-linking ML Studio to a Cycle runner.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

// `lifecycle.ts` imports the SQLite handle at module scope; the pure join
// under test never touches it.
vi.mock('../infrastructure/database/db', () => ({ db: {} }));

import { getModelConfig, listModels, listRunners, reloadConfigs } from '../training/registry';
import { getCycleRegistry } from '../training/cycleModels';
import { getTrainableModels, refreshBridge } from '../infrastructure/lib/catalogBridge';
import { getCatalogModels } from '../infrastructure/lib/modelImport/catalogService';
import { buildCatalogLifecycle, type LifecycleRunner, type LifecycleTrainable } from '../ml/lifecycle';

const FAMILIES = [
  'logistic_regression',
  'random_forest',
  'xgboost',
  'lightgbm',
  'multilayer_perceptron',
  'lstm',
  'temporal_convolution_network',
  'transformer_encoder',
] as const;

const CYCLE_WIDE_KEYS = [
  'train_days',
  'validation_fraction',
  'test_days',
  'step_days',
  'fold_limit',
  'expanding_window',
  'label_horizon_bars',
  'label_threshold_ticks',
  'embargo_bars',
  'label_gap_multiple',
  'long_only',
  'holding_bars',
  'stop_loss_ticks',
  'take_profit_ticks',
  'contracts',
  'tuning_mode',
  'tuning_budget_trials',
  'tuning_budget_seconds',
  'tuning_objective',
  'tuning_folds',
  'tuning_pinned_parameters',
  'bars_per_second',
  'start_paused',
  'quiet_bars',
  'log_every_batches',
  'device',
  'seed',
];

beforeAll(() => {
  reloadConfigs();
});

describe('Model Cycle runners — registry composition', () => {
  it('all 8 "<family>+walk_forward_cycle" keys resolve', () => {
    const models = listModels();
    for (const family of FAMILIES) {
      expect(models, `${family}+walk_forward_cycle should be composed`).toHaveProperty(
        `${family}+walk_forward_cycle`,
      );
    }
  });

  it('each resolves via getModelConfig with the walk_forward_cycle script', () => {
    for (const family of FAMILIES) {
      const entry = getModelConfig(`${family}+walk_forward_cycle`);
      expect(entry, family).not.toBeNull();
      expect(entry!.script).toBe('packages/ml-engine/src/cycle/main.py');
      expect(entry!.runner).toBe('python');
      expect(entry!.chartOverlay).toBe('prediction_markers');
      expect(entry!.featurePipeline).toBe('default-35');
    }
  });

  it('scriptArgs carries --model-family <family> onto the composed entry', () => {
    for (const family of FAMILIES) {
      const entry = getModelConfig(`${family}+walk_forward_cycle`)!;
      expect(entry.scriptArgs).toEqual(['--model-family', family]);
    }
  });

  it('maxDurationSeconds is 43200 (12h) for every cycle runner', () => {
    for (const family of FAMILIES) {
      const entry = getModelConfig(`${family}+walk_forward_cycle`)!;
      expect(entry.maxDurationSeconds).toBe(43200);
    }
  });

  it('every cycle-wide hyperparameter key is present with a cliFlags entry, on every family', () => {
    for (const family of FAMILIES) {
      const entry = getModelConfig(`${family}+walk_forward_cycle`)!;
      for (const key of CYCLE_WIDE_KEYS) {
        expect(entry.defaultHyperparameters, `${family}: missing ${key}`).toHaveProperty(key);
        expect(entry.cliFlags, `${family}: missing cliFlags.${key}`).toHaveProperty(key);
      }
    }
  });

  it('every defaultHyperparameters key (cycle-wide AND model-specific) has a cliFlags entry', () => {
    for (const family of FAMILIES) {
      const entry = getModelConfig(`${family}+walk_forward_cycle`)!;
      const hpKeys = Object.keys(entry.defaultHyperparameters);
      const flagKeys = Object.keys(entry.cliFlags ?? {});
      expect(hpKeys.sort()).toEqual(flagKeys.sort());
      // Flags are --kebab-case of the snake_case key.
      for (const key of hpKeys) {
        expect(entry.cliFlags![key]).toBe(`--${key.replace(/_/g, '-')}`);
      }
    }
  });

  it('device and tuning_objective are categorical with the documented choices', () => {
    const entry = getModelConfig('xgboost+walk_forward_cycle')!;
    expect(entry.defaultHyperparameters.device).toMatchObject({
      type: 'categorical',
      default: 'auto',
      choices: ['auto', 'cuda', 'cpu'],
    });
    expect(entry.defaultHyperparameters.tuning_objective).toMatchObject({
      type: 'categorical',
      default: 'sharpe_ratio',
      choices: ['sharpe_ratio', 'log_loss', 'f1_score'],
    });
  });

  it('bool-typed hyperparameters use the presence-flag convention (no explicit value expected downstream)', () => {
    const entry = getModelConfig('lstm+walk_forward_cycle')!;
    for (const key of ['expanding_window', 'long_only', 'start_paused', 'quiet_bars']) {
      expect(entry.defaultHyperparameters[key]!.type).toBe('bool');
    }
  });

  it("each family's Model group hyperparameters are present (spot check)", () => {
    expect(getModelConfig('xgboost+walk_forward_cycle')!.defaultHyperparameters).toHaveProperty('boosting_rounds');
    expect(getModelConfig('lightgbm+walk_forward_cycle')!.defaultHyperparameters).toHaveProperty('leaf_count');
    expect(getModelConfig('lstm+walk_forward_cycle')!.defaultHyperparameters).toHaveProperty('sequence_length');
    expect(getModelConfig('transformer_encoder+walk_forward_cycle')!.defaultHyperparameters).toHaveProperty(
      'head_count',
    );
    expect(getModelConfig('logistic_regression+walk_forward_cycle')!.defaultHyperparameters).toHaveProperty(
      'regularization_strength',
    );
    expect(getModelConfig('random_forest+walk_forward_cycle')!.defaultHyperparameters).toHaveProperty('tree_count');
    expect(
      getModelConfig('temporal_convolution_network+walk_forward_cycle')!.defaultHyperparameters,
    ).toHaveProperty('kernel_size');
    expect(getModelConfig('multilayer_perceptron+walk_forward_cycle')!.defaultHyperparameters).toHaveProperty(
      'hidden_size',
    );
  });

  it('every algorithm backing a cycle runner supports classification and is gpuRequired=false', () => {
    // gpuRequired lives on the algorithm, not the runner — the 8 new
    // algorithms.json entries, not xgboost (which pre-dates this work and
    // stays gpuRequired:true for its existing direction_classifier runner).
    for (const family of FAMILIES) {
      if (family === 'xgboost') continue;
      const [alg] = `${family}+walk_forward_cycle`.split('+');
      const entry = getModelConfig(`${family}+walk_forward_cycle`)!;
      expect(entry.gpuRequired, alg).toBe(false);
      expect(entry.family, alg).toBeTruthy();
    }
  });
});

describe('Model Cycle runners — the whole registry', () => {
  it('every registry model, not only the 8 legacy families, is a composed runner', () => {
    const models = listModels();
    for (const key of Object.keys(getCycleRegistry().models)) {
      const entry = models[`${key}+walk_forward_cycle`];
      expect(entry, key).toBeDefined();
      expect(entry!.scriptArgs).toEqual(['--model-family', key]);
      expect(entry!.maxDurationSeconds).toBe(43200);
    }
  });
});

// A spec whose only registry claim is a model the registry introduced (not a
// legacy family), with written content in the catalog.
function newRegistrySpecOnCatalog(): { key: string; specId: string } | null {
  const specs = new Map(getCatalogModels({ includeEmpty: true }).models.map((spec) => [spec.id, spec]));
  for (const [key, entry] of Object.entries(getCycleRegistry().models)) {
    if (entry.adapter === 'legacy' || entry.catalogSpecId === null) continue;
    if (specs.get(entry.catalogSpecId)?.hasContent) return { key, specId: entry.catalogSpecId };
  }
  return null;
}

describe('catalog bridge — a Cycle runner does not cover its spec', () => {
  const target = newRegistrySpecOnCatalog();

  it.skipIf(target === null)("the spec keeps its own trainable entry beside the Cycle runner", () => {
    refreshBridge();
    const trainable = getTrainableModels();
    expect(trainable[`${target!.key}+walk_forward_cycle`]?.catalogId).toBe(target!.specId);
    expect(trainable[target!.specId], target!.specId).toBeDefined();
  });
});

describe('catalog lifecycle join — Cycle runners', () => {
  const target = newRegistrySpecOnCatalog();

  it.skipIf(target === null)('counts a Cycle session toward its spec, and never deep-links ML Studio to the Cycle runner', () => {
    const runnerKey = `${target!.key}+walk_forward_cycle`;
    const composed = listModels();
    // Exactly how getCatalogLifecycle gathers its runners.
    const runners: Record<string, LifecycleRunner> = {};
    for (const [key, runner] of Object.entries(listRunners())) {
      runners[key] = { catalogId: runner.catalogId ?? composed[key]?.catalogId, legacyId: runner.legacyId };
    }
    const trainable: Record<string, LifecycleTrainable> = {
      [runnerKey]: { runnerSource: 'wired', catalogId: target!.specId },
      [target!.specId]: { runnerSource: 'generate', templateId: 'sklearn_classifier' },
    };
    const { lifecycle } = buildCatalogLifecycle({
      specs: [{ id: target!.specId, hasContent: true }],
      trainable,
      runners,
      sessions: [{ modelType: runnerKey, status: 'completed', startedAtMilliseconds: 1_700_000_000_000, versionedModelId: null }],
      versions: [],
      deployments: [],
      isLensReady: () => false,
    });
    const card = lifecycle[target!.specId]!;
    expect(card.runnerKeys).toContain(runnerKey);
    expect(card.completedSessionCount).toBe(1);
    expect(card.stage).toBe('trained');
    expect(card.trainableKey).toBe(target!.specId);
    expect(card.runnerSource).toBe('generate');
  });
});
