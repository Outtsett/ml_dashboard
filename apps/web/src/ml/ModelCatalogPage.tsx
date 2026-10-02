/**
 * Model Catalog — Browse, search, and inspect 300+ algo model specs.
 *
 * Think of it as: a trading desk's model library — every strategy type
 * sitting on a shelf, organized by category. You can flip through them,
 * filter by family (Neural Nets, Tree Methods, RL, etc.), and drill into
 * the full blueprint for any model you want to train.
 *
 * SRP: Coordinator — manages state and data flow between sub-components.
 */

import { useState, useMemo } from "react";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import {
  Search,
  FileText,
  Layers,
  RefreshCw,
} from "lucide-react";
import {
  useCatalogStats,
  useCatalogTaxonomy,
  useCatalogList,
  useCatalogDetail,
  useRefreshCatalog,
  useCatalogLifecycle,
} from "@/ml/lib/useModelCatalog";
import { LIFECYCLE_STAGES, type LifecycleStage } from "@shared/catalogLifecycle";

import { CatalogSidebar } from "./CatalogSidebar";
import { CatalogGrid } from "./CatalogGrid";
import { ModelDetailView } from "./ModelDetailView";
import { categoryColor } from "./constants";

type StageFilter = "all" | "trainable" | "trained";

const STAGE_FILTERS: { id: StageFilter; label: string; minimumStage: LifecycleStage | null }[] = [
  { id: "all", label: "All", minimumStage: null },
  { id: "trainable", label: "Trainable", minimumStage: "trainable" },
  { id: "trained", label: "Trained", minimumStage: "trained" },
];

function readModelFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("model");
}

function writeModelToUrl(modelId: string | null): void {
  const url = new URL(window.location.href);
  if (modelId) url.searchParams.set("model", modelId);
  else url.searchParams.delete("model");
  window.history.replaceState(null, "", url);
}

// ════════════════════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════════════════════

