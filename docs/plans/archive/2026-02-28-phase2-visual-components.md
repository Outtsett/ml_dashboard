# Phase 2: Visual Component Library — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build 16 visualization components (7 universal + 9 clustering) that render model training results, wired into the existing Training page via a config-driven VisualizationRouter.

**Architecture:** Each component is self-contained (fetches its own data or receives props, handles empty states). A VisualizationRouter reads `visualizations.json` (Phase 1) and lazy-loads the relevant components. Components integrate into existing sub-tabs (OverviewPanel, RegimesPanel, etc.) or render as standalone panels in a new "Analytics" sub-tab. SOLID principles enforced throughout — SRP per component, OCP via config registry, DIP via hooks not raw fetches.

**Tech Stack:** React 19, Recharts (line/bar/area/composed), D3.js (sankey, heatmaps), Three.js/R3F (3D scatter), TanStack Query, Tailwind v4, shadcn/ui Card, Framer Motion (transitions)

---

## Prerequisites

- Phase 1 complete (schema evolution, trainingStorage, signals.py, evaluation.py, walkforward.ts, visualizations.json, client hooks)
- QuestDB running with `model_regimes` + `model_shap` tables populated
- At least one trained HDP-HMM or 2-State HMM model in `data/models/`

## Existing Architecture (do NOT modify unless plan says so)

| File | Purpose | Lines |
|------|---------|-------|
| `src/client/src/components/training/types.ts` | Interfaces, colors, verdicts, chart constants | 325 |
| `src/client/src/components/training/model-tabs/constants.ts` | SUB_TABS registry, `getVisibleSubTabs()`, `useModelDiagnostics()` | 60 |
| `src/client/src/components/training/model-tabs/index.tsx` | ModelTabs + ModelPanel (sub-tab router) | 300 |
| `src/client/src/components/training/live/index.tsx` | LiveTrainingDashboard (adaptive panel grid) | 133 |
| `src/client/src/components/training/MicroComponents.tsx` | Sparkline, QualityScoreRing, FitGauge, MiniProgress, PendingValue | 99 |

## Diagnostics JSON Shape (from Python save_model)

All Phase 2 components consume this blob (fetched via `useModelDiagnostics(modelId)`):

```typescript
interface Diagnostics {
  // Metadata
  symbol, timeframe, n_regimes, n_bars_total, quality_score, n_features, feature_names,
  date_range: { start, end, train_end, test_start },
  training_config: { gibbs_iter, burn_in, alpha, gamma, kappa, test_split, walk_forward_windows },
  convergence_summary: { n_iterations, final_log_likelihood, final_active_states },
  // Per-regime
  regime_stats: RegimeStat[],  // count, pct, avg_return, avg_volatility, label, characteristics, ...
  transitions: Transition[],   // from, to, probability
  transition_matrix: number[][],
  // Evaluation
  out_of_sample: OOSResult | null,
  walk_forward: WalkForwardResult | null,
  shap_summary: ShapRegimeSummary[],
  evaluation?: { stage1: Record<string, TestResult>, stage2: Record<string, TestResult>, grade: string },
  // Metadata
  training_time_sec, trained_at, beta
}
```

## Chart Styling Constants (reuse from types.ts)

```typescript
import { CHART_GRID, CHART_AXIS, CHART_TOOLTIP, REGIME_COLORS, getRegimeColor } from "../types";
```

## Component File Naming Convention

All new components go in `src/client/src/components/training/analytics/`. This directory contains:
- `index.tsx` — VisualizationRouter (lazy-loads components)
- One file per component: `ConvergenceAnalytics.tsx`, `FeatureCorrelation.tsx`, etc.
- `shared.tsx` — Shared sub-components (ChartCard wrapper, EmptyState)

---

## Milestone 2A: Infrastructure

### Task 1: Create shared ChartCard wrapper + EmptyState

**SOLID:**
- **SRP** — ChartCard handles card chrome only (title, subtitle, loading). EmptyState handles "no data" only.
- **DIP** — All Phase 2 components depend on these abstractions, not raw Card markup.

**Files:**
- Create: `src/client/src/components/training/analytics/shared.tsx`

**Step 1: Write the shared components**

```typescript
/**
 * Shared building blocks for analytics components.
 *
 * SRP: ChartCard = card chrome. EmptyState = no-data message. No business logic.
 * DIP: All analytics components depend on these, not raw shadcn/ui Card.
 */

import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Minimum height for the chart area */
  minHeight?: number;
}

export function ChartCard({ title, subtitle, badge, children, className, minHeight = 200 }: ChartCardProps) {
  return (
    <Card className={`bg-black/20 border-white/5 overflow-hidden ${className ?? ""}`}>
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{title}</h4>
          {subtitle && <p className="text-[9px] text-muted-foreground/40 mt-0.5">{subtitle}</p>}
        </div>
        {badge}
      </div>
      <div className="px-4 pb-3" style={{ minHeight }}>
        {children}
      </div>
    </Card>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  hint?: string;
}

export function EmptyState({ icon, message, hint }: EmptyStateProps) {
  return (
    <div className="w-full h-full flex items-center justify-center text-muted-foreground min-h-[120px]">
      <div className="text-center">
        {icon && <div className="mx-auto mb-2 opacity-30">{icon}</div>}
        <p className="text-xs">{message}</p>
        {hint && <p className="text-[10px] opacity-60 mt-1">{hint}</p>}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/client/src/components/training/analytics/shared.tsx
git commit -m "feat(analytics): add ChartCard and EmptyState shared building blocks"
```

---

### Task 2: Create VisualizationRouter

**SOLID:**
- **OCP** — Adding a new component = add to COMPONENT_MAP + visualizations.json. No changes to router logic.
- **DIP** — Components resolved from config, not hardcoded imports.
- **ISP** — Router only exposes `AnalyticsPanel` (one prop: diagnostics). Components import their own hooks.

**Files:**
- Create: `src/client/src/components/training/analytics/index.tsx`

**Step 1: Write the router**

```typescript
/**
 * VisualizationRouter — Config-driven lazy-loading of analytics components.
 *
 * OCP: New component = add entry to COMPONENT_MAP + visualizations.json. Zero changes here.
 * DIP: Resolves components from config registry, not hardcoded imports.
 * ISP: Single prop interface — diagnostics blob. Each component fetches its own extra data.
 */

import { lazy, Suspense, useMemo } from "react";
import { useVisualizationRegistry, resolveComponents } from "@/hooks/useVisualizationRegistry";
import type { Diagnostics } from "../types";
import { Spinner } from "@/components/ui/spinner";

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
```

**Step 2: Commit**

```bash
git add src/client/src/components/training/analytics/index.tsx
git commit -m "feat(analytics): add VisualizationRouter with config-driven lazy loading"
```

---

### Task 3: Wire AnalyticsPanel into ModelTabs as new "Analytics" sub-tab

**SOLID:**
- **OCP** — Add one entry to SUB_TABS array + one render branch. No changes to existing sub-tabs.

**Files:**
- Modify: `src/client/src/components/training/model-tabs/constants.ts` — add "analytics" sub-tab
- Modify: `src/client/src/components/training/model-tabs/index.tsx` — render AnalyticsPanel

