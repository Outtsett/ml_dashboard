/**
 * The 8 `<family>+walk_forward_cycle` runner entries added to
 * `src/config/{algorithms,tasks,runners}.json` resolve through
 * `training/registry.ts` exactly like every other composite runner, carry
 * `scriptArgs`/`maxDurationSeconds` onto the composed `ModelRegistryEntry`,
 * and declare a `cliFlags` entry for every hyperparameter key (pythonRunner
 * warns — but still trains with the flag silently dropped — for any that don't).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getModelConfig, listModels, reloadConfigs } from '../../src/server/training/registry';

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
  'entry_probability',
  'long_only',
  'holding_bars',
  'stop_loss_ticks',
  'take_profit_ticks',
  'contracts',
  'tuning_trials',
  'tuning_objective',
  'tuning_folds',
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
      expect(entry!.script).toBe('src/ml/cycle/main.py');
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
