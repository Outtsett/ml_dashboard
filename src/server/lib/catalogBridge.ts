/**
 * Catalog-to-Registry Bridge — Unifies the model catalog (markdown specs)
 * with the training registry (models.json) into a single trainable-model API.
 *
 * Think of it as: a project manager who takes the R&D team's research papers
 * (catalog specs) and the engineering team's production configs (models.json)
 * and produces a single, unified roster of "what can we actually train?"
 *
 * Two sources of truth:
 *   1. Hand-configured models.json — battle-tested, always take priority
 *   2. Catalog markdown specs       — auto-parsed, need templates to be runnable
 *
 * SRP: this owns the merge logic + template expansion + trainability checks.
 * DIP: routes depend on this bridge, not on catalog/registry internals.
 * OCP: new model families are added via the FAMILY_TEMPLATES map, not by
 *       modifying existing conversion logic.
 */

import fs from 'fs';
import path from 'path';
import { getCatalogModels, getModelById } from './modelImport';
import { listModels } from '../training/registry';
import type {
  ModelRegistryEntry,
  HyperparameterDef,
} from '@shared/trainingTypes';
import type {
  ParsedModelSpec,
  ExtractedHyperparameter,
} from './modelImport/types';

// ─── Cache (same TTL as catalog service) ────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface BridgeCache {
  /** Merged map: model key → registry entry (hand-configured + catalog-generated) */
  mergedModels: Record<string, ModelRegistryEntry>;
  /** Set of model keys that have a real training script on disk */
  trainableKeys: Set<string>;
  /** Timestamp of last rebuild */
  builtAt: number;
}

let cache: BridgeCache | null = null;

// ─── Family Templates ───────────────────────────────────────────────────────
//
// Each model family maps to a partial ModelRegistryEntry that provides
// sensible defaults for runner, output types, chart overlays, etc.
// Catalog specs that match a family keyword get these defaults applied.
//
// To support a new framework, add an entry here (OCP).

interface FamilyTemplate {
  runner: 'python';
  featurePipeline: string;
  outputs: string[];
  chartOverlay: string;
  outputDir: string;
  gpuRequired: boolean;
  estimatedTrainingTime: string;
  /** Default feature category filter for this model family */
  defaultFeatureCategories?: string[];
  /** Keywords in spec name/overview that trigger this template */
  keywords: string[];
}