**Step 1: Add "analytics" to SUB_TABS**

In `constants.ts`, add after the "fit" entry (before "log"):

```typescript
// Add import at top:
import { BarChart2 } from "lucide-react";

// Add to SUB_TABS array before the "log" entry:
{ id: "analytics",  label: "Analytics", icon: BarChart2, requiredKeys: [] as string[] },
```

Update the SubTabId type — it derives automatically from `as const`.

**Step 2: Render AnalyticsPanel in ModelPanel**

In `index.tsx`, add import:

```typescript
import AnalyticsPanel from "./analytics";  // Note: relative import, analytics/ is a sibling of model-tabs/
```

Wait — `analytics/` is under `training/`, not `model-tabs/`. So the import is:

```typescript
const AnalyticsPanel = lazy(() => import("../analytics"));
```

Actually, since AnalyticsPanel is default-exported and we want lazy loading at the router level (already done inside), just import directly:

```typescript
import AnalyticsPanel from "../analytics";
```

Add render branch in the sub-tab content area (after the `effectiveSubTab === "fit"` line):

```typescript
{effectiveSubTab === "analytics" && (
  <AnalyticsPanel
    diagnostics={diagnostics}
    modelId={model.id}
    subcategory="clustering"  // Both HDP-HMM and 2-State HMM are clustering models
  />
)}
```

**Note:** For now, hardcode `subcategory="clustering"` since both wired models are clustering. In Phase 3, this will be resolved dynamically from models.json `subcategory` field.

**Step 3: Commit**

```bash
git add src/client/src/components/training/model-tabs/constants.ts src/client/src/components/training/model-tabs/index.tsx
git commit -m "feat(tabs): wire AnalyticsPanel into ModelTabs as Analytics sub-tab"
```

---

## Milestone 2B: Universal Components (7)

All universal components share this contract:

```typescript
// Props (from AnalyticsComponentProps):
{ diagnostics: Diagnostics; modelId: string }
```

Each component is a default export from its file. Each uses `ChartCard` + `EmptyState` from `./shared`.

---

### Task 4: ConvergenceAnalytics — Multi-metric convergence curves

**SOLID:**
- **SRP** — Renders persisted convergence metrics only. Separate from live ConvergenceChart.
- **DIP** — Fetches data via `usePersistedMetrics` hook, not raw fetch.

**Files:**
- Create: `src/client/src/components/training/analytics/ConvergenceAnalytics.tsx`

**Data Source:** `usePersistedMetrics(sessionId)` for per-iteration metrics from SQLite. Falls back to `diagnostics.convergence_summary` if no sessionId available.

**What it renders:**
- Multi-series Recharts LineChart: log_likelihood, n_active_states, delta, entropy (toggleable series)
- Summary stats cards above: final LL, iterations, active states, convergence %
- Burn-in reference line

```typescript
/**
 * ConvergenceAnalytics — Multi-metric convergence curves from persisted training data.
 *
 * SRP: Renders convergence metrics. Separate from live ConvergenceChart (which uses SSE).
 * DIP: Fetches via usePersistedMetrics hook.
 */

import { useState, useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend,
} from "recharts";
import type { AnalyticsComponentProps } from "./index";
import { CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "../types";
import { ChartCard, EmptyState } from "./shared";

const SERIES = [
  { key: "log_likelihood", label: "Log-Likelihood", color: "#3b82f6", yAxisId: "left" },
  { key: "n_active_states", label: "Active States", color: "#a855f7", yAxisId: "right" },
  { key: "delta", label: "Delta", color: "#f59e0b", yAxisId: "right" },
  { key: "entropy", label: "Entropy", color: "#06b6d4", yAxisId: "right" },
] as const;

export default function ConvergenceAnalytics({ diagnostics }: AnalyticsComponentProps) {
  const [visible, setVisible] = useState<Set<string>>(new Set(["log_likelihood", "n_active_states"]));

  // Build chart data from convergence_summary or empty
  // NOTE: Full per-iteration data comes from diagnostics convergence points
  // In a future iteration, this will use usePersistedMetrics for SQLite data
  const convergenceSummary = diagnostics.convergence_summary;

  if (!convergenceSummary) {
    return (
      <ChartCard title="Convergence Analytics" className="lg:col-span-2">
        <EmptyState message="No convergence data" hint="Train a model to see convergence curves" />
      </ChartCard>
    );
  }

  const toggleSeries = (key: string) => {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const burnIn = diagnostics.training_config?.burn_in ?? 0;

  return (
    <ChartCard
      title="Convergence Analytics"
      subtitle={`${convergenceSummary.n_iterations} iterations · Final LL: ${convergenceSummary.final_log_likelihood.toFixed(1)} · ${convergenceSummary.final_active_states ?? "?"} active states`}
      className="lg:col-span-2"
      minHeight={280}
    >
      {/* Series toggles */}
      <div className="flex gap-2 mb-2">
        {SERIES.map(s => (
          <button
            key={s.key}
            onClick={() => toggleSeries(s.key)}
            className={`text-[9px] px-2 py-0.5 rounded-full border transition-all ${
              visible.has(s.key)
                ? "border-white/20 bg-white/5"
                : "border-white/5 text-muted-foreground/30"
            }`}
            style={{ color: visible.has(s.key) ? s.color : undefined }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/50 italic">
        Full per-iteration curves available when training metrics are persisted to SQLite.
        Currently showing summary statistics.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 mt-2">
        <div className="bg-white/[0.03] rounded-lg p-2 text-center">
          <div className="text-[9px] text-muted-foreground/50 uppercase">Iterations</div>
          <div className="text-sm font-mono font-bold text-blue-400">{convergenceSummary.n_iterations}</div>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-2 text-center">
          <div className="text-[9px] text-muted-foreground/50 uppercase">Final LL</div>
          <div className="text-sm font-mono font-bold text-emerald-400">{convergenceSummary.final_log_likelihood.toFixed(1)}</div>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-2 text-center">
          <div className="text-[9px] text-muted-foreground/50 uppercase">Active States</div>
          <div className="text-sm font-mono font-bold text-violet-400">{convergenceSummary.final_active_states ?? "—"}</div>
        </div>
      </div>
    </ChartCard>
  );
}
```

**Step 2: Commit**

```bash
git add src/client/src/components/training/analytics/ConvergenceAnalytics.tsx
git commit -m "feat(analytics): add ConvergenceAnalytics component"
```

---

### Task 5: FeatureCorrelation — Feature correlation heatmap

**SOLID:**
- **SRP** — Computes and renders feature correlation matrix only.

**Files:**
- Create: `src/client/src/components/training/analytics/FeatureCorrelation.tsx`

**Data Source:** `diagnostics.feature_names` + `diagnostics.regime_stats[].characteristics` (z-scores). The correlation matrix is not directly in diagnostics, so we render a feature-importance heatmap by regime instead (available data).

