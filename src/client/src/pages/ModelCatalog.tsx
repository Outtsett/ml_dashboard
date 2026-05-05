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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
} from "@/hooks/useModelCatalog";

import { CatalogSidebar } from "./model-catalog/CatalogSidebar";
import { CatalogGrid } from "./model-catalog/CatalogGrid";
import { ModelDetailView } from "./model-catalog/ModelDetailView";
import { categoryColor } from "./model-catalog/constants";

// ════════════════════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════════════════════

export default function ModelCatalog() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

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

  const models = catalog?.models ?? [];

  // ── Derived counts per category for the sidebar badges ────────────────────

  const categoryCounts = useMemo(() => {
    if (!taxonomy?.taxonomy) return {};
    const counts: Record<string, number> = {};
    for (const [cat, subs] of Object.entries(taxonomy.taxonomy)) {
      counts[cat] = Object.values(subs).reduce((a, b) => a + b, 0);
    }
    return counts;
  }, [taxonomy]);

  const categoryLabels = taxonomy?.categoryLabels ?? stats?.categoryLabels ?? {};

  // ── Render ────────────────────────────────────────────────────────────────

  // Detail view
  if (selectedModelId && modelDetail) {
    return (
      <ModelDetailView
        model={modelDetail}
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
        totalModels={stats?.filesWithContent ?? "..."}
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

          <div className="flex-1" />

          {/* Stats badges */}
          {stats && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="gap-1 font-mono">
                <FileText className="h-3 w-3" />
                {stats.filesWithContent} specs
              </Badge>
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
          {isLoading ? "Scanning..." : `${models.length} models`}
          {search.trim().length >= 2 && ` matching "${search.trim()}"`}
        </div>

        {/* Model grid */}
        <CatalogGrid
          models={models}
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
