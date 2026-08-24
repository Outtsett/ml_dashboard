# Training Page Redesign — Scrollable Command Center

## Goal

Replace the tab-based Training page with a single scrollable surface that renders self-describing metric cards with rich visualizations (gauges, time series, rings, bars, heatmaps), live SSE updates, hover tooltips explaining each metric, and per-section color theming. No hardcoded metrics — everything driven by `metricDeclarations` from models.json.

## Architecture

Rewrite `Training.tsx` as a scrollable command center. Kill the `TrainingTabs` component and the Overview/Convergence tab split. One vertical flow: config strip → metric sections → model browser footer. The `MetricGrid` component already groups by `group` field and sorts by `order` — extend it with section accent colors and richer awaiting states.

## Tech Stack

- React 19, TypeScript, Tailwind CSS, visx (gauges/arcs), recharts (time series)
- Existing: `MetricGrid`, `RendererShell`, 14 renderer components, `useTrainingLive()` SSE hook
- Existing: `metricDeclarations` in models.json, `SelfDescribingDiagnostics` schema

---

## Components

### 1. Config Strip (top of page)

Inline card row replacing the current header bar. Four cards in a horizontal flex:

| Card | Content |
|------|---------|
| **Model** | Model name (bold), subcategory, param count. Click → model picker dropdown |
| **Market** | Symbol + timeframe, bar count. Click → symbol picker |
| **Hyperparameters** | Compact summary (key=val pairs). Click → expandable drawer with full `HyperparameterForm` |
| **Action** | Run/Stop button. During training: progress bar + elapsed time |

The drawer expands inline (pushes content down) when "Edit hyperparameters" is clicked. Collapses on blur or explicit close.

### 2. Section-Colored MetricGrid

Extend `MetricGrid` to apply accent colors per group:

| Group | Color | Hex | Use |
|-------|-------|-----|-----|
| `deep_learning` | Purple | `#a78bfa` | Section header, card border tint |
| `machine_learning` | Cyan | `#22d3ee` | Section header, card border tint |
| `trading` | Amber | `#f59e0b` | Section header, card border tint |
| Other | Zinc | `#71717a` | Fallback |

Section headers: colored label + horizontal rule, matching current `GroupHeader` pattern but with accent color applied.

Card borders: subtle tint matching section color (currently severity-based — add group-color override when no severity data exists).

### 3. Hover Tooltips on Every Metric Card

Add a tooltip to `RendererShell` that shows on hover:

- **Mission** — the question this metric answers (already in `MetricDeclaration.mission`)
- **Thresholds** — good/great/breakeven/baseline from `MetricDeclaration.context`
- **Direction** — "Higher is better" or "Lower is better" from `context.higher_is_better`

Implementation: Wrap the card in a Radix `Tooltip` (already available via shadcn/ui). Content built from `MetricDeclaration` fields. No new data needed.

### 4. Live SSE Updates

Already wired:
- `useTrainingLive()` provides `diagnostics` (updated on every SSE event)
- `MetricGrid` receives diagnostics and re-renders
- Individual renderers (GaugeRenderer, NumberRenderer, etc.) animate via React state changes

Additions needed:
- `NumberRenderer`: animated count-up on value change (already implemented with rAF)
- `GaugeRenderer`: smooth arc transition via CSS `transition` on arc path
- `TimeSeriesRenderer`: append new data points, auto-scroll X axis
- All renderers: flash/pulse on value update (CSS animation triggered by key change)

### 5. Training Progress Inline

During training, the Action card in the config strip transforms:
- Shows elapsed time, current epoch/iteration
- Compact progress bar
- Stop button replaces Run button

The metric cards below fill in live as SSE events arrive. Cards transition from "Awaiting Training" → animated renderers as values stream in.

### 6. Model Browser

Move from hidden modal to a collapsible section at the bottom of the page. Shows trained model checkpoints in a compact tree view. Selecting a model loads its saved diagnostics into the metric grid.

### 7. No Tabs

Kill `TrainingTabs.tsx`. The page is one continuous scroll:

```
┌─ Config Strip ────────────────────────────────┐
│ [Model] [Market] [Hyperparameters] [Run]      │
└───────────────────────────────────────────────┘
┌─ Deep Learning (purple) ──────────────────────┐
│ train_loss │ val_loss │ best_epoch │ params    │
│ convergence │ learning_rate                    │
└───────────────────────────────────────────────┘
┌─ Machine Learning (cyan) ─────────────────────┐
│ accuracy │ ROC AUC │ class_balance │ log_loss  │
│ precision_bars │ confusion_matrix              │
└───────────────────────────────────────────────┘
┌─ Trading (amber) ─────────────────────────────┐
│ profit_factor │ sharpe │ win_rate │ n_trades   │
│ cost_impact │ max_drawdown │ avg_duration      │
└───────────────────────────────────────────────┘
┌─ Trained Models (collapsible) ────────────────┐
│ Model browser tree                            │
└───────────────────────────────────────────────┘
```

## File Changes

| File | Action |
|------|--------|
| `src/client/src/pages/Training.tsx` | **Rewrite** — scrollable command center, no tabs |
| `src/client/src/components/training/tabs/TrainingTabs.tsx` | **Delete** — replaced by inline sections |
| `src/client/src/components/training/tabs/OverviewTab.tsx` | **Delete** — MetricGrid renders directly in Training.tsx |
| `src/client/src/components/training/tabs/ConvergenceTab.tsx` | **Keep for reference** — streaming logic moves to Training.tsx |
| `src/client/src/components/renderers/MetricGrid.tsx` | **Extend** — add section accent colors per group |
| `src/client/src/components/renderers/RendererShell.tsx` | **Extend** — add hover tooltip with mission/thresholds |
| `src/client/src/components/training/ConfigStrip.tsx` | **New** — inline config cards with expandable hyperparameter drawer |
| `src/client/src/components/training/ModelBrowser.tsx` | **Modify** — collapsible section instead of modal |

## What Stays

- All 14 renderer components (GaugeRenderer, NumberRenderer, etc.) — unchanged
- `metricDeclarations` in models.json — unchanged
- `SelfDescribingDiagnostics` schema — unchanged
- `useTrainingLive()` SSE hook — unchanged
- `useTrainingControl()` context — unchanged
- `HyperparameterForm` component — reused inside config strip drawer

## Testing

- Verify all 19 CNN-Transformer metric cards render in awaiting state
- Verify HDP-HMM model switch shows different metric set (8 cards)
- Verify hover tooltips display mission + thresholds on every card
- Verify config strip model/market/hyperparameter cards are interactive
- Verify Run Training button triggers training and metrics stream live
- Verify section colors match group assignments