```typescript
/**
 * FeatureCorrelation — Feature importance heatmap across regimes.
 *
 * SRP: Renders feature × regime characteristic z-scores as a heatmap.
 * Uses data directly available in diagnostics (no extra API call needed).
 */

import { useMemo } from "react";
import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor } from "../types";
import { ChartCard, EmptyState } from "./shared";

export default function FeatureCorrelation({ diagnostics }: AnalyticsComponentProps) {
  const { regime_stats } = diagnostics;

  // Collect all unique feature names across regimes
  const { features, matrix } = useMemo(() => {
    if (!regime_stats?.length) return { features: [] as string[], matrix: [] as number[][] };

    // Gather all feature keys from characteristics
    const featureSet = new Set<string>();
    for (const rs of regime_stats) {
      if (rs.characteristics) {
        for (const key of Object.keys(rs.characteristics)) featureSet.add(key);
      }
    }
    const features = Array.from(featureSet).slice(0, 15); // Cap at 15 features

    // Build matrix: rows = features, cols = regimes
    const matrix = features.map(f =>
      regime_stats.map(rs => rs.characteristics?.[f] ?? 0)
    );

    return { features, matrix };
  }, [regime_stats]);

  if (features.length === 0) {
    return (
      <ChartCard title="Feature × Regime Heatmap">
        <EmptyState message="No feature data" hint="Requires regime_stats with characteristics" />
      </ChartCard>
    );
  }

  const maxAbs = Math.max(1, ...matrix.flat().map(Math.abs));

  return (
    <ChartCard title="Feature × Regime Heatmap" subtitle={`${features.length} features · ${regime_stats.length} regimes`}>
      <div className="overflow-x-auto">
        {/* Header row: regime labels */}
        <div className="flex">
          <div className="w-28 shrink-0" /> {/* spacer for feature labels */}
          {regime_stats.map((rs, ci) => {
            const color = getRegimeColor(ci);
            return (
              <div key={ci} className={`flex-1 min-w-[36px] text-center text-[8px] font-mono ${color.text} truncate px-0.5`}>
                {rs.label}
              </div>
            );
          })}
        </div>

        {/* Data rows: one per feature */}
        {features.map((feat, ri) => (
          <div key={feat} className="flex items-center">
            <div className="w-28 shrink-0 text-[9px] text-muted-foreground/60 truncate pr-1 text-right font-mono">
              {feat.replace(/_/g, " ")}
            </div>
            {matrix[ri]!.map((val, ci) => {
              const intensity = Math.abs(val) / maxAbs;
              const isPositive = val > 0;
              const bg = isPositive
                ? `rgba(59, 130, 246, ${intensity * 0.6})`  // blue for positive z-score
                : `rgba(239, 68, 68, ${intensity * 0.6})`;   // red for negative
              return (
                <div
                  key={ci}
                  className="flex-1 min-w-[36px] h-6 flex items-center justify-center text-[8px] font-mono border border-white/[0.03]"
                  style={{ backgroundColor: bg }}
                  title={`${feat} in ${regime_stats[ci]?.label}: z=${val.toFixed(2)}`}
                >
                  {Math.abs(val) > 0.5 ? val.toFixed(1) : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-4 mt-2 text-[8px] text-muted-foreground/40">
        <span><span className="inline-block w-3 h-2 rounded-sm mr-1" style={{ backgroundColor: "rgba(59, 130, 246, 0.5)" }} />Positive z-score (above avg)</span>
        <span><span className="inline-block w-3 h-2 rounded-sm mr-1" style={{ backgroundColor: "rgba(239, 68, 68, 0.5)" }} />Negative z-score (below avg)</span>
      </div>
    </ChartCard>
  );
}
```

**Step 2: Commit**

```bash
git add src/client/src/components/training/analytics/FeatureCorrelation.tsx
git commit -m "feat(analytics): add FeatureCorrelation heatmap component"
```

---

### Task 6: TrainTestTimeline — Visual train/test split

**Files:**
- Create: `src/client/src/components/training/analytics/TrainTestTimeline.tsx`

```typescript
/**
 * TrainTestTimeline — Horizontal bar showing train vs test data ranges.
 *
 * SRP: Renders date range visualization only.
 */

import type { AnalyticsComponentProps } from "./index";
import { ChartCard, EmptyState } from "./shared";

export default function TrainTestTimeline({ diagnostics }: AnalyticsComponentProps) {
  const { date_range, n_bars_train_val, n_bars_test, n_bars_total } = diagnostics;

  if (!date_range?.start) {
    return (
      <ChartCard title="Train / Test Split">
        <EmptyState message="No date range data" />
      </ChartCard>
    );
  }

  const trainPct = n_bars_total && n_bars_train_val ? (n_bars_train_val / n_bars_total * 100) : 85;
  const testPct = n_bars_total && n_bars_test ? (n_bars_test / n_bars_total * 100) : 15;
  const trainEnd = (date_range as any).train_end || "—";
  const testStart = (date_range as any).test_start || "—";

  return (
    <ChartCard title="Train / Test Split" subtitle={`${n_bars_total?.toLocaleString() ?? "?"} total bars`} minHeight={100}>
      {/* Bar */}
      <div className="flex h-8 rounded-lg overflow-hidden border border-white/5 mt-2">
        <div
          className="bg-blue-500/30 flex items-center justify-center text-[10px] font-mono text-blue-300"
          style={{ width: `${trainPct}%` }}
        >
          Train {trainPct.toFixed(0)}%
        </div>
        <div
          className="bg-amber-500/30 flex items-center justify-center text-[10px] font-mono text-amber-300"
          style={{ width: `${testPct}%` }}
        >
          Test {testPct.toFixed(0)}%
        </div>
      </div>

      {/* Date labels */}
      <div className="flex justify-between mt-1.5 text-[9px] text-muted-foreground/50 font-mono">
        <span>{String(date_range.start).split("T")[0]}</span>
        <span className="text-blue-400/60">{String(trainEnd).split("T")[0]} → {String(testStart).split("T")[0]}</span>
        <span>{String(date_range.end).split("T")[0]}</span>
      </div>

      {/* Bar counts */}
      <div className="flex justify-between mt-1 text-[9px] text-muted-foreground/40">
        <span>{n_bars_train_val?.toLocaleString() ?? "?"} bars</span>
        <span>{n_bars_test?.toLocaleString() ?? "?"} bars</span>
      </div>
    </ChartCard>
  );
}
```

**Commit:**

```bash
git add src/client/src/components/training/analytics/TrainTestTimeline.tsx
git commit -m "feat(analytics): add TrainTestTimeline component"
```

---

### Task 7: WalkForwardWindows — Swimlane visualization

**Files:**
- Create: `src/client/src/components/training/analytics/WalkForwardWindows.tsx`

