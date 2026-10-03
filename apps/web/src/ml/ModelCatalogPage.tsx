import { useState, useMemo } from "react";
import { Search, Layers, FileText, RefreshCw, Brain } from "lucide-react";
import { useCatalogList, useCatalogStats, useRefreshCatalog, useCatalogDetail, useCatalogLifecycle, STAGE_FILTERS, LIFECYCLE_STAGES } from "@/ml/lib/useModelCatalog";
import { ModelDetailView } from "./ModelDetailView";
import { categoryColor } from "./constants";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";

type StageFilter = "all" | "trainable" | "trained";

export default function ModelCatalogPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");

  const { data: stats } = useCatalogStats();
  const { data: taxonomy } = useCatalogList({ groupBy: "taxonomy" });
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

  const allCategoryLabels = taxonomy?.categoryLabels ?? stats?.categoryLabels ?? {};
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

  return (
    <div className="flex h-full gap-0 overflow-hidden w-full">
      {/* MASTER: Left Sidebar Model Registry */}
      <aside className="w-80 flex-shrink-0 flex flex-col border-r border-border bg-card/50">
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold font-display flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Model Registry
            </h2>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => refreshCatalog()} disabled={refreshing}>
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
          
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="pl-8 h-8 text-xs font-mono"
            />
          </div>

          <Select value={selectedCategory || "all"} onValueChange={(v) => {
            setSelectedCategory(v === "all" ? null : v);
            setSelectedSubcategory(null);
          }}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All Categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {Object.entries(categoryLabels).map(([cat, label]) => (
                <SelectItem key={cat} value={cat}>{label as string}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-md" />)
            ) : models.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center p-4">No models match criteria.</div>
            ) : (
              models.map(m => (
                <button
                  key={m.id}
                  onClick={() => setSelectedModelId(m.id)}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors border ${selectedModelId === m.id ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-transparent border-transparent hover:bg-muted/50'}`}
                >
                  <div className="font-semibold text-xs truncate">{m.name}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-muted-foreground truncate">{m.shortName}</span>
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${categoryColor(m.category)}`}>
                      {categoryLabels[m.category] ?? m.category}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* DETAIL: Right Canvas Content */}
      <main className="flex-1 min-w-0 flex flex-col bg-background relative h-full overflow-hidden">
        {selectedModelId && modelDetail ? (
          <ModelDetailView
            model={modelDetail}
            lifecycle={lifecycle[selectedModelId]}
            onBack={() => setSelectedModelId(null)}
            categoryLabels={categoryLabels}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center bg-neutral-950/50">
            <Brain className="w-16 h-16 mb-4 opacity-10 text-primary" />
            <h3 className="text-lg font-display font-semibold mb-2 text-neutral-300">Entity-Centric Inference Platform</h3>
            <p className="text-sm max-w-md text-neutral-500">
              Select a model blueprint from the registry on the left to configure the training pipeline, view telemetry, or assess production risk.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
