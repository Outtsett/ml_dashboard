/**
 * `/model-catalog` — the model catalog, one level at a time.
 *
 *   1. Categories: one card per model category. No model is listed here.
 *   2. A category (`?category=<id>`): every model in it, grouped by subcategory.
 *   3. A model (`?model=<id>`): how it works step by step, what to use it for,
 *      one worked example, then its metrics, blueprint and runs.
 *
 * The level is read from the URL, so every level can be linked to. Typing in
 * the search box lists the matching models whatever the level.
 */

import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { ArrowLeft, ChevronRight, Layers, RefreshCw, Search } from "lucide-react";
import { useEntityStore } from "@/shared/contexts/EntityContext";
import { useCatalogList, useCatalogStats, useCatalogDetail, useCatalogLifecycle, useRefreshCatalog } from "@/ml/lib/useModelCatalog";
import type { CatalogModelSummary } from "@/ml/lib/catalog_types";
import type { CatalogLifecycle } from "@shared/catalogLifecycle";
import { ModelDetailView } from "./ModelDetailView";
import { categoryColor } from "./constants";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";

/** A model as the list endpoint returns it; a wrapper family (Deep Learning, Machine Learning) is its `parentCategory`. */
type ListedModel = CatalogModelSummary & { parentCategory?: string };

/** `tree-based-models` → `Tree based models`. */
function slugLabel(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The overview's first sentence, without markdown emphasis marks. */
function firstSentence(overview: string): string {
  const plain = overview.replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
  // A full stop ends the sentence only before a capital or the end ("et al. 2004" does not).
  const end = plain.search(/\.(\s+[A-Z]|$)/);
  return end > 0 ? plain.slice(0, end + 1) : plain.slice(0, 220);
}

/** The stages worth a badge on a model card. */
const STAGE_BADGES: Partial<Record<CatalogLifecycle["stage"], string>> = {
  trainable: "Trainable",
  trained: "Trained",
  lens_ready: "Trained",
  deployed: "Deployed",
};

export default function ModelCatalogPage() {
  const [, navigate] = useLocation();
  const parameters = new URLSearchParams(useSearch());
  const selectedModelId = parameters.get("model");
  const categoryParameter = parameters.get("category");
  const [search, setSearch] = useState("");
  const { setEntity, clearEntity } = useEntityStore();

  const { data: stats } = useCatalogStats();
  const { data: catalog, isLoading } = useCatalogList({ category: null, subcategory: null, search: "" });
  const { data: modelDetail, isLoading: isLoadingDetail } = useCatalogDetail(selectedModelId);
  const { data: lifecycleData } = useCatalogLifecycle();
  const { mutate: refreshCatalog, isPending: refreshing } = useRefreshCatalog();
  const lifecycle = lifecycleData?.lifecycle ?? {};

  const models = (catalog?.models ?? []) as ListedModel[];
  const categoryLabels = stats?.categoryLabels ?? {};
  const labelOf = (category: string) => categoryLabels[category] ?? slugLabel(category);

  const selectedModel = selectedModelId ? models.find((model) => model.id === selectedModelId) : undefined;
  // A model link without a category still knows where "back" leads.
  const selectedCategory = categoryParameter ?? selectedModel?.category ?? null;

  const openCategories = () => navigate("/model-catalog");
  const openCategory = (category: string) => navigate(`/model-catalog?category=${encodeURIComponent(category)}`);
  const openModel = (model: ListedModel) => {
    setEntity("model", model.id, model.name);
    setSearch("");
    navigate(`/model-catalog?category=${encodeURIComponent(model.category)}&model=${encodeURIComponent(model.id)}`);
  };
  const closeModel = () => {
    clearEntity();
    if (selectedCategory) openCategory(selectedCategory);
    else openCategories();
  };

  const needle = search.trim().toLowerCase();
  const searching = needle.length >= 2;
  const matches = searching
    ? models.filter((model) => `${model.name} ${model.shortName} ${model.subcategory} ${labelOf(model.category)}`.toLowerCase().includes(needle))
    : [];

  // ── Level 3: one model ────────────────────────────────────────────────────
  if (selectedModelId && !searching) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        <Breadcrumb
          categoryLabel={selectedCategory ? labelOf(selectedCategory) : null}
          modelName={modelDetail?.name ?? selectedModel?.name ?? selectedModelId}
          onCategories={() => { clearEntity(); openCategories(); }}
          onCategory={closeModel}
        />
        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
          {modelDetail ? (
            <ModelDetailView model={modelDetail} lifecycle={lifecycle[selectedModelId]} onBack={closeModel} categoryLabels={categoryLabels} />
          ) : isLoadingDetail ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <RefreshCw className="mb-4 h-8 w-8 animate-spin text-primary opacity-60" />
              <p className="font-mono text-xs">{selectedModelId}</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
              <p>The catalog has no model with the id "{selectedModelId}".</p>
              <Button variant="outline" size="sm" onClick={openCategories}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> All categories
              </Button>
            </div>
          )}
        </main>
      </div>
    );
  }

  const categoryModels = selectedCategory ? models.filter((model) => model.category === selectedCategory) : [];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <header className="shrink-0 space-y-2 border-b border-border px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <Breadcrumb
            bare
            categoryLabel={selectedCategory && !searching ? labelOf(selectedCategory) : null}
            modelName={null}
            onCategories={openCategories}
            onCategory={() => undefined}
          />
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a model by name"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Re-read the catalog from disk" onClick={() => refreshCatalog()} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {searching
            ? `${matches.length} of ${models.length} models have "${search.trim()}" in their name, subcategory or category.`
            : selectedCategory
              ? `${categoryModels.length} models in ${labelOf(selectedCategory)}, grouped by subcategory. Open one for how it works step by step, what to use it for and a worked example.`
              : `${models.length} models in ${new Set(models.map((model) => model.category)).size} categories. Open a category to see its models.`}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
            {Array.from({ length: 9 }).map((_, index) => <Skeleton key={index} className="h-32 w-full rounded-lg" />)}
          </div>
        ) : searching ? (
          <ModelGroups models={matches} groupOf={(model) => labelOf(model.category)} lifecycle={lifecycle} onOpen={openModel} empty="No model matches." />
        ) : selectedCategory ? (
          <ModelGroups
            models={categoryModels}
            groupOf={(model) => slugLabel(model.subcategory || "general")}
            lifecycle={lifecycle}
            onOpen={openModel}
            empty={`The catalog has no models in "${selectedCategory}".`}
          />
        ) : (
          <CategoryGrid models={models} labelOf={labelOf} onOpen={openCategory} />
        )}
      </div>
    </div>
  );
}

