/**
 * Model Catalog Service — Abstraction over the model-spec parser + cache.
 *
 * Think of it as: the inventory manager who keeps the bookshelf index
 * up to date. Routes ask this service "give me the catalog" and never
 * touch the parser or file system directly.
 *
 * SRP: this owns caching + filtering + single-model lookups.
 * DIP: routes depend on this service interface, not on parser internals.
 */

import path from 'path';
import { scanModelCatalog, parseModelSpec } from './parser';
import type { ParsedModelSpec, ModelCatalog } from './types';
import { CATEGORY_LABELS } from './types';

// ─── Config (could later come from env / config file) ───────────────────────

// The 300-spec algo_models corpus moved to Trading/_architecture/educational on
// 2026-06-26 when the stray E:/Users/tyler home folder was evacuated. The old
// E:/documents/algo_models path no longer exists, so the catalog silently served
// 0 models (totalFiles: 0) until this was repointed. Override with
// ALGO_MODELS_ROOT if the corpus moves again.
const DEFAULT_ROOT = path.resolve(
  process.env.ALGO_MODELS_ROOT ??
    'E:/source/repos/ml_dashboard/Trading/_architecture/educational/algo_models',
);
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── In-memory cache ────────────────────────────────────────────────────────

let cachedCatalog: ModelCatalog | null = null;
let cacheTimestamp = 0;

/**
 * The cache always holds the FULL catalog, stubs included; callers filter on read.
 *
 * Caching per-`includeEmpty` was a bug with a five-minute blast radius: the flag
 * was used to build the cache but never checked on a hit, so whichever endpoint
 * warmed it decided what every other endpoint saw for the next five minutes.
 * Warm it from `/trainable` or the codegen bridge (both pass false) and the
 * catalog page silently lost all 169 stubs AND five of its thirteen sidebar
 * categories — Optimization, Probabilistic & Symbolic, Reinforcement Learning,
 * Simulation & Decision and Statistical are 100% stubs, so they vanish entirely
 * from a taxonomy built after the drop. Warm it from /stats and the same page
 * looked fine. Which you got depended on request order.
 *
 * Scanning with stubs and filtering at read time makes every endpoint agree,
 * and makes the taxonomy stable at all thirteen categories.
 */
function ensureCatalog(): ModelCatalog {
  const now = Date.now();
  if (!cachedCatalog || now - cacheTimestamp > CACHE_TTL_MS) {
    cachedCatalog = scanModelCatalog(DEFAULT_ROOT, { includeEmpty: true });
    cacheTimestamp = now;
  }
  return cachedCatalog;
}

// ─── Public service API ─────────────────────────────────────────────────────

export interface CatalogStatsResult {
  totalFiles: number;
  filesWithContent: number;
  emptyPlaceholders: number;
  categoryCount: number;
  categoryLabels: Record<string, string>;
  scannedAt: number;
}

export function getCatalogStats(): CatalogStatsResult {
  const catalog = ensureCatalog();
  return {
    totalFiles: catalog.totalFiles,
    filesWithContent: catalog.filesWithContent,
    emptyPlaceholders: catalog.emptyPlaceholders,
    categoryCount: Object.keys(catalog.taxonomy).length,
    categoryLabels: CATEGORY_LABELS,
    scannedAt: catalog.scannedAt,
  };
}

export interface TaxonomyResult {
  taxonomy: Record<string, Record<string, number>>;
  categoryLabels: Record<string, string>;
}

export function getCatalogTaxonomy(): TaxonomyResult {
  const catalog = ensureCatalog();
  return { taxonomy: catalog.taxonomy, categoryLabels: CATEGORY_LABELS };
}

export interface CatalogFilter {
  category?: string;
  subcategory?: string;
  search?: string;
  includeEmpty?: boolean;
}

export interface CatalogListResult {
  count: number;
  totalAvailable: number;
  models: Omit<ParsedModelSpec, 'rawMarkdown'>[];
}

export function getCatalogModels(filter: CatalogFilter = {}): CatalogListResult {
  const { category, subcategory, search, includeEmpty = false } = filter;
  const catalog = ensureCatalog();
  // Filter on read, not on scan — see `ensureCatalog`.
  let models = includeEmpty ? catalog.models : catalog.models.filter(m => m.hasContent);

  if (category) {
    models = models.filter(m => m.category === category || m.parentCategory === category);
  }
  if (subcategory) {
    // Under a wrapper category the taxonomy rolls children up using the CHILD
    // CATEGORY as the subcategory key (`buildTaxonomy`: `subKey = m.category`),
    // so the sidebar sends `subcategory=neural-network` for Deep Learning >
    // Neural Network and `subcategory=supervised` for Machine Learning >
    // Supervised. No spec carries those as its own subcategory -- an ML spec's
    // subcategory is `boosting-methods`, not `supervised` -- so matching only
    // on `m.subcategory` returned zero for every nested entry in the sidebar.
    // Accept either key.
    models = models.filter(m => m.subcategory === subcategory || m.category === subcategory);
  }
  if (search) {
    const q = search.toLowerCase();
    models = models.filter(
      m =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.overview.toLowerCase().includes(q),
    );
  }

  // Strip raw markdown from list response
  const slim = models.map(({ rawMarkdown: _raw, ...rest }) => rest);

  return {
    count: slim.length,
    totalAvailable: catalog.filesWithContent,
    models: slim,
  };
}

export function getModelById(id: string): ParsedModelSpec | null {
  const catalog = ensureCatalog();
  const meta = catalog.models.find(m => m.id === id);
  if (!meta) return null;

  const fullPath = path.join(DEFAULT_ROOT, meta.relativePath);
  return parseModelSpec(fullPath, DEFAULT_ROOT, true);
}

export interface RefreshResult {
  message: string;
  totalFiles: number;
  filesWithContent: number;
}

export function refreshCatalog(): RefreshResult {
  cachedCatalog = null;
  cacheTimestamp = 0;
  const catalog = ensureCatalog();
  return {
    message: 'Catalog refreshed',
    totalFiles: catalog.totalFiles,
    filesWithContent: catalog.filesWithContent,
  };
}
