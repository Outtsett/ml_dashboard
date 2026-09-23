/**
 * Training Registry — Reads config/*.json at startup.
 *
 * As of 2026-05-09, model definitions are split across three orthogonal files:
 *   - algorithms.json — pure architecture metadata (XGBoost, Two-Stream Transformer, …)
 *   - tasks.json      — what the model is for (direction_classifier, range_classifier, …)
 *   - runners.json    — (algorithm, task) → script + hyperparameters wiring
 *
 * The legacy `models.json` is no longer the source of truth, but is kept as a
 * fallback when the three new files are absent (defensive — keeps test fixtures
 * + ad-hoc deployments working). When all three are present, this loader builds
 * the runtime `ModelRegistry` view by joining them on the composite key
 * `${algorithm}+${task}`.
 *
 * Backwards compat: each runner row carries `legacyId` (e.g. "xgb_classifier")
 * so any client with a cached old modelType still resolves to the right runner.
 *
 * JSON configs are cross-language (Python reads them too).
 */

import fs from "fs";
import path from "path";
import type {
  AlgorithmEntry,
  AlgorithmRegistry,
  HyperparameterDef,
  ModelRegistry,
  ModelRegistryEntry,
  RunnerEntry,
  RunnerRegistry,
  TaskEntry,
  TaskRegistry,
  TrainingConfig,
} from "@shared/trainingTypes";

const CONFIG_DIR = path.join(process.cwd(), "src", "config");

const IS_DEV = process.env.NODE_ENV !== "production";

// ─── Cached configs (auto-reload on file change in dev mode) ────────────────

let algorithmsConfig: AlgorithmRegistry | null = null;
let tasksConfig: TaskRegistry | null = null;
let runnersConfig: RunnerRegistry | null = null;
let modelsConfig: ModelRegistry | null = null;
let legacyAliasMap: Record<string, string> = {};

interface FeatureDefinition {
  name: string;
  category: string;
  type: string;
  params: Record<string, number>;
  requires: string[];
  description: string;
}

interface FeaturesConfig {
  version?: number;
  categories?: Record<string, { name: string; description: string }>;
  features?: FeatureDefinition[];
  normalization?: { method: string; lookback: number; clip: number[] };
  pipelines?: Record<string, Record<string, unknown>>;
  featureSets?: Record<string, Record<string, unknown>>;
}

let featuresConfig: FeaturesConfig | null = null;
let trainingConfig: TrainingConfig | null = null;

/** Track file mtimes for dev-mode auto-reload */
const lastMtimes: Record<string, number> = {};

