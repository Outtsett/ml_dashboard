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
import { listModels } from '../../training/registry';
import { CYCLE_RUNNER_SUFFIX } from '@shared/cycle/models';
import type {
  ModelRegistryEntry,
  HyperparameterDef,
} from '@shared/trainingTypes';
import type {
  ParsedModelSpec,
  ExtractedHyperparameter,
} from './modelImport/types';

// ─── W5 Composite catalog extras (file-backed, hot-reload via cache TTL) ────
//
// Composite "meta-entries" live in packages/config/composite_catalog_extras.json
// and are merged into the catalog so MoE / Stacking / Voting / Multimodal show
// up as pickable in ModelCatalogPicker. Each extra's `templateId` is one of
// composite_moe / composite_stacking / composite_voting / composite_multimodal
// and resolves through `pickTemplate()` to the corresponding Jinja2 template.

interface CompositeCatalogExtra {
  id: string;
  name: string;
  shortName?: string;
  category: string;
  subcategory: string;
  templateId:
    | 'composite_moe'
    | 'composite_stacking'
    | 'composite_voting'
    | 'composite_multimodal';
  compositeKind: 'moe' | 'stacking' | 'voting' | 'multimodal';
  overview: string;
  principles: string[];
  applications: string[];
  keyFeatures: string[];
  variants: string[];
  hyperparameters: ExtractedHyperparameter[];
  module_path: string | null;
  class_name: string | null;
  classOrigin: 'manual';
}

const COMPOSITE_EXTRAS_PATH = path.resolve(
  process.cwd(), "packages/config/composite_catalog_extras.json",
);

