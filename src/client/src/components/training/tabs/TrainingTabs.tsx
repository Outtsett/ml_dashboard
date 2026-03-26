/**
 * TrainingTabs — 5-tab layout for the Training page.
 *
 * Tabs: Overview | Performance | SHAP | Model State | Convergence
 *
 * Defaults to "convergence" during live training (where the action is),
 * "overview" otherwise.
 */

import { Activity, BarChart3, Layers, Grid3X3, TrendingUp } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OverviewTab } from "./OverviewTab";
import { PerformanceTab } from "./PerformanceTab";
import { ShapTab } from "./ShapTab";
import { ModelStateTab } from "./ModelStateTab";
import { ConvergenceTab } from "./ConvergenceTab";

// ── Tab definitions ─────────────────────────────────────────────────────────

const TRAINING_TABS = [
  { id: "overview",    label: "Overview",    icon: Activity },
  { id: "performance", label: "Performance", icon: BarChart3 },
  { id: "shap",        label: "SHAP",        icon: Layers },
  { id: "model-state", label: "Model State", icon: Grid3X3 },
  { id: "convergence", label: "Convergence", icon: TrendingUp },
] as const;

// ── Props ───────────────────────────────────────────────────────────────────

export interface TrainingTabsProps {
  /** True when training is actively running */
  isTraining: boolean;
  /** Merged diagnostics (live SSE or saved from disk) */
  diagnostics: Record<string, any> | null;
  /** The active model ID (completed or selected) */
  activeModelId: string | null;
  /** Saved convergence data from /api/training/models/:id/convergence */
  convergenceData: any[] | null | undefined;
  /** Whether a completed/selected model with diagnostics is active */
  hasCompleted: boolean;
  /** Whether live streaming data exists (activeMetrics.length > 0) */
  hasLiveData: boolean;
  /** Current symbol */
  symbol: string;
  /** Current timeframe */
  timeframe: string;
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
}: TrainingTabsProps) {
  const defaultTab = (isTraining || hasLiveData) ? "convergence" : "overview";

  return (
    <Tabs defaultValue={defaultTab} className="flex flex-col h-full min-h-0">
      <TabsList className="shrink-0 mx-5 mt-3 bg-white/5 border border-white/5 h-8 gap-0.5 w-fit">
        {TRAINING_TABS.map(tab => {
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

      <TabsContent value="overview" className="flex-1 min-h-0 overflow-y-auto mt-0">
        <OverviewTab diagnostics={diagnostics} activeModelId={activeModelId} />
      </TabsContent>

      <TabsContent value="performance" className="flex-1 min-h-0 overflow-y-auto mt-0">
        <PerformanceTab diagnostics={diagnostics} activeModelId={activeModelId} />
      </TabsContent>

      <TabsContent value="shap" className="flex-1 min-h-0 overflow-y-auto mt-0">
        <ShapTab diagnostics={diagnostics} activeModelId={activeModelId} />
      </TabsContent>

      <TabsContent value="model-state" className="flex-1 min-h-0 overflow-y-auto mt-0">
        <ModelStateTab diagnostics={diagnostics} activeModelId={activeModelId} />
      </TabsContent>

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
    </Tabs>
  );
}
