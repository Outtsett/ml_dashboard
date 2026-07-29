/**
 * Renderer Registry — Maps RendererType to React component.
 *
 * Single source of truth for resolving metric renderers.
 * Adding a new renderer: create the component, add it here.
 */

import type { RendererType, RendererRegistry, RendererProps } from "@/ml/lib/diagnostics-schema";
import type React from 'react';

import { GaugeRenderer } from './GaugeRenderer';
import { NumberRenderer } from './NumberRenderer';
import { PercentRenderer } from './PercentRenderer';
import { BarsRenderer } from './BarsRenderer';
import { PrecisionBarsRenderer } from './PrecisionBarsRenderer';
import { ConfusionMatrixRenderer } from './ConfusionMatrixRenderer';
import { FoldBarsRenderer } from './FoldBarsRenderer';
import { ChartOverlayRenderer } from './ChartOverlayRenderer';
import { TimeSeriesRenderer } from './TimeSeriesRenderer';
import { HeatmapRenderer } from './HeatmapRenderer';
import { DistributionRenderer } from './DistributionRenderer';
import { TableRenderer } from './TableRenderer';
import { RingRenderer } from './RingRenderer';
import { TextRenderer } from './TextRenderer';
import { Surface3DRenderer } from './Surface3DRenderer';

export const RENDERER_REGISTRY: RendererRegistry = {
  gauge: GaugeRenderer,
  number: NumberRenderer,
  percent: PercentRenderer,
  bars: BarsRenderer,
  precision_bars: PrecisionBarsRenderer,
  confusion_matrix: ConfusionMatrixRenderer,
  fold_bars: FoldBarsRenderer,
  chart_overlay: ChartOverlayRenderer,
  time_series: TimeSeriesRenderer,
  heatmap: HeatmapRenderer,
  distribution: DistributionRenderer,
  table: TableRenderer,
  ring: RingRenderer,
  text: TextRenderer,
  surface_3d: Surface3DRenderer,
};

/**
 * Resolve a renderer component by type.
 * Returns the matching component or TextRenderer as fallback for unknown types.
 */
export function resolveRenderer(type: RendererType): React.ComponentType<RendererProps> {
  return RENDERER_REGISTRY[type] ?? TextRenderer;
}

/**
 * Renderer types that can meaningfully overlay >1 run on ONE chart (as
 * opposed to fanning into small multiples). See plan §2.6.
 *
 * `MetricGrid` consults this set to decide, per metric, whether to render a
 * single overlay-aware component with `series` populated, or fan the card
 * into N `compact` small multiples of the plain (non-overlay) component.
 * A renderer must actually read `props.series` to belong here — listing one
 * that doesn't would silently drop every non-primary run instead of showing
 * it, which is worse than the small-multiples fallback.
 *
 * `confusion_matrix`, `heatmap`, `surface_3d`, `precision_bars`, `table`,
 * `ring`, `text`, `gauge`, `number`, `percent`, and `chart_overlay` are
 * deliberately excluded — either superimposition is meaningless (matrices,
 * heatmaps, 3D surfaces) or the redesign needed to overlay them (column-
 * per-run tables, N-value strips) is out of scope for this stage.
 */
export const OVERLAY_CAPABLE: ReadonlySet<RendererType> = new Set<RendererType>([
  'time_series',
  'bars',
  'fold_bars',
  'distribution',
]);

// Re-export all renderers for direct import
export { GaugeRenderer } from './GaugeRenderer';
export { NumberRenderer } from './NumberRenderer';
export { PercentRenderer } from './PercentRenderer';
export { BarsRenderer } from './BarsRenderer';
export { PrecisionBarsRenderer } from './PrecisionBarsRenderer';
export { ConfusionMatrixRenderer } from './ConfusionMatrixRenderer';
export { FoldBarsRenderer } from './FoldBarsRenderer';
export { ChartOverlayRenderer } from './ChartOverlayRenderer';
export { TimeSeriesRenderer } from './TimeSeriesRenderer';
export { HeatmapRenderer } from './HeatmapRenderer';
export { DistributionRenderer } from './DistributionRenderer';
export { TableRenderer } from './TableRenderer';
export { RingRenderer } from './RingRenderer';
export { TextRenderer } from './TextRenderer';
export { Surface3DRenderer } from './Surface3DRenderer';
export { RendererShell } from './RendererShell';
