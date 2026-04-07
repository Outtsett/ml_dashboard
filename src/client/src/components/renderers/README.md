# Renderers — Self-Describing Metric Renderers

15 metric renderer components + infrastructure for the self-describing diagnostics system. Models declare what metrics they emit and how to render them; the dashboard renders whatever the model declares without model-specific UI code.

## How It Works

1. Model emits `metric_declarations` via stdout protocol (renderer type, mission, context thresholds, group)
2. Server broadcasts declarations via SSE
3. `MetricGrid` receives declarations + live metric values
4. `RendererShell` wraps each metric with consistent card chrome (title, mission text, context badges)
5. The appropriate renderer component is selected by `renderer` type

## Renderer Components

| File | Renderer Type | Visualization |
|---|---|---|
| `GaugeRenderer.tsx` | `gauge` | Radial gauge with breakeven/good/great thresholds |
| `NumberRenderer.tsx` | `number` | Formatted number with unit and context |
| `PercentRenderer.tsx` | `percent` | Percentage with colored bar |
| `BarsRenderer.tsx` | `bars` | Horizontal bar chart |
| `PrecisionBarsRenderer.tsx` | `precision_bars` | High-precision bars (per-class metrics) |
| `ConfusionMatrixRenderer.tsx` | `confusion_matrix` | Heatmap confusion matrix |
| `FoldBarsRenderer.tsx` | `fold_bars` | Per-fold walk-forward bars |
| `ChartOverlayRenderer.tsx` | `chart_overlay` | Chart overlay data |
| `TimeSeriesRenderer.tsx` | `time_series` | Line chart time series |
| `HeatmapRenderer.tsx` | `heatmap` | 2D heatmap (transition matrices) |
| `DistributionRenderer.tsx` | `distribution` | Histogram/density distribution |
| `TableRenderer.tsx` | `table` | Data table |
| `RingRenderer.tsx` | `ring` | Donut/ring chart |
| `TextRenderer.tsx` | `text` | Formatted text block |
| `Surface3DRenderer.tsx` | `surface_3d` | Three.js/R3F 3D loss surface with trajectory |

## Infrastructure

| File | Purpose |
|---|---|
| `MetricGrid.tsx` | 12-column responsive grid layout. Filters metrics by active group, renders via registry lookup. |
| `RendererShell.tsx` | Consistent card wrapper: title, mission text, context badges, loading state. |
| `index.ts` | Renderer registry: maps renderer type strings to component imports. |

## Section Colors

Each metric group gets a consistent color theme:
- `deep_learning` = purple
- `machine_learning` = cyan
- `trading` = amber
- `regimes` = orange
- `quality` = teal
- `features` = indigo
