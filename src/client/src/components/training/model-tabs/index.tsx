/**
 * ModelTabs — Each trained model gets its own tab with metric sub-tabs.
 *
 * Layout:
 *   ┌─ MNQ_30m ─┬─ ES_30m ─┬─ NQ_1H ─┐   ← model tabs (one per trained model)
 *   │ Overview │ Regimes │ Convergence │ WF │ OOS │ Fit │ Log │  ← sub-tabs
 *   │ [content for selected sub-tab]                      │
 *   └────────────────────────────────────────────────────────┘
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Layers, Trash2 } from "lucide-react";
import type { RegimeModel, ConvergencePoint } from "../types";
import { getQualityColor } from "../types";
import { SUB_TABS, type SubTabId, useModelDiagnostics, getVisibleSubTabs } from "./constants";
import { OverviewPanel } from "./OverviewPanel";
import { RegimesPanel } from "./RegimesPanel";
import { ConvergencePanel } from "./ConvergencePanel";
import { WalkForwardPanel } from "./WalkForwardPanel";
import { OOSPanel } from "./OOSPanel";
import { FitPanel } from "./FitPanel";
import { TrainingLogTab } from "@/components/terminal/TrainingLogTab";
import AnalyticsPanel from "../analytics";
import { ModelComparisonView } from "../metrics";

// ─── Main ModelTabs Component ────────────────────────────────────────────────

interface ModelTabsProps {
  models: RegimeModel[];
  selectedModel: string | null;
  setSelectedModel: (id: string | null) => void;
  deleteModel: (id: string) => void;
}

export default function ModelTabs({ models, selectedModel, setSelectedModel, deleteModel }: ModelTabsProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTabId>("overview");

  const sortedModels = [...models].sort((a, b) =>
    new Date(b.trained_at).getTime() - new Date(a.trained_at).getTime()
  );

  const activeModelId = selectedModel || sortedModels[0]?.id || "";
  const hasModels = models.length > 0;

  return (
    <Card className="glass rounded-2xl gradient-border overflow-hidden h-full flex flex-col min-h-0">
      {/* ── Model Tabs (top row) ── */}
      {hasModels ? (
        <Tabs value={activeModelId} onValueChange={(id) => setSelectedModel(id)} className="flex flex-col min-h-0 flex-1">
          <div className="border-b border-white/5 bg-white/2 shrink-0">
            <div className="flex items-center px-2 overflow-x-auto scrollbar-none">
              <TabsList className="bg-transparent h-auto p-0 gap-0">
                {sortedModels.map((model) => {
                  const isActive = model.id === activeModelId;
                  const qColor = getQualityColor(model.quality_score ?? 0);
                  return (
                    <TabsTrigger
                      key={model.id}
                      value={model.id}
                      className={`
                        relative rounded-none border-b-2 px-4 py-2.5 text-xs font-medium
                        transition-all data-[state=active]:shadow-none
                        ${isActive
                          ? "border-primary text-foreground bg-white/4"
                          : "border-transparent text-muted-foreground hover:text-foreground/70 hover:bg-white/2"
                        }
                      `}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{model.symbol}</span>
                        <span className="text-[10px] text-muted-foreground/60">{model.timeframe}</span>
                        <span className={`text-[10px] font-bold font-mono ${qColor}`}>
                          {model.quality_score !== undefined ? model.quality_score.toFixed(0) : "--"}
                        </span>
                        <span className="text-[9px] text-orange-400/70 font-mono">{model.n_regimes}R</span>
                      </div>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </div>

          {/* ── Per-model content ── */}
          {sortedModels.map((model) => (
            <TabsContent key={model.id} value={model.id} className="mt-0 flex-1 min-h-0">
              <ModelPanel
                model={model}
                models={sortedModels}
                activeSubTab={activeSubTab}
                setActiveSubTab={setActiveSubTab}
                deleteModel={deleteModel}
              />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        /* ── No models: show sub-tab bar + empty/log content ── */
        <EmptyModelPanel activeSubTab={activeSubTab} setActiveSubTab={setActiveSubTab} />
      )}
    </Card>
  );
}

// ─── EmptyModelPanel: sub-tabs visible even with no trained models ───────────

function EmptyModelPanel({
  activeSubTab, setActiveSubTab,
}: {
  activeSubTab: SubTabId;
  setActiveSubTab: (tab: SubTabId) => void;
}) {
  // Show all sub-tabs (no diagnostics to filter by)
  const visibleTabs = SUB_TABS;
  const effectiveSubTab = visibleTabs.some(t => t.id === activeSubTab) ? activeSubTab : "overview";

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* ── Sub-tab bar (same structure as ModelPanel) ── */}
      <div className="border-b border-white/5 px-3 flex items-center gap-1 overflow-x-auto scrollbar-none shrink-0">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = effectiveSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`
                flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2
                transition-all whitespace-nowrap
                ${isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground/60 hover:text-muted-foreground"
                }
              `}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Content: Training Log works, other tabs show empty state ── */}
      {effectiveSubTab === "log" ? (
        <div className="flex-1 min-h-0">
          <TrainingLogTab visible />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-muted-foreground">
          <Layers className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-sm font-medium">No Trained Models</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Train a model to see its metrics here</p>
        </div>
      )}
    </div>
  );
}

// ─── ModelPanel: sub-tabs for one model ──────────────────────────────────────

function ModelPanel({
  model, models, activeSubTab, setActiveSubTab, deleteModel,
}: {
  model: RegimeModel;
  models: RegimeModel[];
  activeSubTab: SubTabId;
  setActiveSubTab: (tab: SubTabId) => void;
  deleteModel: (id: string) => void;
}) {
  const { diagnostics, convergenceData } = useModelDiagnostics(model.id);

  const convergencePoints: ConvergencePoint[] = convergenceData?.gibbs || [];
  const nBarsForLL = diagnostics?.n_bars_total || 1;
  const ll = diagnostics?.convergence_summary?.final_log_likelihood ?? 0;
  const llPerBar = ll !== 0 ? ll / nBarsForLL : 0;
  const wfWindResults = diagnostics?.walk_forward?.window_results || [];
  const oos = diagnostics?.out_of_sample;
  const stability = diagnostics?.walk_forward?.stability_score ?? 0;
  const oosSimilarity = oos?.distribution_similarity ?? 0;
  const profileCorrelation = oos?.avg_profile_correlation ?? 0;
  const quality = diagnostics?.quality_score ?? 0;

  // Filter sub-tabs by model type config AND available diagnostics keys
  const visibleTabs = getVisibleSubTabs(diagnostics, model.modelType);
  // Auto-reset to "overview" if current tab is no longer visible
  const effectiveSubTab = visibleTabs.some(t => t.id === activeSubTab) ? activeSubTab : "overview";

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* ── Sub-tab bar ── */}
      <div className="border-b border-white/5 px-3 flex items-center gap-1 overflow-x-auto scrollbar-none shrink-0">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = effectiveSubTab === tab.id;
          // Show badge values on sub-tab triggers
          let badge: string | null = null;
          if (tab.id === "regimes" && diagnostics) badge = `${diagnostics.n_regimes}`;
          if (tab.id === "walkforward" && stability > 0) badge = `${(stability * 100).toFixed(0)}%`;
          if (tab.id === "oos" && oosSimilarity > 0) badge = `${(oosSimilarity * 100).toFixed(0)}%`;
          if (tab.id === "fit" && llPerBar !== 0) badge = llPerBar.toFixed(1);
          if (tab.id === "overview" && quality > 0) badge = quality.toFixed(0);

          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`
                flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2
                transition-all whitespace-nowrap
                ${isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground/60 hover:text-muted-foreground"
                }
              `}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
              {badge && (
                <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                  isActive ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground/50"
                }`}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}

        {/* Delete with confirmation */}
        <div className="ml-auto pl-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground/40 hover:text-rose-400"
                title="Delete this model"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {model.symbol} {model.timeframe}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the model files and QuestDB regime data.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-rose-600 hover:bg-rose-700 text-white"
                  onClick={() => deleteModel(model.id)}
                >
                  Delete Model
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* ── Sub-tab content (ONLY scrollable area on page) ── */}
      {effectiveSubTab === "log" ? (
        <div className="flex-1 min-h-0">
          <TrainingLogTab visible />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {!diagnostics ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <div className="flex gap-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-16 w-28 rounded-xl bg-white/3 animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
              <span className="text-xs text-muted-foreground/40 font-mono">Loading diagnostics</span>
            </div>
          ) : (
            <>
              {effectiveSubTab === "overview" && <OverviewPanel diagnostics={diagnostics} model={model} llPerBar={llPerBar} convergencePoints={convergencePoints} />}
              {effectiveSubTab === "regimes" && <RegimesPanel diagnostics={diagnostics} />}
              {effectiveSubTab === "convergence" && <ConvergencePanel diagnostics={diagnostics} convergencePoints={convergencePoints} nBarsForLL={nBarsForLL} llPerBar={llPerBar} />}
              {effectiveSubTab === "walkforward" && <WalkForwardPanel diagnostics={diagnostics} wfWindResults={wfWindResults} stability={stability} />}
              {effectiveSubTab === "oos" && <OOSPanel diagnostics={diagnostics} oos={oos} oosSimilarity={oosSimilarity} profileCorrelation={profileCorrelation} />}
              {effectiveSubTab === "fit" && <FitPanel diagnostics={diagnostics} convergencePoints={convergencePoints} nBarsForLL={nBarsForLL} llPerBar={llPerBar} ll={ll} />}
              {effectiveSubTab === "compare" && (
                <ModelComparisonView
                  models={models}
                  modelCategory="unsupervised"
                  modelSubcategory="clustering"
                />
              )}
              {effectiveSubTab === "analytics" && (
                <AnalyticsPanel
                  diagnostics={diagnostics}
                  modelId={model.id}
                  subcategory="clustering"
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
