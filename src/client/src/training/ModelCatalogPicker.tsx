import { useMemo, useState, useCallback } from "react";
import {
  Search,
  Cpu,
  Clock,
  Sparkles,
  BookOpen,
  PackageOpen,
} from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { useCatalogTaxonomy, useTrainableCatalog } from "@/ml/lib/useModelCatalog";
import type { TrainableModel, RunnerSource } from "@shared/trainableModelTypes";
import type { ModelRegistryEntry } from "@shared/trainingTypes";

// ─── Props ───────────────────────────────────────────────────────────

export interface ModelCatalogPickerProps {
  selectedModelId: string | null;
  onSelectModel: (modelId: string, model: ModelRegistryEntry) => void;
  disabled?: boolean;
  className?: string;
}

// ─── Filter logic ───────────────────────────────────────────────────

interface PickerEntry {
  id: string;
  entry: TrainableModel;
}

function matchesSearch(entry: PickerEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const m = entry.entry;
  return (
    m.name.toLowerCase().includes(q) ||
    (m.description?.toLowerCase().includes(q) ?? false) ||
    (m.tags?.some((t) => t.toLowerCase().includes(q)) ?? false) ||
    entry.id.toLowerCase().includes(q)
  );
}

// ─── Runner-source badge ────────────────────────────────────────────
//
// 3-state taxonomy (see W2.d in
// `docs/plans/2026-05-09-ml-studio-workshop-integration-frontend.md`):
//   - WIRED              — `runnerSource === 'wired'`        — emerald
//   - GENERATE-<family>  — `runnerSource === 'generate'`     — amber
//                          where family = templateId.split('_')[0]
//                          (e.g. `pytorch_mlp` → `GENERATE-pytorch`,
//                          `tree` → `GENERATE-tree`,
//                          `composite_moe` → `GENERATE-composite`)
//   - BROWSE-ONLY        — `runnerSource === 'browse-only'`  — muted gray

function familyFromTemplate(templateId: string | null | undefined): string {
  if (!templateId) return "generate";
  const head = templateId.split("_")[0];
  return head || "generate";
}

interface RunnerBadgeProps {
  runnerSource: RunnerSource;
  templateId: string | null | undefined;
}

function RunnerBadge({ runnerSource, templateId }: RunnerBadgeProps) {
  if (runnerSource === "wired") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] px-1.5 py-0 h-4 border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
      >
        WIRED
      </Badge>
    );
  }
  if (runnerSource === "generate") {
    const family = familyFromTemplate(templateId);
    return (
      <Badge
        variant="outline"
        className="text-[10px] px-1.5 py-0 h-4 border-amber-500/40 text-amber-400 bg-amber-500/10 uppercase"
      >
        GENERATE-{family}
      </Badge>
    );
  }
  // browse-only
  return (
    <Badge
      variant="outline"
      className="text-[10px] px-1.5 py-0 h-4 border-white/20 text-muted-foreground bg-white/5"
    >
      BROWSE-ONLY
    </Badge>
  );
}

// ─── Model Card ─────────────────────────────────────────────────────

interface ModelCardProps {
  id: string;
  entry: TrainableModel;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string, entry: ModelRegistryEntry) => void;
}

const ModelCard = ({ id, entry, selected, disabled, onSelect }: ModelCardProps) => {
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
          <RunnerBadge
            runnerSource={entry.runnerSource}
            templateId={entry.templateId}
          />
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
  // Single round-trip. The server (`getTrainableModels()` in
  // `src/server/lib/catalogBridge.ts`) merges hand-configured registry
  // entries with auto-scanned catalog specs, classifies each via
  // `runnerSource`, and returns the unified record. No client-side merge.
  const {
    data: trainableData,
    isLoading: trainableLoading,
    isError: trainableError,
  } = useTrainableCatalog();

  const { data: taxonomyData } = useCatalogTaxonomy();

  const isLoading = trainableLoading;

  // ─── Materialize entries ───────────────────────────────────────
  const allEntries = useMemo<PickerEntry[]>(() => {
    if (!trainableData) return [];
    return Object.entries(trainableData).map(([id, entry]) => ({ id, entry }));
  }, [trainableData]);

  // ─── Category options from taxonomy ────────────────────────────
  const categories = useMemo(() => {
    if (taxonomyData?.taxonomy) {
      return Object.keys(taxonomyData.taxonomy).sort();
    }
    const unique = new Set(allEntries.map((m) => m.entry.category));
    return Array.from(unique).sort();
  }, [taxonomyData, allEntries]);

  // ─── Filter ────────────────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    return allEntries.filter((m) => {
      if (!matchesSearch(m, search)) return false;
      if (category !== "all" && m.entry.category !== category) return false;
      // "Trainable only" hides BROWSE-ONLY but keeps both WIRED and GENERATE-*.
      if (trainableOnly && m.entry.runnerSource === "browse-only") return false;
      return true;
    });
  }, [allEntries, search, category, trainableOnly]);

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
            : trainableError
              ? "Failed to load model catalog"
              : `${filteredEntries.length} model${filteredEntries.length !== 1 ? "s" : ""}`}
        </span>
        {!isLoading && !trainableError && trainableOnly && (
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
        ) : trainableError ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <PackageOpen className="h-8 w-8 opacity-40" />
            <p className="text-sm">Failed to load model catalog</p>
            <p className="text-xs opacity-70">
              <code className="font-mono">/api/model-catalog/trainable</code> is unavailable
            </p>
          </div>
        ) : filteredEntries.length === 0 ? (
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
            {filteredEntries.map(({ id, entry }) => (
              <ModelCard
                key={id}
                id={id}
                entry={entry}
                selected={selectedModelId === id}
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
