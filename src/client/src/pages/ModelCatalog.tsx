/**
 * Model Catalog — Browse, search, and inspect 300+ algo model specs.
 *
 * Think of it as: a trading desk's model library — every strategy type
 * sitting on a shelf, organized by category. You can flip through them,
 * filter by family (Neural Nets, Tree Methods, RL, etc.), and drill into
 * the full blueprint for any model you want to train.
 *
 * SRP: Render only — data-fetching lives in useModelCatalog hooks.
 * DIP: Depends on hooks (abstraction), never calls fetch() directly.
 * ISP: Imports focused types from catalogTypes.ts.
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "@/components/ui/empty";
import { ErrorCard } from "@/components/ui/error-card";
import {
  Search,
  BookOpen,
  Layers,
  ArrowLeft,
  ChevronRight,
  FileText,
  Tag,
  Cpu,
  RefreshCw,
  Brain,
  Sparkles,
  Info,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import type { CatalogModelSummary, CatalogModelDetail } from "@/lib/catalogTypes";
import {
  useCatalogStats,
  useCatalogTaxonomy,
  useCatalogList,
  useCatalogDetail,
  useRefreshCatalog,
} from "@/hooks/useModelCatalog";

// ─── Category color map ─────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  "generative": "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "hybrid-composite": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "machine-learning": "bg-green-500/20 text-green-400 border-green-500/30",
  "neural-network": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "optimization": "bg-orange-500/20 text-orange-400 border-orange-500/30",
  "probabilistic-symbolic": "bg-pink-500/20 text-pink-400 border-pink-500/30",
  "reinforcement-learning": "bg-red-500/20 text-red-400 border-red-500/30",
  "simulation-decision": "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "statistical": "bg-teal-500/20 text-teal-400 border-teal-500/30",
  "self-supervised": "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  "semi-supervised": "bg-lime-500/20 text-lime-400 border-lime-500/30",
  "supervised": "bg-rose-500/20 text-rose-400 border-rose-500/30",
  "unsupervised": "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

function categoryColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? "bg-muted text-muted-foreground";
}

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
      <aside className="w-64 min-w-[16rem] border-r border-border flex flex-col bg-card/50">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-semibold font-display flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Categories
          </h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
            {/* All models button */}
            <button
              onClick={() => { setSelectedCategory(null); setSelectedSubcategory(null); }}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between ${
                !selectedCategory
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <span>All Models</span>
              <Badge variant="outline" className="text-[10px] h-5 font-mono">
                {stats?.filesWithContent ?? "..."}
              </Badge>
            </button>

            <Separator className="my-2" />

            {/* Category list */}
            {Object.entries(categoryLabels).map(([key, label]) => {
              const isActive = selectedCategory === key;
              const subcategories = taxonomy?.taxonomy[key] ?? {};

              return (
                <div key={key}>
                  <button
                    onClick={() => {
                      setSelectedCategory(isActive ? null : key);
                      setSelectedSubcategory(null);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between group ${
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    <span className="truncate">{label}</span>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px] h-5 font-mono">
                        {categoryCounts[key] ?? 0}
                      </Badge>
                      <ChevronRight
                        className={`h-3 w-3 transition-transform ${isActive ? "rotate-90" : ""}`}
                      />
                    </div>
                  </button>

                  {/* Subcategories (expanded) */}
                  {isActive && Object.keys(subcategories).length > 0 && (
                    <div className="ml-3 pl-3 border-l border-border/60 mt-1 mb-2 space-y-0.5">
                      {Object.entries(subcategories)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([sub, count]) => (
                          <button
                            key={sub}
                            onClick={() =>
                              setSelectedSubcategory(
                                selectedSubcategory === sub ? null : sub
                              )
                            }
                            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between ${
                              selectedSubcategory === sub
                                ? "bg-primary/10 text-primary font-medium"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                            }`}
                          >
                            <span className="truncate capitalize">
                              {sub.replace(/-/g, " ")}
                            </span>
                            <span className="text-[10px] font-mono opacity-60">
                              {count}
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </aside>

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
        <ScrollArea className="flex-1">
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {isError ? (
              <div className="col-span-full">
                <ErrorCard
                  title="Failed to load model catalog"
                  description="Could not fetch the model list from the server."
                  error={error}
                  onRetry={() => refetch()}
                />
              </div>
            ) : (
            <>
            {models.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                categoryLabels={categoryLabels}
                onClick={() => setSelectedModelId(m.id)}
              />
            ))}

            {!isLoading && models.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="col-span-full flex items-center justify-center py-20">
                {(search.trim().length >= 2 || selectedCategory) ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <BookOpen />
                      </EmptyMedia>
                      <EmptyTitle>No models match your filters</EmptyTitle>
                      <EmptyDescription>Try adjusting your search or filter criteria.</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setSearch(""); setSelectedCategory(null); setSelectedSubcategory(null); }}
                      >
                        Clear filters
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <BookOpen />
                      </EmptyMedia>
                      <EmptyTitle>No models registered</EmptyTitle>
                      <EmptyDescription>Train your first model in ML Studio to see it appear in the catalog.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </motion.div>
            )}
            </>
            )}
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Model Card
// ════════════════════════════════════════════════════════════════════════════

function ModelCard({
  model,
  categoryLabels,
  onClick,
}: {
  model: CatalogModelSummary;
  categoryLabels: Record<string, string>;
  onClick: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className="cursor-pointer hover:border-primary/40 transition-all duration-150 hover:shadow-md hover:shadow-primary/5 group"
    >
      <CardHeader className="pb-2 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight line-clamp-2">
            {model.name}
          </CardTitle>
          {model.hasContent ? (
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge
            className={`${categoryColor(model.category)} border text-[10px] px-1.5 py-0`}
          >
            {categoryLabels[model.category] ?? model.category}
          </Badge>
          {model.shortName !== model.name && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
              {model.shortName}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {model.hasContent ? (
          <>
            <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
              {model.overview || "No overview available"}
            </p>
            <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground/70 font-mono">
              {model.variants.length > 0 && (
                <span className="flex items-center gap-1">
                  <Tag className="h-3 w-3" /> {model.variants.length} variant{model.variants.length !== 1 ? "s" : ""}
                </span>
              )}
              {model.hyperparameters.length > 0 && (
                <span className="flex items-center gap-1">
                  <Cpu className="h-3 w-3" /> {model.hyperparameters.length} param{model.hyperparameters.length !== 1 ? "s" : ""}
                </span>
              )}
              {model.keyFeatures.length > 0 && (
                <span className="flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> {model.keyFeatures.length} feature{model.keyFeatures.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground/50 italic">
            Placeholder — content not yet written
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Detail View
// ════════════════════════════════════════════════════════════════════════════

function ModelDetailView({
  model,
  onBack,
  categoryLabels,
}: {
  model: CatalogModelDetail;
  onBack: () => void;
  categoryLabels: Record<string, string>;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-display font-semibold truncate">
            {model.name}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge className={`${categoryColor(model.category)} border text-[10px]`}>
              {categoryLabels[model.category] ?? model.category}
            </Badge>
            <Badge variant="outline" className="text-[10px] capitalize">
              {model.subcategory.replace(/-/g, " ")}
            </Badge>
            {model.shortName !== model.name && (
              <Badge variant="secondary" className="text-[10px] font-mono">
                {model.shortName}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-6 max-w-5xl space-y-6">
          {/* Overview */}
          {model.overview && (
            <section>
              <SectionHeader icon={BookOpen} title="Overview" />
              <p className="text-sm text-muted-foreground leading-relaxed mt-2">
                {model.overview}
              </p>
            </section>
          )}

          {/* Key Features */}
          {model.keyFeatures.length > 0 && (
            <section>
              <SectionHeader icon={Sparkles} title="Key Features" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                {model.keyFeatures.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30 border border-border/50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                    <span className="text-xs text-muted-foreground leading-relaxed">{f}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Principles */}
          {model.principles.length > 0 && (
            <section>
              <SectionHeader icon={Info} title="Core Principles" />
              <ul className="mt-2 space-y-1.5">
                {model.principles.map((p, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="text-primary font-mono text-[10px] mt-0.5">{i + 1}.</span>
                    <span className="leading-relaxed">{p}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Variants */}
          {model.variants.length > 0 && (
            <section>
              <SectionHeader icon={Tag} title="Variants" />
              <div className="flex flex-wrap gap-2 mt-2">
                {model.variants.map((v, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {v}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          {/* Hyperparameters */}
          {model.hyperparameters.length > 0 && (
            <section>
              <SectionHeader icon={Cpu} title="Hyperparameters" />
              <div className="mt-2 border border-border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 font-medium">Name</th>
                      <th className="text-left px-3 py-2 font-medium">Type</th>
                      <th className="text-left px-3 py-2 font-medium">Default</th>
                      <th className="text-left px-3 py-2 font-medium">Range</th>
                      <th className="text-left px-3 py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.hyperparameters.map((hp, i) => (
                      <tr
                        key={i}
                        className="border-b border-border/50 last:border-0 hover:bg-muted/20"
                      >
                        <td className="px-3 py-2 font-mono text-primary">{hp.name}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px] py-0">
                            {hp.type}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 font-mono">{String(hp.default)}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">
                          {hp.type === "number" && hp.min != null && hp.max != null
                            ? `${hp.min} — ${hp.max}`
                            : hp.options?.join(", ") ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">
                          {hp.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Applications */}
          {model.applications.length > 0 && (
            <section>
              <SectionHeader icon={Brain} title="Applications" />
              <div className="flex flex-wrap gap-2 mt-2">
                {model.applications.map((a, i) => (
                  <Badge
                    key={i}
                    variant="secondary"
                    className="text-xs"
                  >
                    {a}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          {/* Raw Markdown */}
          {model.rawMarkdown && (
            <section>
              <SectionHeader icon={FileText} title="Raw Specification" />
              <pre className="mt-2 p-4 bg-muted/30 border border-border rounded-md text-xs font-mono whitespace-pre-wrap leading-relaxed text-muted-foreground overflow-x-auto max-h-[600px] overflow-y-auto">
                {model.rawMarkdown}
              </pre>
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title }: { icon: typeof BookOpen; title: string }) {
  return (
    <h3 className="text-sm font-semibold font-display flex items-center gap-2">
      <Icon className="h-4 w-4 text-primary" />
      {title}
    </h3>
  );
}