const FAMILY_TEMPLATES: Record<string, FamilyTemplate> = {
  sklearn: {
    runner: 'python',
    featurePipeline: 'standard',
    outputs: ['predictions', 'feature_importance'],
    chartOverlay: 'prediction_markers',
    outputDir: 'data/models',
    gpuRequired: false,
    estimatedTrainingTime: '1-5 min',
    defaultFeatureCategories: ['returns', 'volatility', 'momentum', 'volume'],
    keywords: [
      'random forest', 'decision tree', 'logistic regression', 'svm',
      'support vector', 'k-nearest', 'knn', 'naive bayes', 'gradient boosting',
      'adaboost', 'bagging', 'elastic net', 'lasso', 'ridge',
    ],
  },
  xgboost: {
    runner: 'python',
    featurePipeline: 'standard',
    outputs: ['predictions', 'feature_importance', 'shap_values'],
    chartOverlay: 'prediction_markers',
    outputDir: 'data/models',
    gpuRequired: false,
    estimatedTrainingTime: '2-10 min',
    defaultFeatureCategories: ['returns', 'volatility', 'momentum', 'volume'],
    keywords: ['xgboost', 'xgb'],
  },
  lightgbm: {
    runner: 'python',
    featurePipeline: 'standard',
    outputs: ['predictions', 'feature_importance'],
    chartOverlay: 'prediction_markers',
    outputDir: 'data/models',
    gpuRequired: false,
    estimatedTrainingTime: '1-5 min',
    defaultFeatureCategories: ['returns', 'volatility', 'momentum', 'volume'],
    keywords: ['lightgbm', 'light gbm', 'lgbm'],
  },
  catboost: {
    runner: 'python',
    featurePipeline: 'standard',
    outputs: ['predictions', 'feature_importance'],
    chartOverlay: 'prediction_markers',
    outputDir: 'data/models',
    gpuRequired: false,
    estimatedTrainingTime: '2-10 min',
    defaultFeatureCategories: ['returns', 'volatility', 'momentum', 'volume'],
    keywords: ['catboost'],
  },
  pytorch: {
    runner: 'python',
    featurePipeline: 'standard',
    outputs: ['predictions', 'loss_curve', 'model_weights'],
    chartOverlay: 'prediction_markers',
    outputDir: 'data/models',
    gpuRequired: true,
    estimatedTrainingTime: '10-60 min',
    defaultFeatureCategories: ['returns', 'volatility', 'momentum', 'orderflow'],
    keywords: [
      'neural network', 'deep learning', 'lstm', 'gru', 'rnn',
      'cnn', 'convolutional', 'attention', 'mlp', 'autoencoder',
      'variational', 'gan', 'generative adversarial',
    ],
  },
  transformer: {
    runner: 'python',
    featurePipeline: 'sequence',
    outputs: ['predictions', 'attention_weights', 'loss_curve'],
    chartOverlay: 'prediction_markers',
    outputDir: 'data/models',
    gpuRequired: true,
    estimatedTrainingTime: '30-120 min',
    defaultFeatureCategories: ['returns', 'volatility', 'momentum', 'orderflow', 'microstructure'],
    keywords: ['transformer', 'bert', 'gpt', 'self-attention'],
  },
  hmm: {
    runner: 'python',
    featurePipeline: 'self-contained',
    outputs: ['regimes', 'transition_matrix', 'convergence'],
    chartOverlay: 'regime_zones',
    outputDir: 'data/models',
    gpuRequired: false,
    estimatedTrainingTime: '2-15 min',
    defaultFeatureCategories: ['returns', 'volatility'],
    keywords: [
      'hidden markov', 'hmm', 'regime detection', 'regime switching',
      'baum-welch', 'viterbi', 'bayesian nonparametric',
    ],
  },
  reinforcement: {
    runner: 'python',
    featurePipeline: 'standard',
    outputs: ['policy', 'reward_curve', 'episode_stats'],
    chartOverlay: 'action_markers',
    outputDir: 'data/models',
    gpuRequired: true,
    estimatedTrainingTime: '30-180 min',
    defaultFeatureCategories: ['returns', 'volatility', 'position', 'portfolio'],
    keywords: [
      'reinforcement learning', 'q-learning', 'dqn', 'ppo', 'a2c', 'a3c',
      'policy gradient', 'actor-critic', 'sarsa', 'td learning',
    ],
  },
};

// ─── Hyperparameter Conversion ──────────────────────────────────────────────

/**
 * Convert an ExtractedHyperparameter (from markdown parsing) into a
 * HyperparameterDef (the training registry format).
 *
 * Markdown-extracted params have a simpler schema — we fill in the
 * training-specific fields (label, step, searchSpace) with heuristics.
 */
function convertHyperparameter(extracted: ExtractedHyperparameter): HyperparameterDef {
  const base: HyperparameterDef = {
    default: typeof extracted.default === 'number' ? extracted.default : 0,
    type: 'float',
    min: extracted.min ?? 0,
    max: extracted.max ?? 100,
    step: extracted.step ?? inferStep(extracted),
    label: formatLabel(extracted.name),
    description: extracted.description || undefined,
  };

  // Map catalog type → registry type
  switch (extracted.type) {
    case 'number':
      base.type = isIntegerParam(extracted) ? 'int' : 'float';
      break;
    case 'select':
      base.type = 'categorical';
      if (extracted.options) {
        base.choices = extracted.options;
        base.default = typeof extracted.default === 'number'
          ? extracted.default
          : 0;
      }
      break;
    case 'boolean':
      base.type = 'bool';
      base.min = 0;
      base.max = 1;
      base.step = 1;
      break;
    default:
      base.type = 'float';
  }

  // Add log-scale hint for params that span orders of magnitude
  if (base.type === 'float' && (base.max ?? 0) > 0 && (base.min ?? 0) > 0) {
    const ratio = base.max! / base.min!;
    if (ratio >= 100) {
      base.logScale = true;
      base.searchSpace = {
        min: base.min!,
        max: base.max!,
        logScale: true,
        distribution: 'loguniform',
      };
    }
  }

  return base;
}

