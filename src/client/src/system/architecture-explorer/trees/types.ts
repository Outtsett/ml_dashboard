/**
 * types — contract types for the /api/anatomy endpoints plus the pure
 * tree-walk / color-scale helpers TreeDiagram renders with.
 *
 * XgbTreeNode mirrors the RAW xgboost JSON dump node shape
 * (booster.get_dump(dump_format='json', with_stats=True)) verbatim — the
 * server passes dump nodes through untransformed, so the client type must
 * stay 1:1 with xgboost's serializer, never a cleaned-up re-shape.
 *
 * The helpers are pure functions (no React, no DOM) so they are directly
 * unit-testable — see tests/client/anatomyTrees.test.ts.
 */

// ============================================================
// Raw xgboost dump node
// ============================================================

export interface XgbTreeNode {
  nodeid: number;
  /** Present on split nodes in xgboost dumps; absent on leaves. */
  depth?: number;
  /** Feature name (or "fN" when the booster has no feature_names). */
  split?: string;
  split_condition?: number;
  /** Child nodeid taken when feature < split_condition. */
  yes?: number;
  /** Child nodeid taken when feature >= split_condition. */
  no?: number;
  /** Child nodeid taken when the feature value is missing. */
  missing?: number;
  gain?: number;
  cover: number;
  /** Leaf output value — present only on leaf nodes. */
  leaf?: number;
  children?: XgbTreeNode[];
}

// ============================================================
// /api/anatomy response payloads (CONTRACT-API — server owns impl)
// ============================================================

export interface AnatomyModelMeta {
  modelId: string;
  learner: "xgboost" | "sklearn";
  nTrees: number;
  nFeatures: number;
  features: string[];
  sizeBytes: number;
  modifiedAt: string;
}

/** GET /api/anatomy/models */
export interface AnatomyModelsResponse {
  models: AnatomyModelMeta[];
}

/** GET /api/anatomy/trees/:modelId?start=&count= */
export interface ModelTreesResponse {
  modelId: string;
  nTrees: number;
  features: string[];
  start: number;
  count: number;
  trees: XgbTreeNode[];
}

export interface ForestFeatureUsage {
  feature: string;
  nSplits: number;
  totalGain: number;
  totalCover: number;
}

export interface ForestDepthBin {
  depth: number;
  count: number;
}

export interface ForestLeafBin {
  x0: number;
  x1: number;
  count: number;
}

/** GET /api/anatomy/forest/:modelId */
export interface ForestSummary {
  modelId: string;
  nTrees: number;
  features: string[];
  maxDepth: number;
  avgLeaves: number;
  featureUsage: ForestFeatureUsage[];
  depthHistogram: ForestDepthBin[];
  leafValues: {
    min: number;
    max: number;
    mean: number;
    histogram: ForestLeafBin[];
  };
}

// ============================================================
// Pure helpers — tree walking
// ============================================================

/** Preorder DFS flatten (root first, yes-subtree before no-subtree). */
export function flattenTree(root: XgbTreeNode): XgbTreeNode[] {
  const out: XgbTreeNode[] = [];
  const stack: XgbTreeNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n) break;
    out.push(n);
    const kids = n.children;
    if (kids) {
      for (let i = kids.length - 1; i >= 0; i -= 1) {
        const child = kids[i];
        if (child) stack.push(child);
      }
    }
  }
  return out;
}

/** Count of nodes strictly below `node` (its whole subtree minus itself). */
export function countDescendants(node: XgbTreeNode): number {
  return flattenTree(node).length - 1;
}

/**
 * Fraction of the root's cover (≈ training samples, hessian-weighted) that
 * flows through `node`. Clamped to [0, 1]; degenerate root cover → 0.
 */
export function coverFraction(node: XgbTreeNode, rootCover: number): number {
  if (!Number.isFinite(rootCover) || rootCover <= 0) return 0;
  const f = node.cover / rootCover;
  if (!Number.isFinite(f)) return 0;
  return Math.max(0, Math.min(1, f));
}

/** Root-to-target node chain (inclusive both ends), or null when absent. */
export function findPath(
  root: XgbTreeNode,
  nodeid: number,
): XgbTreeNode[] | null {
  if (root.nodeid === nodeid) return [root];
  for (const child of root.children ?? []) {
    const sub = findPath(child, nodeid);
    if (sub) return [root, ...sub];
  }
  return null;
}

