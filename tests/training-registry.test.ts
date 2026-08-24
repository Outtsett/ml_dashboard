/**
 * tests/training-registry.test.ts
 *
 * Validates the 2026-05-09 algorithm × task × runner decomposition:
 *   - The 3 source files (algorithms.json, tasks.json, runners.json) load
 *   - Composite keys resolve to ModelRegistryEntry view (algorithm + task + runner joined)
 *   - Legacy modelType keys (xgb_classifier etc.) alias to composite keys
 *   - Hyperparameter resolution still works with overrides
 *   - getClientConfig surfaces algorithms, tasks, runners, aliases for the UI
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  getModelConfig,
  listAlgorithms,
  listModels,
  listRunners,
  listTasks,
  reloadConfigs,
  resolveHyperparameters,
  resolveLegacyModelType,
  getClientConfig,
} from '../src/server/training/registry';

beforeAll(() => {
  reloadConfigs();
});

describe('training registry — algorithm × task × runner decomposition', () => {
  it('loads all three source files', () => {
    const algorithms = listAlgorithms();
    const tasks = listTasks();
    const runners = listRunners();

    expect(Object.keys(algorithms).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(tasks).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(runners).length).toBeGreaterThanOrEqual(4);

    // Key 4 algorithms exist
    expect(algorithms).toHaveProperty('xgboost');
    expect(algorithms).toHaveProperty('transformer_2s');
    expect(algorithms).toHaveProperty('transformer_tiny');
    expect(algorithms).toHaveProperty('primitives_cnn');

    // Key tasks exist
    expect(tasks).toHaveProperty('direction_classifier');
    expect(tasks).toHaveProperty('range_classifier');
  });

  it('composes ModelRegistryEntry views for each (alg, task) pair', () => {
    const models = listModels();

    expect(models).toHaveProperty('xgboost+direction_classifier');
    expect(models).toHaveProperty('transformer_2s+range_classifier');
    expect(models).toHaveProperty('transformer_tiny+direction_classifier');
    expect(models).toHaveProperty('primitives_cnn+multi_head');

    const xgbDir = models['xgboost+direction_classifier']!;
    expect(xgbDir.script).toBe('src/ml/xgb_classifier/main.py');
    expect(xgbDir.runner).toBe('python');
    expect(xgbDir.family).toBe('gradient_boosting');
    expect(xgbDir.gpuRequired).toBe(true);
    expect(xgbDir.defaultHyperparameters).toHaveProperty('n_estimators');
    expect(xgbDir.defaultHyperparameters.n_estimators!.default).toBe(500);
  });

  it('aliases legacy modelType keys to composite keys', () => {
    expect(resolveLegacyModelType('xgb_classifier')).toBe('xgboost+direction_classifier');
    expect(resolveLegacyModelType('transformer_range')).toBe('transformer_2s+range_classifier');
    expect(resolveLegacyModelType('transformer_direction_daily')).toBe(
      'transformer_tiny+direction_classifier',
    );
    expect(resolveLegacyModelType('primitives')).toBe('primitives_cnn+multi_head');
    expect(resolveLegacyModelType('not_a_real_key')).toBeNull();
  });

  it('getModelConfig accepts both composite and legacy keys', () => {
    const viaComposite = getModelConfig('xgboost+direction_classifier');
    const viaLegacy = getModelConfig('xgb_classifier');
    expect(viaComposite).not.toBeNull();
    expect(viaLegacy).not.toBeNull();
    expect(viaComposite?.script).toBe(viaLegacy?.script);
    expect(viaComposite?.defaultHyperparameters).toEqual(viaLegacy?.defaultHyperparameters);
  });

  it('returns null for unknown modelType', () => {
    expect(getModelConfig('does_not_exist')).toBeNull();
    expect(getModelConfig('xgboost+nonexistent_task')).toBeNull();
  });

  it('resolves hyperparameters with overrides over runner defaults', () => {
    const model = getModelConfig('xgboost+direction_classifier');
    expect(model).not.toBeNull();
    const merged = resolveHyperparameters(model!.defaultHyperparameters, {
      n_estimators: 1000,
      learning_rate: 0.1,
      unknown_key: 999, // should be ignored — not in defaults
    });
    expect(merged.n_estimators).toBe(1000);
    expect(merged.learning_rate).toBe(0.1);
    expect(merged.max_depth).toBe(6); // default carries through
    expect(merged).not.toHaveProperty('unknown_key');
  });

  it('exposes algorithms, tasks, runners, aliases via getClientConfig', () => {
    const cfg = getClientConfig();
    expect(cfg.algorithms).toHaveProperty('xgboost');
    expect(cfg.tasks).toHaveProperty('direction_classifier');
    expect(cfg.runners).toHaveProperty('xgboost+direction_classifier');
    expect(cfg.aliases.xgb_classifier).toBe('xgboost+direction_classifier');
    expect(cfg.models).toHaveProperty('xgboost+direction_classifier');
  });

  it('every wired runner references known algorithm + task IDs', () => {
    const algs = listAlgorithms();
    const tasks = listTasks();
    const runners = listRunners();
    for (const compositeId of Object.keys(runners)) {
      const [alg, task] = compositeId.split('+');
      expect(algs[alg!], `runner "${compositeId}" references unknown algorithm "${alg}"`).toBeTruthy();
      expect(tasks[task!], `runner "${compositeId}" references unknown task "${task}"`).toBeTruthy();
    }
  });

  it('every algorithm × task pair in runners is head-compatible', () => {
    const algs = listAlgorithms();
    const tasks = listTasks();
    const runners = listRunners();
    for (const compositeId of Object.keys(runners)) {
      const [algId, taskId] = compositeId.split('+');
      const alg = algs[algId!]!;
      const task = tasks[taskId!]!;
      const compatible =
        (task.headKind === 'classification' && alg.supports.includes('classification')) ||
        (task.headKind === 'regression' && alg.supports.includes('regression')) ||
        (task.headKind === 'multi' && alg.supports.includes('multi-head'));
      expect(
        compatible,
        `${compositeId}: algorithm ${algId} supports=${alg.supports.join(',')} ` +
          `is not compatible with task ${taskId} (headKind=${task.headKind})`,
      ).toBe(true);
    }
  });
});