/** Infer a step size from the extracted parameter range */
function inferStep(param: ExtractedHyperparameter): number {
  if (param.step) return param.step;
  if (param.type === 'boolean') return 1;
  if (param.type === 'select') return 1;

  const defaultVal = typeof param.default === 'number' ? param.default : 1;
  const range = (param.max ?? defaultVal * 10) - (param.min ?? 0);

  if (range <= 1) return 0.01;
  if (range <= 10) return 0.1;
  if (range <= 100) return 1;
  if (range <= 1000) return 10;
  return 50;
}

/** Determine if a numeric parameter should be treated as integer */
function isIntegerParam(param: ExtractedHyperparameter): boolean {
  if (typeof param.default === 'number' && !Number.isInteger(param.default)) return false;
  if (param.min !== undefined && !Number.isInteger(param.min)) return false;
  if (param.max !== undefined && !Number.isInteger(param.max)) return false;
  if (param.step !== undefined && !Number.isInteger(param.step)) return false;
  return true;
}

/** Convert snake_case parameter name to a human-readable label */
function formatLabel(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Template Matching ──────────────────────────────────────────────────────

/**
 * Match a catalog spec to the best family template by scanning its
 * name, overview, and category for keyword hits.
 */
function matchTemplate(spec: ParsedModelSpec): { templateId: string; template: FamilyTemplate } | null {
  const haystack = [
    spec.name,
    spec.overview,
    spec.category,
    spec.subcategory,
    ...spec.keyFeatures,
  ].join(' ').toLowerCase();

  let bestMatch: { templateId: string; template: FamilyTemplate; score: number } | null = null;

  for (const [templateId, template] of Object.entries(FAMILY_TEMPLATES)) {
    let score = 0;
    for (const keyword of template.keywords) {
      if (haystack.includes(keyword)) {
        // Longer keywords are more specific → higher score
        score += keyword.length;
      }
    }
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { templateId, template, score };
    }
  }

  return bestMatch ? { templateId: bestMatch.templateId, template: bestMatch.template } : null;
}

// ─── Catalog → Registry Conversion ──────────────────────────────────────────

/**
 * Convert a ParsedModelSpec (from markdown) into a ModelRegistryEntry
 * by applying a family template and converting hyperparameters.
 *
 * The resulting entry is a "draft" — it won't have a real training script
 * until someone writes one and adds a `script` path.
 */
function specToRegistryEntry(spec: ParsedModelSpec): ModelRegistryEntry {
  const match = matchTemplate(spec);
  const template = match?.template;

  // Convert extracted hyperparameters → training registry format
  const defaultHyperparameters: Record<string, HyperparameterDef> = {};
  for (const extracted of spec.hyperparameters) {
    defaultHyperparameters[extracted.name] = convertHyperparameter(extracted);
  }

  // Build tags from spec metadata
  const tags: string[] = [spec.category, spec.subcategory];
  if (spec.variants.length > 0) {
    tags.push(...spec.variants.slice(0, 3).map(v => v.toLowerCase()));
  }
  if (match?.templateId) {
    tags.push(match.templateId);
  }

  return {
    name: spec.name,
    category: spec.category,
    subcategory: spec.subcategory,
    runner: template?.runner ?? 'python',
    featurePipeline: template?.featurePipeline ?? 'standard',
    outputs: template?.outputs ?? ['predictions'],
    chartOverlay: template?.chartOverlay ?? 'prediction_markers',
    outputDir: template?.outputDir ?? 'data/models',
    defaultHyperparameters,
    featureCategories: template?.defaultFeatureCategories ?? null,
    catalogId: spec.id,
    description: spec.overview.slice(0, 500) || undefined,
    tags,
    family: match?.templateId as ModelRegistryEntry['family'],
    gpuRequired: template?.gpuRequired ?? false,
    estimatedTrainingTime: template?.estimatedTrainingTime,
    templateId: match?.templateId,
  };
}

