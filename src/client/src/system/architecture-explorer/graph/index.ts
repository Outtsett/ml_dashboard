/**
 * architecture-explorer / graph — public surface.
 *
 * Faithful, source-derived architecture schematics for the trainable models in
 * this repo, plus the 2D SVG renderer that draws them. See derive.ts for the
 * per-model derivations (all parameter counts are exact PyTorch weight sizes)
 * and NetworkDiagram.tsx for the interactive renderer.
 *
 * flow.ts schedules those derivations into an animatable data-flow plan (real
 * tensor shapes, real head splits, real dimension transforms — no activations
 * are simulated); catalog.ts resolves real `/api/model-catalog/trainable`
 * entries to the derivations that genuinely model them, and explains the ones
 * it won't draw rather than faking a graph for them.
 */

export type {
  LayerKind,
  ArchNode,
  ArchEdge,
  ArchGraph,
  TunableHp,
} from './types';

export { LAYER_PALETTE } from './palette';
export type { LayerPaletteEntry } from './palette';

export { deriveArchGraph, SUPPORTED_ALGORITHMS, TUNABLE_HPS } from './derive';

export {
  buildCatalogOptions,
  fallbackOptions,
  resolveGraphSupport,
} from './catalog';
export type { CatalogGraphOption, CatalogEntryLike, GraphSupport } from './catalog';

export {
  buildFlowPlan,
  parseShape,
  renderShape,
  tweenShape,
  edgeProgress,
  activeStage,
} from './flow';
export type {
  FlowPlan,
  FlowEdgePlan,
  ShapeTransform,
  HeadSplit,
  ShapeDims,
} from './flow';

export { NetworkDiagram } from './NetworkDiagram';
