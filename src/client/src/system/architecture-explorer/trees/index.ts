/**
 * Barrel for the model-anatomy tree views. Consumers import from
 * `@/system/architecture-explorer/trees` so the internal file layout can be
 * refactored without churning callsites.
 */

export type {
  XgbTreeNode,
  AnatomyModelMeta,
  AnatomyModelsResponse,
  ModelTreesResponse,
  ForestSummary,
  ForestFeatureUsage,
  ForestDepthBin,
  ForestLeafBin,
  DivergingToken,
} from "./types";

export {
  flattenTree,
  countDescendants,
  coverFraction,
  findPath,
  decisionPath,
  formatThreshold,
  formatLeafValue,
  resolveFeature,
  leafValueToken,
  gainStopIndex,
  gainFillOpacity,
  GAIN_STOPS,
  LEAF_NEUTRAL_BAND,
} from "./types";

export { useAnatomyModels, useModelTrees, useForestSummary } from "./useAnatomy";

export { TreeDiagram } from "./TreeDiagram";
export type { TreeDiagramProps } from "./TreeDiagram";

export { ForestPanel } from "./ForestPanel";
export type { ForestPanelProps } from "./ForestPanel";
