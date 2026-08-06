/**
 * Engine resolution.
 *
 * Every researched model animates. Which engine draws it depends on how much we
 * can honestly show:
 *
 *   kernelId set + a bespoke engine exists  ->  that engine, with REAL computed
 *                                               values from the real algorithm
 *   otherwise                               ->  NodeFlow, which animates the
 *                                               model's real researched stage
 *                                               flow and computes nothing
 *
 * The fallback is not a lookalike substitution: NodeFlow renders THIS model's
 * own cited stages, loop shape and beats, and states on the canvas that no
 * values are computed. What it never does is borrow another model's algorithm.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { MechanismSpec } from '../registry';
import type { ArchetypeProps } from './types';

export * from './types';

type Engine = LazyExoticComponent<ComponentType<ArchetypeProps>>;

/** Bespoke engines, keyed by the kernel they genuinely reproduce. */
const CLUSTER_CANVAS: Engine = lazy(() =>
  import('./ClusterCanvas').then((m) => ({ default: m.ClusterCanvas })),
);

/**
 * Bespoke engines, keyed by the kernel they genuinely reproduce.
 *
 * The clustering kernels all render through ClusterCanvas, which dispatches on
 * kernelId to the real algorithm in compute/clustering.ts. Sharing a renderer
 * is not sharing an algorithm: DBSCAN grows density regions, Mean Shift climbs
 * a density estimate, SOM anneals a lattice. Each draws its own run.
 */
export const KERNEL_ENGINES: Record<string, Engine> = {
  kmeans: CLUSTER_CANVAS,
  gmm: CLUSTER_CANVAS,
  dbscan: CLUSTER_CANVAS,
  meanshift: CLUSTER_CANVAS,
  agglomerative: CLUSTER_CANVAS,
  som: CLUSTER_CANVAS,
  copkmeans: CLUSTER_CANVAS,
  affinity: CLUSTER_CANVAS,
};

/**
 * The universal engine: the nodes-and-lines picture, generalised.
 *
 * This is the same visual vocabulary as graph/NeuralCanvas.tsx — columns of
 * nodes, fully wired between adjacent columns, a signal front sweeping across —
 * applied to every researched model rather than only the nine with a derived
 * layer graph. Topology varies by archetype (opposed stacks for the adversarial
 * families, a closed loop for the iterative ones, a straight stack otherwise).
 */
export const NODE_FLOW: Engine = lazy(() =>
  import('./NodeFlow').then((m) => ({ default: m.NodeFlow })),
);

/** Never returns undefined for a researched spec — everything animates. */
export function resolveEngine(spec: MechanismSpec): Engine {
  if (spec.kernelId) {
    const bespoke = KERNEL_ENGINES[spec.kernelId];
    if (bespoke) return bespoke;
  }
  return NODE_FLOW;
}

/** True when the panel shows real computed values rather than flow alone. */
export function hasLiveKernel(spec: MechanismSpec): boolean {
  return !!(spec.kernelId && KERNEL_ENGINES[spec.kernelId]);
}