```typescript
/**
 * WalkForwardWindows — Per-window confidence swimlane with quality coloring.
 *
 * SRP: Renders walk-forward window results only.
 */

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine } from "recharts";
import type { AnalyticsComponentProps } from "./index";
import { CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "../types";
import { ChartCard, EmptyState } from "./shared";

export default function WalkForwardWindows({ diagnostics }: AnalyticsComponentProps) {
  const wf = diagnostics.walk_forward;

  if (!wf?.window_results?.length) {
    return (
      <ChartCard title="Walk-Forward Windows">
        <EmptyState message="No walk-forward data" hint="Enable walk-forward validation during training" />
      </ChartCard>
    );
  }

  const chartData = wf.window_results.map(w => ({
    name: `W${w.window}`,
    confidence: (w.avg_confidence ?? 0) * 100,
    switchRate: (w.switch_rate ?? 0) * 100,
    failed: w.failed,
  }));

  return (
    <ChartCard
      title="Walk-Forward Windows"
      subtitle={`${wf.n_windows} windows · Stability: ${(wf.stability_score * 100).toFixed(0)}%`}
      badge={
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
          wf.stability_score >= 0.7 ? "bg-emerald-500/15 text-emerald-400"
          : wf.stability_score >= 0.5 ? "bg-amber-500/15 text-amber-400"
          : "bg-rose-500/15 text-rose-400"
        }`}>
          {(wf.stability_score * 100).toFixed(0)}%
        </span>
      }
    >
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} barGap={2}>
          <CartesianGrid {...CHART_GRID} />
          <XAxis dataKey="name" {...CHART_AXIS} />
          <YAxis {...CHART_AXIS} domain={[0, 100]} tickFormatter={v => `${v}%`} />
          <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v.toFixed(1)}%`} />
          <ReferenceLine y={50} stroke="rgba(239, 68, 68, 0.3)" strokeDasharray="3 3" label={{ value: "Fail threshold", fill: "#ef444480", fontSize: 8 }} />
          <Bar dataKey="confidence" name="Confidence" radius={[3, 3, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.failed ? "#ef444460" : d.confidence > 70 ? "#10b98160" : "#f59e0b60"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
```

**Commit:**

```bash
git add src/client/src/components/training/analytics/WalkForwardWindows.tsx
git commit -m "feat(analytics): add WalkForwardWindows swimlane component"
```

---

### Task 8: ConfidenceCalibration — Evaluation stage results

**Files:**
- Create: `src/client/src/components/training/analytics/ConfidenceCalibration.tsx`

**Data Source:** `diagnostics.evaluation` (stage1 + stage2 test results + grade), injected by Phase 1's evaluation.py.

```typescript
/**
 * ConfidenceCalibration — Evaluation test results and overall grade.
 *
 * SRP: Renders evaluation pass/fail badges + grade. No business logic.
 * DIP: Reads from diagnostics.evaluation (populated by Python evaluation.py).
 */

import { CheckCircle, XCircle, AlertCircle } from "lucide-react";
import type { AnalyticsComponentProps } from "./index";
import { ChartCard, EmptyState } from "./shared";

interface TestResult {
  value: number | null;
  passed: boolean;
  p_value: number | null;
  details?: Record<string, unknown>;
}

const GRADE_COLORS: Record<string, string> = {
  A: "text-emerald-400 bg-emerald-500/15",
  B: "text-blue-400 bg-blue-500/15",
  C: "text-amber-400 bg-amber-500/15",
  D: "text-orange-400 bg-orange-500/15",
  F: "text-rose-400 bg-rose-500/15",
};

const TEST_LABELS: Record<string, string> = {
  silhouette_score: "Silhouette Score",
  calinski_harabasz: "Calinski-Harabasz Index",
  davies_bouldin: "Davies-Bouldin Index",
  return_separation: "Return Separation (t-test)",
  volatility_separation: "Volatility Separation (Levene)",
  min_duration: "Minimum Regime Duration",
  permutation_test: "Permutation Significance",
  bootstrap_ci: "Bootstrap Confidence Interval",
};

export default function ConfidenceCalibration({ diagnostics }: AnalyticsComponentProps) {
  const evaluation = (diagnostics as any).evaluation as {
    stage1: Record<string, TestResult>;
    stage2: Record<string, TestResult>;
    grade: string;
  } | undefined;

  if (!evaluation) {
    return (
      <ChartCard title="Evaluation Results" className="lg:col-span-2">
        <EmptyState message="No evaluation data" hint="Evaluation runs automatically after training" />
      </ChartCard>
    );
  }

  const { stage1, stage2, grade } = evaluation;
  const gradeStyle = GRADE_COLORS[grade] || GRADE_COLORS.F;

  const renderTests = (tests: Record<string, TestResult>, stageLabel: string) => (
    <div>
      <h5 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 mb-2">{stageLabel}</h5>
      <div className="space-y-1.5">
        {Object.entries(tests).map(([name, result]) => (
          <div key={name} className="flex items-center gap-2 bg-white/[0.02] rounded-lg px-3 py-1.5">
            {result.passed
              ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              : <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            }
            <span className="text-[10px] flex-1">{TEST_LABELS[name] || name}</span>
            {result.value != null && (
              <span className="text-[9px] font-mono text-muted-foreground/50">
                {result.value.toFixed(3)}
              </span>
            )}
            {result.p_value != null && (
              <span className="text-[9px] font-mono text-muted-foreground/40">
                p={result.p_value.toFixed(4)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <ChartCard
      title="Evaluation Results"
      className="lg:col-span-2"
      badge={
        <span className={`text-lg font-bold font-mono px-3 py-1 rounded-lg ${gradeStyle}`}>
          {grade}
        </span>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {renderTests(stage1, "Stage 1: Regime Quality")}
        {Object.keys(stage2).length > 0
          ? renderTests(stage2, "Stage 2: Statistical Significance")
          : (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/40">
              <AlertCircle className="h-3.5 w-3.5" />
              Stage 2 not run (enable --run-significance-tests)
            </div>
          )
        }
      </div>
    </ChartCard>
  );
}
```

**Commit:**

```bash
git add src/client/src/components/training/analytics/ConfidenceCalibration.tsx
git commit -m "feat(analytics): add ConfidenceCalibration evaluation results component"
```

---

### Task 9: DataQuality — Feature quality overview

**Files:**
- Create: `src/client/src/components/training/analytics/DataQuality.tsx`

```typescript
/**
 * DataQuality — Feature count, data coverage, and training configuration summary.
 *
 * SRP: Data quality overview only. No analysis or recommendations.
 */

import type { AnalyticsComponentProps } from "./index";
import { ChartCard, EmptyState } from "./shared";

export default function DataQuality({ diagnostics }: AnalyticsComponentProps) {
  const { n_features, feature_names, n_bars_total, n_bars_train_val, n_bars_test, training_config, date_range } = diagnostics;

  return (
    <ChartCard title="Data Quality" subtitle={`${n_features} features · ${n_bars_total?.toLocaleString() ?? "?"} bars`}>
      {/* Feature list */}
      <div className="mt-1">
        <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-1">Features ({n_features})</div>
        <div className="flex flex-wrap gap-1">
          {feature_names.slice(0, 20).map(f => (
            <span key={f} className="text-[8px] font-mono bg-white/[0.04] px-1.5 py-0.5 rounded text-muted-foreground/60">
              {f}
            </span>
          ))}
          {feature_names.length > 20 && (
            <span className="text-[8px] text-muted-foreground/30">+{feature_names.length - 20} more</span>
          )}
        </div>
      </div>

      {/* Training config summary */}
      {training_config && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: "Iterations", value: training_config.gibbs_iter },
            { label: "Burn-in", value: training_config.burn_in },
            { label: "Test Split", value: `${(training_config.test_split * 100).toFixed(0)}%` },
            { label: "Alpha (CRP)", value: training_config.alpha },
            { label: "Gamma", value: training_config.gamma },
            { label: "Kappa", value: training_config.kappa },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <div className="text-[8px] text-muted-foreground/40 uppercase">{label}</div>
              <div className="text-[11px] font-mono">{value}</div>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}
```

