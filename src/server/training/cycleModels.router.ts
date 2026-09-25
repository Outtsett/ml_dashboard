/**
 * `GET /training/cycle-models` — the Model Cycle's model browser.
 *
 * Joins the Cycle registry (`cycleModels.ts`) with the user's model catalog
 * (`getCatalogModels`, read-only) and answers with `cycleModelsResponseSchema`
 * (`@shared/cycle/models`):
 *
 *   - categories and subcategories are the catalog's, each registry model on a
 *     card under its own catalog spec;
 *   - every `alsoCatalogSpecIds` spec is a second card selecting the same key;
 *   - every other catalog spec is a greyed card carrying the reason it cannot
 *     run (`cycleUnavailableReason`: its spec, else its
 *     `<category>/<subcategory>`, else its category);
 *   - a registry model whose spec the catalog lacks (or every model, when the
 *     catalog folder is not on disk — `catalogAvailable: false`) is grouped by
 *     the registry's own fallback category / subcategory labels.
 *
 * Categories holding registry models come first, in registry order; the rest
 * follow by label. Within a subcategory, runnable models, then the models
 * being built, then the greyed specs by name. Counts are over cards, as the
 * browser's own search recounts them.
 *
 * Mounted under `/api` by the route table.
 */

import { Router, type Request, type Response } from "express";

import {
  CYCLE_RUNNER_SUFFIX,
  cycleModelsResponseSchema,
  type CycleModelCard,
  type CycleModelEntry,
  type CycleModelsResponse,
  type CycleRegistry,
} from "@shared/cycle/models";
import { getCatalogModels, getCatalogTaxonomy } from "../infrastructure/lib/modelImport/catalogService";
import { cycleUnavailableReason, loadCycleRegistry } from "./cycleModels";

/** The catalog fields the join reads. */
export interface CatalogSpecSummary {
  id: string;
  name: string;
  category: string;
  subcategory: string;
}

/** The catalog as the join sees it; null when the catalog cannot be read. */
export interface CatalogSnapshot {
  specs: CatalogSpecSummary[];
  categoryLabels: Record<string, string>;
}

export interface CycleModelsRouterOptions {
  loadRegistry?: () => { registry: CycleRegistry | null; problems: string[] };
  loadCatalog?: () => CatalogSnapshot | null;
}

/** The catalog on disk, or null when its folder is absent or unreadable. */
export function readCatalogSnapshot(): CatalogSnapshot | null {
  try {
    const specs = getCatalogModels({ includeEmpty: true }).models.map(({ id, name, category, subcategory }) => ({ id, name, category, subcategory }));
    if (specs.length === 0) return null;
    return { specs, categoryLabels: getCatalogTaxonomy().categoryLabels };
  } catch {
    return null;
  }
}

