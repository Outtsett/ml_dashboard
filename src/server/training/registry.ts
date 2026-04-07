/**
 * Training Registry — Reads config/*.json at startup.
 *
 * Single source of truth for:
 * - Which model types are implemented and how to run them
 * - Default feature pipeline configs
 * - Infrastructure paths, limits, timeframe mappings
 *
 * JSON configs are cross-language (Python reads them too).
 */

import fs from "fs";
import path from "path";
import { z } from "zod";
import type {
  ModelRegistry,
  ModelRegistryEntry,
  TrainingConfig,
  HyperparameterDef,
} from "@shared/trainingTypes";

const CONFIG_DIR = path.join(process.cwd(), "src", "config");

// ─── Cached configs (auto-reload on file change in dev mode) ────────────────


const ModelSpecSchema = z.object({
  version: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  models: z.record(z.object({
    name: z.string(),
    architecture: z.string().optional(),
    entry_point: z.string().optional(),
    status: z.string().optional(),
    tier: z.string().optional(),
    outputs: z.union([z.array(z.string()), z.record(z.string())]),
    hyperparameter_map: z.record(z.array(z.string())).optional(),
  }).passthrough())
});

const IS_DEV = process.env.NODE_ENV !== "production";

let modelsConfig: ModelRegistry | null = null;
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

function fileChanged(filename: string): boolean {
  const filePath = path.join(CONFIG_DIR, filename);
  try {
    return fs.statSync(filePath).mtimeMs !== (lastMtimes[filename] ?? 0);
  } catch { return false; }
}

function ensureLoaded() {
  // In dev mode, re-read if any config file changed on disk
  if (IS_DEV && (fileChanged("models.json") || fileChanged("features.json") || fileChanged("training.json"))) {
    modelsConfig = null;
    featuresConfig = null;
    trainingConfig = null;
  }

  if (!modelsConfig) {
    const raw = loadJSON<any>("models.json");
    const parsed = ModelSpecSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[registry] models.json validation failed:", parsed.error.message);
      // Fallback to raw if validation is too strict during migration
      modelsConfig = raw as ModelRegistry;
    } else {
      modelsConfig = parsed.data as unknown as ModelRegistry;
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

/** Get a model config by type key */
export function getModelConfig(modelType: string): ModelRegistryEntry | null {
  ensureLoaded();
  return modelsConfig!.models[modelType] ?? null;
}

/** List all implemented model types */
export function listModels(): Record<string, ModelRegistryEntry> {
  ensureLoaded();
  return modelsConfig!.models;
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
  modelsConfig = null;
  featuresConfig = null;
  trainingConfig = null;
  ensureLoaded();
}

/** Get the full config bundle for client consumption */
export function getClientConfig() {
  ensureLoaded();
  return {
    models: modelsConfig!.models,
    features: featuresConfig!,
    timeframes: trainingConfig!.timeframes,
  };
}