function loadCompositeExtras(): CompositeCatalogExtra[] {
  try {
    if (!fs.existsSync(COMPOSITE_EXTRAS_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(COMPOSITE_EXTRAS_PATH, 'utf-8')) as {
      extras?: CompositeCatalogExtra[];
    };
    return Array.isArray(raw.extras) ? raw.extras : [];
  } catch {
    return [];
  }
}

/** Composite catalog ID → templateId lookup, populated lazily. */
let _compositeIdToTemplate: Record<string, CompositeCatalogExtra['templateId']> | null = null;
function compositeIdToTemplate(): Record<string, CompositeCatalogExtra['templateId']> {
  if (_compositeIdToTemplate === null) {
    const out: Record<string, CompositeCatalogExtra['templateId']> = {};
    for (const x of loadCompositeExtras()) {
      out[x.id] = x.templateId;
    }
    _compositeIdToTemplate = out;
  }
  return _compositeIdToTemplate;
}

// ─── Generated catalog extras (repo-local curated GENERATE entries) ──────────
//
// First-class neural architectures that ship as a Jinja2 template + composable
// blocks but have no markdown spec under E:/documents/algo_models. Listing them
// here surfaces them in the Train dropdown as GENERATE (Generate → Save →
// Train) with curated hyperparameters, without depending on the external spec
// tree. Each `templateId` must be a real TemplateId resolvable by
// generate_model.py's DEFAULT_FAMILY_FOR_CATALOG.

interface GeneratedCatalogExtra {
  id: string;
  name: string;
  shortName?: string;
  category: string;
  subcategory: string;
  templateId: TemplateId;
  overview: string;
  principles?: string[];
  applications?: string[];
  keyFeatures?: string[];
  variants?: string[];
  hyperparameters: ExtractedHyperparameter[];
  gpuRequired?: boolean;
  featureCategories?: string[];
}

const GENERATED_EXTRAS_PATH = path.resolve(
  process.cwd(), "packages/config/generated_catalog_extras.json",
);

function loadGeneratedExtras(): GeneratedCatalogExtra[] {
  try {
    if (!fs.existsSync(GENERATED_EXTRAS_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(GENERATED_EXTRAS_PATH, 'utf-8')) as {
      extras?: GeneratedCatalogExtra[];
    };
    return Array.isArray(raw.extras) ? raw.extras : [];
  } catch {
    return [];
  }
}

/** Non-composite templateIds trusted directly on a catalog entry by
 *  resolveTemplateId (no markdown spec required). Sourced from the generated
 *  extras file so adding a new GENERATE architecture is a JSON edit. */
const GENERATABLE_CURATED_TEMPLATES = new Set<string>(
  loadGeneratedExtras().map((x) => x.templateId),
);

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
  runner: 'async-orchestrator';
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
    // Skip specs already covered by a hand-configured entry. A Model Cycle
    // runner (`<key>+walk_forward_cycle`) names its spec too, but it runs only
    // inside the Cycle, so it never stands in for the spec's own trainer.
    const alreadyCovered = Object.entries(merged).some(
      ([key, entry]) => !key.endsWith(CYCLE_RUNNER_SUFFIX) && entry.catalogId === spec.id,
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

  // ── Step 3: Merge W5 composite catalog extras ────────────────────────────
  // Each extra adds a synthetic ParsedModelSpec-shaped entry whose templateId
  // is one of composite_* and whose `runnerSource` will resolve to 'generate'
  // via classifyRunnerSource (no `script:` field on the entry).
  for (const x of loadCompositeExtras()) {
    if (merged[x.id]) continue; // never overwrite registry/catalog entries
    const defaultHps: Record<string, HyperparameterDef> = {};
    for (const hp of x.hyperparameters) {
      defaultHps[hp.name] = convertHyperparameter(hp);
    }
    const entry: ModelRegistryEntry = {
      name: x.name,
      category: x.category,
      subcategory: x.subcategory,
      runner: 'python',
      featurePipeline: 'standard',
      outputs: ['predictions', 'composite_diagnostics'],
      chartOverlay: 'prediction_markers',
      outputDir: 'data/models',
      defaultHyperparameters: defaultHps,
      featureCategories: ['returns', 'volatility', 'momentum', 'volume'],
      catalogId: x.id,
      description: x.overview.slice(0, 500),
      // A Set: a composite's subcategory is often its kind ("multimodal").
      tags: [...new Set([x.category, x.subcategory, x.compositeKind, 'composite'])],
      // family is left undefined - composites are not a registry "family"
      gpuRequired: x.compositeKind === 'multimodal',
      estimatedTrainingTime: '5-30 min',
      templateId: x.templateId,
    };
    merged[x.id] = entry;
    // Composites are GENERATE (no script on disk) until the user clicks
    // Generate in Studio. Do NOT add to trainableKeys.
  }

  // ── Step 4: Merge repo-local generated catalog extras (curated GENERATE) ──
  for (const x of loadGeneratedExtras()) {
    if (merged[x.id]) continue; // never overwrite registry/catalog/composite entries
    const defaultHps: Record<string, HyperparameterDef> = {};
    for (const hp of x.hyperparameters) {
      defaultHps[hp.name] = convertHyperparameter(hp);
    }
    merged[x.id] = {
      name: x.name,
      category: x.category,
      subcategory: x.subcategory,
      runner: 'python',
      featurePipeline: 'standard',
      outputs: ['checkpoint.json', 'diagnostics.json', 'oos_predictions.parquet'],
      chartOverlay: 'prediction_markers',
      outputDir: 'data/models',
      defaultHyperparameters: defaultHps,
      featureCategories: x.featureCategories ?? ['returns', 'volatility', 'momentum', 'volume'],
      catalogId: x.id,
      description: x.overview.slice(0, 500),
      tags: [x.category, x.subcategory, 'generated'],
      gpuRequired: x.gpuRequired ?? true,
      estimatedTrainingTime: '5-30 min',
      templateId: x.templateId,
    };
    // GENERATE (no script) until the user clicks Generate + Save in Studio.
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

// ─── Template Picker (W2.a — feeds Jinja2 generator + frontend picker) ──────

/**
 * Concrete template identifiers that can be passed to
 * `scripts/generate_model.py --template-id <id>`.  Distinct from the coarser
 * `FAMILY_TEMPLATES` keys in this file — `pickTemplate()` narrows from a
 * family to a specific template using spec name/subcategory cues.
 *
 * Mirrors backend integration plan §6 and the `_base.py.j2` resolver.
 */
export type TemplateId =
  | 'sklearn'
  | 'tree'
  | 'gmm'
  | 'pytorch_mlp'
  | 'pytorch_cnn'
  | 'pytorch_autoencoder'
  | 'pytorch_vae'
  | 'transformer_seq'
  | 'temporal_fusion_transformer'
  | 'hmm'
  | 'composite_moe'
  | 'composite_stacking'
  | 'composite_voting'
  | 'composite_multimodal'
  | 'rl_dqn'
  | 'rl_ppo'
  | 'rl_a2c';

/**
 * Source of the runner for a trainable model:
 *   - 'wired'       a hand-curated `script:` field exists on disk
 *   - 'generate'    no script yet, but `pickTemplate()` resolved a TemplateId
 *                   so the user can click "Generate" in Studio
 *   - 'browse-only' no script and no template — read-only catalog entry
 */
export type RunnerSource = 'wired' | 'generate' | 'browse-only';

/** Feature flag for RL templates.  As of W9.a (2026-05-11) the three RL
 * Jinja2 templates (`rl_dqn`, `rl_ppo`, `rl_a2c`) and the underlying
 * `src.ml.blocks.trading_env.TradingEnv` substrate have shipped, so the
 * default flips to ENABLED.  Set `ENABLE_RL_TEMPLATES=0` to force RL specs
 * back to BROWSE-ONLY (e.g. for a local clone that lacks `gymnasium` /
 * `stable-baselines3` in its Python env). */
const RL_TEMPLATES_ENABLED = process.env.ENABLE_RL_TEMPLATES !== '0';

/**
 * Narrow a `(spec, family-template)` pair to a concrete `TemplateId`.
 * Returns `null` when no template can render the spec (BROWSE-ONLY).
 *
 * Decision tree mirrors backend integration plan §6 and is the *single source
 * of truth* for what the frontend picker badges as GENERATE-able.  Order of
 * checks matters: e.g. "variational autoencoder" must match `pytorch_vae`
 * before the broader `autoencoder` rule.
 */
export function pickTemplate(
  spec: ParsedModelSpec,
  template: { id: string },
): TemplateId | null {
  // ── W5 composite catalog extras short-circuit ──
  // If the spec id is one of the four composite meta-entries from
  // packages/config/composite_catalog_extras.json, route directly to its
  // composite_* template id - skip family keyword matching entirely.
  const compositeRouted = compositeIdToTemplate()[spec.id];
  if (compositeRouted) return compositeRouted as TemplateId;

  const name = spec.name.toLowerCase();
  const sub = spec.subcategory?.toLowerCase() ?? '';

  switch (template.id) {
    case 'sklearn': {
      // GMM is a special-case clustering algorithm — separate template because
      // it produces soft cluster assignments + per-component covariances.
      if (/gaussian.?mixture|^gmm\b|\bgmm\b/.test(name) || spec.id.includes('gaussian-mixture')) {
        return 'gmm';
      }
      // K-Means / DBSCAN / Spectral / etc. all ride the standard sklearn fit/predict loop.
      if (sub === 'clustering' || /\bkmeans\b|\bk-means\b|dbscan|spectral/.test(name)) {
        return 'sklearn';
      }
      return 'sklearn';
    }

    case 'xgboost':
    case 'lightgbm':
    case 'catboost':
      return 'tree';

    case 'pytorch': {
      if (/variational.*autoencoder|\bvae\b/.test(name)) return 'pytorch_vae';
      if (/autoencoder/.test(name)) return 'pytorch_autoencoder';
      if (/\bcnn\b|convolutional|conv1d|conv2d/.test(name)) return 'pytorch_cnn';
      // RNNs (LSTM/GRU/RNN) ride the MLP loop — body inside the loop is the variation.
      if (/\blstm\b|\bgru\b|\brnn\b|recurrent/.test(name)) return 'pytorch_mlp';
      return 'pytorch_mlp';
    }

    case 'transformer':
      if (/temporal[\s_-]?fusion|\btft\b/.test(name) || spec.id.includes('temporal-fusion')) {
        return 'temporal_fusion_transformer';
      }
      return 'transformer_seq';

    case 'hmm':
      return 'hmm';

    case 'reinforcement': {
      if (!RL_TEMPLATES_ENABLED) return null; // BROWSE-ONLY when explicitly disabled
      // RL templates target a Python env -- not a sklearn-style (module, class)
      // pair -- so stamp `classOrigin='generated'` to signal that the catalog
      // shouldn't try to resolve a module_path/class_name for them.
      spec.classOrigin = 'generated';
      // DQN family (value-based / Q-learning):
      if (/\bdqn\b|\bdouble-?dqn\b|\bdueling-?dqn\b|\brainbow\b|\bnoisy\b|q-?learning|\bsarsa\b/.test(name)) {
        return 'rl_dqn';
      }
      // PPO family (clipping / trust-region / vanilla PG):
      if (/\bppo\b|proximal.policy|\btrpo\b|trust.region|\breinforce\b|policy.gradient/.test(name)) {
        return 'rl_ppo';
      }
      // Actor-critic family:
      if (/\ba2c\b|\ba3c\b|\bsac\b|actor.critic/.test(name)) {
        return 'rl_a2c';
      }
      // Unknown RL spec -- BROWSE-ONLY rather than guessing a template.
      return null;
    }

    default:
      return null;
  }
}

/**
 * Classify how a TrainableModel will be operated:
 *   - WIRED       hand-curated `script` exists on disk
 *   - GENERATE    no script but `pickTemplate()` resolved a TemplateId
 *   - BROWSE-ONLY no script and no template
 *
 * Pure function over (entry, templateId).  Disk check uses `fs.existsSync`
 * resolved against `process.cwd()` — same convention as `hasTrainingScript()`.
 */
export function classifyRunnerSource(
  entry: ModelRegistryEntry,
  templateId: TemplateId | null,
): RunnerSource {
  if (entry.script) {
    try {
      const scriptPath = path.resolve(process.cwd(), entry.script);
      if (fs.existsSync(scriptPath)) return 'wired';
    } catch {
      // fall through
    }
  }
  if (templateId !== null) return 'generate';
  return 'browse-only';
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface TrainableModel extends ModelRegistryEntry {
  /** Whether this model has a working training script (legacy field — kept for
   * back-compat with existing routes that filter on `trainable: true`). */
  trainable: boolean;
  /** Source of this entry: 'registry' (models.json) or 'catalog' (auto-generated) */
  source: 'registry' | 'catalog';
  /**
   * Concrete template ID resolved by `pickTemplate()`.  `null` when the spec
   * cannot be rendered by any current Jinja2 template (BROWSE-ONLY).
   */
  templateId: TemplateId | null;
  /**
   * 3-state classification used by the frontend picker to badge each entry:
   *   wired       has a script on disk → click train immediately
   *   generate    no script but a template can render one
   *   browse-only no script, no template → read-only catalog entry
   */
  runnerSource: RunnerSource;
}

/**
 * Resolve the concrete TemplateId for a registry entry by looking up its
 * catalog spec and running `pickTemplate()`.  Returns null when:
 *   - entry has no `catalogId`
 *   - spec cannot be loaded
 *   - no family template matches
 *   - matched family routes to BROWSE-ONLY (e.g. RL pre-W9)
 *
 * Centralised so `getTrainableModels()` and `getModelTrainingConfig()` stay
 * consistent.  Catches lookup errors silently to keep cache build robust to
 * partial catalog corruption.
 */
function resolveTemplateId(entry: ModelRegistryEntry): TemplateId | null {
  // ── W5 composite extras: entry was seeded with templateId already.
  // Trust it (composite extras have no real ParsedModelSpec to look up).
  if (
    entry.templateId &&
    ((entry.templateId as string).startsWith('composite_') ||
      GENERATABLE_CURATED_TEMPLATES.has(entry.templateId as string))
  ) {
    return entry.templateId as TemplateId;
  }
  if (!entry.catalogId) return null;
  try {
    const spec = getModelById(entry.catalogId);
    if (!spec) return null;
    const familyMatch = matchTemplate(spec);
    if (!familyMatch) return null;
    return pickTemplate(spec, { id: familyMatch.templateId });
  } catch {
    return null;
  }
}

/**
 * Get all models — both hand-configured and catalog-generated — with
 * trainability status, template resolution, and runner-source classification.
 *
 * Hand-configured models always appear first, then catalog models sorted
 * alphabetically. Each entry includes:
 *   - trainable    legacy: has a working script on disk
 *   - source       'registry' (models.json) | 'catalog' (auto-generated)
 *   - templateId   concrete Jinja2 template ID, or null
 *   - runnerSource 'wired' | 'generate' | 'browse-only'
 */
export function getTrainableModels(): Record<string, TrainableModel> {
  const { mergedModels, trainableKeys } = ensureCache();
  const handConfigured = listModels();
  const result: Record<string, TrainableModel> = {};

  for (const [key, entry] of Object.entries(mergedModels)) {
    const templateId = resolveTemplateId(entry);
    const runnerSource = classifyRunnerSource(entry, templateId);
    result[key] = {
      ...entry,
      trainable: trainableKeys.has(key),
      source: key in handConfigured ? 'registry' : 'catalog',
      templateId,
      runnerSource,
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
    const entry = mergedModels[catalogId]!;
    const templateId = resolveTemplateId(entry);
    return {
      ...entry,
      trainable: trainableKeys.has(catalogId),
      source: catalogId in handConfigured ? 'registry' : 'catalog',
      templateId,
      runnerSource: classifyRunnerSource(entry, templateId),
    };
  }

  // Second check: find by catalogId field in any entry (never a Model Cycle
  // runner — see Step 2 of rebuildCache)
  for (const [key, entry] of Object.entries(mergedModels)) {
    if (!key.endsWith(CYCLE_RUNNER_SUFFIX) && entry.catalogId === catalogId) {
      const templateId = resolveTemplateId(entry);
      return {
        ...entry,
        trainable: trainableKeys.has(key),
        source: key in handConfigured ? 'registry' : 'catalog',
        templateId,
        runnerSource: classifyRunnerSource(entry, templateId),
      };
    }
  }

  // Third check: try loading from catalog directly (might be a fresh spec)
  const spec = getModelById(catalogId);
  if (spec) {
    const entry = specToRegistryEntry(spec);
    const familyMatch = matchTemplate(spec);
    const templateId = familyMatch ? pickTemplate(spec, { id: familyMatch.templateId }) : null;
    return {
      ...entry,
      trainable: hasTrainingScript(entry),
      source: 'catalog',
      templateId,
      runnerSource: classifyRunnerSource(entry, templateId),
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
