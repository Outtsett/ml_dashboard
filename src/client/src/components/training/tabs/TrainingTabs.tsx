/**
 * TrainingTabs — Model-type-aware tab layout for the Training page.
 *
 * Main tabs rendered depend on the selected model type:
 *   HDP-HMM / 2-state-HMM: Overview | Performance | SHAP | Model State | Convergence
 *   CNN+Transformer:        Overview | Convergence
 *
 * Defaults to "convergence" during live training, "overview" otherwise.
 */

import { Activity, BarChart3, Layers, Grid3X3, TrendingUp } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OverviewTab } from "./OverviewTab";
import { PerformanceTab } from "./PerformanceTab";
import { ShapTab } from "./ShapTab";
import { ModelStateTab } from "./ModelStateTab";
import { ConvergenceTab } from "./ConvergenceTab";
import { getModelTypeConfig } from "@/config/model-types";

// ── All possible main tab definitions ───────────────────────────────────────

const ALL_TRAINING_TABS = [
  { id: "overview",    label: "Overview",    icon: Activity },
  { id: "performance", label: "Performance", icon: BarChart3 },
  { id: "shap",        label: "SHAP",        icon: Layers },
  { id: "model-state", label: "Model State", icon: Grid3X3 },
  { id: "convergence", label: "Convergence", icon: TrendingUp },
] as const;

type MainTabId = typeof ALL_TRAINING_TABS[number]["id"];

// ── Props ───────────────────────────────────────────────────────────────────

export interface TrainingTabsProps {
  /** True when training is actively running */
  isTraining: boolean;
  /** Merged diagnostics (live SSE or saved from disk) */
  diagnostics: Record<string, unknown> | null;
  /** The active model ID (completed or selected) */
  activeModelId: string | null;
  /** Saved convergence data from /api/training/models/:id/convergence */
  convergenceData: unknown[] | null | undefined;
  /** Whether a completed/selected model with diagnostics is active */
  hasCompleted: boolean;
  /** Whether live streaming data exists (activeMetrics.length > 0) */
  hasLiveData: boolean;
  /** Current symbol */
  symbol: string;
  /** Current timeframe */
  timeframe: string;
  /** The currently selected model type (e.g. "hdp-hmm", "cnn-transformer") */
  selectedModelType?: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export function TrainingTabs({
  isTraining,
  diagnostics,
  activeModelId,
  convergenceData,
  hasCompleted,
  hasLiveData,
  symbol,
  timeframe,
  selectedModelType,
}: TrainingTabsProps) {
  // Resolve model type: prefer live diagnostics model_type, then prop
  const modelType = (diagnostics?.model_type as string | undefined) ?? selectedModelType;
  const config = getModelTypeConfig(modelType);
  const allowedMainTabs = new Set<string>(config.mainTabs);

  const visibleTabs = ALL_TRAINING_TABS.filter(t => allowedMainTabs.has(t.id));

  const defaultTab: MainTabId = (isTraining || hasLiveData) ? "convergence" : "overview";
  // If the default tab is filtered out for this model type, fall back to first visible
  const effectiveDefault = visibleTabs.some(t => t.id === defaultTab)
    ? defaultTab
    : (visibleTabs[0]?.id ?? "overview");

  return (
    <Tabs defaultValue={effectiveDefault} className="flex flex-col h-full min-h-0">
      <TabsList className="shrink-0 mx-5 mt-3 bg-white/5 border border-white/5 h-8 gap-0.5 w-fit">
        {visibleTabs.map(tab => {
          const Icon = tab.icon;
          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="text-[11px] font-mono px-2.5 py-1 gap-1.5 data-[state=active]:bg-white/10 data-[state=active]:text-foreground text-muted-foreground/50"
            >
              <Icon className="h-3 w-3" />
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {allowedMainTabs.has("overview") && (
        <TabsContent value="overview" className="flex-1 min-h-0 overflow-y-auto mt-0">
          <OverviewTab diagnostics={diagnostics} activeModelId={activeModelId} />
        </TabsContent>
      )}

      {allowedMainTabs.has("performance") && (
        <TabsContent value="performance" className="flex-1 min-h-0 overflow-y-auto mt-0">
          <PerformanceTab diagnostics={diagnostics} activeModelId={activeModelId} />
        </TabsContent>
      )}

      {allowedMainTabs.has("shap") && (
        <TabsContent value="shap" className="flex-1 min-h-0 overflow-y-auto mt-0">
          <ShapTab diagnostics={diagnostics} activeModelId={activeModelId} />
        </TabsContent>
      )}

      {allowedMainTabs.has("model-state") && (
        <TabsContent value="model-state" className="flex-1 min-h-0 overflow-y-auto mt-0">
          <ModelStateTab diagnostics={diagnostics} activeModelId={activeModelId} />
        </TabsContent>
      )}

      {allowedMainTabs.has("convergence") && (
        <TabsContent value="convergence" className="flex-1 min-h-0 overflow-y-auto mt-0">
          <ConvergenceTab
            convergenceData={convergenceData}
            diagnostics={diagnostics}
            hasCompleted={hasCompleted}
            hasLiveData={hasLiveData}
            symbol={symbol}
            timeframe={timeframe}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}
