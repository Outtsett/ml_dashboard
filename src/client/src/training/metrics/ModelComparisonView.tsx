/**
 * ModelComparisonView — Full comparison page composing selector, universal strip,
 * category sub-tabs, and category metrics panel.
 *
 * Think of it as: the master dashboard screen. Top = model light switches.
 * Middle = always-visible universal gauges. Bottom = category-specific deep dive.
 *
 * SRP: Layout composition only. Delegates all logic to child components + hook.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Loader2 } from "lucide-react";
import { CATEGORY_METRICS } from "@shared/categoryMetrics";
import { useModelComparison } from "@/ml/lib/useModelComparison";
import type { RegimeModel } from "@/training/lib/types";
import ModelComparisonSelector from "./ModelComparisonSelector";
import UniversalMetricsStrip from "./UniversalMetricsStrip";
import CategoryMetricsPanel from "./CategoryMetricsPanel";
import CategorySubTabs, { useCategorySubTab } from "./CategorySubTabs";

interface ModelComparisonViewProps {
  models: RegimeModel[];
  modelCategory?: string;
  modelSubcategory?: string;
}

export default function ModelComparisonView({
  models,
  modelCategory = 'unsupervised',
  modelSubcategory,
}: ModelComparisonViewProps) {
  const {
    selectedIds,
    toggle,
    maxSelections,
    snapshots,
    isLoading,
    categoryKey,
  } = useModelComparison(models, modelCategory, modelSubcategory);

  const metricsConfig = categoryKey ? CATEGORY_METRICS[categoryKey] ?? null : null;
  const { activeGroup, setActiveGroup, currentGroupConfig } = useCategorySubTab(metricsConfig);

  // Filter metrics panel to show only active group if sub-tabs are visible
  const filteredConfig = metricsConfig && currentGroupConfig
    ? { ...metricsConfig, groups: [currentGroupConfig] }
    : metricsConfig;

  return (
    <div className="space-y-3">
      {/* ── Model Selector (light switches) ── */}
      <ModelComparisonSelector
        models={models}
        selectedIds={selectedIds}
        onToggle={toggle}
        maxSelections={maxSelections}
      />

      {/* ── Universal Metrics Strip ── */}
      <Card className="border-white/5 bg-card/50">
        <CardHeader className="py-2 px-4">
          <CardTitle className="text-xs font-medium text-muted-foreground/60 uppercase tracking-widest">
            Universal Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/30" />
              <span className="ml-2 text-xs text-muted-foreground/30">Loading diagnostics...</span>
            </div>
          ) : (
            <UniversalMetricsStrip snapshots={snapshots} />
          )}
        </CardContent>
      </Card>

      {/* ── Category Sub-Tabs ── */}
      {metricsConfig && metricsConfig.groups.length > 1 && (
        <CategorySubTabs
          config={metricsConfig}
          activeGroup={activeGroup}
          onGroupChange={setActiveGroup}
        />
      )}

      {/* ── Category Metrics Panel ── */}
      {filteredConfig && (
        <CategoryMetricsPanel
          config={filteredConfig}
          snapshots={snapshots}
        />
      )}

      {/* ── No category fallback ── */}
      {!metricsConfig && selectedIds.size > 0 && (
        <div className="text-center text-muted-foreground/30 text-xs py-8">
          No category-specific metrics defined for this model type.
        </div>
      )}
    </div>
  );
}
