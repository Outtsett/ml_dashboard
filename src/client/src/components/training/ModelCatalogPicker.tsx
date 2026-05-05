import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Cpu,
  Clock,
  Sparkles,
  BookOpen,
  PackageOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ModelRegistryEntry } from "@shared/trainingTypes";

// ─── Props ───────────────────────────────────────────────────────────

export interface ModelCatalogPickerProps {
  selectedModelId: string | null;
  onSelectModel: (modelId: string, model: ModelRegistryEntry) => void;
  disabled?: boolean;
  className?: string;
}

// ─── Fetch helpers ───────────────────────────────────────────────────

interface TrainingConfigResponse {
  models: Record<string, ModelRegistryEntry>;
}

interface CatalogModel {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  description?: string;
  tags?: string[];
  family?: string;
  gpuRequired?: boolean;
  estimatedTrainingTime?: string;
  [key: string]: unknown;
}

interface TaxonomyResponse {
  taxonomy: Record<string, string[]>;
}

function fetchTrainingConfig(): Promise<TrainingConfigResponse> {
  return fetch("/api/training/config").then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });
}

function fetchModelCatalog(): Promise<CatalogModel[]> {
  return fetch("/api/model-catalog").then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });
}

function fetchTaxonomy(): Promise<TaxonomyResponse> {
  return fetch("/api/model-catalog/taxonomy").then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });
}

// ─── Merged model type ──────────────────────────────────────────────

interface MergedModel {
  id: string;
  entry: ModelRegistryEntry;
  trainable: boolean;
}

function mergeModels(
  registry: Record<string, ModelRegistryEntry> | undefined,
  catalog: CatalogModel[] | undefined,
): MergedModel[] {
  const merged = new Map<string, MergedModel>();

  // Registry models take priority — always trainable
  if (registry) {
    for (const [id, entry] of Object.entries(registry)) {
      merged.set(id, { id, entry, trainable: !!entry.script });
    }
  }

  // Catalog-only models added with trainable=false
  if (catalog) {
    for (const cat of catalog) {
      const key = cat.id ?? cat.name;
      if (!merged.has(key)) {
        merged.set(key, {
          id: key,
          entry: {
            name: cat.name,
            category: cat.category ?? "Uncategorized",
            subcategory: cat.subcategory ?? "",
            runner: "python" as const,
            featurePipeline: "",
            outputs: [],
            chartOverlay: "",
            outputDir: "",
            defaultHyperparameters: {},
            description: cat.description,
            tags: cat.tags,
            family: cat.family as ModelRegistryEntry["family"],
            gpuRequired: cat.gpuRequired,
            estimatedTrainingTime: cat.estimatedTrainingTime,
          },
          trainable: false,
        });
      }
    }
  }

  return Array.from(merged.values());
}

// ─── Filter logic ───────────────────────────────────────────────────

function matchesSearch(model: MergedModel, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const { entry } = model;
  return (
    entry.name.toLowerCase().includes(q) ||
    (entry.description?.toLowerCase().includes(q) ?? false) ||
    (entry.tags?.some((t) => t.toLowerCase().includes(q)) ?? false) ||
    model.id.toLowerCase().includes(q)
  );
}

// ─── Model Card ─────────────────────────────────────────────────────

interface ModelCardProps {
  model: MergedModel;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string, entry: ModelRegistryEntry) => void;
}

const ModelCard = ({ model, selected, disabled, onSelect }: ModelCardProps) => {
  const { id, entry, trainable } = model;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(id, entry)}
      className={cn(
        "w-full rounded-lg bg-white/5 border p-3 text-left transition-all",
        "hover:bg-white/[0.08] cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-primary ring-1 ring-primary/40"
          : "border-white/10",
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-sm text-foreground leading-tight truncate">
          {entry.name}
        </h4>
        <div className="flex shrink-0 items-center gap-1">
          {entry.gpuRequired && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Cpu className="h-3.5 w-3.5 text-orange-400" />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  GPU required
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {trainable ? (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
            >
              Trainable
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 border-white/20 text-muted-foreground bg-white/5"
            >
              Browse Only
            </Badge>
          )}
        </div>
      </div>

      {/* Category breadcrumb */}
      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
        <Badge
          variant="secondary"
          className="text-[10px] px-1.5 py-0 h-4 bg-blue-500/15 text-blue-400 border-0"
        >
          {entry.category}
        </Badge>
        {entry.subcategory && (
          <>
            <span className="text-[10px] text-muted-foreground">›</span>
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-4 bg-violet-500/15 text-violet-400 border-0"
            >
              {entry.subcategory}
            </Badge>
          </>
        )}
      </div>

      {/* Description */}
      {entry.description && (
        <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {entry.description}
        </p>
      )}

      {/* Footer: tags + training time */}
      <div className="mt-2 flex items-center justify-between gap-2">
        {entry.tags && entry.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            {entry.tags.slice(0, 4).map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="text-[9px] px-1 py-0 h-3.5 border-white/10 text-muted-foreground font-normal"
              >
                {tag}
              </Badge>
            ))}
            {entry.tags.length > 4 && (
              <span className="text-[9px] text-muted-foreground">
                +{entry.tags.length - 4}
              </span>
            )}
          </div>
        )}
        {entry.estimatedTrainingTime && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>{entry.estimatedTrainingTime}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Estimated training time
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </button>
  );
};

