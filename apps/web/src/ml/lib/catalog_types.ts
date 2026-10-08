/**
 * Model Catalog shared types — used by hooks and UI components.
 *
 * ISP: focused interfaces per concern. Components import only what they render.
 */

import type { SpecificationMetrics } from "@shared/cycle/metrics";

// ─── Hyperparameter (detail view only) ──────────────────────────────────────

export interface CatalogHyperParam {
  name: string;
  type: "number" | "select" | "boolean" | "string";
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: (string | number)[];
  description: string;
}

// ─── Model summary (card grid) ──────────────────────────────────────────────

export interface CatalogModelSummary {
  id: string;
  name: string;
  shortName: string;
  category: string;
  subcategory: string;
  relativePath: string;
  overview: string;
  principles: string[];
  applications: string[];
  keyFeatures: string[];
  variants: string[];
  hyperparameters: CatalogHyperParam[];
  /** How this model is judged, natively and as run (`@shared/cycle/metrics`). */
  metricsRecord?: SpecificationMetrics;
  hasContent: boolean;
  fileSize: number;
}

// ─── Model detail (full spec view) ──────────────────────────────────────────

export interface CatalogModelDetail extends CatalogModelSummary {
  rawMarkdown?: string;
}

// ─── API response shapes ────────────────────────────────────────────────────

export interface CatalogStats {
  totalFiles: number;
  filesWithContent: number;
  emptyPlaceholders: number;
  categoryCount: number;
  categoryLabels: Record<string, string>;
  scannedAt: number;
}

export interface CatalogTaxonomy {
  taxonomy: Record<string, Record<string, number>>;
  categoryLabels: Record<string, string>;
}

export interface CatalogListResponse {
  count: number;
  totalAvailable: number;
  models: CatalogModelSummary[];
}