/** "recurrent-and-sequential-models" -> "Recurrent and sequential models". */
function humanize(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Supervised learning" -> "supervised-learning": an id for a fallback label. */
function slugOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function registryCard(key: string, entry: CycleModelEntry, catalogSpecId: string | null, specAvailable: boolean): CycleModelCard {
  return {
    key,
    runnerKey: `${key}${CYCLE_RUNNER_SUFFIX}`,
    displayName: entry.displayName,
    catalogSpecId,
    specAvailable,
    kind: entry.kind,
    summary: entry.summary,
    implementationNote: entry.implementationNote,
    runnable: entry.runnable,
    unavailableReason: entry.unavailableReason,
    implementation: entry.implementation,
    explainKind: entry.explainKind,
    directionMode: entry.direction.mode,
    hasPriceModel: entry.price !== null,
    sequence: entry.sequence,
    speed: entry.speed,
    estimatedTrainingTime: entry.estimatedTrainingTime,
  };
}

function greyedCard(spec: CatalogSpecSummary, reason: string): CycleModelCard {
  return {
    key: null,
    runnerKey: null,
    displayName: spec.name,
    catalogSpecId: spec.id,
    specAvailable: true,
    kind: null,
    summary: null,
    implementationNote: null,
    runnable: false,
    unavailableReason: reason,
    implementation: null,
    explainKind: null,
    directionMode: null,
    hasPriceModel: null,
    sequence: false,
    speed: null,
    estimatedTrainingTime: null,
  };
}

/** A category or subcategory being filled: its cards, and the order registry models first reached it. */
interface Bucket<T> {
  id: string;
  label: string;
  /** Registry position of the first registry card placed here; Infinity when none. */
  firstRegistryIndex: number;
  items: T;
}

type SubcategoryBucket = Bucket<{ registry: { card: CycleModelCard; index: number }[]; greyed: CycleModelCard[] }>;
type CategoryBucket = Bucket<Map<string, SubcategoryBucket>>;

class Grouping {
  private readonly categories = new Map<string, CategoryBucket>();

  private subcategory(categoryId: string, categoryLabel: string, subcategoryId: string, subcategoryLabel: string): SubcategoryBucket {
    let category = this.categories.get(categoryId);
    if (!category) {
      category = { id: categoryId, label: categoryLabel, firstRegistryIndex: Infinity, items: new Map() };
      this.categories.set(categoryId, category);
    }
    let subcategory = category.items.get(subcategoryId);
    if (!subcategory) {
      subcategory = { id: subcategoryId, label: subcategoryLabel, firstRegistryIndex: Infinity, items: { registry: [], greyed: [] } };
      category.items.set(subcategoryId, subcategory);
    }
    return subcategory;
  }

  addRegistry(categoryId: string, categoryLabel: string, subcategoryId: string, subcategoryLabel: string, card: CycleModelCard, index: number): void {
    const subcategory = this.subcategory(categoryId, categoryLabel, subcategoryId, subcategoryLabel);
    subcategory.items.registry.push({ card, index });
    subcategory.firstRegistryIndex = Math.min(subcategory.firstRegistryIndex, index);
    const category = this.categories.get(categoryId)!;
    category.firstRegistryIndex = Math.min(category.firstRegistryIndex, index);
  }

  addGreyed(categoryId: string, categoryLabel: string, subcategoryId: string, subcategoryLabel: string, card: CycleModelCard): void {
    this.subcategory(categoryId, categoryLabel, subcategoryId, subcategoryLabel).items.greyed.push(card);
  }

  /** Relabel a subcategory (a registry label reads better than a humanized folder name). */
  relabel(categoryId: string, subcategoryId: string, label: string): void {
    const subcategory = this.categories.get(categoryId)?.items.get(subcategoryId);
    if (subcategory) subcategory.label = label;
  }

  build(): CycleModelsResponse["categories"] {
    const byRegistryThenLabel = <T extends { firstRegistryIndex: number; label: string }>(a: T, b: T): number =>
      a.firstRegistryIndex !== b.firstRegistryIndex ? (a.firstRegistryIndex < b.firstRegistryIndex ? -1 : 1) : a.label.localeCompare(b.label);
    return [...this.categories.values()].sort(byRegistryThenLabel).map((category) => {
      const subcategories = [...category.items.values()].sort(byRegistryThenLabel).map((subcategory) => {
        const registry = [...subcategory.items.registry]
          .sort((a, b) => Number(b.card.runnable) - Number(a.card.runnable) || a.index - b.index)
          .map(({ card }) => card);
        const greyed = [...subcategory.items.greyed].sort((a, b) => a.displayName.localeCompare(b.displayName));
        return { id: subcategory.id, label: subcategory.label, models: [...registry, ...greyed] };
      });
      // Models, not cards: a model shown under two catalog specs counts once.
      const runnableCount = runnableModelCount(subcategories.flatMap((subcategory) => subcategory.models));
      return { id: category.id, label: category.label, runnableCount, subcategories };
    });
  }
}

/**
 * The browser response for `registry` joined with `catalog` (null: the
 * catalog is unavailable, so the registry's fallback grouping is used).
 * Pure; the result is validated against `cycleModelsResponseSchema`.
 */
/** Distinct runnable registry keys among `cards` (alias cards from alsoCatalogSpecIds share their model's key). */
export function runnableModelCount(cards: ReadonlyArray<{ key: string | null; runnable: boolean }>): number {
  return new Set(cards.filter((card) => card.runnable).map((card) => card.key)).size;
}

export function buildCycleModelsResponse(registry: CycleRegistry, catalog: CatalogSnapshot | null): CycleModelsResponse {
  const grouping = new Grouping();
  const entries = Object.entries(registry.models);
  const specs = new Map((catalog?.specs ?? []).map((spec) => [spec.id, spec]));
  const claimed = new Set<string>();

  entries.forEach(([key, entry], index) => {
    const specIds = [entry.catalogSpecId, ...entry.alsoCatalogSpecIds].filter((id): id is string => id !== null);
    const onCatalog = specIds.filter((id) => specs.has(id));
    for (const specId of onCatalog) {
      const spec = specs.get(specId)!;
      claimed.add(specId);
      const categoryLabel = catalog!.categoryLabels[spec.category] ?? humanize(spec.category);
      grouping.addRegistry(spec.category, categoryLabel, spec.subcategory, humanize(spec.subcategory), registryCard(key, entry, specId, true), index);
      // The primary spec's subcategory takes the registry's label ("Feedforward and MLPs").
      if (specId === entry.catalogSpecId) grouping.relabel(spec.category, spec.subcategory, entry.subcategory);
    }
    const primaryOnCatalog = entry.catalogSpecId !== null && specs.has(entry.catalogSpecId);
    if (!primaryOnCatalog && onCatalog.length === 0) {
      grouping.addRegistry(slugOf(entry.category), entry.category, slugOf(entry.subcategory), entry.subcategory, registryCard(key, entry, entry.catalogSpecId, false), index);
    }
  });

  if (catalog) {
    for (const spec of catalog.specs) {
      if (claimed.has(spec.id)) continue;
      const reason = cycleUnavailableReason(registry.shared, spec.id, spec.category, spec.subcategory);
      const categoryLabel = catalog.categoryLabels[spec.category] ?? humanize(spec.category);
      grouping.addGreyed(spec.category, categoryLabel, spec.subcategory, humanize(spec.subcategory), greyedCard(spec, reason));
    }
  }

  const categories = grouping.build();
  const cards = categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.models));
  return cycleModelsResponseSchema.parse({
    categories,
    runnableCount: runnableModelCount(cards),
    totalCount: cards.length,
    catalogAvailable: catalog !== null,
  });
}

export function createCycleModelsRouter(options: CycleModelsRouterOptions = {}): Router {
  const loadRegistry = options.loadRegistry ?? (() => loadCycleRegistry());
  const loadCatalog = options.loadCatalog ?? readCatalogSnapshot;
  const router = Router();

  router.get("/training/cycle-models", (_req: Request, res: Response) => {
    const load = loadRegistry();
    if (!load.registry) {
      res.status(500).json({ error: `The Model Cycle registry is invalid: ${load.problems.join("; ")}` });
      return;
    }
    try {
      res.json(buildCycleModelsResponse(load.registry, loadCatalog()));
    } catch (error) {
      res.status(500).json({ error: `The model browser response failed its schema: ${(error as Error).message}` });
    }
  });

  return router;
}

export default createCycleModelsRouter();