// ─── Main Component ─────────────────────────────────────────────────

function ModelCatalogPicker({
  selectedModelId,
  onSelectModel,
  disabled = false,
  className,
}: ModelCatalogPickerProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [trainableOnly, setTrainableOnly] = useState(false);

  // ─── Data fetching ─────────────────────────────────────────────
  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: ["training-config"],
    queryFn: fetchTrainingConfig,
    staleTime: 5 * 60_000,
  });

  const { data: catalogData, isLoading: catalogLoading } = useQuery({
    queryKey: ["model-catalog"],
    queryFn: fetchModelCatalog,
    staleTime: 5 * 60_000,
  });

  const { data: taxonomyData } = useQuery({
    queryKey: ["model-catalog-taxonomy"],
    queryFn: fetchTaxonomy,
    staleTime: 10 * 60_000,
  });

  const isLoading = configLoading || catalogLoading;

  // ─── Merge models ──────────────────────────────────────────────
  const allModels = useMemo(
    () => mergeModels(configData?.models, catalogData),
    [configData, catalogData],
  );

  // ─── Category options from taxonomy ────────────────────────────
  const categories = useMemo(() => {
    if (taxonomyData?.taxonomy) {
      return Object.keys(taxonomyData.taxonomy).sort();
    }
    const unique = new Set(allModels.map((m) => m.entry.category));
    return Array.from(unique).sort();
  }, [taxonomyData, allModels]);

  // ─── Filter ────────────────────────────────────────────────────
  const filteredModels = useMemo(() => {
    return allModels.filter((m) => {
      if (!matchesSearch(m, search)) return false;
      if (category !== "all" && m.entry.category !== category) return false;
      if (trainableOnly && !m.trainable) return false;
      return true;
    });
  }, [allModels, search, category, trainableOnly]);

  const handleSelect = useCallback(
    (id: string, entry: ModelRegistryEntry) => {
      if (!disabled) onSelectModel(id, entry);
    },
    [disabled, onSelectModel],
  );

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Filter bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search models…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={disabled}
            className="h-8 pl-8 text-sm bg-white/5 border-white/10"
          />
        </div>

        <Select
          value={category}
          onValueChange={setCategory}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 w-full sm:w-44 text-sm bg-white/5 border-white/10">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex shrink-0 items-center gap-2 cursor-pointer select-none">
          <Switch
            checked={trainableOnly}
            onCheckedChange={setTrainableOnly}
            disabled={disabled}
            className="scale-90"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Trainable only
          </span>
        </label>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
        <span>
          {isLoading
            ? "Loading models…"
            : `${filteredModels.length} model${filteredModels.length !== 1 ? "s" : ""}`}
        </span>
        {!isLoading && trainableOnly && (
          <div className="flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-emerald-400" />
            <span>Trainable filter active</span>
          </div>
        )}
      </div>

      {/* Model grid */}
      <ScrollArea className="h-[420px]">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 pr-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg bg-white/5 border border-white/10 p-3 animate-pulse"
              >
                <div className="h-4 w-2/3 rounded bg-white/10" />
                <div className="mt-2 h-3 w-1/3 rounded bg-white/10" />
                <div className="mt-2 h-3 w-full rounded bg-white/5" />
                <div className="mt-1 h-3 w-4/5 rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            {search || category !== "all" || trainableOnly ? (
              <>
                <BookOpen className="h-8 w-8 opacity-40" />
                <p className="text-sm">No models match your filters</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setCategory("all");
                    setTrainableOnly(false);
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  Clear all filters
                </button>
              </>
            ) : (
              <>
                <PackageOpen className="h-8 w-8 opacity-40" />
                <p className="text-sm">No models available</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 pr-3">
            {filteredModels.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                selected={selectedModelId === model.id}
                disabled={disabled}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

export default ModelCatalogPicker;
