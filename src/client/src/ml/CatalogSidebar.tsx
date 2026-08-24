import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Separator } from "@/shared/ui/separator";
import { Layers, ChevronRight } from "lucide-react";

interface CatalogSidebarProps {
  selectedCategory: string | null;
  setSelectedCategory: (cat: string | null) => void;
  selectedSubcategory: string | null;
  setSelectedSubcategory: (sub: string | null) => void;
  categoryLabels: Record<string, string>;
  categoryCounts: Record<string, number>;
  totalModels: number | string;
  taxonomy: Record<string, Record<string, number>>;
}

export function CatalogSidebar({
  selectedCategory,
  setSelectedCategory,
  selectedSubcategory,
  setSelectedSubcategory,
  categoryLabels,
  categoryCounts,
  totalModels,
  taxonomy,
}: CatalogSidebarProps) {
  return (
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
            onClick={() => {
              setSelectedCategory(null);
              setSelectedSubcategory(null);
            }}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between ${
              !selectedCategory
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <span>All Models</span>
            <Badge variant="outline" className="text-[10px] h-5 font-mono">
              {totalModels}
            </Badge>
          </button>

          <Separator className="my-2" />

          {/* Category list */}
          {Object.entries(categoryLabels).map(([key, label]) => {
            const isActive = selectedCategory === key;
            const subcategories = taxonomy[key] ?? {};

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
  );
}