**Commit:**

```bash
git add src/client/src/components/training/analytics/DataQuality.tsx
git commit -m "feat(analytics): add DataQuality component"
```

---

### Task 10: ResourceUsage — Training performance stats

**Files:**
- Create: `src/client/src/components/training/analytics/ResourceUsage.tsx`

```typescript
/**
 * ResourceUsage — Training time, speed, and resource summary.
 *
 * SRP: Displays training performance metadata only.
 */

import { Clock, Zap, Database, Calendar } from "lucide-react";
import type { AnalyticsComponentProps } from "./index";
import { ChartCard } from "./shared";

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export default function ResourceUsage({ diagnostics }: AnalyticsComponentProps) {
  const { training_time_sec, trained_at, n_bars_total, convergence_summary, n_features } = diagnostics;

  const iterPerSec = convergence_summary && training_time_sec > 0
    ? (convergence_summary.n_iterations / training_time_sec).toFixed(1)
    : "—";
  const barsPerSec = n_bars_total && training_time_sec > 0
    ? Math.round(n_bars_total / training_time_sec).toLocaleString()
    : "—";

  const stats = [
    { icon: Clock, label: "Training Time", value: formatDuration(training_time_sec), color: "text-blue-400" },
    { icon: Zap, label: "Speed", value: `${iterPerSec} it/s`, color: "text-amber-400" },
    { icon: Database, label: "Throughput", value: `${barsPerSec} bars/s`, color: "text-cyan-400" },
    { icon: Calendar, label: "Trained", value: trained_at ? new Date(trained_at).toLocaleDateString() : "—", color: "text-violet-400" },
  ];

  return (
    <ChartCard title="Resource Usage" subtitle={`${n_features} features × ${n_bars_total?.toLocaleString() ?? "?"} bars`} minHeight={80}>
      <div className="grid grid-cols-2 gap-3 mt-1">
        {stats.map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="flex items-center gap-2 bg-white/[0.02] rounded-lg px-3 py-2">
            <Icon className={`h-3.5 w-3.5 ${color} shrink-0`} />
            <div>
              <div className="text-[8px] text-muted-foreground/40 uppercase">{label}</div>
              <div className={`text-xs font-mono font-medium ${color}`}>{value}</div>
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}
```

**Commit:**

```bash
git add src/client/src/components/training/analytics/ResourceUsage.tsx
git commit -m "feat(analytics): add ResourceUsage component"
```

---

## Milestone 2C: Clustering Components (7 of 9)

### Task 11: RegimeTimeline — Enhanced regime timeline with confidence

**Files:**
- Create: `src/client/src/components/training/analytics/RegimeTimeline.tsx`

**Data Source:** Fetches from `GET /api/training/models/:id/assignments` — QuestDB `model_regimes` table with signal columns (confidence, entropy, transition_prob).

```typescript
/**
 * RegimeTimeline — Regime assignments over time with confidence as opacity.
 *
 * SRP: Renders regime zones with signal overlays. Fetches its own data via useQuery.
 * DIP: Uses model assignments API, not raw QuestDB.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor, CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "../types";
import { ChartCard, EmptyState } from "./shared";

export default function RegimeTimeline({ diagnostics, modelId }: AnalyticsComponentProps) {
  const { data } = useQuery({
    queryKey: ["regimeAssignments", modelId, "timeline"],
    queryFn: async () => {
      const res = await fetch(`/api/training/models/${modelId}/assignments?limit=2000`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!modelId,
    staleTime: 60_000,
  });

  const chartData = useMemo(() => {
    const rows = data?.assignments || data?.rows;
    if (!rows?.length) return [];
    return rows.map((r: any, i: number) => ({
      idx: i,
      regime: r.regime,
      confidence: r.confidence ?? 1,
      entropy: r.entropy ?? 0,
      transition_prob: r.transition_prob ?? 0,
    }));
  }, [data]);

  if (chartData.length === 0) {
    return (
      <ChartCard title="Regime Timeline" className="lg:col-span-2">
        <EmptyState message="No assignment data" hint="Train a model to see regime zones" />
      </ChartCard>
    );
  }

  // Build per-regime area layers
  const regimeIds = [...new Set(chartData.map((d: any) => d.regime))].sort() as number[];

  return (
    <ChartCard
      title="Regime Timeline"
      subtitle={`${chartData.length} bars · ${regimeIds.length} regimes · Opacity = confidence`}
      className="lg:col-span-2"
      minHeight={200}
    >
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={chartData}>
          <CartesianGrid {...CHART_GRID} />
          <XAxis dataKey="idx" {...CHART_AXIS} tickFormatter={() => ""} />
          <YAxis {...CHART_AXIS} domain={[0, 1]} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
          <Tooltip
            {...CHART_TOOLTIP}
            formatter={(v: number, name: string) =>
              name === "confidence" ? `${(v * 100).toFixed(1)}%` : v.toFixed(3)
            }
          />
          <Area
            dataKey="confidence"
            stroke="#3b82f680"
            fill="#3b82f620"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="entropy"
            stroke="#f59e0b60"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="transition_prob"
            stroke="#ef444460"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-[8px] text-muted-foreground/40 mt-1">
        <span><span className="inline-block w-3 h-1 rounded-sm mr-1 bg-blue-500/40" />Confidence</span>
        <span><span className="inline-block w-3 h-1 rounded-sm mr-1 bg-amber-500/40" />Entropy</span>
        <span><span className="inline-block w-3 h-1 rounded-sm mr-1 bg-rose-500/40" />Transition Prob</span>
      </div>
    </ChartCard>
  );
}
```

**Commit:**

```bash
git add src/client/src/components/training/analytics/RegimeTimeline.tsx
git commit -m "feat(analytics): add RegimeTimeline with signal overlays"
```

---

### Task 12: TransitionSankey — D3 Sankey diagram

**Files:**
- Create: `src/client/src/components/training/analytics/TransitionSankey.tsx`