// ── Level 1: the categories ─────────────────────────────────────────────────

function CategoryGrid({ models, labelOf, onOpen }: { models: ListedModel[]; labelOf: (category: string) => string; onOpen: (category: string) => void }) {
  const byCategory = new Map<string, ListedModel[]>();
  for (const model of models) {
    const members = byCategory.get(model.category);
    if (members) members.push(model);
    else byCategory.set(model.category, [model]);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length || labelOf(a[0]).localeCompare(labelOf(b[0])));

  return (
    <div className="grid items-start gap-3 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]" data-testid="catalog-categories">
      {categories.map(([category, members]) => {
        const subcategories = new Map<string, number>();
        for (const model of members) subcategories.set(model.subcategory || "general", (subcategories.get(model.subcategory || "general") ?? 0) + 1);
        const parent = members[0]?.parentCategory;
        return (
          <button
            key={category}
            type="button"
            onClick={() => onOpen(category)}
            data-testid={`catalog-category-${category}`}
            className="group flex flex-col gap-3 rounded-lg border border-border/60 bg-card/40 p-4 text-left transition-colors hover:border-primary/50 hover:bg-card"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {parent && parent !== category && (
                  <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{labelOf(parent)}</div>
                )}
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate text-base font-semibold font-display">{labelOf(category)}</span>
                </div>
              </div>
              <Badge variant="outline" className={`shrink-0 text-[11px] ${categoryColor(category)}`}>
                {members.length} {members.length === 1 ? "model" : "models"}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[...subcategories.entries()].sort((a, b) => b[1] - a[1]).map(([subcategory, count]) => (
                <span key={subcategory} className="rounded border border-border/40 bg-muted/30 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {slugLabel(subcategory)} <span className="font-mono">{count}</span>
                </span>
              ))}
            </div>
            <span className="mt-auto flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary">
              Show the models <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Level 2: the models of a category (or of a search) ──────────────────────

function ModelGroups({
  models,
  groupOf,
  lifecycle,
  onOpen,
  empty,
}: {
  models: ListedModel[];
  groupOf: (model: ListedModel) => string;
  lifecycle: Record<string, CatalogLifecycle>;
  onOpen: (model: ListedModel) => void;
  empty: string;
}) {
  if (models.length === 0) return <p className="p-6 text-center text-sm text-muted-foreground">{empty}</p>;

  const groups = new Map<string, ListedModel[]>();
  for (const model of models) {
    const group = groupOf(model);
    const members = groups.get(group);
    if (members) members.push(model);
    else groups.set(group, [model]);
  }

  return (
    <div className="space-y-6" data-testid="catalog-models">
      {[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([group, members]) => (
        <section key={group}>
          <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {group} ({members.length})
          </h2>
          <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
            {[...members].sort((a, b) => a.name.localeCompare(b.name)).map((model) => {
              const stage = lifecycle[model.id]?.stage;
              const stageBadge = stage ? STAGE_BADGES[stage] : undefined;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => onOpen(model)}
                  className="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-card/30 p-3 text-left transition-colors hover:border-primary/50 hover:bg-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{model.name}</span>
                    {stageBadge && <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">{stageBadge}</Badge>}
                  </div>
                  <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{firstSentence(model.overview)}</p>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Where you are ───────────────────────────────────────────────────────────

function Breadcrumb({
  categoryLabel,
  modelName,
  onCategories,
  onCategory,
  bare = false,
}: {
  categoryLabel: string | null;
  modelName: string | null;
  onCategories: () => void;
  onCategory: () => void;
  /** Without its own bar: the caller supplies the surrounding header. */
  bare?: boolean;
}) {
  const crumbs = (
    <nav aria-label="Catalog level" className="flex min-w-0 items-center gap-1.5 text-sm">
      {categoryLabel || modelName ? (
        <button type="button" onClick={onCategories} className="flex shrink-0 items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> All categories
        </button>
      ) : (
        <span className="flex items-center gap-2 font-semibold font-display">
          <Layers className="h-4 w-4 text-primary" /> Model categories
        </span>
      )}
      {categoryLabel && (
        <>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {modelName ? (
            <button type="button" onClick={onCategory} className="shrink-0 text-muted-foreground hover:text-foreground">{categoryLabel}</button>
          ) : (
            <span className="font-semibold font-display">{categoryLabel}</span>
          )}
        </>
      )}
      {modelName && (
        <>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-semibold font-display">{modelName}</span>
        </>
      )}
    </nav>
  );
  return bare ? crumbs : <div className="shrink-0 border-b border-border px-6 py-2">{crumbs}</div>;
}
