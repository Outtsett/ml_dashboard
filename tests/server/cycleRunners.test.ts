/**
 * The Model Cycle registry as training runners: the loader
 * (`training/cycleModels.ts`), the pure composition (`training/cycleRunners.ts`),
 * their merge into `training/registry.ts`, and the `--no-<flag>` rule in
 * `runners/pythonRunner.ts`.
 *
 * The 8 legacy keys are held to `tests/fixtures/cycle_runners_legacy.json` —
 * the runner blocks and composed `/api/training/config` entries exactly as
 * they were before the registry.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CYCLE_RUNNER_SUFFIX, type CycleRegistry } from '@shared/cycle/models';
import type { AlgorithmRegistry, TaskRegistry } from '@shared/trainingTypes';
import {
  CYCLE_MODELS_DIR,
  cycleUnavailableReason,
  getCycleRegistry,
  loadCycleRegistry,
  validateCycleRegistryFiles,
} from '../../src/server/training/cycleModels';
import { composeCycleRunners, cycleFlag, cycleRunnerKey } from '../../src/server/training/cycleRunners';
import { composeEntry, getClientConfig, getModelConfig, listModels, listRunners, reloadConfigs } from '../../src/server/training/registry';
import { hyperparameterArgs } from '../../src/server/training/runners/pythonRunner';

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG = path.join(ROOT, 'src', 'config');
const INVALID = path.join(ROOT, 'tests', 'fixtures', 'cycle_models_invalid');
const legacyFixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'cycle_runners_legacy.json'), 'utf-8')) as {
  runners: Record<string, unknown>;
  models: Record<string, unknown>;
};
const algorithms = (JSON.parse(fs.readFileSync(path.join(CONFIG, 'algorithms.json'), 'utf-8')) as AlgorithmRegistry).algorithms;
const tasks = (JSON.parse(fs.readFileSync(path.join(CONFIG, 'tasks.json'), 'utf-8')) as TaskRegistry).tasks;

/** Round-trip through JSON: the fixture is JSON, so an undefined field must equal an absent one. */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

type Files = Record<string, Record<string, unknown>>;
type Operation =
  | { op: 'set'; file: string; path: string[]; value: unknown }
  | { op: 'delete'; file: string; path: string[] }
  | { op: 'copy'; fromFile: string; fromPath: string[]; toFile: string; toPath: string[] };

function readFiles(): Files {
  const files: Files = {};
  for (const name of fs.readdirSync(CYCLE_MODELS_DIR).filter((file) => file.endsWith('.json'))) {
    files[name] = JSON.parse(fs.readFileSync(path.join(CYCLE_MODELS_DIR, name), 'utf-8'));
  }
  return files;
}

function parentOf(document: unknown, keys: string[]): Record<string, unknown> {
  let node = document as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
  return node;
}

function apply(files: Files, operations: Operation[]): Files {
  const next = structuredClone(files);
  for (const operation of operations) {
    if (operation.op === 'set') parentOf(next[operation.file], operation.path)[operation.path.at(-1)!] = operation.value;
    else if (operation.op === 'delete') delete parentOf(next[operation.file], operation.path)[operation.path.at(-1)!];
    else {
      const value = structuredClone(parentOf(next[operation.fromFile], operation.fromPath)[operation.fromPath.at(-1)!]);
      parentOf(next[operation.toFile], operation.toPath)[operation.toPath.at(-1)!] = value;
    }
  }
  return next;
}

let registry: CycleRegistry;

beforeAll(() => {
  reloadConfigs();
  registry = getCycleRegistry();
});

// ─── Loader ──────────────────────────────────────────────────────────────────

