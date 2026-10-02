/**
 * VisualizationRouter — Config-driven lazy-loading of analytics components.
 *
 * OCP: New component = add entry to COMPONENT_MAP + visualizations.json. Zero changes here.
 * DIP: Resolves components from config registry, not hardcoded imports.
 * ISP: Single prop interface — diagnostics blob. Each component fetches its own extra data.
 */

import { lazy, Suspense, useMemo } from "react";
import { useVisualizationRegistry, resolveComponents } from "@/ml/lib/useVisualizationRegistry";
import type { Diagnostics } from "@/training/lib/types";
import { Spinner } from "@/shared/ui/spinner";

// ─── Lazy-loaded component map (OCP: add entry = add component) ──────────────
const COMPONENT_MAP: Record<string, React.LazyExoticComponent<React.ComponentType<AnalyticsComponentProps>>> = {
  "convergence-panel":           lazy(() => import("./ConvergenceAnalytics")),
  "feature-correlation-matrix":  lazy(() => import("./FeatureCorrelation")),
  "train-test-split-timeline":   lazy(() => import("./TrainTestTimeline")),
  "walk-forward-windows":        lazy(() => import("./WalkForwardWindows")),
  "confidence-calibration":      lazy(() => import("./ConfidenceCalibration")),
  "data-quality-panel":          lazy(() => import("./DataQuality")),
  "resource-usage":              lazy(() => import("./ResourceUsage")),
  "regime-timeline":             lazy(() => import("./RegimeTimeline")),
  "transition-sankey":           lazy(() => import("./TransitionSankey")),
  "cluster-scatter":             lazy(() => import("./ClusterScatter")),
  "posterior-heatmap":           lazy(() => import("./PosteriorHeatmap")),
  "cluster-profile-cards":       lazy(() => import("./ClusterProfileCards")),
  "silhouette-plot":             lazy(() => import("./SilhouettePlot")),
  "elbow-bic-curve":             lazy(() => import("./ElbowBicCurve")),
  "benchmark-comparison":        lazy(() => import("./BenchmarkComparison")),
  "model-history":               lazy(() => import("./ModelHistory")),
  "microstructure-analytics":    lazy(() => import("./MicrostructureAnalytics")),
};

export interface AnalyticsComponentProps {
  diagnostics: Diagnostics;
  modelId: string;
}

interface AnalyticsPanelProps {
  diagnostics: Diagnostics;
  modelId: string;
  /** ML subcategory (e.g., "clustering", "classification") for component resolution */
  subcategory: string;
}

export default function AnalyticsPanel({ diagnostics, modelId, subcategory }: AnalyticsPanelProps) {
  const { data: config } = useVisualizationRegistry(subcategory);

  const componentIds = useMemo(
    () => resolveComponents(config, diagnostics.symbol),
    [config, diagnostics.symbol],
  );

  if (!config || componentIds.length === 0) {
    return (
      <div className="text-center text-muted-foreground/40 py-8 text-xs">
        No analytics components configured for <span className="font-mono">{subcategory}</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {componentIds.map((id) => {
        const Component = COMPONENT_MAP[id];
        if (!Component) return null; // Component not yet implemented — skip silently (OCP)
        return (
          <Suspense
            key={id}
            fallback={
              <div className="flex items-center justify-center h-48 bg-black/20 rounded-xl border border-white/5">
                <Spinner className="h-4 w-4" />
              </div>
            }
          >
            <Component diagnostics={diagnostics} modelId={modelId} />
          </Suspense>
        );
      })}
    </div>
  );
}
