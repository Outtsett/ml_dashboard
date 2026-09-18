/**
 * Contract types for the architecture-explorer graph module.
 *
 * An ArchGraph is a faithful, source-derived schematic of one trainable
 * architecture: nodes are real layers/stages read from the actual model
 * source (src/ml/blocks/*, src/templates/architectures/*.py.j2,
 * src/ml/xgb_classifier/main.py), never invented. Layout is a simple
 * column (x, data-flow left→right) × lane (y, parallel branches) grid;
 * the renderer (NetworkDiagram) owns pixel geometry.
 */

export type LayerKind =
  | 'input'
  | 'embedding'
  | 'positional'
  | 'conv'
  | 'attention'
  | 'norm'
  | 'dropout'
  | 'linear'
  | 'activation'
  | 'recurrent'
  | 'gate'
  | 'fusion'
  | 'pool'
  | 'reshape'
  | 'head'
  | 'output'
  | 'tree'
  | 'ensemble'
  // Added 2026-09-18 for the catalog blueprints, which cover models that are
  // not layer stacks: samplers, distance/loss comparisons, addressable memory
  // and partition steps have no honest home among the layer kinds above.
  | 'stochastic'
  | 'compare'
  | 'memory'
  | 'cluster';

export interface ArchNode {
  id: string;
  kind: LayerKind;
  /** Class/stage name, e.g. "MultiHeadSelfAttention". */
  label: string;
  /** Compact config line, e.g. "4 heads · d_model 128". */
  sublabel?: string;
  /** Symbolic input shape, e.g. "B × 64 × 5" (uses × U+00D7). */
  inShape?: string;
  /** Symbolic output shape. */
  outShape?: string;
  /** Trainable parameter count for this node (real formula, not a guess). */
  params?: number;
  /** Layout column (x, 0-based; left→right = data flow). */
  column: number;
  /** Layout lane (y, 0-based) for parallel branches. */
  lane: number;
  /** Hover table rows — real config values only. */
  detail?: Record<string, string | number>;
  /** One-sentence trading-grounded "Think of it as ..." line. */
  analogy?: string;
}

export interface ArchEdge {
  from: string;
  to: string;
  kind: 'flow' | 'residual' | 'context';
  label?: string;
}

export interface ArchGraph {
  title: string;
  subtitle?: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  /** Sum of every node's params. */
  totalParams: number;
  /** max(column) + 1 */
  columns: number;
  /** max(lane) + 1 */
  lanes: number;
}

/** A numeric hyperparameter that reshapes the diagram (slider spec). */
export interface TunableHp {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
}