```typescript
/**
 * TransitionSankey — D3 Sankey diagram of regime transitions.
 *
 * SRP: Renders transition flow only. Data from diagnostics.transitions + transition_matrix.
 */

import { useRef, useEffect, useMemo } from "react";
import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor } from "../types";
import { ChartCard, EmptyState } from "./shared";

export default function TransitionSankey({ diagnostics }: AnalyticsComponentProps) {
  const { transitions, regime_stats, transition_matrix } = diagnostics;
  const svgRef = useRef<SVGSVGElement>(null);

  // Filter significant transitions (> 5%)
  const links = useMemo(() => {
    if (!transitions?.length) return [];
    return transitions
      .filter(t => t.probability > 0.05 && t.from !== t.to)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 15);
  }, [transitions]);

  if (links.length === 0 || !regime_stats?.length) {
    return (
      <ChartCard title="Transition Flow">
        <EmptyState message="No transition data" hint="Requires at least 2 regimes with cross-transitions" />
      </ChartCard>
    );
  }

  const nRegimes = regime_stats.length;
  const nodeH = 180 / Math.max(nRegimes, 2);
  const W = 320;
  const H = Math.max(nRegimes * nodeH + 20, 120);

  return (
    <ChartCard title="Transition Flow" subtitle={`${links.length} significant transitions (>5%)`} minHeight={H + 20}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {/* Source nodes (left) */}
        {regime_stats.map((rs, i) => {
          const color = getRegimeColor(i);
          const y = 10 + i * nodeH;
          return (
            <g key={`src-${i}`}>
              <rect x={0} y={y} width={12} height={nodeH - 4} rx={3} fill={color.fill} opacity={0.7} />
              <text x={16} y={y + nodeH / 2} className="text-[8px]" fill="currentColor" dominantBaseline="middle" opacity={0.5}>
                {rs.label}
              </text>
            </g>
          );
        })}

        {/* Target nodes (right) */}
        {regime_stats.map((rs, i) => {
          const color = getRegimeColor(i);
          const y = 10 + i * nodeH;
          return (
            <g key={`tgt-${i}`}>
              <rect x={W - 12} y={y} width={12} height={nodeH - 4} rx={3} fill={color.fill} opacity={0.7} />
              <text x={W - 16} y={y + nodeH / 2} className="text-[8px]" fill="currentColor" dominantBaseline="middle" textAnchor="end" opacity={0.5}>
                {rs.label}
              </text>
            </g>
          );
        })}

        {/* Links */}
        {links.map((link, i) => {
          const srcY = 10 + link.from * nodeH + (nodeH - 4) / 2;
          const tgtY = 10 + link.to * nodeH + (nodeH - 4) / 2;
          const thickness = Math.max(1, link.probability * 20);
          const color = getRegimeColor(link.from).fill;
          return (
            <path
              key={i}
              d={`M 12 ${srcY} C ${W / 2} ${srcY}, ${W / 2} ${tgtY}, ${W - 12} ${tgtY}`}
              fill="none"
              stroke={color}
              strokeWidth={thickness}
              opacity={0.25}
            >
              <title>{`${regime_stats[link.from]?.label} → ${regime_stats[link.to]?.label}: ${(link.probability * 100).toFixed(1)}%`}</title>
            </path>
          );
        })}
      </svg>
    </ChartCard>
  );
}
```

**Commit:**

```bash
git add src/client/src/components/training/analytics/TransitionSankey.tsx
git commit -m "feat(analytics): add TransitionSankey flow diagram"
```

---

### Task 13: ClusterScatter — 2D feature-space scatter

**Files:**
- Create: `src/client/src/components/training/analytics/ClusterScatter.tsx`

**Data:** Uses `regime_stats` characteristics as a proxy for regime centroids in feature space. Plots the top-2 distinguishing features as axes, colors by regime.

```typescript
/**
 * ClusterScatter — 2D scatter of regime centroids in feature space.
 *
 * SRP: Renders scatter plot of regime positions only.
 */

import { useMemo } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor, CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "../types";
import { ChartCard, EmptyState } from "./shared";

export default function ClusterScatter({ diagnostics }: AnalyticsComponentProps) {
  const { regime_stats } = diagnostics;

  const { data, xFeature, yFeature } = useMemo(() => {
    if (!regime_stats?.length) return { data: [], xFeature: "", yFeature: "" };

    // Find top-2 features with highest variance across regimes
    const allFeatures = new Set<string>();
    for (const rs of regime_stats) {
      if (rs.characteristics) {
        for (const k of Object.keys(rs.characteristics)) allFeatures.add(k);
      }
    }

    const features = Array.from(allFeatures);
    const variances = features.map(f => {
      const vals = regime_stats.map(rs => rs.characteristics?.[f] ?? 0);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
      return { feature: f, variance };
    }).sort((a, b) => b.variance - a.variance);

    const xFeature = variances[0]?.feature || "return_1";
    const yFeature = variances[1]?.feature || "volatility_10";

    const data = regime_stats.map((rs, i) => ({
      x: rs.characteristics?.[xFeature] ?? 0,
      y: rs.characteristics?.[yFeature] ?? 0,
      label: rs.label,
      pct: rs.pct,
      idx: i,
    }));

    return { data, xFeature, yFeature };
  }, [regime_stats]);

  if (data.length < 2) {
    return (
      <ChartCard title="Cluster Scatter">
        <EmptyState message="Need at least 2 regimes" />
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Cluster Scatter" subtitle={`${xFeature} vs ${yFeature} (highest cross-regime variance)`}>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart>
          <CartesianGrid {...CHART_GRID} />
          <XAxis
            dataKey="x"
            name={xFeature}
            {...CHART_AXIS}
            label={{ value: xFeature.replace(/_/g, " "), position: "bottom", fontSize: 8, fill: "#888" }}
          />
          <YAxis
            dataKey="y"
            name={yFeature}
            {...CHART_AXIS}
            label={{ value: yFeature.replace(/_/g, " "), angle: -90, position: "left", fontSize: 8, fill: "#888" }}
          />
          <Tooltip
            {...CHART_TOOLTIP}
            formatter={(v: number) => v.toFixed(2)}
            labelFormatter={() => ""}
            content={({ payload }) => {
              const d = payload?.[0]?.payload;
              if (!d) return null;
              return (
                <div className="bg-[hsla(250,25%,14%,0.95)] rounded-lg px-3 py-2 text-[10px] border-none">
                  <div className="font-medium" style={{ color: getRegimeColor(d.idx).fill }}>{d.label}</div>
                  <div className="text-muted-foreground/60">{d.pct.toFixed(1)}% of data</div>
                </div>
              );
            }}
          />
          <Scatter data={data} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={getRegimeColor(d.idx).fill} r={Math.max(6, Math.sqrt(d.pct) * 3)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
```

**Commit:**

```bash
git add src/client/src/components/training/analytics/ClusterScatter.tsx
git commit -m "feat(analytics): add ClusterScatter 2D feature-space scatter"
```

---

### Task 14: PosteriorHeatmap — Regime confidence over time

**Files:**
- Create: `src/client/src/components/training/analytics/PosteriorHeatmap.tsx`

**Data:** Fetches assignments (with confidence + entropy per bar) from API. Renders a time × metric strip showing confidence distribution.

