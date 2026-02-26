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

const DEFAULT_ROOT = path.resolve(
  process.env.ALGO_MODELS_ROOT ?? 'E:/source/documents/algo_models',
);
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── In-memory cache ────────────────────────────────────────────────────────

let cachedCatalog: ModelCatalog | null = null;
let cacheTimestamp = 0;

function ensureCatalog(includeEmpty: boolean): ModelCatalog {
  const now = Date.now();
  if (!cachedCatalog || now - cacheTimestamp > CACHE_TTL_MS) {
    cachedCatalog = scanModelCatalog(DEFAULT_ROOT, { includeEmpty });
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
  const catalog = ensureCatalog(true);
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
  const catalog = ensureCatalog(true);
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
  const catalog = ensureCatalog(includeEmpty);
  let models = catalog.models;

  if (category) {
    models = models.filter(m => m.category === category);
  }
  if (subcategory) {
    models = models.filter(m => m.subcategory === subcategory);
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
  const catalog = ensureCatalog(true);
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
  const catalog = ensureCatalog(true);
  return {
    message: 'Catalog refreshed',
    totalFiles: catalog.totalFiles,
    filesWithContent: catalog.filesWithContent,
  };
}
