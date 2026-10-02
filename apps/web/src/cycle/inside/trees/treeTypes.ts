/**
 * Pure helpers the tree views render with — no React, no DOM, so they are unit
 * testable (`apps/web/tests/cycle-inside-trees.test.tsx`).
 *
 * Reads the columnar `bar.trees` block of `@shared/cycle/explain`: tree t's
 * path is `pathOffsets[t] .. pathOffsets[t+1]-1`, root first; each step is one
 * question the tree asked this bar; `pathWentLeft` is the "yes" branch (left,
 * or the matching side of a CatBoost border). `runningTotal[t]` is the base
 * plus every leaf through tree t (forests: the running mean) and its last
 * value equals `bar.output.raw` — the views never recompute it.
 *
 * Also the whole-tree shape for `TreeDiagram.tsx`: the node columns of
 * `CycleExplainTree` (children as positions, -1 = none) turned into a nested
 * datum d3-hierarchy can lay out.
 */
import type { CycleExplainBar, CycleExplainRole, CycleExplainStructure, CycleExplainTree } from "@shared/cycle/explain";

import { CYCLE_COLORS } from "../../chartModel";
import { linkProbability } from "../OutputChain";

export type SplitRule = CycleExplainTree["splitRule"];
export type BarTrees = NonNullable<CycleExplainBar["trees"]>;

/** The comparison each split makes, as the path text prints it. */
export const SPLIT_OPERATOR: Record<SplitRule, string> = {
  less_than: "<",
  less_or_equal: "≤",
  greater_than: ">",
};

// ─── numbers ─────────────────────────────────────────────────────────────────

/** Four significant digits, exponent form only for extreme scales; "—" for a missing value. */
export function formatValue(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 0.0001 || magnitude >= 1_000_000)) return value.toExponential(2);
  return Number(value.toPrecision(digits)).toString();
}

/** Like `formatValue` with an explicit sign: "+0.12", "−0.05", "0". */
export function formatSigned(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const text = formatValue(Math.abs(value), digits);
  if (value > 0) return `+${text}`;
  if (value < 0) return `−${text}`;
  return text;
}

// ─── push: which way a leaf moves the answer ────────────────────────────────

/**
 * The value a leaf is measured against. A forest's direction trees each vote a
 * chance of up, so a vote pushes up when it is above one half; everything else
 * (boosting log-odds, target units) pushes up when it is above zero.
 */
export function leafCenter(structure: CycleExplainStructure): number {
  return structure.trees?.aggregation === "mean" && structure.link === "mean_probability" ? 0.5 : 0;
}

export function leafPush(value: number, center: number): number {
  return value - center;
}

export type PushSign = 1 | -1 | 0;

export function pushSign(push: number): PushSign {
  if (push > 0) return 1;
  if (push < 0) return -1;
  return 0;
}

/** Orange pushes up, blue pushes down, neutral grey for exactly nothing — always shown with the glyph and the sign too. */
export function pushColor(push: number): string {
  const sign = pushSign(push);
  return sign === 1 ? CYCLE_COLORS.up : sign === -1 ? CYCLE_COLORS.down : CYCLE_COLORS.neutral;
}

export function pushGlyph(push: number): string {
  const sign = pushSign(push);
  return sign === 1 ? "▲" : sign === -1 ? "▼" : "•";
}

export function pushWords(push: number): string {
  const sign = pushSign(push);
  return sign === 1 ? "pushes up" : sign === -1 ? "pushes down" : "pushes neither way";
}

// ─── paths ───────────────────────────────────────────────────────────────────

export interface PathStep {
  node: number;
  feature: number;
  threshold: number;
  /** True when the bar took the "yes" branch. */
  wentYes: boolean;
}

export function usedTreeTotal(trees: BarTrees | null | undefined): number {
  return trees?.leafValues.length ?? 0;
}