// ─── Script Existence Check ─────────────────────────────────────────────────

/**
 * Check whether a training script file actually exists on disk.
 * Returns false for catalog-only models that don't have an implementation yet.
 */
function hasTrainingScript(entry: ModelRegistryEntry): boolean {
  if (!entry.script) return false;
  try {
    const scriptPath = path.resolve(process.cwd(), entry.script);
    return fs.existsSync(scriptPath);
  } catch {
    return false;
  }
}

// ─── Cache Builder ──────────────────────────────────────────────────────────

/**
 * Rebuild the merged model map from both sources.
 *
 * Priority order:
 *   1. Hand-configured models from models.json (always win)
 *   2. Catalog specs converted via templates (fill in the gaps)
 *
 * Hand-configured entries are enriched with catalog metadata (description,
 * tags) if they have a matching catalogId.
 */
function rebuildCache(): BridgeCache {
  const handConfigured = listModels();
  const catalogResult = getCatalogModels({ includeEmpty: false });
  const merged: Record<string, ModelRegistryEntry> = {};
  const trainableKeys = new Set<string>();

  // ── Step 1: Load hand-configured models (highest priority) ──────────────
  for (const [key, entry] of Object.entries(handConfigured)) {
    merged[key] = { ...entry };

    // Enrich with catalog metadata if catalogId is set
    if (entry.catalogId) {
      const spec = getModelById(entry.catalogId);
      if (spec) {
        merged[key] = {
          ...merged[key]!,
          description: merged[key]!.description || spec.overview.slice(0, 500) || undefined,
          tags: merged[key]!.tags ?? [spec.category, spec.subcategory],
        };
      }
    }

    // Hand-configured models are always trainable (they have tested scripts)
    if (entry.script) {
      trainableKeys.add(key);
    }
  }

  // ── Step 2: Convert catalog specs that aren't already in the registry ────
  for (const spec of catalogResult.models) {
    // Skip specs already covered by a hand-configured entry
    const alreadyCovered = Object.values(merged).some(
      entry => entry.catalogId === spec.id,
    );
    if (alreadyCovered) continue;

    // Skip empty / content-less specs
    if (!spec.hasContent) continue;

    const entry = specToRegistryEntry(spec);
    const key = spec.id;

    // Don't overwrite hand-configured entries that happen to share a key
    if (merged[key]) continue;

    merged[key] = entry;

    // Catalog-only models are trainable only if a script path is set and exists
    if (hasTrainingScript(entry)) {
      trainableKeys.add(key);
    }
  }

  return {
    mergedModels: merged,
    trainableKeys,
    builtAt: Date.now(),
  };
}