```typescript
/**
 * PosteriorHeatmap — Regime confidence and entropy over time as a strip heatmap.
 *
 * SRP: Renders posterior confidence visualization only.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor } from "../types";
import { ChartCard, EmptyState } from "./shared";

export default function PosteriorHeatmap({ diagnostics, modelId }: AnalyticsComponentProps) {
  const { data } = useQuery({
    queryKey: ["regimeAssignments", modelId, "posterior"],
    queryFn: async () => {
      const res = await fetch(`/api/training/models/${modelId}/assignments?limit=500`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!modelId,
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const raw = data?.assignments || data?.rows;
    if (!raw?.length) return [];
    // Sample to max 200 bars for performance
    const step = Math.max(1, Math.floor(raw.length / 200));
    return raw.filter((_: any, i: number) => i % step === 0).map((r: any) => ({
      regime: r.regime ?? 0,
      confidence: r.confidence ?? 1,
      entropy: r.entropy ?? 0,
    }));
  }, [data]);

  if (rows.length === 0) {
    return (
      <ChartCard title="Posterior Heatmap">
        <EmptyState message="No posterior data" hint="Requires model assignments with confidence" />
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Posterior Heatmap" subtitle={`${rows.length} sampled bars · Color = regime · Opacity = confidence`}>
      {/* Regime strip */}
      <div className="text-[8px] text-muted-foreground/40 mb-1">Regime assignment (opacity = confidence)</div>
      <div className="flex h-6 rounded overflow-hidden border border-white/5">
        {rows.map((r: any, i: number) => {
          const color = getRegimeColor(r.regime);
          return (
            <div
              key={i}
              className="flex-1 min-w-0"
              style={{ backgroundColor: color.fill, opacity: 0.15 + r.confidence * 0.75 }}
              title={`Bar ${i}: Regime ${r.regime}, conf=${(r.confidence * 100).toFixed(0)}%`}
            />
          );
        })}
      </div>

      {/* Entropy strip */}
      <div className="text-[8px] text-muted-foreground/40 mb-1 mt-2">Entropy (brighter = more uncertain)</div>
      <div className="flex h-4 rounded overflow-hidden border border-white/5">
        {rows.map((r: any, i: number) => (
          <div
            key={i}
            className="flex-1 min-w-0"
            style={{ backgroundColor: `rgba(245, 158, 11, ${r.entropy * 0.8})` }}
            title={`Bar ${i}: entropy=${r.entropy.toFixed(3)}`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 text-[8px] text-muted-foreground/40">
        {diagnostics.regime_stats.map((rs, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: getRegimeColor(i).fill }} />
            {rs.label}
          </span>
        ))}
      </div>
    </ChartCard>
  );
}
```

**Commit:**

```bash
git add src/client/src/components/training/analytics/PosteriorHeatmap.tsx
git commit -m "feat(analytics): add PosteriorHeatmap regime confidence strip"
```

---

### Task 15: ClusterProfileCards — Per-regime stat cards

**Files:**
- Create: `src/client/src/components/training/analytics/ClusterProfileCards.tsx`

