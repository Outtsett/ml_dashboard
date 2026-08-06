/**
 * Model Resolver — Pure model-type → category/metricsKey lookup.
 *
 * Think of it as: a phone book. You give it a model type string
 * and it tells you the category, subcategory, and which
 * metrics dashboard to use.
 *
 * SRP: Pure lookup logic. No rendering, no fetching, no side effects.
 * OCP: New model type = add one entry to KNOWN_MODEL_TYPES. Nothing else changes.
 * DIP: Consumers depend on ModelCategoryInfo interface, not on how resolution works.
 */

import {
  resolveMetricsConfig,
  CATEGORY_METRICS,
  type CategoryMetricsConfig,
} from '@shared/categoryMetrics';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModelCategoryInfo {
  /** Parent category (e.g., 'unsupervised') */
  category: string;
  /** Subcategory (e.g., 'clustering') */
  subcategory: string;
  /** Resolved metrics key into CATEGORY_METRICS (e.g., 'clustering') */
  metricsKey: string;
  /** Full metrics config for the resolved key, or undefined if unknown */
  metricsConfig: CategoryMetricsConfig | undefined;
}

export interface CategoryGroup<T = { id: string; modelType: string }> {
  /** Metrics key (e.g., 'clustering', 'classification') */
  key: string;
  /** Display label (e.g., 'Clustering') */
  label: string;
  /** Models in this category */
  models: T[];
}

// ── Static Registry ──────────────────────────────────────────────────────────
// Mirrors config/models.json. OCP: add entry here when a new model type is created.

const KNOWN_MODEL_TYPES: Record<string, { category: string; subcategory: string }> = {
};

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve a model's category info from its modelType string.
 *
 * Checks static registry first, then optional dynamic registry
 * (e.g., from training context's availableModels loaded at runtime).
 *
 * @param modelType - e.g. "primitives-discovery", "cnn-transformer"
 * @param dynamicRegistry - Optional runtime registry (from /api/training/config)
 */
export function resolveModelCategory(
  modelType: string,
  dynamicRegistry?: Record<string, { category?: string; subcategory?: string }>,
): ModelCategoryInfo {
  // 1. Static registry (known model types)
  let info = KNOWN_MODEL_TYPES[modelType];

  // 2. Dynamic registry fallback (models loaded from server config)
  if (!info && dynamicRegistry?.[modelType]) {
    const dyn = dynamicRegistry[modelType]!;
    info = {
      category: dyn.category ?? 'unsupervised',
      subcategory: dyn.subcategory ?? 'clustering',
    };
  }

  // 3. Ultimate fallback — treat unknown as unsupervised/clustering
  if (!info) {
    info = { category: 'unsupervised', subcategory: 'clustering' };
  }

  const metricsConfig = resolveMetricsConfig(info.category, info.subcategory);

  return {
    category: info.category,
    subcategory: info.subcategory,
    metricsKey: metricsConfig?.id ?? 'clustering',
    metricsConfig,
  };
}

// ── Grouping ─────────────────────────────────────────────────────────────────

/**
 * Group models by their resolved metrics category key.
 *
 * Returns only categories that have at least 1 model, sorted by label.
 * Each group carries the display label from CATEGORY_METRICS.
 */
export function groupModelsByMetricsKey<T extends { id: string; modelType: string }>(
  models: T[],
  dynamicRegistry?: Record<string, { category?: string; subcategory?: string }>,
): CategoryGroup<T>[] {
  const buckets = new Map<string, T[]>();

  for (const model of models) {
    const { metricsKey } = resolveModelCategory(model.modelType, dynamicRegistry);
    const bucket = buckets.get(metricsKey) ?? [];
    bucket.push(model);
    buckets.set(metricsKey, bucket);
  }

  const groups: CategoryGroup<T>[] = [];
  for (const [key, groupModels] of buckets) {
    const config = CATEGORY_METRICS[key];
    groups.push({
      key,
      label: config?.label ?? key,
      models: groupModels,
    });
  }

  // Alphabetical by label for stable ordering
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

/**
 * Get count of models per metrics key — lightweight version for tab badges.
 */
export function countModelsByMetricsKey(
  models: Array<{ modelType: string }>,
  dynamicRegistry?: Record<string, { category?: string; subcategory?: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const model of models) {
    const { metricsKey } = resolveModelCategory(model.modelType, dynamicRegistry);
    counts.set(metricsKey, (counts.get(metricsKey) ?? 0) + 1);
  }
  return counts;
}