export function pathSteps(trees: BarTrees, treeIndex: number): PathStep[] {
  const start = trees.pathOffsets[treeIndex] ?? 0;
  const end = trees.pathOffsets[treeIndex + 1] ?? start;
  const steps: PathStep[] = [];
  for (let position = start; position < end; position += 1) {
    steps.push({
      node: trees.pathNode[position] ?? 0,
      feature: trees.pathFeature[position] ?? 0,
      threshold: trees.pathThreshold[position] ?? Number.NaN,
      wentYes: trees.pathWentLeft[position] ?? false,
    });
  }
  return steps;
}

/** Every node the bar visited in one tree, the leaf included. */
export function pathNodeSet(trees: BarTrees, treeIndex: number): Set<number> {
  const nodes = new Set(pathSteps(trees, treeIndex).map((step) => step.node));
  const leaf = trees.leafNode[treeIndex];
  if (leaf !== undefined) nodes.add(leaf);
  return nodes;
}

/** One question in words: "Relative strength index 14 = 0.8 < 0.5? no →". */
export function questionText(step: PathStep, featureNames: readonly string[], values: readonly (number | null)[], rule: SplitRule): string {
  const name = featureNames[step.feature] ?? `Input ${step.feature + 1}`;
  const value = values[step.feature];
  const answer = step.wentYes ? "yes" : "no";
  if (value === null || value === undefined) {
    return `${name} is missing, so it goes the "${answer}" way →`;
  }
  return `${name} = ${formatValue(value)} ${SPLIT_OPERATOR[rule]} ${formatValue(step.threshold)}? ${answer} →`;
}

/** The whole path of one tree in words, ending at its leaf. */
export function pathInWords(
  trees: BarTrees,
  treeIndex: number,
  featureNames: readonly string[],
  values: readonly (number | null)[],
  rule: SplitRule,
  center: number,
): string[] {
  const lines = pathSteps(trees, treeIndex).map((step) => questionText(step, featureNames, values, rule));
  const leaf = trees.leafValues[treeIndex];
  if (leaf !== undefined) {
    const push = leafPush(leaf, center);
    lines.push(`leaf ${formatSigned(leaf)} ${pushGlyph(push)} ${pushWords(push)}`);
  }
  return lines;
}

/** How many times each input was asked about along this bar's paths (every used tree). */
export function splitCountsFromPaths(trees: BarTrees | null | undefined, featureCount: number): number[] {
  const counts = new Array<number>(featureCount).fill(0);
  if (!trees) return counts;
  for (const feature of trees.pathFeature) {
    if (feature >= 0 && feature < featureCount) counts[feature] = (counts[feature] ?? 0) + 1;
  }
  return counts;
}

// ─── sorting ─────────────────────────────────────────────────────────────────

export type TreeSortMode = "tree_order" | "biggest_push";

/** Tree positions in display order. Ties keep tree order. */
export function sortTreeIndices(leafValues: readonly number[], center: number, mode: TreeSortMode): number[] {
  const indices = leafValues.map((_, index) => index);
  if (mode === "tree_order") return indices;
  return indices.sort((a, b) => {
    const difference = Math.abs(leafPush(leafValues[b] ?? 0, center)) - Math.abs(leafPush(leafValues[a] ?? 0, center));
    return difference !== 0 ? difference : a - b;
  });
}

// ─── the running total ──────────────────────────────────────────────────────

export interface AggregationPoint {
  /** Trees counted so far (0 = none). */
  treesIncluded: number;
  treeTotal: number;
  /** The raw value after `treesIncluded` trees: base + leaves (sum) or the mean vote (mean); null for a mean of no trees. */
  value: number | null;
  /** The leaves added so far (sum), or null for a mean. */
  leafSum: number | null;
  /** `value` through the link, when the link is a function of the raw value alone. */
  probabilityUp: number | null;
}