/** Ensure the cache is warm and fresh */
function ensureCache(): BridgeCache {
  const now = Date.now();
  if (!cache || now - cache.builtAt > CACHE_TTL_MS) {
    cache = rebuildCache();
  }
  return cache;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface TrainableModel extends ModelRegistryEntry {
  /** Whether this model has a working training script */
  trainable: boolean;
  /** Source of this entry: 'registry' (models.json) or 'catalog' (auto-generated) */
  source: 'registry' | 'catalog';
}

/**
 * Get all models — both hand-configured and catalog-generated — with
 * trainability status and source annotation.
 *
 * Hand-configured models always appear first, then catalog models sorted
 * alphabetically. Each entry includes `trainable` (has a working script)
 * and `source` (registry vs. catalog) flags.
 */
export function getTrainableModels(): Record<string, TrainableModel> {
  const { mergedModels, trainableKeys } = ensureCache();
  const handConfigured = listModels();
  const result: Record<string, TrainableModel> = {};

  for (const [key, entry] of Object.entries(mergedModels)) {
    result[key] = {
      ...entry,
      trainable: trainableKeys.has(key),
      source: key in handConfigured ? 'registry' : 'catalog',
    };
  }

  return result;
}

/**
 * Get the full training configuration for a specific catalog model.
 *
 * If the model exists in models.json, returns that entry directly.
 * If it only exists in the catalog, generates a config from the spec
 * via template matching + hyperparameter conversion.
 *
 * Returns null if the catalogId doesn't match any known model.
 */
export function getModelTrainingConfig(catalogId: string): TrainableModel | null {
  const { mergedModels, trainableKeys } = ensureCache();
  const handConfigured = listModels();

  // First check: direct key match in merged models
  if (mergedModels[catalogId]) {
    return {
      ...mergedModels[catalogId]!,
      trainable: trainableKeys.has(catalogId),
      source: catalogId in handConfigured ? 'registry' : 'catalog',
    };
  }

  // Second check: find by catalogId field in any entry
  for (const [key, entry] of Object.entries(mergedModels)) {
    if (entry.catalogId === catalogId) {
      return {
        ...entry,
        trainable: trainableKeys.has(key),
        source: key in handConfigured ? 'registry' : 'catalog',
      };
    }
  }

  // Third check: try loading from catalog directly (might be a fresh spec)
  const spec = getModelById(catalogId);
  if (spec) {
    const entry = specToRegistryEntry(spec);
    return {
      ...entry,
      trainable: hasTrainingScript(entry),
      source: 'catalog',
    };
  }

  return null;
}

/**
 * Check whether a catalog model is trainable (has a working training script).
 *
 * Returns false for:
 *   - Unknown catalog IDs
 *   - Catalog-only models without a script
 *   - Models whose script path doesn't exist on disk
 */
export function isModelTrainable(catalogId: string): boolean {
  const config = getModelTrainingConfig(catalogId);
  return config?.trainable ?? false;
}

export interface CatalogBridgeStats {
  /** Total models in unified registry */
  totalModels: number;
  /** Models from hand-configured models.json */
  registryModels: number;
  /** Models auto-generated from catalog specs */
  catalogModels: number;
  /** Models that have working training scripts */
  trainableModels: number;
  /** Models without training scripts (catalog-only drafts) */
  untrained: number;
  /** Breakdown of models matched to each family template */
  templateCoverage: Record<string, number>;
  /** Cache age in seconds */
  cacheAgeSec: number;
  /** When the cache was last rebuilt */
  lastBuiltAt: number;
}

/**
 * Get statistics about the bridge — how many models are merged,
 * how many are trainable, template coverage, cache freshness.
 *
 * Useful for the dashboard admin panel and debugging.
 */
export function getCatalogBridgeStats(): CatalogBridgeStats {
  const { mergedModels, trainableKeys, builtAt } = ensureCache();
  const handConfigured = listModels();

  let registryModels = 0;
  let catalogModels = 0;
  const templateCoverage: Record<string, number> = {};

  for (const [key, entry] of Object.entries(mergedModels)) {
    if (key in handConfigured) {
      registryModels++;
    } else {
      catalogModels++;
    }

    const templateId = entry.templateId ?? 'unmatched';
    templateCoverage[templateId] = (templateCoverage[templateId] ?? 0) + 1;
  }

  const totalModels = Object.keys(mergedModels).length;

  return {
    totalModels,
    registryModels,
    catalogModels,
    trainableModels: trainableKeys.size,
    untrained: totalModels - trainableKeys.size,
    templateCoverage,
    cacheAgeSec: Math.round((Date.now() - builtAt) / 1000),
    lastBuiltAt: builtAt,
  };
}

/**
 * Force-rebuild the bridge cache. Call this after adding new catalog
 * specs or modifying models.json to see changes immediately.
 */
export function refreshBridge(): CatalogBridgeStats {
  cache = null;
  return getCatalogBridgeStats();
}
