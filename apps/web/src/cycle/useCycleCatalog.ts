/**
 * The Model Cycle's two catalog reads.
 *
 * - `useCycleCatalog()` — the runner slice of the trainable catalog: entries
 *   whose runner key ends `+walk_forward_cycle`, one per registry model, with
 *   hyperparameters grouped in the display order the config form uses. These
 *   carry the parameters, defaults and validation bounds.
 * - `useCycleModels()` — `GET /api/training/cycle-models`: the model browser's
 *   cards (kind, summary, speed, reasons a model cannot run), grouped by
 *   catalog category and subcategory. Built from the registry in
 *   `packages/config/cycle_models/`; contract `cycleModelsResponseSchema`.
 *
 * Plus the pure helpers the browser renders from (search filter, runner-key
 * lookup, the fallback grouping when the registry endpoint does not answer).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTrainableCatalog } from "@/ml/lib/useModelCatalog";
import { cycleModelFamilySchema, type CycleModelFamily } from "@shared/cycle/schema";
import { CYCLE_RUNNER_SUFFIX, cycleModelsResponseSchema, type CycleModelCard, type CycleModelsResponse } from "@shared/cycle/models";
import type { HyperparameterDef } from "@shared/trainingTypes";

export { CYCLE_RUNNER_SUFFIX };

/** Display order for hyperparameter groups; a group outside this list is appended after, in catalog order. */
export const CYCLE_GROUP_ORDER = ["Model", "Walk-forward", "Labels", "Trading", "Tuning", "Replay", "Runtime"] as const;

export interface CycleParameterGroup {
  name: string;
  parameters: Array<{ key: string; def: HyperparameterDef }>;
}

export interface CycleCatalogEntry {
  /** Runner key, `"<family>+walk_forward_cycle"`. */
  key: string;
  family: CycleModelFamily;
  label: string;
  description?: string;
  /** False when the server says the runner cannot run yet (the registry's `runnable`); `unavailableReason` says why. */
  available: boolean;
  unavailableReason?: string;
  groups: CycleParameterGroup[];
  hyperparameters: Record<string, HyperparameterDef>;
}

function groupEntry(key: string, family: CycleModelFamily, label: string, description: string | undefined, hyperparameters: Record<string, HyperparameterDef>): CycleCatalogEntry {
  const byGroup = new Map<string, Array<{ key: string; def: HyperparameterDef }>>();
  for (const [paramKey, def] of Object.entries(hyperparameters)) {
    const groupName = def.group && def.group.length > 0 ? def.group : "Model";
    if (!byGroup.has(groupName)) byGroup.set(groupName, []);
    byGroup.get(groupName)!.push({ key: paramKey, def });
  }
  const groups: CycleParameterGroup[] = [];
  for (const name of CYCLE_GROUP_ORDER) {
    const parameters = byGroup.get(name);
    if (parameters) groups.push({ name, parameters });
  }
  for (const [name, parameters] of byGroup) {
    if (!(CYCLE_GROUP_ORDER as readonly string[]).includes(name)) groups.push({ name, parameters });
  }
  return { key, family, label, description, available: true, groups, hyperparameters };
}

export function useCycleCatalog() {
  const query = useTrainableCatalog();

  const entries = useMemo<CycleCatalogEntry[]>(() => {
    if (!query.data) return [];
    const result: CycleCatalogEntry[] = [];
    for (const [key, model] of Object.entries(query.data)) {
      if (!key.endsWith(CYCLE_RUNNER_SUFFIX)) continue;
      const familyRaw = key.slice(0, key.length - CYCLE_RUNNER_SUFFIX.length);
      const parsedFamily = cycleModelFamilySchema.safeParse(familyRaw);
      if (!parsedFamily.success) continue;
      // Runner display names end in " — model cycle"; every card here is one.
      const label = model.name.replace(/\s+—\s+model cycle$/i, "");
      result.push({
        ...groupEntry(key, parsedFamily.data, label, model.description, model.defaultHyperparameters),
        available: model.available !== false,
        unavailableReason: model.unavailableReason,
      });
    }
    result.sort((a, b) => a.family.localeCompare(b.family));
    return result;
  }, [query.data]);

  const byFamily = useMemo(() => {
    const map = new Map<CycleModelFamily, CycleCatalogEntry>();
    for (const entry of entries) map.set(entry.family, entry);
    return map;
  }, [entries]);

  return { ...query, entries, byFamily };
}

// ─── GET /api/training/cycle-models ─────────────────────────────────────────

export const CYCLE_MODELS_PATH = "/api/training/cycle-models";