export function aggregationAt(bar: CycleExplainBar, structure: CycleExplainStructure, step: number): AggregationPoint {
  const trees = bar.trees;
  const total = usedTreeTotal(trees);
  const included = Math.max(0, Math.min(total, Math.round(step)));
  const mean = structure.trees?.aggregation === "mean";
  if (!trees) return { treesIncluded: 0, treeTotal: 0, value: null, leafSum: null, probabilityUp: null };
  let value: number | null;
  if (included === 0) value = mean ? null : trees.baseValue;
  else value = trees.runningTotal[included - 1] ?? null;
  let leafSum: number | null = null;
  if (!mean) {
    leafSum = 0;
    for (let index = 0; index < included; index += 1) leafSum += trees.leafValues[index] ?? 0;
  }
  const probabilityUp = value === null ? null : linkProbability(bar.link, value, structure);
  return { treesIncluded: included, treeTotal: total, value, leafSum, probabilityUp };
}

// ─── CatBoost: answers spell the leaf number ────────────────────────────────

export interface SpelledLeaf {
  /** The answers as binary digits (1 = yes), written most significant first. */
  bits: string;
  /** Which level is the lowest bit, when the answers reproduce the library's leaf index; null when neither order does. */
  order: "first_level_lowest" | "first_level_highest" | null;
  index: number;
}

/**
 * The leaf number a symmetric tree's yes/no answers spell. The library's own
 * index (`leafNode`) is authoritative; the bit order shown is the one that
 * reproduces it, so the text never claims an order the library did not use.
 */
export function spellObliviousLeaf(answers: readonly boolean[], leafIndex: number): SpelledLeaf {
  const lowestFirst = answers.reduce((sum, yes, level) => sum + (yes ? 1 << level : 0), 0);
  const highestFirst = answers.reduce((sum, yes, level) => sum + (yes ? 1 << (answers.length - 1 - level) : 0), 0);
  if (lowestFirst === leafIndex) {
    return { bits: answers.map((yes) => (yes ? "1" : "0")).reverse().join(""), order: "first_level_lowest", index: leafIndex };
  }
  if (highestFirst === leafIndex) {
    return { bits: answers.map((yes) => (yes ? "1" : "0")).join(""), order: "first_level_highest", index: leafIndex };
  }
  return { bits: answers.map((yes) => (yes ? "1" : "0")).join(""), order: null, index: leafIndex };
}

// ─── whole tree (TreeDiagram) ───────────────────────────────────────────────

export interface TreeNodeDatum {
  /** Node position in the columns. */
  index: number;
  feature: number;
  threshold: number | null;
  missingGoesLeft: boolean | null;
  value: number;
  cover: number | null;
  depth: number;
  isLeaf: boolean;
  /** The "yes" child's position (left), or -1. */
  yesChild: number;
  noChild: number;
  children: TreeNodeDatum[];
}

/** Nested datum from the node columns; null for an empty tree. Guards against cycles in a malformed reply. */
export function buildTreeNodes(tree: CycleExplainTree): TreeNodeDatum | null {
  const { nodes } = tree;
  const count = nodes.left.length;
  if (count === 0) return null;
  const seen = new Set<number>();
  const build = (index: number): TreeNodeDatum => {
    seen.add(index);
    const left = nodes.left[index] ?? -1;
    const right = nodes.right[index] ?? -1;
    const isLeaf = (left < 0 && right < 0) || (nodes.feature[index] ?? -1) < 0;
    const children: TreeNodeDatum[] = [];
    if (!isLeaf) {
      for (const child of [left, right]) {
        if (child >= 0 && child < count && !seen.has(child)) children.push(build(child));
      }
    }
    return {
      index,
      feature: nodes.feature[index] ?? -1,
      threshold: nodes.threshold[index] ?? null,
      missingGoesLeft: nodes.missingGoesLeft[index] ?? null,
      value: nodes.value[index] ?? 0,
      cover: nodes.cover[index] ?? null,
      depth: nodes.depth[index] ?? 0,
      isLeaf,
      yesChild: left,
      noChild: right,
      children,
    };
  };
  return build(0);
}

export function countNodes(node: TreeNodeDatum): number {
  let total = 1;
  for (const child of node.children) total += countNodes(child);
  return total;
}

/** "the direction model" / "the price model" — for sentences. */
export function roleWords(role: CycleExplainRole): string {
  return role === "price" ? "price model" : "direction model";
}
