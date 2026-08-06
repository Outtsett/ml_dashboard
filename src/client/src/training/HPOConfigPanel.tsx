/**
 * HPOConfigPanel — Hyperparameter Optimization configuration UI.
 *
 * Two sections:
 *  A) Optimizer picker + per-optimizer config form
 *  B) Search-space editor (toggle params in/out, edit ranges)
 */

import React from "react";
import {
  ToggleLeft,
  Search,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui/tabs";
import { TooltipProvider } from "@/shared/ui/tooltip";
import type {
  OptimizerType,
  SearchSpaceDef,
} from "@shared/hpoTypes";
import type { HyperparameterDef } from "@shared/trainingTypes";
import { cn } from "@/shared/utils/utils";

import { OPTIMIZER_FORMS } from "./hpo-config/OptimizerConfigFields";
import { OptimizerSelector, OPTIMIZER_META } from "./hpo-config/OptimizerSelector";
import { SearchSpaceEditor } from "./hpo-config/SearchSpaceEditor";

// ─── Props ──────────────────────────────────────────────────────────────────

export interface HPOConfigPanelProps {
  optimizerType: OptimizerType;
  onOptimizerTypeChange: (type: OptimizerType) => void;
  optimizerConfig: Record<string, unknown>;
  onOptimizerConfigChange: (config: Record<string, unknown>) => void;
  searchSpace: SearchSpaceDef;
  onSearchSpaceChange: (space: SearchSpaceDef) => void;
  /** Source schema from the model — used to build default search dimensions. */
  hyperparameters: Record<string, HyperparameterDef>;
  disabled?: boolean;
  className?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Estimate total evaluations from search config. */
function estimateEvaluations(
  optimizer: OptimizerType,
  config: Record<string, unknown>,
): number {
  switch (optimizer) {
    case "optuna":
      return (config.nTrials as number) ?? 50;
    case "bayesian":
      return (config.nCalls as number) ?? 50;
    case "pso":
      return ((config.nParticles as number) ?? 30) * ((config.nIterations as number) ?? 100);
    case "montecarlo":
      return (config.nSamples as number) ?? 100;
    case "evolutionary":
      return (config.budget as number) ?? 100;
    case "bohb":
      return (config.nTrials as number) ?? 50;
    default:
      return 50;
  }
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function HPOConfigPanel({
  optimizerType,
  onOptimizerTypeChange,
  optimizerConfig,
  onOptimizerConfigChange,
  searchSpace,
  onSearchSpaceChange,
  hyperparameters,
  disabled = false,
  className,
}: HPOConfigPanelProps) {
  const includedCount = Object.keys(searchSpace).length;
  const evals = estimateEvaluations(optimizerType, optimizerConfig);

  const OptimizerForm = OPTIMIZER_FORMS[optimizerType];
  const meta = OPTIMIZER_META[optimizerType];

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("space-y-4", className)}>
        <Tabs defaultValue="optimizer" className="w-full">
          <TabsList className="w-full justify-start bg-transparent border-b border-white/5 rounded-none h-auto p-0 gap-0">
            <TabsTrigger
              value="optimizer"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-orange-500
                         data-[state=active]:bg-transparent data-[state=active]:text-orange-400
                         text-muted-foreground/60 text-xs px-3 py-2 transition-colors"
            >
              <ToggleLeft className="h-3 w-3 mr-1.5" />
              Optimizer
            </TabsTrigger>
            <TabsTrigger
              value="search-space"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-orange-500
                         data-[state=active]:bg-transparent data-[state=active]:text-orange-400
                         text-muted-foreground/60 text-xs px-3 py-2 transition-colors"
            >
              <Search className="h-3 w-3 mr-1.5" />
              Search Space
              {includedCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 text-[9px] px-1 py-0 h-4 bg-orange-500/20 text-orange-300 border-0"
                >
                  {includedCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Tab A: Optimizer selection + config ── */}
          <TabsContent value="optimizer" className="mt-3 space-y-3">
            <OptimizerSelector
              optimizerType={optimizerType}
              onOptimizerTypeChange={onOptimizerTypeChange}
              disabled={disabled}
            />

            {/* Active optimizer description badge */}
            <div className="flex items-center gap-2 px-1">
              {(() => {
                const Icon = meta.icon;
                return <Icon className={cn("h-4 w-4 shrink-0", meta.color)} />;
              })()}
              <span className="text-[10px] text-muted-foreground/60">
                {meta.description}
              </span>
            </div>

            {/* Per-optimizer config */}
            <div className="p-3 rounded-lg border border-white/6 bg-white/[0.02]">
              <OptimizerForm
                config={optimizerConfig}
                onChange={onOptimizerConfigChange}
                disabled={disabled}
              />
            </div>

            {/* Evaluation estimate */}
            <div className="flex items-center justify-between px-1 py-1.5 rounded-md bg-white/[0.03]">
              <span className="text-[10px] text-muted-foreground/50">
                Est. evaluations
              </span>
              <span className="text-xs font-mono text-orange-400">
                ~{evals.toLocaleString()}
              </span>
            </div>
          </TabsContent>

          {/* ── Tab B: Search Space Editor ── */}
          <TabsContent value="search-space" className="mt-3 space-y-3">
            <SearchSpaceEditor
              searchSpace={searchSpace}
              onSearchSpaceChange={onSearchSpaceChange}
              hyperparameters={hyperparameters}
              evals={evals}
              disabled={disabled}
            />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