function loadJSON<T>(filename: string): T {
  const filePath = path.join(CONFIG_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }
  lastMtimes[filename] = fs.statSync(filePath).mtimeMs;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function loadJSONIfExists<T>(filename: string): T | null {
  const filePath = path.join(CONFIG_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  lastMtimes[filename] = fs.statSync(filePath).mtimeMs;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function fileChanged(filename: string): boolean {
  const filePath = path.join(CONFIG_DIR, filename);
  try {
    return fs.statSync(filePath).mtimeMs !== (lastMtimes[filename] ?? 0);
  } catch {
    return false;
  }
}

// ─── Composite registry build ───────────────────────────────────────────────

/**
 * Compose a ModelRegistryEntry from the (algorithm, task, runner) triple.
 *
 * The runner is the dominant source of truth for runtime wiring (script,
 * hyperparams, CLI flags). Algorithm + task contribute display metadata,
 * supported-objectives, and chart-overlay defaults that the runner can
 * override.
 */
function composeEntry(
  algorithmId: string,
  taskId: string,
  algorithm: AlgorithmEntry,
  task: TaskEntry,
  runner: RunnerEntry,
): ModelRegistryEntry {
  return {
    name: runner.displayName ?? `${algorithm.name} + ${task.name}`,
    category: algorithm.category,
    subcategory: algorithm.subcategory,
    runner: runner.runner,
    script: runner.script,
    featurePipeline: runner.featurePipeline,
    outputs: runner.outputs,
    chartOverlay: runner.chartOverlay ?? task.chartOverlay ?? "prediction_markers",
    outputDir: runner.outputDir,
    defaultHyperparameters: runner.defaultHyperparameters,
    featureCategories: runner.featureCategories ?? null,
    includeIndicators: runner.includeIndicators,
    allFeatures: runner.allFeatures,
    cliFlags: runner.cliFlags,
    catalogId: algorithm.catalogSpec,
    description: runner.displayName
      ? `${runner.displayName} — ${algorithm.description ?? ""}`
      : algorithm.description,
    // A Set: both lists routinely carry the family tag ("transformer"), and the
    // picker keys its tag chips by tag text.
    tags: [...new Set([...(algorithm.tags ?? []), ...(runner.tags ?? [])])],
    family: algorithm.family as ModelRegistryEntry["family"],
    gpuRequired: algorithm.gpuRequired,
    estimatedTrainingTime: runner.estimatedTrainingTime,
    supportedObjectives: runner.supportedObjectives ?? task.supportedObjectives,
    // config.runners already marked three entries unavailable (their scripts
    // point at repositories that are not on this machine), but composeEntry
    // enumerates the fields it copies, so config.models — which is what the
    // Train dropdown reads — kept reporting all six as runnable.
    available: runner.available ?? true,
    unavailableReason: runner.unavailableReason,
  };
}

function buildCompositeRegistry(): {
  models: Record<string, ModelRegistryEntry>;
  aliases: Record<string, string>;
} {
  const models: Record<string, ModelRegistryEntry> = {};
  const aliases: Record<string, string> = {};

  if (!algorithmsConfig || !tasksConfig || !runnersConfig) {
    return { models, aliases };
  }

  for (const [compositeId, runner] of Object.entries(runnersConfig.runners)) {
    const [algorithmId, taskId] = compositeId.split("+");
    if (!algorithmId || !taskId) {
      console.warn(`[registry] Invalid composite key: ${compositeId} (expected "alg+task")`);
      continue;
    }

    const algorithm = algorithmsConfig.algorithms[algorithmId];
    const task = tasksConfig.tasks[taskId];

    if (!algorithm) {
      console.warn(`[registry] Runner ${compositeId} references unknown algorithm: ${algorithmId}`);
      continue;
    }
    if (!task) {
      console.warn(`[registry] Runner ${compositeId} references unknown task: ${taskId}`);
      continue;
    }

    // Sanity check: algorithm.supports ∩ task.headKind
    const headKind = task.headKind;
    const compatible =
      (headKind === "classification" && algorithm.supports.includes("classification")) ||
      (headKind === "regression" && algorithm.supports.includes("regression")) ||
      (headKind === "multi" && algorithm.supports.includes("multi-head"));
    if (!compatible) {
      console.warn(
        `[registry] ${compositeId}: algorithm ${algorithmId} (supports=${algorithm.supports.join(",")}) ` +
          `is not compatible with task ${taskId} (headKind=${headKind})`,
      );
    }

    models[compositeId] = composeEntry(algorithmId, taskId, algorithm, task, runner);

    if (runner.legacyId) {
      aliases[runner.legacyId] = compositeId;
    }
  }

  return { models, aliases };
}

function ensureLoaded() {
  // In dev mode, re-read if any config file changed on disk
  if (
    IS_DEV &&
    (fileChanged("algorithms.json") ||
      fileChanged("tasks.json") ||
      fileChanged("runners.json") ||
      fileChanged("models.json") ||
      fileChanged("features.json") ||
      fileChanged("training.json"))
  ) {
    algorithmsConfig = null;
    tasksConfig = null;
    runnersConfig = null;
    modelsConfig = null;
    featuresConfig = null;
    trainingConfig = null;
  }

  // Try to load the new 3-file source of truth
  if (!algorithmsConfig) {
    algorithmsConfig = loadJSONIfExists<AlgorithmRegistry>("algorithms.json");
  }
  if (!tasksConfig) {
    tasksConfig = loadJSONIfExists<TaskRegistry>("tasks.json");
  }
  if (!runnersConfig) {
    runnersConfig = loadJSONIfExists<RunnerRegistry>("runners.json");
  }

  // If all three loaded, compose the runtime view from them
  if (algorithmsConfig && tasksConfig && runnersConfig) {
    if (!modelsConfig) {
      const { models, aliases } = buildCompositeRegistry();
      modelsConfig = { version: 2, models };
      legacyAliasMap = aliases;
    }
  } else {
    // Fallback to legacy models.json
    if (!modelsConfig) {
      const raw = loadJSON<{ models: Record<string, ModelRegistryEntry>; version?: number }>(
        "models.json",
      );
      modelsConfig = { version: raw.version ?? 1, models: raw.models };
      legacyAliasMap = {};
    }
  }

  if (!featuresConfig) {
    featuresConfig = loadJSON<FeaturesConfig>("features.json");
  }
  if (!trainingConfig) {
    trainingConfig = loadJSON<TrainingConfig>("training.json");
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get a model config by type key.
 * Accepts both new composite keys (`xgboost+direction_classifier`) and
 * pre-2026-05-09 legacy keys (`xgb_classifier`) — the latter are translated
 * via the alias map built at registry-load time.
 */
export function getModelConfig(modelType: string): ModelRegistryEntry | null {
  ensureLoaded();
  // Direct hit (new composite key OR legacy key still in models.json)
  const direct = modelsConfig!.models[modelType];
  if (direct) return direct;
  // Legacy alias → composite key
  const aliased = legacyAliasMap[modelType];
  if (aliased) return modelsConfig!.models[aliased] ?? null;
  return null;
}

/** List all wired (algorithm × task) runners as the runtime registry. */
export function listModels(): Record<string, ModelRegistryEntry> {
  ensureLoaded();
  return modelsConfig!.models;
}

/** All algorithms (architecture metadata, no runner wiring). */
export function listAlgorithms(): Record<string, AlgorithmEntry> {
  ensureLoaded();
  return algorithmsConfig?.algorithms ?? {};
}

/** All tasks (head + label strategy compatibility). */
export function listTasks(): Record<string, TaskEntry> {
  ensureLoaded();
  return tasksConfig?.tasks ?? {};
}

/** All wired runners keyed by `${algorithm}+${task}`. */
export function listRunners(): Record<string, RunnerEntry> {
  ensureLoaded();
  return runnersConfig?.runners ?? {};
}

/** Resolve a legacy modelType key to its composite equivalent (or null). */
export function resolveLegacyModelType(modelType: string): string | null {
  ensureLoaded();
  return legacyAliasMap[modelType] ?? null;
}

/** Get a feature pipeline config by key */
export function getFeaturePipeline(pipelineId: string): Record<string, unknown> | null {
  ensureLoaded();
  return featuresConfig!.pipelines?.[pipelineId] ?? null;
}

/** Get all feature pipelines */
export function listFeaturePipelines(): Record<string, Record<string, unknown>> {
  ensureLoaded();
  return featuresConfig!.pipelines ?? {};
}

/** Get a named feature set (e.g. "full-344") */
export function getFeatureSet(setId: string): Record<string, unknown> | null {
  ensureLoaded();
  return featuresConfig!.featureSets?.[setId] ?? null;
}

/** Get all feature sets */
export function listFeatureSets(): Record<string, Record<string, unknown>> {
  ensureLoaded();
  return featuresConfig!.featureSets ?? {};
}

/** Get all feature categories */
export function getFeatureCategories(): Record<string, { name: string; description: string }> {
  ensureLoaded();
  return featuresConfig!.categories ?? {};
}

/** Get full feature catalog (all defined features) */
export function getFeatureCatalog(): FeatureDefinition[] {
  ensureLoaded();
  return featuresConfig!.features ?? [];
}

/** Get normalization config */
export function getNormalizationConfig(): { method: string; lookback: number; clip: number[] } | null {
  ensureLoaded();
  return featuresConfig!.normalization ?? null;
}

/** Get training infrastructure config (paths, limits, timeframes) */
export function getTrainingConfig(): TrainingConfig {
  ensureLoaded();
  return trainingConfig!;
}

/** Convert timeframe label to seconds (e.g. "30m" → 1800) */
export function timeframeToSeconds(tf: string): number {
  ensureLoaded();
  return trainingConfig!.timeframes[tf] ?? 60;
}

/** Convert timeframe minutes to label (e.g. 30 → "30m", 60 → "1h") */
export function minutesToTimeframeLabel(minutes: number): string {
  const map: Record<number, string> = {
    1: "1m", 5: "5m", 15: "15m", 30: "30m",
    60: "1h", 240: "4h", 1440: "1d", 10080: "1w",
  };
  return map[minutes] ?? `${minutes}m`;
}

/**
 * Merge default hyperparameters with user overrides.
 * Returns flat key→value map ready for CLI args or trainer config.
 */
export function resolveHyperparameters(
  defaults: Record<string, HyperparameterDef>,
  overrides?: Record<string, number | string | boolean>,
): Record<string, number | string | boolean> {
  const result: Record<string, number | string | boolean> = {};

  // Start with defaults
  for (const [key, def] of Object.entries(defaults)) {
    result[key] = def.default;
  }

  // Apply overrides (only for known keys with valid values)
  if (overrides) {
    for (const [key, val] of Object.entries(overrides)) {
      if (key in defaults) {
        result[key] = val;
      }
    }
  }

  return result;
}

/** Force-reload all configs from disk (useful after hot-edit) */
export function reloadConfigs() {
  algorithmsConfig = null;
  tasksConfig = null;
  runnersConfig = null;
  modelsConfig = null;
  featuresConfig = null;
  trainingConfig = null;
  legacyAliasMap = {};
  ensureLoaded();
}

/**
 * Get the full config bundle for client consumption.
 *
 * Includes:
 *   - models:     legacy-shape composite-keyed registry (drives existing dropdowns)
 *   - algorithms: NEW — architecture-only metadata (drives Algorithm picker)
 *   - tasks:      NEW — head/label compatibility (drives Task picker)
 *   - runners:    NEW — wired (alg, task) pairs with hyperparam defaults
 *   - aliases:    NEW — legacy modelType key → composite key map (UI legacy hydration)
 */
export function getClientConfig() {
  ensureLoaded();
  return {
    models: modelsConfig!.models,
    algorithms: algorithmsConfig?.algorithms ?? {},
    tasks: tasksConfig?.tasks ?? {},
    runners: runnersConfig?.runners ?? {},
    aliases: legacyAliasMap,
    features: featuresConfig!,
    timeframes: trainingConfig!.timeframes,
  };
}
