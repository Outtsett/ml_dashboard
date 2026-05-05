/**
 * Model Import — Public barrel export.
 *
 * External consumers should depend on catalogService (service abstraction)
 * rather than parser.ts directly (DIP).
 */

// ── Service layer (preferred entry point for routes) ────────────────────────
export {
  getCatalogStats,
  getCatalogTaxonomy,
  getCatalogModels,
  getModelById,
  refreshCatalog,
} from './catalogService';
export type {
  CatalogStatsResult,
  TaxonomyResult,
  CatalogFilter,
  CatalogListResult,
  RefreshResult,
} from './catalogService';

// ── Lower-level parser (for scripts / advanced use) ─────────────────────────
export { scanModelCatalog, parseModelSpec } from './parser';
export type {
  ParsedModelSpec,
  ModelCatalog,
  ExtractedHyperparameter,
  AlgoModelCategory,
  AlgoModelSubcategory,
} from './types';
export { FOLDER_TO_CATEGORY, CATEGORY_LABELS } from './types';
