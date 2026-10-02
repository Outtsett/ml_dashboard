import React, { useMemo, useCallback } from "react";
import { CheckSquare, XSquare } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shared/ui/accordion";
import type {
  SearchDimension,
  SearchSpaceDef,
  DistributionType,
} from "@shared/hpoTypes";
import type { HyperparameterDef } from "@shared/trainingTypes";
import { SearchDimensionItem } from "./SearchDimensionItem";

/** Derive a search dimension from a HyperparameterDef. */
export function dimFromHpDef(hp: HyperparameterDef): SearchDimension {
  const dimType = hp.type ?? ((hp.step ?? 1) >= 1 ? "int" : "float");

  if (dimType === "categorical") {
    return {
      type: "categorical",
      choices: hp.choices ?? [],
      distribution: "choice",
      default: hp.default,
    };
  }
  if (dimType === "bool") {
    return { type: "bool", choices: [true, false], default: hp.default };
  }

  return {
    type: dimType as "int" | "float",
    low: hp.searchSpace?.min ?? hp.min ?? 0,
    high: hp.searchSpace?.max ?? hp.max ?? 100,
    step: hp.searchSpace?.step ?? hp.step ?? 1,
    logScale: hp.searchSpace?.logScale ?? hp.logScale ?? false,
    distribution:
      (hp.searchSpace?.distribution as DistributionType) ?? "uniform",
    default: hp.default,
  };
}

/** Group hyperparameters by their `group` field. */
export function groupParams(
  params: Record<string, HyperparameterDef>,
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const [key, def] of Object.entries(params)) {
    const g = def.group ?? "General";
    (groups[g] ??= []).push(key);
  }
  return groups;
}

interface SearchSpaceEditorProps {
  searchSpace: SearchSpaceDef;
  onSearchSpaceChange: (space: SearchSpaceDef) => void;
  hyperparameters: Record<string, HyperparameterDef>;
  evals: number;
  disabled?: boolean;
}

export function SearchSpaceEditor({
  searchSpace,
  onSearchSpaceChange,
  hyperparameters,
  evals,
  disabled,
}: SearchSpaceEditorProps) {
  const defaultDimensions = useMemo(() => {
    const dims: Record<string, SearchDimension> = {};
    for (const [key, hp] of Object.entries(hyperparameters)) {
      dims[key] = dimFromHpDef(hp);
    }
    return dims;
  }, [hyperparameters]);

  const includedCount = Object.keys(searchSpace).length;
  const totalParams = Object.keys(hyperparameters).length;
  const grouped = useMemo(() => groupParams(hyperparameters), [hyperparameters]);

  const toggleParam = useCallback(
    (key: string, on: boolean) => {
      const next = { ...searchSpace };
      if (on) {
        next[key] = searchSpace[key] ?? defaultDimensions[key]!;
      } else {
        delete next[key];
      }
      onSearchSpaceChange(next);
    },
    [searchSpace, defaultDimensions, onSearchSpaceChange],
  );

  const updateDimension = useCallback(
    (key: string, dim: SearchDimension) => {
      onSearchSpaceChange({ ...searchSpace, [key]: dim });
    },
    [searchSpace, onSearchSpaceChange],
  );

  const selectAll = useCallback(() => {
    const next: SearchSpaceDef = {};
    for (const key of Object.keys(hyperparameters)) {
      next[key] = searchSpace[key] ?? defaultDimensions[key]!;
    }
    onSearchSpaceChange(next);
  }, [hyperparameters, searchSpace, defaultDimensions, onSearchSpaceChange]);

  const deselectAll = useCallback(() => {
    onSearchSpaceChange({});
  }, [onSearchSpaceChange]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={selectAll}
            disabled={disabled}
            className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
          >
            <CheckSquare className="h-3 w-3 mr-1" />
            Select All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={deselectAll}
            disabled={disabled}
            className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
          >
            <XSquare className="h-3 w-3 mr-1" />
            Deselect All
          </Button>
        </div>
        <Badge
          variant="outline"
          className="text-[9px] px-1.5 py-0 font-mono"
        >
          {includedCount}/{totalParams} params &middot; ~
          {(includedCount * evals).toLocaleString()} evals
        </Badge>
      </div>

      {/* Grouped param list */}
      {Object.keys(grouped).length > 1 ? (
        <Accordion
          type="multiple"
          defaultValue={Object.keys(grouped)}
          className="space-y-1"
        >
          {Object.entries(grouped).map(([group, keys]) => (
            <AccordionItem
              key={group}
              value={group}
              className="border-white/6 rounded-lg overflow-hidden"
            >
              <AccordionTrigger className="text-[10px] uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground px-2 py-1.5 hover:no-underline">
                {group}
                <Badge
                  variant="secondary"
                  className="ml-auto mr-2 text-[8px] px-1 py-0 h-3.5 bg-white/5 border-0"
                >
                  {keys.filter((k) => k in searchSpace).length}/{keys.length}
                </Badge>
              </AccordionTrigger>
              <AccordionContent className="px-1 pb-1 space-y-1">
                {keys.map((key) => (
                  <SearchDimensionItem
                    key={key}
                    paramKey={key}
                    hp={hyperparameters[key]!}
                    dimension={searchSpace[key] ?? defaultDimensions[key]!}
                    included={key in searchSpace}
                    onToggle={toggleParam}
                    onDimensionChange={updateDimension}
                    disabled={disabled}
                  />
                ))}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <div className="space-y-1">
          {Object.keys(hyperparameters).map((key) => (
            <SearchDimensionItem
              key={key}
              paramKey={key}
              hp={hyperparameters[key]!}
              dimension={searchSpace[key] ?? defaultDimensions[key]!}
              included={key in searchSpace}
              onToggle={toggleParam}
              onDimensionChange={updateDimension}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      {totalParams === 0 && (
        <div className="text-center py-6 text-xs text-muted-foreground/40 italic">
          No hyperparameters defined for this model
        </div>
      )}
    </div>
  );
}
