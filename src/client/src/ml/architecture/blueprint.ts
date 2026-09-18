/**
 * Blueprint builder — how a catalog spec's architecture is written down.
 *
 * Think of it as: a parts list with the arithmetic attached. A blueprint names
 * each stage of a model in data-flow order; the parameter count of every stage
 * comes from a formula in `P`, never from a number typed by hand. That is the
 * whole reason this file exists — a hand-typed "roughly 270k parameters" was
 * measured at 217,090 in this repo's own LSTM spec, and a count nobody can
 * re-derive is a count nobody can trust.
 *
 * A blueprint draws the architecture THE SPEC DESCRIBES. It is not a claim
 * about what ML Studio would train: several specs are generated through a
 * shared template (an LSTM spec renders the `pytorch_mlp` runner today). The
 * catalog states that separately, beside the diagram.
 */

import type { ArchEdge, ArchGraph, ArchNode, LayerKind } from './types';

// ─── Reference dimensions ───────────────────────────────────────────────────
//
// Every blueprint is sized for the same input so diagrams compare like for like:
// this repo's feature pipeline (35 features) over a 64-bar window.

export const DIM = {
  /** Features per bar — `src/config/features.json`. */
  features: 35,
  /** Bars in the input window. */
  window: 64,
  /** Output classes for a direction head (down / flat / up). */
  classes: 3,
} as const;

// ─── Parameter formulas ─────────────────────────────────────────────────────
//
// Each matches the framework's own accounting (PyTorch unless noted), so a
// blueprint's total can be checked against `sum(p.numel() for p in model.parameters())`.

export const P = {
  /** nn.Linear: weights + bias. */
  linear: (inputs: number, outputs: number, bias = true) => inputs * outputs + (bias ? outputs : 0),

  /** nn.Conv1d: out × (in / groups) × kernel + bias. */
  conv1d: (channelsIn: number, channelsOut: number, kernel: number, groups = 1, bias = true) =>
    channelsOut * (channelsIn / groups) * kernel + (bias ? channelsOut : 0),

  /** nn.Conv2d with a square kernel. */
  conv2d: (channelsIn: number, channelsOut: number, kernel: number, bias = true) =>
    channelsOut * channelsIn * kernel * kernel + (bias ? channelsOut : 0),

  /** nn.RNN, one layer: PyTorch keeps TWO bias vectors (bias_ih and bias_hh). */
  rnn: (inputs: number, hidden: number) => hidden * (inputs + hidden + 2),

  /** nn.LSTM, one layer: four gates. */
  lstm: (inputs: number, hidden: number) => 4 * hidden * (inputs + hidden + 2),

  /** nn.GRU, one layer: three gates. */
  gru: (inputs: number, hidden: number) => 3 * hidden * (inputs + hidden + 2),

  /** nn.MultiheadAttention: packed q/k/v projection + output projection. Heads do not change the count. */
  attention: (width: number) => P.linear(width, 3 * width) + P.linear(width, width),

  /** LayerNorm / BatchNorm affine: scale + shift. */
  norm: (width: number) => 2 * width,

  /** Transformer feed-forward block: width -> inner -> width. */
  feedForward: (width: number, inner: number) => P.linear(width, inner) + P.linear(inner, width),

  /** One pre-norm transformer encoder layer. */
  encoderLayer: (width: number, inner: number) =>
    P.attention(width) + P.feedForward(width, inner) + 2 * P.norm(width),

  /** nn.Embedding. */
  embedding: (entries: number, width: number) => entries * width,
} as const;

// ─── Builder ────────────────────────────────────────────────────────────────

export interface NodeSpec {
  id: string;
  kind: LayerKind;
  label: string;
  sublabel?: string;
  /** Symbolic shapes — use the × sign, e.g. "B × 64 × 35". */
  inShape?: string;
  outShape?: string;
  /** From `P`. Omit for stages with nothing to learn (0). */
  params?: number;
  /** 0-based, left to right in data-flow order. */
  column: number;
  /** 0-based, top to bottom — parallel branches. Defaults to 0. */
  lane?: number;
  detail?: Record<string, string | number>;
  /** One sentence, trading-grounded: "Think of it as ...". */
  analogy?: string;
}

export type EdgeSpec = [from: string, to: string, kind?: ArchEdge['kind'], label?: string];

export interface BlueprintSpec {
  title: string;
  subtitle?: string;
  nodes: NodeSpec[];
  edges: EdgeSpec[];
}

/** Assemble an ArchGraph; the totals are computed, never supplied. */
export function blueprint(spec: BlueprintSpec): ArchGraph {
  const nodes: ArchNode[] = spec.nodes.map((n) => ({ ...n, lane: n.lane ?? 0, params: n.params ?? 0 }));
  const edges: ArchEdge[] = spec.edges.map(([from, to, kind = 'flow', label]) => ({
    from,
    to,
    kind,
    ...(label ? { label } : {}),
  }));

  return {
    title: spec.title,
    subtitle: spec.subtitle,
    nodes,
    edges,
    totalParams: nodes.reduce((total, n) => total + (n.params ?? 0), 0),
    columns: Math.max(...nodes.map((n) => n.column)) + 1,
    lanes: Math.max(...nodes.map((n) => n.lane)) + 1,
  };
}

/** Chain ids into flow edges: `chain('a','b','c')` -> a->b, b->c. */
export function chain(...ids: string[]): EdgeSpec[] {
  return ids.slice(1).map((id, i): EdgeSpec => [ids[i]!, id]);
}

/** Problems that make a graph undrawable or dishonest. Empty means sound. */
export function validateBlueprint(graph: ArchGraph): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();

  for (const node of graph.nodes) {
    if (ids.has(node.id)) problems.push(`duplicate node id "${node.id}"`);
    ids.add(node.id);
    if (!Number.isInteger(node.column) || node.column < 0) problems.push(`${node.id}: bad column`);
    if (!Number.isInteger(node.lane) || node.lane < 0) problems.push(`${node.id}: bad lane`);
    if (!Number.isFinite(node.params ?? 0) || (node.params ?? 0) < 0 || !Number.isInteger(node.params ?? 0)) {
      problems.push(`${node.id}: parameter count ${node.params} is not a whole non-negative number`);
    }
  }

  const cells = new Map<string, string>();
  for (const node of graph.nodes) {
    const cell = `${node.column}:${node.lane}`;
    const other = cells.get(cell);
    if (other) problems.push(`${node.id} and ${other} share column ${node.column}, lane ${node.lane}`);
    cells.set(cell, node.id);
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const touched = new Set<string>();
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from) problems.push(`edge from unknown node "${edge.from}"`);
    if (!to) problems.push(`edge to unknown node "${edge.to}"`);
    if (from && to && edge.kind === 'flow' && to.column < from.column) {
      problems.push(`flow edge ${edge.from} -> ${edge.to} runs right to left`);
    }
    touched.add(edge.from);
    touched.add(edge.to);
  }
  for (const node of graph.nodes) {
    if (graph.nodes.length > 1 && !touched.has(node.id)) problems.push(`${node.id} is connected to nothing`);
  }

  if (!graph.nodes.some((n) => n.kind === 'input')) problems.push('no input node');
  if (!graph.nodes.some((n) => n.kind === 'output')) problems.push('no output node');
  if (graph.nodes.length < 4) problems.push('fewer than 4 stages — too coarse to explain anything');

  return problems;
}
