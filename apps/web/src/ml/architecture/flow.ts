/**
 * buildFlowPlan — a time-indexed data-flow schedule derived from an ArchGraph.
 *
 * ═══ WHAT IS REAL HERE ═══════════════════════════════════════════════════════
 * Everything in a FlowPlan is architecture math already computed by derive.ts
 * from real model source. Nothing is sampled, simulated, or randomised:
 *
 *   - `edges[].shape`     the source node's real `outShape` (e.g. "B × 64 × 5")
 *   - `transforms`        the real inShape → outShape change across a layer,
 *                         both endpoints straight off the ArchNode
 *   - `heads`             real `n_heads` / `d_model` from the node's detail
 *                         table; `dHead = d_model / n_heads` recomputed here
 *                         only when derive.ts didn't already carry `d_head`
 *   - the schedule        node.column IS the data-flow order derive.ts laid
 *                         out, so "stage k" is a real position in the network
 *
 * There are NO activations, attention weights, gradients or logits anywhere in
 * this module, because no trained model or recorded forward pass is in play.
 * A shape transform's intermediate frames (see `tweenShape`) interpolate
 * BETWEEN TWO REAL DERIVED DIMENSIONS purely as a visual morph — an in-flight
 * frame is a transition artifact, never a claimed tensor size.
 *
 * ═══ THE SCHEDULE ════════════════════════════════════════════════════════════
 * Time `p` is measured in stages, not seconds. A node at column c occupies the
 * window [c, c+1] (it is "computing"); its output is ready at t = c+1. An edge
 * therefore departs at `srcCol + 1` and arrives at `dstCol + 1`.
 *
 * That falls out correctly for residuals without special-casing: derive.ts
 * wires `layerInput → ff` (residual) alongside `layerInput → sa → ff` (flow).
 * The skip departs at the same instant as the first flow hop and arrives at the
 * same instant as the second — one long parallel arc racing two short hops, so
 * the highway is visibly carrying the same data past attention.
 */

import type { ArchGraph, ArchNode } from './types';

// ── shape parsing ───────────────────────────────────────────────────────────

/** One parsed tensor shape: literal axis tokens, numeric where numeric. */
export type ShapeDims = readonly (number | string)[];

const AXIS_SEP = /\s*×\s*/;

/**
 * Parse a derive.ts shape string ("B × 64 × 5") into its axis tokens.
 * Returns null for the multi-input forms derive.ts writes for fusion nodes
 * ("B × 64 × 112  |  B × 64 × 16") — those have no single shape to ride a wire.
 */
export function parseShape(s: string | undefined): ShapeDims | null {
  if (!s) return null;
  if (s.includes('|')) return null;
  const parts = s.trim().split(AXIS_SEP).filter((t) => t.length > 0);
  if (parts.length === 0) return null;
  return parts.map((t) => (/^\d+$/.test(t) ? Number(t) : t));
}

/** Compact re-render of parsed dims: "B×64×5" (no spaces — badge real estate). */
export function renderShape(dims: ShapeDims): string {
  return dims.join('×');
}

// ── plan shapes ─────────────────────────────────────────────────────────────

export interface FlowEdgePlan {
  key: string;
  from: string;
  to: string;
  kind: 'flow' | 'residual' | 'context';
  /** Real tensor shape riding this wire = source node's outShape. */
  shape: ShapeDims | null;
  /** Badge text for this wire (explicit edge label wins over the shape). */
  badge: string | null;
  /** Stage-time the data leaves the source (= source column + 1). */
  departAt: number;
  /** Stage-time the data reaches the target (= target column + 1). */
  arriveAt: number;
}

/** A real dimension change across one layer. Both endpoints come from derive.ts. */
export interface ShapeTransform {
  nodeId: string;
  from: ShapeDims;
  to: ShapeDims;
  /** Indices whose numeric value changes. Empty when only the rank changes. */
  changed: number[];
  /** True when in/out have different rank — morphed as a swap, never tweened. */
  rankChange: boolean;
  /** Stage-time the transform happens (the node's own compute window start). */
  at: number;
  column: number;
  lane: number;
}

/** Real attention-head split. `dHead` is d_model / n_heads. */
export interface HeadSplit {
  nodeId: string;
  nHeads: number;
  dModel: number;
  /** floor(d_model / n_heads) — derive.ts's own value when it carries one. */
  dHead: number;
  /** d_model - n_heads·dHead. Non-zero when the split doesn't divide evenly. */
  remainder: number;
  at: number;
  column: number;
  lane: number;
}

export interface FlowPlan {
  edges: FlowEdgePlan[];
  transforms: ShapeTransform[];
  heads: HeadSplit[];
  /** Node ids per column index — stage k is `stages[k]`. */
  stages: string[][];
  /** Number of stages = graph.columns. */
  stageCount: number;
  /** End of the timeline in stage units (last column's output + one beat). */
  timelineEnd: number;
  inputIds: string[];
  outputIds: string[];
}

// ── derivation ──────────────────────────────────────────────────────────────