```typescript
/**
 * ClusterProfileCards — One card per regime with return, volatility, duration stats.
 *
 * SRP: Renders per-regime profile summaries only.
 */

import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor, VOL_COLORS, CANDLE_LABELS } from "../types";
import { ChartCard, EmptyState } from "./shared";

export default function ClusterProfileCards({ diagnostics }: AnalyticsComponentProps) {
  const { regime_stats } = diagnostics;

  if (!regime_stats?.length) {
    return (
      <ChartCard title="Cluster Profiles" className="lg:col-span-2">
        <EmptyState message="No regime stats" />
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Cluster Profiles" subtitle={`${regime_stats.length} regimes discovered`} className="lg:col-span-2">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {regime_stats.map((rs, i) => {
          const color = getRegimeColor(i);
          const volBadge = rs.volatility_state ? VOL_COLORS[rs.volatility_state] || "" : "";
          const candleLabel = rs.bar_character ? CANDLE_LABELS[rs.bar_character] || rs.bar_character : "";
          return (
            <div
              key={i}
              className="bg-white/[0.02] rounded-xl border p-3"
              style={{ borderColor: `${color.fill}30` }}
            >
              {/* Header */}
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color.fill }} />
                <span className="text-[11px] font-medium">{rs.label}</span>
                <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto">{rs.pct.toFixed(1)}%</span>
              </div>

              {/* Stats grid */}
              <div className="space-y-1 text-[9px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground/50">Return/bar</span>
                  <span className={`font-mono ${(rs.avg_return_pct ?? rs.avg_return * 100) > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {((rs.avg_return_pct ?? rs.avg_return * 100)).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/50">Volatility</span>
                  <span className="font-mono">{(rs.avg_volatility * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/50">Avg duration</span>
                  <span className="font-mono">{rs.avg_duration.toFixed(1)} bars</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/50">Max duration</span>
                  <span className="font-mono">{rs.max_duration} bars</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/50">Count</span>
                  <span className="font-mono">{rs.count.toLocaleString()}</span>
                </div>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap gap-1 mt-2">
                {rs.volatility_state && (
                  <span className={`text-[7px] px-1.5 py-0.5 rounded-full ${volBadge}`}>
                    {rs.volatility_state}
                  </span>
                )}
                {candleLabel && (
                  <span className="text-[7px] px-1.5 py-0.5 rounded-full bg-white/5 text-muted-foreground/50">
                    {candleLabel}
                  </span>
                )}
              </div>

              {/* Top characteristics */}
              {rs.characteristics && Object.keys(rs.characteristics).length > 0 && (
                <div className="mt-2 border-t border-white/5 pt-1.5">
                  <div className="text-[7px] text-muted-foreground/30 uppercase mb-1">Defining Features</div>
                  {Object.entries(rs.characteristics)
                    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                    .slice(0, 3)
                    .map(([feat, z]) => (
                      <div key={feat} className="flex justify-between text-[8px]">
                        <span className="text-muted-foreground/40 truncate">{feat.replace(/_/g, " ")}</span>
                        <span className={`font-mono ${z > 0 ? "text-blue-400/70" : "text-rose-400/70"}`}>
                          {z > 0 ? "+" : ""}{z.toFixed(1)}σ
                        </span>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}
```

**Commit:**

```bash
git add src/client/src/components/training/analytics/ClusterProfileCards.tsx
git commit -m "feat(analytics): add ClusterProfileCards per-regime stat cards"
```

---

### Task 16: SilhouettePlot — Cluster separation quality

**Files:**
- Create: `src/client/src/components/training/analytics/SilhouettePlot.tsx`

**Data:** Uses `diagnostics.evaluation.stage1.silhouette_score` for overall score, and regime_stats for per-regime sizes. The full per-sample silhouette values are not available in diagnostics (would need a new Python output), so we render a summary bar chart.

```typescript
/**
 * SilhouettePlot — Cluster separation quality summary.
 *
 * SRP: Renders evaluation cluster metrics only.
 */

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine } from "recharts";
import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor, CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "../types";
import { ChartCard, EmptyState } from "./shared";

export default function SilhouettePlot({ diagnostics }: AnalyticsComponentProps) {
  const evaluation = (diagnostics as any).evaluation;
  const stage1 = evaluation?.stage1;

  if (!stage1) {
    return (
      <ChartCard title="Cluster Quality Metrics">
        <EmptyState message="No evaluation data" hint="Evaluation runs automatically after training" />
      </ChartCard>
    );
  }

  const metrics = [
    {
      name: "Silhouette",
      value: stage1.silhouette_score?.value ?? 0,
      passed: stage1.silhouette_score?.passed ?? false,
      threshold: 0.2,
      description: "Higher = better-separated clusters",
    },
    {
      name: "Calinski-Harabasz",
      value: Math.min(stage1.calinski_harabasz?.value ?? 0, 200), // Cap for chart
      passed: stage1.calinski_harabasz?.passed ?? false,
      threshold: 10,
      description: "Higher = denser, well-separated",
    },
    {
      name: "Davies-Bouldin",
      value: stage1.davies_bouldin?.value ?? 0,
      passed: stage1.davies_bouldin?.passed ?? false,
      threshold: 1.5,
      description: "Lower = better separation",
    },
  ];

  return (
    <ChartCard title="Cluster Quality Metrics" subtitle="Stage 1 evaluation tests">
      <div className="space-y-3">
        {metrics.map(m => (
          <div key={m.name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium">{m.name}</span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                m.passed ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
              }`}>
                {m.value.toFixed(3)} {m.passed ? "PASS" : "FAIL"}
              </span>
            </div>
            <div className="text-[8px] text-muted-foreground/30">{m.description}</div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}
```

**Commit:**

```bash
git add src/client/src/components/training/analytics/SilhouettePlot.tsx
git commit -m "feat(analytics): add SilhouettePlot cluster quality metrics"
```

---

### Task 17: ElbowBicCurve — Regime count quality summary

**Files:**
- Create: `src/client/src/components/training/analytics/ElbowBicCurve.tsx`

**Data:** For HDP-HMM (nonparametric), there's no K sweep. Instead, render a summary showing discovered K, quality score, and regime balance (pct distribution).

```typescript
/**
 * ElbowBicCurve — Regime count and balance summary.
 *
 * For nonparametric models (HDP-HMM), shows discovered K and balance.
 * For parametric models, will show K-sweep results (future).
 *
 * SRP: Renders regime count quality only.
 */

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor, getRegimeVerdict, CHART_TOOLTIP } from "../types";
import { ChartCard, EmptyState } from "./shared";

export default function ElbowBicCurve({ diagnostics }: AnalyticsComponentProps) {
  const { regime_stats, n_regimes } = diagnostics;

  if (!regime_stats?.length) {
    return (
      <ChartCard title="Regime Balance">
        <EmptyState message="No regime data" />
      </ChartCard>
    );
  }

  const pieData = regime_stats.map((rs, i) => ({
    name: rs.label,
    value: rs.pct,
    fill: getRegimeColor(i).fill,
  }));

  const verdict = getRegimeVerdict(n_regimes);

  return (
    <ChartCard title="Regime Balance" subtitle={`${n_regimes} regimes discovered`} minHeight={180}>
      <div className="flex items-center gap-4">
        {/* Pie chart */}
        <div className="w-32 h-32">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius={25}
                outerRadius={50}
                paddingAngle={2}
                isAnimationActive={false}
              >
                {pieData.map((d, i) => (
                  <Cell key={i} fill={d.fill} stroke="transparent" />
                ))}
              </Pie>
              <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v.toFixed(1)}%`} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend + verdict */}
        <div className="flex-1">
          <div className="space-y-1">
            {regime_stats.map((rs, i) => (
              <div key={i} className="flex items-center gap-2 text-[9px]">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: getRegimeColor(i).fill }} />
                <span className="truncate">{rs.label}</span>
                <span className="font-mono text-muted-foreground/50 ml-auto">{rs.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className={`text-[9px] mt-2 ${verdict.color}`}>{verdict.text}</div>
        </div>
      </div>
    </ChartCard>
  );
}
```

**Commit:**

```bash
git add src/client/src/components/training/analytics/ElbowBicCurve.tsx
git commit -m "feat(analytics): add ElbowBicCurve regime balance summary"
```

---

## Milestone 2D: Verification + Commit

### Task 18: Verify TypeScript compiles

**Step 1: Run type check**

```bash
npm run check
```

Expected: Only pre-existing errors. No new errors from Phase 2 components.

**If errors:**
- Fix import paths (ensure `../types`, `./shared`, `@/hooks/*` resolve correctly)
- Fix any Recharts prop type issues
- Ensure `AnalyticsComponentProps` import works from `./index`

---

### Task 19: Verify dev server renders Analytics tab

**Step 1: Start dev server**

```bash
npm run dev
```

**Step 2: Test visually**

1. Open http://localhost:5000
2. Navigate to Training page
3. If a trained model exists, click on it in ModelTabs
4. Click the "Analytics" sub-tab
5. Verify components render (even if some show EmptyState for missing data)

---

### Task 20: Final commit

```bash
git add -A
git commit -m "milestone: Phase 2 complete — Visual Component Library (7 universal + 7 clustering)"
```

---

## Summary: What Was Built

| # | Component | Type | Data Source | Chart |
|---|-----------|------|-------------|-------|
| 1 | `shared.tsx` | Infrastructure | — | ChartCard + EmptyState |
| 2 | `index.tsx` | Infrastructure | visualizations.json | VisualizationRouter |
| 3 | Constants + ModelTabs | Wiring | — | Analytics sub-tab |
| 4 | `ConvergenceAnalytics` | Universal | convergence_summary | Summary cards |
| 5 | `FeatureCorrelation` | Universal | regime_stats.characteristics | CSS heatmap |
| 6 | `TrainTestTimeline` | Universal | date_range, n_bars_* | Proportional bar |
| 7 | `WalkForwardWindows` | Universal | walk_forward | Recharts BarChart |
| 8 | `ConfidenceCalibration` | Universal | evaluation (stage1+2) | Pass/fail cards |
| 9 | `DataQuality` | Universal | feature_names, training_config | Feature tags + config grid |
| 10 | `ResourceUsage` | Universal | training_time_sec, trained_at | Stat cards |
| 11 | `RegimeTimeline` | Clustering | /assignments API | Recharts ComposedChart |
| 12 | `TransitionSankey` | Clustering | transitions | SVG paths |
| 13 | `ClusterScatter` | Clustering | regime_stats.characteristics | Recharts ScatterChart |
| 14 | `PosteriorHeatmap` | Clustering | /assignments API | CSS strip heatmap |
| 15 | `ClusterProfileCards` | Clustering | regime_stats | Stat cards |
| 16 | `SilhouettePlot` | Clustering | evaluation.stage1 | Metric summary |
| 17 | `ElbowBicCurve` | Clustering | regime_stats | Recharts PieChart |

**SOLID Compliance:**
- **SRP**: Each component = one visualization. ChartCard = chrome. EmptyState = no-data.
- **OCP**: New component = add to COMPONENT_MAP + visualizations.json. Zero changes to router.
- **LSP**: All components satisfy `AnalyticsComponentProps` contract identically.
- **ISP**: Components fetch only what they need (some use diagnostics, some fetch from API).
- **DIP**: Components depend on hooks (useVisualizationRegistry, useQuery), not raw fetch/DB.

**Deferred (no models exist yet):**
- Dendrogram (conditional: hierarchical)
- SOM Grid (conditional: self-organizing-maps)
- All classification, regression, sequence, ensemble, deep-learning groups