/**
 * Compact threshold formatting for split conditions — six significant
 * digits, trailing zeros stripped, exponent form only for extreme scales.
 */
export function formatThreshold(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.001 || a >= 100_000)) return v.toExponential(2);
  return Number(v.toPrecision(6)).toString();
}

/**
 * The decision path from the root to `nodeid` as human-readable condition
 * lines, one per traversed split: "feature < thr" on the yes-branch,
 * "feature >= thr" on the no-branch. Empty for the root itself or when the
 * nodeid is not present in the tree.
 */
export function decisionPath(root: XgbTreeNode, nodeid: number): string[] {
  const chain = findPath(root, nodeid);
  if (!chain || chain.length < 2) return [];
  const lines: string[] = [];
  for (let i = 0; i < chain.length - 1; i += 1) {
    const parent = chain[i];
    const child = chain[i + 1];
    if (!parent || !child) continue;
    if (parent.split == null || parent.split_condition == null) continue;
    const thr = formatThreshold(parent.split_condition);
    if (child.nodeid === parent.yes) {
      lines.push(`${parent.split} < ${thr}`);
    } else if (child.nodeid === parent.no) {
      lines.push(`${parent.split} >= ${thr}`);
    }
  }
  return lines;
}

/** Maps dump-style "fN" split names to real feature names when available. */
export function resolveFeature(split: string, features: string[]): string {
  const m = /^f(\d+)$/.exec(split);
  if (!m || !m[1]) return split;
  const idx = Number(m[1]);
  const name = features[idx];
  return name ?? split;
}

/** Signed leaf-value text — the value is ALWAYS visible on leaf pills
 *  (deuteranopia rule: color is reinforcement, never the sole channel). */
export function formatLeafValue(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const s = v.toFixed(3);
  return v > 0 ? `+${s}` : s;
}

// ============================================================
// Pure helpers — color scales (token names only; never hex)
// ============================================================

/** Diverging tokens from src/client/src/index.css — polarity of leaf values. */
export type DivergingToken =
  | "--data-div-neg-strong"
  | "--data-div-neg"
  | "--data-div-mid"
  | "--data-div-pos"
  | "--data-div-pos-strong";

/** |value|/maxAbs band below which a leaf is treated as ~0 (neutral mid). */
export const LEAF_NEUTRAL_BAND = 0.05;

/**
 * Discrete diverging color-stop for a leaf value. Negative → neg tokens,
 * ~zero → mid, positive → pos tokens; |value| ≥ 50% of the max magnitude
 * upgrades to the strong stop. Discrete stops, never continuous
 * interpolation.
 */
export function leafValueToken(value: number, maxAbs: number): DivergingToken {
  if (!Number.isFinite(value) || value === 0) return "--data-div-mid";
  if (!Number.isFinite(maxAbs) || maxAbs <= 0) return "--data-div-mid";
  const u = Math.min(1, Math.abs(value) / maxAbs);
  if (u <= LEAF_NEUTRAL_BAND) return "--data-div-mid";
  if (value > 0) return u >= 0.5 ? "--data-div-pos-strong" : "--data-div-pos";
  return u >= 0.5 ? "--data-div-neg-strong" : "--data-div-neg";
}

/** 5 discrete fill opacities for split-node gain shading (0.06 → 0.35). */
export const GAIN_STOPS = [0.06, 0.1325, 0.205, 0.2775, 0.35] as const;

/**
 * Discrete 5-stop index for a split node's gain relative to the tree's max
 * gain. Monotonic non-decreasing in `gain`; clamped to [0, 4].
 */
export function gainStopIndex(gain: number, maxGain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) return 0;
  if (!Number.isFinite(maxGain) || maxGain <= 0) return 0;
  const u = Math.min(1, gain / maxGain);
  return Math.min(GAIN_STOPS.length - 1, Math.floor(u * GAIN_STOPS.length));
}

/** Gain-scaled fill opacity — hsl(var(--data-seq-mid) / <this value>). */
export function gainFillOpacity(gain: number, maxGain: number): number {
  const idx = gainStopIndex(gain, maxGain);
  return GAIN_STOPS[idx] ?? GAIN_STOPS[0];
}