function readInt(v: string | number | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * Read the real head split off an attention node's detail table.
 * Returns null when the node doesn't carry a usable n_heads / d_model pair —
 * we never guess a head count.
 */
export function readHeadSplit(node: ArchNode): HeadSplit | null {
  if (node.kind !== 'attention') return null;
  const detail = node.detail ?? {};
  const nHeads = readInt(detail['n_heads'] as string | number | undefined);
  const dModel = readInt(detail['d_model'] as string | number | undefined);
  if (nHeads == null || dModel == null || nHeads < 1 || dModel < 1) return null;
  const carried = readInt(detail['d_head'] as string | number | undefined);
  const dHead = carried ?? Math.floor(dModel / nHeads);
  return {
    nodeId: node.id,
    nHeads,
    dModel,
    dHead,
    remainder: dModel - nHeads * dHead,
    at: node.column,
    column: node.column,
    lane: node.lane,
  };
}

/** Real in→out dimension change for a node, or null when the shape is unchanged. */
export function readTransform(node: ArchNode): ShapeTransform | null {
  const from = parseShape(node.inShape);
  const to = parseShape(node.outShape);
  if (!from || !to) return null;
  if (renderShape(from) === renderShape(to)) return null;

  const rankChange = from.length !== to.length;
  const changed: number[] = [];
  if (!rankChange) {
    for (let i = 0; i < from.length; i += 1) {
      if (from[i] !== to[i]) changed.push(i);
    }
    if (changed.length === 0) return null;
  }
  return {
    nodeId: node.id,
    from,
    to,
    changed,
    rankChange,
    at: node.column,
    column: node.column,
    lane: node.lane,
  };
}

/**
 * Interpolate one real shape toward another for the in-flight morph.
 *
 * ONLY the numeric axes that genuinely differ move, and they move between the
 * two real derived endpoints. At u=0 this returns exactly `from`; at u=1
 * exactly `to`. Intermediate values are a visual transition — they are not,
 * and are never presented as, a tensor the model actually produces.
 */
export function tweenShape(t: ShapeTransform, u: number): ShapeDims {
  if (t.rankChange) return u < 0.5 ? t.from : t.to;
  const k = Math.min(1, Math.max(0, u));
  return t.from.map((v, i): number | string => {
    if (!t.changed.includes(i)) return v;
    const a = t.from[i];
    const b = t.to[i];
    // Non-numeric axes (e.g. a symbolic "B") cannot be interpolated — snap at
    // the midpoint. `v` is the already-narrowed `from` element, so it stands in
    // whenever an index widens to undefined under noUncheckedIndexedAccess.
    if (typeof a !== 'number' || typeof b !== 'number') {
      return (k < 0.5 ? a : b) ?? v;
    }
    return Math.round(a + (b - a) * k);
  });
}

/**
 * Build the flow plan for a derived graph.
 *
 * Pure: same graph in, same plan out. No clock, no DOM, no randomness.
 */
export function buildFlowPlan(graph: ArchGraph): FlowPlan {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));

  const stages: string[][] = Array.from({ length: graph.columns }, () => []);
  for (const n of graph.nodes) {
    const col = stages[n.column];
    if (col) col.push(n.id);
  }

  const edges: FlowEdgePlan[] = [];
  graph.edges.forEach((e, i) => {
    const s = byId.get(e.from);
    const d = byId.get(e.to);
    if (!s || !d) return;
    const shape = parseShape(s.outShape) ?? parseShape(s.inShape);
    edges.push({
      key: `${e.from}->${e.to}-${e.kind}-${i}`,
      from: e.from,
      to: e.to,
      kind: e.kind,
      shape,
      badge: e.label ?? (shape ? renderShape(shape) : null),
      departAt: s.column + 1,
      arriveAt: d.column + 1,
    });
  });

  const transforms: ShapeTransform[] = [];
  const heads: HeadSplit[] = [];
  for (const n of graph.nodes) {
    const t = readTransform(n);
    if (t) transforms.push(t);
    const h = readHeadSplit(n);
    if (h) heads.push(h);
  }

  // Terminals — by kind first, falling back to pure graph degree so the plan
  // still resolves for families that don't use input/output kinds.
  const hasIncoming = new Set(graph.edges.filter((e) => e.kind === 'flow').map((e) => e.to));
  const hasOutgoing = new Set(graph.edges.filter((e) => e.kind === 'flow').map((e) => e.from));
  const byKind = (k: ArchNode['kind']) => graph.nodes.filter((n) => n.kind === k).map((n) => n.id);
  const inputIds = byKind('input');
  const outputIds = byKind('output');

  return {
    edges,
    transforms,
    heads,
    stages,
    stageCount: graph.columns,
    timelineEnd: graph.columns + 1,
    inputIds: inputIds.length > 0 ? inputIds : graph.nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id),
    outputIds: outputIds.length > 0 ? outputIds : graph.nodes.filter((n) => !hasOutgoing.has(n.id)).map((n) => n.id),
  };
}

/**
 * Fraction of an edge's transit completed at stage-time `p`.
 * < 0 → not departed yet; > 1 → already delivered.
 */
export function edgeProgress(e: FlowEdgePlan, p: number): number {
  const span = e.arriveAt - e.departAt;
  if (span <= 0) return p >= e.arriveAt ? 1 : 0;
  return (p - e.departAt) / span;
}

/** The stage (column index) that is computing at stage-time `p`. */
export function activeStage(p: number, stageCount: number): number {
  return Math.min(stageCount - 1, Math.max(0, Math.floor(p)));
}
