import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "@/shared/ui/empty";
import { ErrorCard } from "@/shared/ui/error-card";
import { BookOpen, Tag, Cpu, Sparkles, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import type { CatalogModelSummary } from "@/ml/lib/catalog_types";
import type { CatalogLifecycle } from "@shared/catalogLifecycle";
import { categoryColor } from "./constants";
import { LifecycleStrip } from "./LifecycleStrip";

interface CatalogGridProps {
  models: CatalogModelSummary[];
  /** Keyed by spec id; absent while the lifecycle query is in flight. */
  lifecycle: Record<string, CatalogLifecycle>;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  categoryLabels: Record<string, string>;
  onModelClick: (id: string) => void;
  search: string;
  setSearch: (s: string) => void;
  selectedCategory: string | null;
  setSelectedCategory: (c: string | null) => void;
  setSelectedSubcategory: (s: string | null) => void;
}

export function CatalogGrid({
  models,
  lifecycle,
  isLoading,
  isError,
  error,
  refetch,
  categoryLabels,
  onModelClick,
  search,
  setSearch,
  selectedCategory,
  setSelectedCategory,
  setSelectedSubcategory,
}: CatalogGridProps) {
  return (
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
                key={m.relativePath}
                model={m}
                lifecycle={lifecycle[m.id]}
                categoryLabels={categoryLabels}
                onClick={() => onModelClick(m.id)}
              />
            ))}

            {!isLoading && models.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="col-span-full flex items-center justify-center py-20"
              >
                {search.trim().length >= 2 || selectedCategory ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <BookOpen />
                      </EmptyMedia>
                      <EmptyTitle>No models match your filters</EmptyTitle>
                      <EmptyDescription>
                        Try adjusting your search or filter criteria.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSearch("");
                          setSelectedCategory(null);
                          setSelectedSubcategory(null);
                        }}
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
                      <EmptyDescription>
                        Train your first model in ML Studio to see it appear in the catalog.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </motion.div>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function ModelCard({
  model,
  lifecycle,
  categoryLabels,
  onClick,
}: {
  model: CatalogModelSummary;
  lifecycle: CatalogLifecycle | undefined;
  categoryLabels: Record<string, string>;
  onClick: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className="cursor-pointer hover:border-primary/40 transition duration-150 hover:shadow-md hover:shadow-primary/5 group"
    >
      <CardHeader className="pb-2 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight line-clamp-2">
            {model.name}
          </CardTitle>
          {model.hasContent ? (
            <CheckCircle2 className="h-4 w-4 text-[hsl(var(--data-pos))] shrink-0 mt-0.5" />
          ) : (
            /* A 40%-opacity XCircle read as decoration, so 169 unwritten specs
               looked like ordinary cards. State this one in words. */
            <Badge
              variant="outline"
              className="shrink-0 mt-0.5 px-1.5 py-0 text-[9.5px] font-mono uppercase tracking-wider text-muted-foreground border-dashed"
            >
              Stub
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge className={`${categoryColor(model.category)} border text-[10px] px-1.5 py-0`}>
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
                  <Tag className="h-3 w-3" /> {model.variants.length} variant
                  {model.variants.length !== 1 ? "s" : ""}
                </span>
              )}
              {model.hyperparameters.length > 0 && (
                <span className="flex items-center gap-1">
                  <Cpu className="h-3 w-3" /> {model.hyperparameters.length} param
                  {model.hyperparameters.length !== 1 ? "s" : ""}
                </span>
              )}
              {model.keyFeatures.length > 0 && (
                <span className="flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> {model.keyFeatures.length} feature
                  {model.keyFeatures.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground/60 leading-relaxed">
            Spec not written yet — the file exists but is empty.
            <span className="block mt-1 font-mono text-[10px] text-muted-foreground/40">
              {model.category} · {model.subcategory}
            </span>
          </p>
        )}
        {lifecycle && model.hasContent && (
          <div className="mt-2.5 pt-2 border-t border-border/50">
            <LifecycleStrip lifecycle={lifecycle} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