export default function ModelCatalog() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  // `/model-catalog?model=<id>` opens that spec — the target of ML Studio's
  // "open spec" link. Same read-once idiom as LensPage.
  const [selectedModelId, setSelectedModelIdRaw] = useState<string | null>(readModelFromUrl);
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");

  const setSelectedModelId = (id: string | null) => {
    setSelectedModelIdRaw(id);
    writeModelToUrl(id);
  };

  // ── Data queries (one hook per concern — SRP) ─────────────────────────────

  const { data: stats } = useCatalogStats();
  const { data: taxonomy } = useCatalogTaxonomy();
  const { data: catalog, isLoading, isError, error, refetch } = useCatalogList({
    category: selectedCategory,
    subcategory: selectedSubcategory,
    search,
  });
  const { data: modelDetail } = useCatalogDetail(selectedModelId);
  const { mutate: refreshCatalog, isPending: refreshing } = useRefreshCatalog();

  const { data: lifecycleData } = useCatalogLifecycle();
  const lifecycle = lifecycleData?.lifecycle ?? {};

  const minimumStage = STAGE_FILTERS.find((f) => f.id === stageFilter)?.minimumStage ?? null;
  const models = (catalog?.models ?? []).filter((m) => {
    if (!minimumStage) return true;
    const stage = lifecycle[m.id]?.stage;
    return stage !== undefined && LIFECYCLE_STAGES.indexOf(stage) >= LIFECYCLE_STAGES.indexOf(minimumStage);
  });

  // ── Derived counts per category for the sidebar badges ────────────────────

  const categoryCounts = useMemo(() => {
    if (!taxonomy?.taxonomy) return {};
    const counts: Record<string, number> = {};
    for (const [cat, subs] of Object.entries(taxonomy.taxonomy)) {
      counts[cat] = Object.values(subs).reduce((a, b) => a + b, 0);
    }
    return counts;
  }, [taxonomy]);

  const allCategoryLabels = taxonomy?.categoryLabels ?? stats?.categoryLabels ?? {};

  // Top-level list excludes any category that is ALSO a subcategory of another.
  //
  // The parser rolls every Machine Learning spec into both its own category and
  // the `machine-learning` parent, so supervised/unsupervised/semi-/self- were
  // rendered twice: once as siblings of their own parent, and again when that
  // parent was expanded. The sidebar badges summed to 384 on a 300-file corpus.
  // Nested entries are reachable by expanding the parent, which is where they
  // belong, so they are dropped from the flat list rather than being counted
  // a second time.
  const categoryLabels = useMemo(() => {
    const nested = new Set<string>();
    for (const subs of Object.values(taxonomy?.taxonomy ?? {})) {
      for (const sub of Object.keys(subs)) {
        if (sub in allCategoryLabels) nested.add(sub);
      }
    }
    return Object.fromEntries(
      Object.entries(allCategoryLabels).filter(([key]) => !nested.has(key)),
    );
  }, [taxonomy, allCategoryLabels]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Detail view
  if (selectedModelId && modelDetail) {
    return (
      <ModelDetailView
        model={modelDetail}
        lifecycle={lifecycle[modelDetail.id]}
        onBack={() => setSelectedModelId(null)}
        categoryLabels={categoryLabels}
      />
    );
  }

  return (
    <div className="flex h-full gap-0 overflow-hidden">
      {/* ── Sidebar: Category tree ─────────────────────────────────────── */}
      <CatalogSidebar
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
        selectedSubcategory={selectedSubcategory}
        setSelectedSubcategory={setSelectedSubcategory}
        categoryLabels={categoryLabels}
        categoryCounts={categoryCounts}
        totalModels={stats?.totalFiles ?? "..."}
        taxonomy={taxonomy?.taxonomy ?? {}}
      />

      {/* ── Main content ───────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-border flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models by name, acronym, or keyword..."
              className="pl-9 h-9 text-sm font-mono"
            />
          </div>

          {/* Active filters */}
          {selectedCategory && (
            <Badge className={`${categoryColor(selectedCategory)} border text-xs`}>
              {categoryLabels[selectedCategory] ?? selectedCategory}
              {selectedSubcategory && (
                <span className="opacity-70 ml-1">
                  / {selectedSubcategory.replace(/-/g, " ")}
                </span>
              )}
            </Badge>
          )}

          {/* Lifecycle filter — "what can I train today", "what have I trained" */}
          <div className="flex items-center rounded-md border border-border overflow-hidden" role="group" aria-label="Filter by lifecycle stage">
            {STAGE_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setStageFilter(f.id)}
                aria-pressed={stageFilter === f.id}
                data-testid={`stage-filter-${f.id}`}
                className={`px-2.5 h-9 text-xs font-mono transition-colors ${
                  stageFilter === f.id
                    ? "bg-primary/15 text-primary font-semibold underline underline-offset-4"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Stats badges */}
          {stats && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="gap-1 font-mono">
                <FileText className="h-3 w-3" />
                {stats.totalFiles} specs
              </Badge>
              {stats.emptyPlaceholders > 0 && (
                <Badge variant="outline" className="gap-1 font-mono text-muted-foreground">
                  {stats.emptyPlaceholders} not yet written
                </Badge>
              )}
              <Badge variant="outline" className="gap-1 font-mono">
                <Layers className="h-3 w-3" />
                {stats.categoryCount} categories
              </Badge>
            </div>
          )}

          {/* Refresh */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refreshCatalog()}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Results count */}
        <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border/50 font-mono">
          {isLoading
            ? "Scanning..."
            : `${models.length} model${models.length === 1 ? "" : "s"}`}
          {search.trim().length >= 2 && ` matching "${search.trim()}"`}
        </div>

        {/* Model grid */}
        <CatalogGrid
          models={models}
          lifecycle={lifecycle}
          isLoading={isLoading}
          isError={isError}
          error={error}
          refetch={refetch}
          categoryLabels={categoryLabels}
          onModelClick={setSelectedModelId}
          search={search}
          setSearch={setSearch}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          setSelectedSubcategory={setSelectedSubcategory}
        />
      </main>
    </div>
  );
}
