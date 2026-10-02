/**
 * ArchitectureComposer — Stage 4 hyperparameter form for atomic models.
 *
 * Per the W4 frontend sub-plan §1: this component renders one HP input per
 * `defaultHyperparameters` entry on the selected catalog/registry record and
 * dispatches `setHyperparameters` on every change. It also exposes a
 * "Generate code" button that POSTs to `/api/training/generate-code` and
 * dispatches `setGeneratedPreview` with the response.
 *
 * Composite/MoE/multimodal sub-pickers are scoped to W5 — this component is
 * atomic-only. When `state.compositionConfig?.kind` is something other than
 * "atomic" we render a small banner directing the user back to the catalog.
 *
 * Hyperparameter widgets are picked from the `HyperparameterDef.type`:
 *   int / float        → <Input type="number" min/max/step/>
 *   bool               → <Switch />
 *   categorical        → <Select> over `choices`
 *
 * Conditional params (`conditionalOn`) are skipped when the gating param's
 * current value doesn't match. Defaults are seeded into
 * `state.hyperparameters` only on the first render after model selection
 * (mirrors the legacy Training.tsx behaviour) so the user keeps any edits
 * they've already made.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";
import { apiRequest } from "@/infrastructure/api/query_client";
import { toast } from "sonner";
import { useTrainableCatalog } from "@/ml/lib/useModelCatalog";
import {
  useMLStudio,
  type GeneratedPreview,
  type GeneratedFile,
  type GeneratedFileLanguage,
} from "../../MLStudioContext";
import type { HyperparameterDef, ModelRegistryEntry } from "@shared/trainingTypes";

// ─── Codegen response → GeneratedPreview ─────────────────────────────────────

interface GenerateCodeResponse {
  files: Record<string, string>;
  templateUsed: string;
  warnings: string[];
  hash: string;
}

function languageForPath(path: string): GeneratedFileLanguage {
  return path.toLowerCase().endsWith(".json") ? "json" : "python";
}

function toGeneratedPreview(
  res: GenerateCodeResponse,
  templateVersion: string,
): GeneratedPreview {
  const files: GeneratedFile[] = Object.entries(res.files).map(([path, content]) => ({
    path,
    content,
    language: languageForPath(path),
  }));
  return {
    files,
    templateId: res.templateUsed,
    templateVersion,
    hash: res.hash,
    warnings: res.warnings ?? [],
    generatedAt: new Date().toISOString(),
    dirty: false,
  };
}

// ─── Conditional param helper ────────────────────────────────────────────────

function isConditionMet(
  def: HyperparameterDef,
  values: Record<string, number | string | boolean>,
): boolean {
  if (!def.conditionalOn) return true;
  const cur = values[def.conditionalOn.param];
  return cur === def.conditionalOn.value;
}

// ─── Hyperparameter input widgets ────────────────────────────────────────────

interface HpFieldProps {
  paramKey: string;
  def: HyperparameterDef;
  value: number | string | boolean;
  onChange: (next: number | string | boolean) => void;
  disabled?: boolean;
}

function HpField({ paramKey, def, value, onChange, disabled }: HpFieldProps) {
  const labelId = `hp-${paramKey}`;
  const description = def.description;

  let control: ReactElement;
  if (def.type === "bool") {
    control = (
      <Switch
        id={labelId}
        checked={Boolean(value)}
        onCheckedChange={(checked) => onChange(checked)}
        disabled={disabled}
      />
    );
  } else if (def.type === "categorical") {
    const choices = def.choices ?? [];
    const stringValue = String(value);
    control = (
      <Select
        value={stringValue}
        onValueChange={(next) => {
          // Recover the original primitive type from def.choices
          const match = choices.find((c) => String(c) === next);
          onChange(match ?? next);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={labelId} className="h-8 text-sm bg-white/5 border-white/10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={String(c)} value={String(c)}>
              {String(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else {
    // int / float
    control = (
      <Input
        id={labelId}
        type="number"
        value={typeof value === "number" ? value : Number(value)}
        min={def.min}
        max={def.max}
        step={def.step ?? (def.type === "int" ? 1 : 0.01)}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return;
          const parsed = def.type === "int" ? parseInt(raw, 10) : parseFloat(raw);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
        className="h-8 text-sm bg-white/5 border-white/10"
      />
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={labelId}
        className="text-xs font-medium text-foreground flex items-center gap-1.5"
      >
        <span>{def.label}</span>
        {description && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="text-[10px] uppercase text-muted-foreground/70 border border-white/10 rounded px-1 cursor-help"
                  aria-label="Help"
                >
                  ?
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {description}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </label>
      {control}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ArchitectureComposer() {
  const { state, dispatch } = useMLStudio();
  const { data: catalog, isLoading } = useTrainableCatalog();

  const entry: ModelRegistryEntry | null = useMemo(() => {
    if (!state.modelType || !catalog) return null;
    return catalog[state.modelType] ?? null;
  }, [catalog, state.modelType]);

  // Seed defaults the first time a (modelType, hyperparameters-empty) pair is
  // observed. Skip when the user has already populated values for this model.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  useEffect(() => {
    if (!entry || !state.modelType) return;
    if (seededFor === state.modelType) return;
    if (Object.keys(state.hyperparameters).length > 0) {
      setSeededFor(state.modelType);
      return;
    }
    const defaults: Record<string, number | string | boolean> = {};
    for (const [key, def] of Object.entries(entry.defaultHyperparameters)) {
      defaults[key] = def.default;
    }
    dispatch({ type: "setHyperparameters", hyperparameters: defaults });
    setSeededFor(state.modelType);
  }, [entry, state.modelType, state.hyperparameters, seededFor, dispatch]);

  // Group defs for ordered rendering.
  const groupedFields = useMemo(() => {
    if (!entry) return [] as Array<{ group: string; defs: Array<[string, HyperparameterDef]> }>;
    const groups = new Map<string, Array<[string, HyperparameterDef]>>();
    for (const [key, def] of Object.entries(entry.defaultHyperparameters)) {
      const g = def.group ?? "General";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push([key, def]);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, defs]) => ({ group, defs }));
  }, [entry]);

  const generateMut = useMutation<GenerateCodeResponse, Error, void>({
    mutationFn: async () => {
      if (!entry || !state.modelType) {
        throw new Error("Pick a model from the catalog first");
      }
      const featurePipeline = entry.featurePipeline ?? state.featurePipelineId ?? "ohlcv_basic";
      const body = {
        catalogId: state.modelType,
        hyperparameters: state.hyperparameters,
        walkForward: state.walkForward
          ? {
              trainMonths: state.walkForward.trainMonths,
              testMonths: state.walkForward.testMonths,
              stepMonths: state.walkForward.stepMonths ?? state.walkForward.testMonths,
              purgeBars: state.walkForward.purgeBars ?? 0,
            }
          : null,
        labelStrategy: state.labelStrategy,
        labelParams: state.labelParams,
        featurePipeline,
        featureCategories: state.featureCategories,
        symbol: state.symbol,
        timeframe: state.timeframe,
      };
      const res = await apiRequest("POST", "/api/training/generate-code", body);
      return (await res.json()) as GenerateCodeResponse;
    },
    onSuccess: (res) => {
      const preview = toGeneratedPreview(res, "1.0.0");
      dispatch({ type: "setGeneratedPreview", preview });
      toast.success(
        preview.warnings.length > 0
          ? `Code generated with ${preview.warnings.length} warning(s)`
          : "Code generated",
      );
    },
    onError: (err) => {
      toast.error(`Generate failed: ${err.message}`);
    },
  });

  const compositionKind = state.compositionConfig?.kind ?? "atomic";
  const isAtomic = compositionKind === "atomic";

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Architecture composer
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {entry
              ? `${entry.name} — atomic hyperparameters`
              : "Pick a model above to configure its hyperparameters."}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => generateMut.mutate()}
          disabled={!entry || generateMut.isPending || !isAtomic}
          data-testid="composer-generate"
        >
          {generateMut.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Generate code
            </>
          )}
        </Button>
      </header>

      {!isAtomic && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          Composite mode <code className="font-mono">{compositionKind}</code> is wired up
          in W5. For now, switch back to an atomic catalog entry to edit
          hyperparameters here.
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-muted-foreground">Loading catalog…</div>
      )}

      {entry && isAtomic && groupedFields.length === 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground">
          This model has no exposed hyperparameters. Click <span className="text-foreground">Generate code</span> to render its template directly.
        </div>
      )}

      {entry && isAtomic && groupedFields.length > 0 && (
        <div className="space-y-5">
          {groupedFields.map(({ group, defs }) => (
            <div key={group} className="space-y-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70 font-medium">
                {group}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {defs.map(([key, def]) => {
                  if (!isConditionMet(def, state.hyperparameters)) return null;
                  const value = state.hyperparameters[key] ?? def.default;
                  return (
                    <HpField
                      key={key}
                      paramKey={key}
                      def={def}
                      value={value}
                      disabled={generateMut.isPending}
                      onChange={(next) =>
                        dispatch({
                          type: "setHyperparameters",
                          hyperparameters: {
                            ...state.hyperparameters,
                            [key]: next,
                          },
                        })
                      }
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