describe('cycleModels.ts — loading and validating the registry', () => {
  it('loads the real registry with no problems', () => {
    const load = loadCycleRegistry();
    expect(load.problems).toEqual([]);
    expect(Object.keys(load.registry!.models).length).toBeGreaterThanOrEqual(8);
  });

  const cases = fs.readdirSync(INVALID).filter((file) => file.endsWith('.json')).sort();
  for (const file of cases) {
    it(`rejects ${file.replace(/\.json$/, '')}`, () => {
      const fixture = JSON.parse(fs.readFileSync(path.join(INVALID, file), 'utf-8')) as { operations: Operation[] };
      const result = validateCycleRegistryFiles(apply(readFiles(), fixture.operations));
      expect(result.registry).toBeNull();
      expect(result.problems.length).toBeGreaterThan(0);
    });
  }

  describe('re-reads the folder when a file changes', () => {
    let directory: string;

    beforeAll(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-models-'));
      for (const name of fs.readdirSync(CYCLE_MODELS_DIR)) fs.copyFileSync(path.join(CYCLE_MODELS_DIR, name), path.join(directory, name));
    });

    afterAll(() => {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    it('serves the cached load until an mtime moves, then the edited file', () => {
      const first = loadCycleRegistry(directory);
      expect(first.registry!.models.xgboost!.displayName).toBe('XGBoost');
      expect(loadCycleRegistry(directory)).toBe(first);

      const file = path.join(directory, 'boosting.json');
      const document = JSON.parse(fs.readFileSync(file, 'utf-8'));
      document.models.xgboost.displayName = 'XGBoost (edited)';
      fs.writeFileSync(file, JSON.stringify(document, null, 2));
      const later = new Date(Date.now() + 5_000);
      fs.utimesSync(file, later, later);

      const second = loadCycleRegistry(directory);
      expect(second).not.toBe(first);
      expect(second.registry!.models.xgboost!.displayName).toBe('XGBoost (edited)');
    });

    it('an invalid edit yields its problems and no registry — never a half-loaded one', () => {
      const file = path.join(directory, 'boosting.json');
      const document = JSON.parse(fs.readFileSync(file, 'utf-8'));
      document.models.xgboost.runnable = false;
      fs.writeFileSync(file, JSON.stringify(document, null, 2));
      const later = new Date(Date.now() + 10_000);
      fs.utimesSync(file, later, later);

      const load = loadCycleRegistry(directory);
      expect(load.registry).toBeNull();
      expect(load.problems.join(' ')).toMatch(/unavailableReason/);
    });
  });

  it('cycleUnavailableReason: spec beats subcategory beats category beats the default', () => {
    const { shared } = registry;
    const specId = 'neural-network-architectures-attention-based-architectures-vision-transformer-vit';
    expect(cycleUnavailableReason(shared, specId, 'neural-network', 'attention-based-architectures')).toBe(shared.unavailableBySpec[specId]);
    expect(cycleUnavailableReason(shared, 'some-spec', 'neural-network', 'graph-neural-networks')).toBe(
      shared.unavailableBySubcategory['neural-network/graph-neural-networks'],
    );
    expect(cycleUnavailableReason(shared, 'some-spec', 'unsupervised', 'clustering')).toBe(shared.unavailableByCategory.unsupervised);
    expect(cycleUnavailableReason(shared, 'some-spec', 'a-category-nobody-listed', 'x')).toBe('Not built for the Cycle yet.');
  });
});

// ─── Composition ─────────────────────────────────────────────────────────────

describe('cycleRunners.ts — registry to runners', () => {
  const legacyKeys = Object.keys(legacyFixture.runners);

  it('the fixture holds the 8 legacy keys', () => {
    expect(legacyKeys).toHaveLength(8);
  });

  // Exactly what they were, plus the one field the registry adds: every Cycle
  // runner and model entry names its catalog spec, so its runs join the spec's
  // lifecycle (before, only XGBoost's did, through algorithms.json).
  const withCatalogId = <T extends object>(runnerKey: string, value: T): T => {
    const spec = registry.models[runnerKey.slice(0, -CYCLE_RUNNER_SUFFIX.length)]!.catalogSpecId;
    return spec === null ? value : { ...value, catalogId: spec };
  };
  const expectedRunner = (runnerKey: string) => withCatalogId(runnerKey, legacyFixture.runners[runnerKey] as object);
  const expectedModel = (runnerKey: string) => withCatalogId(runnerKey, legacyFixture.models[runnerKey] as object);

  it('composes the 8 legacy runner blocks and model entries as they were, plus their catalog spec (pure path)', () => {
    const composed = composeCycleRunners(registry, algorithms, tasks[registry.shared.task]!, composeEntry);
    for (const runnerKey of legacyKeys) {
      expect(asJson(composed.runners[runnerKey]), runnerKey).toEqual(expectedRunner(runnerKey));
      expect(asJson(composed.models[runnerKey]), runnerKey).toEqual(expectedModel(runnerKey));
    }
  });

  it('registry.ts serves the same legacy entries through listRunners(), listModels() and the client config', () => {
    const runners = listRunners();
    const models = listModels();
    const client = getClientConfig();
    for (const runnerKey of legacyKeys) {
      expect(asJson(runners[runnerKey]), runnerKey).toEqual(expectedRunner(runnerKey));
      expect(asJson(models[runnerKey]), runnerKey).toEqual(expectedModel(runnerKey));
      expect(asJson(client.runners[runnerKey]), runnerKey).toEqual(expectedRunner(runnerKey));
      expect(asJson(client.models[runnerKey]), runnerKey).toEqual(expectedModel(runnerKey));
    }
  });

  it('every registry model is a runner and a model entry, and nothing else ends in the Cycle suffix', () => {
    const expected = Object.keys(registry.models).map(cycleRunnerKey).sort();
    const cycleRunners = Object.keys(listRunners()).filter((key) => key.endsWith(CYCLE_RUNNER_SUFFIX)).sort();
    const cycleModels = Object.keys(listModels()).filter((key) => key.endsWith(CYCLE_RUNNER_SUFFIX)).sort();
    expect(cycleRunners).toEqual(expected);
    expect(cycleModels).toEqual(expected);
  });

  it('runners.json no longer carries any Cycle runner — the registry is the only source', () => {
    const runnersJson = JSON.parse(fs.readFileSync(path.join(CONFIG, 'runners.json'), 'utf-8')) as { runners: Record<string, unknown> };
    expect(Object.keys(runnersJson.runners).filter((key) => key.endsWith(CYCLE_RUNNER_SUFFIX))).toEqual([]);
  });

  it('a new model: scriptArgs, catalogId, one flag per parameter, estimator-only fields stripped, search and description kept', () => {
    const newKeys = Object.entries(registry.models).filter(([, entry]) => entry.adapter !== 'legacy');
    expect(newKeys.length).toBeGreaterThan(0);
    const runners = listRunners();
    for (const [key, entry] of newKeys) {
      const runner = runners[cycleRunnerKey(key)]!;
      expect(runner.scriptArgs).toEqual(['--model-family', key]);
      expect(runner.catalogId).toBe(entry.catalogSpecId ?? undefined);
      expect(runner.displayName).toBe(`${entry.displayName}${registry.shared.displayNameSuffix}`);
      expect(runner.script).toBe('src/ml/cycle/main.py');
      const names = [...Object.keys(registry.shared.cycleParameters), ...Object.keys(entry.parameters)];
      expect(Object.keys(runner.defaultHyperparameters)).toEqual(names);
      for (const name of names) {
        expect(runner.cliFlags![name]).toBe(cycleFlag(name));
        const parameter = runner.defaultHyperparameters[name] as unknown as Record<string, unknown>;
        expect(parameter).not.toHaveProperty('argument');
        expect(parameter).not.toHaveProperty('roles');
        // the Optuna space travels with the parameter so the form can show it and pin it
        const spec = (registry.shared.cycleParameters as Record<string, { search?: unknown }>)[name] ?? entry.parameters[name];
        if (spec?.search) expect(parameter.search).toEqual(spec.search);
        else expect(parameter).not.toHaveProperty('search');
      }
      for (const [name, spec] of Object.entries(entry.parameters)) {
        expect(runner.defaultHyperparameters[name]!.description).toBe(spec.description);
      }
      if (entry.runnable) {
        expect(runner.available).toBeUndefined();
      } else {
        expect(runner.available).toBe(false);
        expect(runner.unavailableReason).toBe(entry.unavailableReason);
      }
    }
  });

  it('a legacy model keeps no parameter description (its runner predates them)', () => {
    const runner = listRunners()['xgboost+walk_forward_cycle']!;
    for (const parameter of Object.values(runner.defaultHyperparameters)) expect(parameter.description).toBeUndefined();
  });

  it("a new model's composed entry is derived from the registry: labels, summary, tags, family, GPU flag, catalog spec", () => {
    const models = listModels();
    for (const [key, entry] of Object.entries(registry.models)) {
      if (entry.adapter === 'legacy') continue;
      const model = models[cycleRunnerKey(key)]!;
      expect(model.name).toBe(`${entry.displayName}${registry.shared.displayNameSuffix}`);
      expect(model.category).toBe(entry.category);
      expect(model.subcategory).toBe(entry.subcategory);
      expect(model.description).toBe(`${model.name} — ${entry.summary}`);
      expect(model.tags).toEqual(['cycle', 'walk-forward', key]);
      expect(model.gpuRequired).toBe(entry.gpu);
      expect(model.catalogId).toBe(entry.catalogSpecId ?? undefined);
      expect(model.available).toBe(entry.runnable);
      expect(model.family).toBe(
        entry.implementation === 'torch' ? 'pytorch' : entry.implementation === 'statsmodels' ? 'custom' : entry.implementation === 'sklearn' ? 'sklearn' : entry.implementation,
      );
      expect(getModelConfig(cycleRunnerKey(key))).toEqual(model);
    }
  });
});

// ─── pythonRunner: bool flags ────────────────────────────────────────────────

describe('hyperparameterArgs — bool flags', () => {
  const defaults = {
    quiet_bars: { type: 'bool', default: false, label: 'Quiet' },
    use_bias: { type: 'bool', default: true, label: 'Bias' },
    tree_count: { type: 'int', default: 100, label: 'Trees' },
  } as const;
  const flags = { quiet_bars: '--quiet-bars', use_bias: '--use-bias', tree_count: '--tree-count' };

  it('a Cycle runner passes --no-<flag> for a default-true bool set to false', () => {
    const args = hyperparameterArgs({ quiet_bars: false, use_bias: false, tree_count: 50 }, defaults, flags, 'catboost+walk_forward_cycle');
    expect(args).toEqual(['--no-use-bias', '--tree-count', '50']);
  });

  it('true passes the bare flag; a default-false bool set to false passes nothing', () => {
    const args = hyperparameterArgs({ quiet_bars: true, use_bias: true }, defaults, flags, 'catboost+walk_forward_cycle');
    expect(args).toEqual(['--quiet-bars', '--use-bias']);
  });

  it('other runners keep the presence rule (their scripts do not accept --no-…)', () => {
    const args = hyperparameterArgs({ quiet_bars: false, use_bias: false }, defaults, flags, 'temporal_fusion_transformer+direction_classifier');
    expect(args).toEqual([]);
  });

  it('skips unmapped keys', () => {
    expect(hyperparameterArgs({ unknown: 3 }, defaults, flags, 'x+walk_forward_cycle')).toEqual([]);
  });
});
