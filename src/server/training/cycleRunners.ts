/**
 * The Model Cycle registry turned into training runners — pure.
 *
 * Every registry model becomes one `<key>+walk_forward_cycle` runner: the
 * shared `runnerTemplate` from `_cycle.json`, `scriptArgs: ["--model-family",
 * key]`, and the cycle-wide parameters followed by the model's own, each with
 * its `--kebab-case` flag. `registry.ts` merges these into `listRunners()` and
 * `listModels()`; `runners.json` no longer carries them.
 *
 * Registry-only parameter fields (`argument`, `roles`, `search`) never reach a
 * runner. A parameter's `description` is kept for the models the registry
 * introduced and dropped for the 8 legacy ones, whose runner and composed model
 * entries must stay what they were before the registry
 * (`tests/fixtures/cycle_runners_legacy.json`) plus one field: every runner,
 * legacy included, now carries its registry `catalogId`, so a Cycle run of any
 * model counts toward its catalog spec's lifecycle (before the registry only
 * XGBoost's did, through its `algorithms.json` `catalogSpec`).
 *
 * Model entries are composed by the caller's `compose` (registry.ts's
 * `composeEntry`) from an algorithm: `algorithms.json`'s entry for a legacy
 * key, or one derived from the registry entry for every other key.
 */

import { CYCLE_RUNNER_SUFFIX, type CycleModelEntry, type CycleParameter, type CycleRegistry, type CycleSharedRegistry } from "@shared/cycle/models";
import type { AlgorithmEntry, HyperparameterDef, ModelRegistryEntry, RunnerEntry, TaskEntry } from "@shared/trainingTypes";

export type ComposeEntry = (
  algorithmId: string,
  taskId: string,
  algorithm: AlgorithmEntry,
  task: TaskEntry,
  runner: RunnerEntry,
) => ModelRegistryEntry;

export interface CycleRunnerSet {
  runners: Record<string, RunnerEntry>;
  models: Record<string, ModelRegistryEntry>;
}

export function cycleRunnerKey(key: string): string {
  return `${key}${CYCLE_RUNNER_SUFFIX}`;
}

export function isCycleRunnerKey(runnerKey: string): boolean {
  return runnerKey.endsWith(CYCLE_RUNNER_SUFFIX);
}

/** `label_horizon_bars` -> `--label-horizon-bars`; the same rule as `catalog.flag` in Python. */
export function cycleFlag(name: string): string {
  return `--${name.replace(/_/g, "-")}`;
}

function runnerParameter(spec: CycleParameter, keepDescription: boolean): HyperparameterDef {
  const { argument: _argument, roles: _roles, search: _search, description, ...rest } = spec;
  // The registry allows string defaults (categorical); HyperparameterDef's
  // `default` type predates categorical parameters, as runners.json's did.
  const parameter = rest as unknown as HyperparameterDef;
  return keepDescription && description !== undefined ? { ...parameter, description } : parameter;
}

/** One registry model's runner block. */
export function composeCycleRunner(key: string, entry: CycleModelEntry, shared: CycleSharedRegistry): RunnerEntry {
  const legacy = entry.adapter === "legacy";
  const defaultHyperparameters: Record<string, HyperparameterDef> = {};
  for (const [name, spec] of Object.entries(shared.cycleParameters)) defaultHyperparameters[name] = runnerParameter(spec, !legacy);
  for (const [name, spec] of Object.entries(entry.parameters)) defaultHyperparameters[name] = runnerParameter(spec, !legacy);
  const cliFlags = Object.fromEntries(Object.keys(defaultHyperparameters).map((name) => [name, cycleFlag(name)]));

  const runner = {
    ...(entry.catalogSpecId === null ? {} : { catalogId: entry.catalogSpecId }),
    displayName: `${entry.displayName}${shared.displayNameSuffix}`,
    ...(shared.runnerTemplate as unknown as Omit<RunnerEntry, "defaultHyperparameters">),
    estimatedTrainingTime: entry.estimatedTrainingTime,
    tags: ["cycle", "walk-forward", key],
    defaultHyperparameters,
    cliFlags,
    ...(entry.runnable ? {} : { available: false, unavailableReason: entry.unavailableReason ?? "Not runnable in the Cycle yet." }),
    scriptArgs: ["--model-family", key],
  } satisfies RunnerEntry;
  return runner;
}

/** The library family a registry model belongs to, in `AlgorithmEntry.family`'s terms. */
function familyOf(entry: CycleModelEntry): AlgorithmEntry["family"] {
  switch (entry.implementation) {
    case "torch":
      return "pytorch";
    case "xgboost":
    case "lightgbm":
    case "catboost":
      return entry.implementation;
    case "statsmodels":
      return "custom";
    default:
      return "sklearn";
  }
}

/**
 * The algorithm a cycle runner is composed with. A legacy key keeps its
 * `algorithms.json` entry (its category, description, tags, family, GPU flag
 * and catalog spec are part of the frozen legacy entry); every other key gets
 * one derived from the registry: its fallback category/subcategory labels, its
 * summary as the description, its catalog spec, its GPU flag.
 */
export function cycleAlgorithm(key: string, entry: CycleModelEntry, algorithms: Record<string, AlgorithmEntry>): AlgorithmEntry {
  if (entry.adapter === "legacy") {
    const known = algorithms[entry.legacyFamily ?? key];
    // The registry names the catalog spec for the 7 legacy algorithms that had none.
    if (known) return entry.catalogSpecId === null || known.catalogSpec ? known : { ...known, catalogSpec: entry.catalogSpecId };
  }
  return {
    name: entry.displayName,
    family: familyOf(entry),
    category: entry.category,
    subcategory: entry.subcategory,
    supports: ["classification"],
    gpuRequired: entry.gpu,
    ...(entry.catalogSpecId === null ? {} : { catalogSpec: entry.catalogSpecId }),
    description: entry.summary,
  };
}

/** Drop keys whose value is undefined, so a composed entry deep-equals its JSON form. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

/**
 * Every registry model's runner block and composed model entry, keyed by
 * runner key, in registry order. `algorithms` is `algorithms.json`'s map;
 * `task` is the `walk_forward_cycle` task from `tasks.json`.
 */
export function composeCycleRunners(
  registry: CycleRegistry,
  algorithms: Record<string, AlgorithmEntry>,
  task: TaskEntry,
  compose: ComposeEntry,
): CycleRunnerSet {
  const runners: Record<string, RunnerEntry> = {};
  const models: Record<string, ModelRegistryEntry> = {};
  for (const [key, entry] of Object.entries(registry.models)) {
    const runnerKey = cycleRunnerKey(key);
    const runner = composeCycleRunner(key, entry, registry.shared);
    runners[runnerKey] = runner;
    models[runnerKey] = withoutUndefined(compose(key, registry.shared.task, cycleAlgorithm(key, entry, algorithms), task, runner));
  }
  return { runners, models };
}