async function fetchCycleModels({ signal }: { signal: AbortSignal }): Promise<CycleModelsResponse> {
  const response = await fetch(CYCLE_MODELS_PATH, { credentials: "include", signal });
  if (!response.ok) throw new Error(`${CYCLE_MODELS_PATH} answered ${response.status}`);
  const parsed = cycleModelsResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`${CYCLE_MODELS_PATH} returned a shape the browser cannot read: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

/** The model browser's cards, validated against `cycleModelsResponseSchema`. */
export function useCycleModels() {
  return useQuery<CycleModelsResponse>({
    queryKey: [CYCLE_MODELS_PATH],
    queryFn: fetchCycleModels,
    staleTime: 5 * 60_000,
  });
}

// ─── Browser helpers (pure) ──────────────────────────────────────────────────

/** The runner key a card selects: the server's `runnerKey`, else `<key>+walk_forward_cycle`. */
export function runnerKeyForCard(card: CycleModelCard): string | null {
  if (card.runnerKey) return card.runnerKey;
  return card.key ? `${card.key}${CYCLE_RUNNER_SUFFIX}` : null;
}

function cardText(card: CycleModelCard, categoryLabel: string, subcategoryLabel: string): string {
  return [card.displayName, card.key, card.kind, card.summary, card.implementationNote, card.implementation, categoryLabel, subcategoryLabel]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
}

/**
 * The response narrowed to the cards matching every whitespace-separated term
 * of `search` (name, key, kind, summary, implementation note, category and
 * subcategory labels). Empty subcategories and categories are dropped; the
 * runnable counts are recounted over what is left. A blank search returns the
 * response unchanged.
 */
/** Distinct runnable models among `cards`: a model shown under two catalog specs counts once. */
export function countRunnableModels(cards: ReadonlyArray<CycleModelCard>): number {
  return new Set(cards.filter((card) => card.runnable).map((card) => card.key)).size;
}

export function filterCycleModels(response: CycleModelsResponse, search: string): CycleModelsResponse {
  const terms = search.toLowerCase().split(/\s+/).filter((term) => term.length > 0);
  if (terms.length === 0) return response;
  const categories: CycleModelsResponse["categories"] = [];
  const runnableKeys = new Set<string | null>();
  let totalCount = 0;
  for (const category of response.categories) {
    const subcategories: CycleModelsResponse["categories"][number]["subcategories"] = [];
    for (const subcategory of category.subcategories) {
      const models = subcategory.models.filter((card) => {
        const text = cardText(card, category.label, subcategory.label);
        return terms.every((term) => text.includes(term));
      });
      if (models.length === 0) continue;
      subcategories.push({ ...subcategory, models });
      totalCount += models.length;
    }
    if (subcategories.length === 0) continue;
    const categoryModels = subcategories.flatMap((subcategory) => subcategory.models);
    categories.push({ ...category, runnableCount: countRunnableModels(categoryModels), subcategories });
    for (const card of categoryModels) if (card.runnable) runnableKeys.add(card.key);
  }
  return { ...response, categories, runnableCount: runnableKeys.size, totalCount };
}

/** The category id holding the card that selects `runnerKey`, or null. */
export function categoryOfRunnerKey(response: CycleModelsResponse, runnerKey: string | null): string | null {
  if (!runnerKey) return null;
  for (const category of response.categories) {
    for (const subcategory of category.subcategories) {
      if (subcategory.models.some((card) => runnerKeyForCard(card) === runnerKey)) return category.id;
    }
  }
  return null;
}

/**
 * A browser response built from the runner entries alone, for when the
 * registry endpoint does not answer: one group, every runner selectable, no
 * badges or chips (the runner catalog does not carry them).
 */
export function cycleModelsFromRunnerEntries(entries: CycleCatalogEntry[]): CycleModelsResponse {
  const models: CycleModelCard[] = entries.map((entry) => ({
    key: entry.family,
    runnerKey: entry.key,
    displayName: entry.label,
    catalogSpecId: null,
    specAvailable: false,
    kind: null,
    summary: entry.description ?? null,
    implementationNote: null,
    runnable: entry.available !== false,
    unavailableReason: entry.available !== false ? null : (entry.unavailableReason ?? "The server says this model cannot run yet."),
    implementation: null,
    explainKind: null,
    directionMode: null,
    hasPriceModel: null,
    sequence: false,
    speed: null,
    estimatedTrainingTime: null,
  }));
  return {
    categories: models.length === 0 ? [] : [{ id: "runners", label: "Models the server can run", runnableCount: countRunnableModels(models), subcategories: [{ id: "all", label: "All", models }] }],
    runnableCount: countRunnableModels(models),
    totalCount: models.length,
    catalogAvailable: false,
  };
}
